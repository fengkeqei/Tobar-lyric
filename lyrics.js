import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function cleanText(value) {
    return String(value ?? '')
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
        return ok ? textFromContents(contents) : '';
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

    const document = embedded.includes('[')
        ? LyricDocument.fromLrc(embedded, 'embedded')
        : LyricDocument.fromPlain(embedded, 'embedded');

    return document.lines.length > 0 ? document : null;
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
        const timestampPattern = /\[(\d+):(\d+(?:[.,]\d+)?)\]/g;

        for (const rawLine of String(text).split('\n')) {
            const timestamps = [...rawLine.matchAll(timestampPattern)];
            const lyricText = cleanText(rawLine.replace(/\[[^\]]+\]/g, ''));

            if (timestamps.length === 0) {
                const tag = rawLine.match(/^\[([a-z]+):([^\]]*)\]$/i);
                if (tag)
                    metadata[tag[1].toLowerCase()] = cleanText(tag[2]);
                continue;
            }

            if (!lyricText)
                continue;

            for (const [, minute, second] of timestamps) {
                const seconds = Number(minute) * 60 + Number(second.replace(',', '.'));
                const offset = Number(metadata.offset ?? 0) / 1000;
                lines.push({time: Math.max(0, seconds + offset), text: lyricText});
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

export function findLocalLyrics(snapshot, settings) {
    const metadata = snapshot?.metadata ?? {};
    const artist = getArtist(metadata);
    const title = getTitle(metadata);
    let trackFile = null;

    if (snapshot?.url?.startsWith('file://')) {
        try {
            trackFile = Gio.File.new_for_uri(snapshot.url);
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
        if (text)
            return LyricDocument.fromLrc(text, 'local');
    }

    return null;
}
