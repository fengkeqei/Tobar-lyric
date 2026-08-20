import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function cleanText(value) {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r/g, '')
        .replace(/\u0000/g, '')
        .trim();
}

function firstValue(value) {
    if (Array.isArray(value))
        return value[0] ?? '';

    return value ?? '';
}

function expandPath(path) {
    const value = cleanText(path);
    if (value === '~')
        return GLib.get_home_dir();
    if (value.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), value.slice(2)]);
    return value;
}

function safeFilename(value) {
    return cleanText(value).replace(/[\\/:*?"<>|]/g, '_');
}

function textFromContents(contents) {
    try {
        return new TextDecoder('utf-8').decode(contents);
    } catch (_error) {
        return '';
    }
}

function readFile(file) {
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok)
            return '';

        const utf8 = textFromContents(contents);
        if (!utf8.includes('\uFFFD') && !utf8.includes('\u0000'))
            return utf8;

        const bytes = contents instanceof Uint8Array
            ? contents
            : new Uint8Array(contents);
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
            return new TextDecoder('utf-16le').decode(bytes);
        if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
            return new TextDecoder('utf-16be').decode(bytes);

        return utf8;
    } catch (_error) {
        return '';
    }
}

export function getArtist(metadata) {
    return cleanText(firstValue(metadata?.['xesam:artist']));
}

export function getTitle(metadata) {
    return cleanText(firstValue(metadata?.['xesam:title']));
}

export function findEmbeddedLyrics(snapshot) {
    const embedded = cleanText(snapshot?.metadata?.['xesam:asText']);
    if (!embedded)
        return null;

    return parseLyricsText(embedded, 'embedded');
}

export class LyricDocument {
    constructor(lines = [], source = 'none') {
        this.lines = lines
            .filter(line => Number.isFinite(line.time) && cleanText(line.text))
            .sort((a, b) => a.time - b.time);
        this.source = source;
    }

    getLineAt(seconds) {
        if (this.lines.length === 0)
            return '';

        let low = 0;
        let high = this.lines.length - 1;
        let result = -1;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if (this.lines[middle].time <= seconds) {
                result = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        return result >= 0 ? this.lines[result].text : '';
    }

    static fromLrc(text, source = 'local') {
        const lines = [];
        const metadata = {};
        const rawLines = String(text).replace(/^\uFEFF/, '').split('\n');
        const timestampPattern =
            /\[(\d+):(\d{1,2})(?:[.,](\d{1,3}))?\]/g;

        for (const rawLine of rawLines) {
            const tag = rawLine.match(/^\s*\[([a-z]+):([^\]]*)\]\s*$/i);
            if (tag)
                metadata[tag[1].toLowerCase()] = cleanText(tag[2]);
        }

        const offset = Number(metadata.offset ?? 0) / 1000;
        for (const rawLine of rawLines) {
            const timestamps = [...rawLine.matchAll(timestampPattern)];
            if (timestamps.length === 0)
                continue;

            const lyricText = cleanText(rawLine.replace(timestampPattern, ''));
            if (!lyricText)
                continue;

            for (const [, minute, second, fraction = '0'] of timestamps) {
                const fractionSeconds = Number(
                    `0.${String(fraction).padEnd(3, '0')}`
                );
                const seconds = Number(minute) * 60 +
                    Number(second) +
                    fractionSeconds;
                if (!Number.isFinite(seconds))
                    continue;

                lines.push({
                    time: Math.max(0, seconds + offset),
                    text: lyricText,
                });
            }
        }

        return new LyricDocument(lines, source);
    }

    static fromPlain(text, source = 'online') {
        const lines = String(text)
            .split('\n')
            .map(cleanText)
            .filter(Boolean)
            .map((line, index) => ({
                time: index * 5,
                text: line,
            }));

        return new LyricDocument(lines, source);
    }
}

const LRC_TIMESTAMP_PATTERN = /\[\d+:\d{1,2}(?:[.,]\d{1,3})?\]/;
const LRC_METADATA_PATTERN = /^\s*\[[a-z]+:[^\]]*\]\s*$/im;

export function isLrcText(text) {
    const value = String(text ?? '');
    return LRC_TIMESTAMP_PATTERN.test(value) ||
        LRC_METADATA_PATTERN.test(value);
}

export function parseLyricsText(text, source = 'local', synced = false) {
    const value = String(text ?? '').trim();
    if (!value)
        return null;

    const document = synced || isLrcText(value)
        ? LyricDocument.fromLrc(value, source)
        : LyricDocument.fromPlain(value, source);
    return document.lines.length > 0 ? document : null;
}

export function findLocalLyrics(snapshot, settings) {
    const metadata = snapshot?.metadata ?? {};
    const artist = getArtist(metadata);
    const title = getTitle(metadata);
    let trackFile = null;

    if (snapshot?.url) {
        try {
            trackFile = snapshot.url.startsWith('/')
                ? Gio.File.new_for_path(snapshot.url)
                : Gio.File.new_for_uri(snapshot.url);
        } catch (_error) {
            trackFile = null;
        }
    }

    const directories = (settings?.get_strv('local-directories') ?? [])
        .map(expandPath)
        .filter(Boolean);

    const candidates = [];
    const trackBasename = trackFile?.get_basename?.() ?? '';
    const trackStem = trackBasename.replace(/\.[^.]+$/, '');
    if (trackFile?.get_parent?.() && trackStem)
        candidates.push(trackFile.get_parent().get_child(`${trackStem}.lrc`));

    const names = [
        `${safeFilename(artist)} - ${safeFilename(title)}.lrc`,
        `${safeFilename(title)}.lrc`,
        `${safeFilename(artist)}-${safeFilename(title)}.lrc`,
    ].filter(name => name !== '.lrc' && !name.startsWith(' - '));

    for (const directory of directories) {
        for (const name of names)
            candidates.push(Gio.File.new_for_path(
                GLib.build_filenamev([directory, name])
            ));
    }

    for (const candidate of candidates) {
        const text = readFile(candidate);
        if (!text)
            continue;

        const document = parseLyricsText(text, 'local');
        if (document?.lines.length > 0)
            return document;
    }

    return null;
}
