import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {decryptKrc} from './krc.js';
import {isWordSyncedText, parseLyricsText, parseWordSyncedText} from './lyrics.js';

const USER_AGENT = 'LyricEx/4.0 GNOME/50';

export const PROVIDERS = [
    {id: 'netease', name: '网易云音乐', description: '国内带时间轴歌词源'},
    {id: 'qqmusic', name: 'QQ 音乐', description: '国内歌曲和歌词源'},
    {id: 'kugou', name: '酷狗音乐', description: '国内歌曲和歌词源'},
    {id: 'lrclib', name: 'LRCLIB', description: '国际带时间轴歌词源'},
    {id: 'lyrics-ovh', name: 'Lyrics.ovh', description: '纯文本歌词备用源'},
];

export function providerName(providerId) {
    return PROVIDERS.find(provider => provider.id === providerId)?.name ??
        String(providerId ?? '');
}

function encode(value) {
    return encodeURIComponent(String(value ?? ''));
}

function withQuery(base, parameters) {
    const query = Object.entries(parameters)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${encode(key)}=${encode(value)}`)
        .join('&');
    return query ? `${base}?${query}` : base;
}

function decodeBytes(bytes) {
    return new TextDecoder('utf-8').decode(bytes.get_data());
}

function decodeBase64(value) {
    try {
        return new TextDecoder('utf-8').decode(
            GLib.base64_decode(String(value ?? ''))
        );
    } catch (_error) {
        return '';
    }
}

function parseJson(text) {
    const value = String(text ?? '').trim();
    if (!value)
        return null;

    const jsonp = value.match(/^[^(]+\(([\s\S]*)\)\s*;?\s*$/);
    try {
        return JSON.parse(jsonp ? jsonp[1] : value);
    } catch (_error) {
        return null;
    }
}

function artistText(snapshot) {
    const artist = snapshot.artist || snapshot.metadata?.['xesam:artist'] || '';
    return Array.isArray(artist)
        ? artist.map(value => String(value ?? '')).filter(Boolean).join(' ')
        : String(artist);
}

function durationSeconds(snapshot) {
    const value = snapshot.metadata?.['mpris:length'] ?? snapshot.length ?? 0;
    const length = Number(value?.deep_unpack?.() ?? value);
    const seconds = Number.isFinite(length) && length > 0
        ? Math.round(length / 1_000_000)
        : 0;
    return seconds >= 1 && seconds <= 3600 ? seconds : 0;
}

function simpleMatchText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function looseMatchText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\(\[【（{<].*?[\)\]】）}>]/g, '')
        .replace(/\b(feat\.?|ft\.?|with)\b.*$/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function textScore(candidate, expected) {
    const candidateText = simpleMatchText(candidate);
    const expectedText = simpleMatchText(expected);
    if (!candidateText || !expectedText)
        return 0;
    if (candidateText === expectedText)
        return 1;

    const looseCandidate = looseMatchText(candidate);
    const looseExpected = looseMatchText(expected);
    if (looseCandidate && looseCandidate === looseExpected)
        return 0.88;
    if (candidateText.includes(expectedText) || expectedText.includes(candidateText))
        return 0.62;
    return 0;
}

function durationScore(candidateSeconds, expectedSeconds) {
    const candidate = Number(candidateSeconds);
    if (!Number.isFinite(candidate) || candidate <= 0 || expectedSeconds <= 0)
        return 0;

    const difference = Math.abs(candidate - expectedSeconds);
    if (difference <= 2)
        return 1;
    if (difference <= 8)
        return 0.65;
    if (difference <= 20)
        return 0.25;
    return 0;
}

function bestCandidate(items, snapshot, readCandidate) {
    const title = snapshot.title || '';
    const artist = artistText(snapshot);
    const duration = durationSeconds(snapshot);
    const scored = [];

    for (const item of items) {
        const candidate = readCandidate(item);
        const titleScore = textScore(candidate.title, title);
        if (title && titleScore === 0)
            continue;

        const artistScore = textScore(candidate.artist, artist);

        const score = titleScore * 0.68 +
            (artist ? artistScore * 0.24 : 0) +
            durationScore(candidate.duration, duration) * 0.08;
        scored.push({item, score});
    }

    scored.sort((left, right) => right.score - left.score);
    const best = scored[0];
    return best && best.score >= (artist ? 0.48 : 0.42)
        ? best.item
        : null;
}

function documentFromText(text, source, synced = true) {
    return parseLyricsText(text, source, synced);
}

let _sharedSession = null;

function sharedSession() {
    if (_sharedSession === null) {
        _sharedSession = new Soup.Session();
        _sharedSession.timeout = 8;
    }
    return _sharedSession;
}

function request(session, cancellable, method, uri, {headers = {}, payload = null, raw = false} = {}) {
    return new Promise(resolve => {
        let message = null;
        try {
            message = Soup.Message.new(method, uri);
        } catch (_error) {
            resolve(null);
            return;
        }

        message.request_headers.append('User-Agent', USER_AGENT);
        if (payload !== null)
            message.set_request_body_from_bytes(
                'application/json',
                GLib.Bytes.new(JSON.stringify(payload))
            );
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);

        session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (_session, result) => {
                try {
                    const bytes = _session.send_and_read_finish(result);
                    const status = message.get_status();
                    if (status < 200 || status >= 300)
                        return resolve(null);
                    resolve(raw ? {bytes: bytes.get_data()} : {text: decodeBytes(bytes)});
                } catch (_error) {
                    resolve(null);
                }
            }
        );
    });
}

const QQ_HEADERS = {Referer: 'https://y.qq.com/'};

// ---------------------------------------------------------------------------
// Provider stages. Every provider exposes search(snapshot) -> candidates and
// fetchLyrics(ref, snapshot) -> document, so automatic matching and the
// manual "re-match" picker share the same code path. Candidates carry a
// JSON-serializable `ref` so a manual pick can be persisted per track.
// ---------------------------------------------------------------------------

async function searchNetease(snapshot) {
    const query = encode(`${snapshot.title || ''} ${artistText(snapshot)}`);
    const response = await request(
        sharedSession(),
        null,
        'GET',
        `https://music.163.com/api/search/get/web?s=${query}&limit=10&type=1`
    );
    const songs = parseJson(response?.text)?.result?.songs ?? [];
    return songs.map(song => ({
        providerId: 'netease',
        ref: {id: song.id},
        title: song.name ?? '',
        artist: song.artists?.map(value => value.name).join(' ') ?? '',
        album: song.album?.name ?? '',
        duration: Number(song.duration ?? 0) / 1000,
    }));
}

async function fetchNeteaseLyrics(ref) {
    const response = await request(
        sharedSession(),
        null,
        'GET',
        `https://music.163.com/api/song/lyric?id=${encode(ref.id)}&lv=0&kv=0&tv=-1&rv=-1`
    );
    const lyric = parseJson(response?.text);
    const document = documentFromText(lyric?.lrc?.lyric, 'netease', true);
    if (document && lyric?.tlyric?.lyric)
        document.attachTranslation(lyric.tlyric.lyric);
    return document;
}

async function searchQqMusic(snapshot) {
    const query = encode(`${snapshot.title || ''} ${artistText(snapshot)}`);
    const response = await request(
        sharedSession(),
        null,
        'GET',
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=10&w=${query}`,
        {headers: QQ_HEADERS}
    );
    const songs = parseJson(response?.text)?.data?.song?.list ?? [];
    return songs.map(song => ({
        providerId: 'qqmusic',
        ref: {songmid: song.songmid, songid: song.songid ?? 0},
        title: song.songname ?? '',
        artist: song.singer?.map(value => value.name).join(' ') ?? '',
        album: song.albumname ?? '',
        duration: Number(song.interval ?? 0),
    }));
}

async function fetchQqMusicLyrics(ref) {
    // musicu.fcg returns QRC (per-word timing) via POST; fall back to the
    // legacy fcg endpoint for plain LRC with a translation track.
    const qrcPayload = {
        req_1: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: {
                songMID: ref.songmid,
                songID: ref.songid ?? 0,
                qrc: 1,
                crypt: 1,
            },
        },
    };
    const qrcResponse = await request(
        sharedSession(),
        null,
        'POST',
        'https://u.y.qq.com/cgi-bin/musicu.fcg',
        {payload: qrcPayload, headers: QQ_HEADERS}
    );
    const info = parseJson(qrcResponse?.text ?? '')?.req_1?.data;
    const qrcText = decodeBase64(info?.lyric);
    const qrcDocument = isWordSyncedText(qrcText)
        ? parseWordSyncedText(qrcText, 'qqmusic')
        : null;
    if (qrcDocument) {
        const qrcTrans = decodeBase64(info?.trans);
        if (qrcTrans)
            qrcDocument.attachTranslation(qrcTrans);
        return qrcDocument;
    }

    const lyricUri = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encode(ref.songmid)}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json`;
    const lyricResponse = await request(
        sharedSession(),
        null,
        'GET',
        lyricUri,
        {headers: QQ_HEADERS}
    );
    const lyric = parseJson(lyricResponse?.text);
    const document = documentFromText(decodeBase64(lyric?.lyric), 'qqmusic', true);
    if (document && lyric?.trans) {
        const transText = decodeBase64(lyric.trans);
        if (transText)
            document.attachTranslation(transText);
    }
    return document;
}

async function searchKugou(snapshot) {
    const query = encode(`${snapshot.title || ''} ${artistText(snapshot)}`);
    const response = await request(
        sharedSession(),
        null,
        'GET',
        `https://mobileservice.kugou.com/api/v3/search/song?keyword=${query}&page=1&pagesize=10`
    );
    const songs = parseJson(response?.text)?.data?.info ?? [];
    return songs.map(song => ({
        providerId: 'kugou',
        ref: {hash: song.hash},
        title: song.songname ?? '',
        artist: song.singername ?? '',
        album: song.album_name ?? '',
        duration: Number(song.duration ?? 0),
    }));
}

async function fetchKugouLyrics(ref) {
    const lyricSearchUri = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${encode(ref.hash)}`;
    const lyricResponse = await request(
        sharedSession(),
        null,
        'GET',
        lyricSearchUri
    );
    const candidates = parseJson(lyricResponse?.text)?.candidates ?? [];
    const candidate = candidates.find(item => item.id && item.accesskey) ??
        candidates[0];
    if (!candidate?.id || !candidate?.accesskey)
        return null;

    // Try the encrypted KRC format first for per-word timing; fall back to
    // plain LRC when KRC is unavailable.
    const krcUri = `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=krc&charset=utf8&id=${encode(candidate.id)}&accesskey=${encode(candidate.accesskey)}`;
    const krcResponse = await request(
        sharedSession(),
        null,
        'GET',
        krcUri,
        {raw: true}
    );
    const krcText = krcResponse ? decryptKrc(krcResponse.bytes) : '';
    const krcDocument = krcText
        ? parseWordSyncedText(krcText, 'kugou')
        : null;
    if (krcDocument)
        return krcDocument;

    const downloadUri = `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=lrc&charset=utf8&id=${encode(candidate.id)}&accesskey=${encode(candidate.accesskey)}`;
    const downloadResponse = await request(
        sharedSession(),
        null,
        'GET',
        downloadUri
    );
    const result = parseJson(downloadResponse?.text);
    return documentFromText(decodeBase64(result?.content), 'kugou', true);
}

async function searchLrclib(snapshot) {
    const artist = artistText(snapshot);
    const title = snapshot.title || '';
    const album = snapshot.album || '';
    const duration = durationSeconds(snapshot);

    // Exact lookup first: the /api/get hit carries the lyrics inline.
    const getUri = withQuery('https://lrclib.net/api/get', {
        track_name: title,
        artist_name: artist,
        album_name: album,
        duration: duration || null,
    });
    const exact = parseJson(
        (await request(sharedSession(), null, 'GET', getUri))?.text
    );
    if (exact?.id)
        return [{
            providerId: 'lrclib',
            ref: {id: exact.id, track_name: exact.trackName ?? title,
                artist_name: exact.artistName ?? artist,
                album_name: exact.albumName ?? album,
                duration: exact.duration ?? duration},
            title: exact.trackName ?? title,
            artist: exact.artistName ?? artist,
            album: exact.albumName ?? album,
            duration: exact.duration ?? duration,
        }];

    const searchUri = withQuery('https://lrclib.net/api/search', {
        track_name: title,
        artist_name: artist,
    });
    const items = parseJson(
        (await request(sharedSession(), null, 'GET', searchUri))?.text
    );
    if (!Array.isArray(items))
        return [];
    return items.map(item => ({
        providerId: 'lrclib',
        ref: {id: item.id, track_name: item.trackName ?? '',
            artist_name: item.artistName ?? '', album_name: item.albumName ?? '',
            duration: item.duration ?? 0},
        title: item.trackName ?? item.name ?? '',
        artist: item.artistName ?? '',
        album: item.albumName ?? '',
        duration: item.duration ?? 0,
    }));
}

async function fetchLrclibLyrics(ref, snapshot) {
    const getUri = withQuery('https://lrclib.net/api/get', {
        track_name: ref.track_name,
        artist_name: ref.artist_name,
        album_name: ref.album_name || null,
        duration: ref.duration || null,
    });
    let item = parseJson(
        (await request(sharedSession(), null, 'GET', getUri))?.text
    );

    // /api/get requires an exact match; fall back to the search index and
    // locate the remembered entry by its stable id.
    if (!item?.syncedLyrics && !item?.plainLyrics) {
        const searchUri = withQuery('https://lrclib.net/api/search', {
            track_name: ref.track_name || snapshot?.title || '',
            artist_name: ref.artist_name || '',
        });
        const items = parseJson(
            (await request(sharedSession(), null, 'GET', searchUri))?.text
        );
        item = Array.isArray(items)
            ? items.find(candidate => candidate.id === ref.id) ?? null
            : null;
    }
    if (!item)
        return null;

    const synced = documentFromText(item.syncedLyrics, 'lrclib', true);
    return synced || documentFromText(item.plainLyrics, 'lrclib', false);
}

async function searchLyricsOvh(snapshot) {
    // The API has no search index; the direct lookup doubles as the search,
    // so only a confirmed hit yields a candidate.
    const document = await fetchLyricsOvhLyrics({
        artist: artistText(snapshot),
        title: snapshot.title || '',
    });
    return document
        ? [{
            providerId: 'lyrics-ovh',
            ref: {
                artist: artistText(snapshot),
                title: snapshot.title || '',
            },
            title: snapshot.title || '',
            artist: artistText(snapshot),
            album: '',
            duration: durationSeconds(snapshot),
        }]
        : [];
}

async function fetchLyricsOvhLyrics(ref) {
    const uri = `https://api.lyrics.ovh/v1/${encode(ref.artist)}/${encode(ref.title)}`;
    const response = await request(sharedSession(), null, 'GET', uri);
    const result = parseJson(response?.text);
    return result
        ? documentFromText(result.lyrics, 'lyrics-ovh', false)
        : null;
}

const SEARCH_STAGES = {
    netease: searchNetease,
    qqmusic: searchQqMusic,
    kugou: searchKugou,
    lrclib: searchLrclib,
    'lyrics-ovh': searchLyricsOvh,
};

const FETCH_STAGES = {
    netease: fetchNeteaseLyrics,
    qqmusic: fetchQqMusicLyrics,
    kugou: fetchKugouLyrics,
    lrclib: fetchLrclibLyrics,
    'lyrics-ovh': fetchLyricsOvhLyrics,
};

export async function searchProvider(providerId, snapshot) {
    const stage = SEARCH_STAGES[providerId];
    if (!stage || !snapshot?.title)
        return [];
    try {
        const candidates = await stage(snapshot);
        return Array.isArray(candidates) ? candidates : [];
    } catch (_error) {
        return [];
    }
}

export async function fetchCandidateLyrics(candidate, snapshot) {
    const stage = candidate ? FETCH_STAGES[candidate.providerId] : null;
    if (!stage)
        return null;
    try {
        return await stage(candidate.ref ?? {}, snapshot);
    } catch (_error) {
        return null;
    }
}

// Candidates from every provider at once, for the manual picker UI.
export async function searchAllProviders(snapshot, providerIds, {limitPerProvider = 6} = {}) {
    const results = await Promise.all(
        providerIds.map(async providerId => {
            const candidates = await searchProvider(providerId, snapshot);
            return candidates.slice(0, limitPerProvider);
        })
    );
    return results.flat();
}

export class OnlineLyricsFetcher {
    constructor(snapshot, providerIds, onResult, onComplete) {
        this._snapshot = snapshot;
        this._providerIds = providerIds;
        this._onResult = onResult;
        this._onComplete = onComplete;
        this._cancellable = new Gio.Cancellable();
        this._providerIndex = 0;
        this._aborted = false;
    }

    start() {
        this._tryNext();
        return this;
    }

    abort() {
        if (this._aborted)
            return;
        this._aborted = true;
        // Cancel in-flight requests instead of merely ignoring their
        // results, so skipping tracks does not leave requests running.
        this._cancellable.cancel();
    }

    async _tryNext() {
        if (this._aborted)
            return;

        if (this._providerIndex >= this._providerIds.length) {
            this._onComplete(null);
            return;
        }

        const providerId = this._providerIds[this._providerIndex++];
        try {
            const candidates = await searchProvider(providerId, this._snapshot);
            if (this._aborted)
                return;
            if (candidates.length === 0)
                return this._tryNext();

            const best = bestCandidate(
                candidates,
                this._snapshot,
                candidate => ({
                    title: candidate.title,
                    artist: candidate.artist,
                    album: candidate.album,
                    duration: candidate.duration,
                })
            );
            if (!best)
                return this._tryNext();

            const document = await fetchCandidateLyrics(best, this._snapshot);
            if (this._aborted)
                return;
            if (!document)
                return this._tryNext();

            this._onResult(document, providerId);
            this._onComplete(providerId);
        } catch (_error) {
            if (!this._aborted)
                this._tryNext();
        }
    }
}
