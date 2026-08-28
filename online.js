import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {decryptKrc} from './krc.js';
import {isWordSyncedText, parseLyricsText, parseWordSyncedText} from './lyrics.js';

export const PROVIDERS = [
    {id: 'netease', name: '网易云音乐', description: '国内带时间轴歌词源'},
    {id: 'qqmusic', name: 'QQ 音乐', description: '国内歌曲和歌词源'},
    {id: 'kugou', name: '酷狗音乐', description: '国内歌曲和歌词源'},
    {id: 'lrclib', name: 'LRCLIB', description: '国际带时间轴歌词源'},
    {id: 'lyrics-ovh', name: 'Lyrics.ovh', description: '纯文本歌词备用源'},
];

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

export class OnlineLyricsFetcher {
    constructor(snapshot, providerIds, onResult, onComplete) {
        this._snapshot = snapshot;
        this._providerIds = providerIds;
        this._onResult = onResult;
        this._onComplete = onComplete;
        this._session = sharedSession();
        this._providerIndex = 0;
        this._aborted = false;
    }

    start() {
        this._tryNext();
        return this;
    }

    abort() {
        // The session is shared across fetchers, so only detach; pending
        // responses are ignored via the _aborted flag.
        this._aborted = true;
    }

    _tryNext() {
        if (this._aborted)
            return;

        if (this._providerIndex >= this._providerIds.length) {
            this._onComplete(null);
            return;
        }

        const providerId = this._providerIds[this._providerIndex++];
        const handler = {
            lrclib: callback => this._fetchLrclib(callback),
            netease: callback => this._fetchNetease(callback),
            qqmusic: callback => this._fetchQqMusic(callback),
            kugou: callback => this._fetchKugou(callback),
            'lyrics-ovh': callback => this._fetchLyricsOvh(callback),
        }[providerId];

        if (!handler) {
            this._tryNext();
            return;
        }

        try {
            handler(result => {
                if (this._aborted)
                    return;

                if (result) {
                    this._onResult(result, providerId);
                    this._onComplete(providerId);
                } else {
                    this._tryNext();
                }
            });
        } catch (_error) {
            this._tryNext();
        }
    }

    _request(uri, callback, headers = {}) {
        const message = Soup.Message.new('GET', uri);
        message.request_headers.append('User-Agent', 'LyricEx/4.0 GNOME/50');
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                if (this._aborted)
                    return;

                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() < 200 || message.get_status() >= 300) {
                        callback(null);
                        return;
                    }

                    callback({text: decodeBytes(bytes), status: message.get_status()});
                } catch (_error) {
                    callback(null);
                }
            }
        );
    }

    // Raw response bytes, for encrypted formats such as Kugou KRC.
    _requestBytes(uri, callback, headers = {}) {
        const message = Soup.Message.new('GET', uri);
        message.request_headers.append('User-Agent', 'LyricEx/4.0 GNOME/50');
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                if (this._aborted)
                    return;

                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() < 200 || message.get_status() >= 300)
                        return callback(null);
                    callback({bytes: bytes.get_data(), status: message.get_status()});
                } catch (_error) {
                    callback(null);
                }
            }
        );
    }

    // JSON POST used by endpoints (such as QQ Music's musicu.fcg) that
    // reject plain GET requests.
    _postJson(uri, payload, callback, headers = {}) {
        const message = Soup.Message.new('POST', uri);
        message.request_headers.append('User-Agent', 'LyricEx/4.0 GNOME/50');
        message.request_headers.append('Content-Type', 'application/json');
        for (const [name, value] of Object.entries(headers))
            message.request_headers.append(name, value);

        const body = GLib.Bytes.new(JSON.stringify(payload));
        message.set_request_body_from_bytes('application/json', body);
        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                if (this._aborted)
                    return;

                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() < 200 || message.get_status() >= 300)
                        return callback(null);
                    callback({text: decodeBytes(bytes)});
                } catch (_error) {
                    callback(null);
                }
            }
        );
    }

    _fetchLrclib(callback) {
        const artist = artistText(this._snapshot);
        const title = this._snapshot.title || '';
        const album = this._snapshot.album || '';
        const duration = durationSeconds(this._snapshot);
        const uri = withQuery('https://lrclib.net/api/get', {
            track_name: title,
            artist_name: artist,
            album_name: album,
            duration: duration || null,
        });

        this._request(uri, response => {
            const result = response ? parseJson(response.text) : null;
            const synced = documentFromText(
                result?.syncedLyrics,
                'lrclib',
                true
            );
            const plain = documentFromText(
                result?.plainLyrics,
                'lrclib',
                false
            );
            if (synced || plain)
                return callback(synced || plain);

            const searchUri = withQuery('https://lrclib.net/api/search', {
                track_name: title,
                artist_name: artist,
            });
            this._request(searchUri, searchResponse => {
                if (!searchResponse)
                    return callback(null);

                const items = parseJson(searchResponse.text);
                if (!Array.isArray(items))
                    return callback(null);

                const item = bestCandidate(
                    items,
                    this._snapshot,
                    candidate => ({
                        title: candidate.trackName || candidate.name,
                        artist: candidate.artistName,
                        album: candidate.albumName,
                        duration: candidate.duration,
                    })
                );
                if (!item)
                    return callback(null);

                const searchSynced = documentFromText(
                    item.syncedLyrics,
                    'lrclib',
                    true
                );
                const searchPlain = documentFromText(
                    item.plainLyrics,
                    'lrclib',
                    false
                );
                callback(searchSynced || searchPlain);
            });
        });
    }

    _fetchLyricsOvh(callback) {
        const artist = artistText(this._snapshot);
        const title = this._snapshot.title || '';
        const uri = `https://api.lyrics.ovh/v1/${encode(artist)}/${encode(title)}`;

        this._request(uri, response => {
            if (!response)
                return callback(null);

            const result = parseJson(response.text);
            callback(result ? documentFromText(result.lyrics, 'lyrics-ovh', false) : null);
        });
    }

    _fetchNetease(callback) {
        const artist = artistText(this._snapshot);
        const title = this._snapshot.title || '';
        const query = encode(`${title} ${artist}`);
        const searchUri = `https://music.163.com/api/search/get/web?s=${query}&limit=10&type=1`;

        this._request(searchUri, response => {
            if (!response)
                return callback(null);

            const songs = parseJson(response.text)?.result?.songs ?? [];
            const song = bestCandidate(songs, this._snapshot, item => ({
                title: item.name,
                artist: item.artists?.map(value => value.name).join(' ') ?? '',
                album: item.album?.name ?? '',
                duration: Number(item.duration ?? 0) / 1000,
            }));
            if (!song?.id)
                return callback(null);

            const lyricUri = `https://music.163.com/api/song/lyric?id=${song.id}&lv=0&kv=0&tv=-1&rv=-1`;
            this._request(lyricUri, lyricResponse => {
                if (!lyricResponse)
                    return callback(null);

                const lyric = parseJson(lyricResponse.text)?.lrc?.lyric;
                callback(documentFromText(lyric, 'netease', true));
            });
        });
    }

    _fetchQqMusic(callback) {
        const artist = artistText(this._snapshot);
        const title = this._snapshot.title || '';
        const query = encode(`${title} ${artist}`);
        const searchUri = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=10&w=${query}`;

        this._request(searchUri, response => {
            if (!response)
                return callback(null);

            const songs = parseJson(response.text)?.data?.song?.list ?? [];
            const song = bestCandidate(songs, this._snapshot, item => ({
                title: item.songname,
                artist: item.singer?.map(value => value.name).join(' ') ?? '',
                album: item.albumname ?? '',
                duration: Number(item.interval ?? 0),
            }));
            if (!song?.songmid)
                return callback(null);

            // musicu.fcg returns QRC (per-word timing) via POST; fall back
            // to the legacy fcg endpoint for plain LRC.
            const qrcPayload = {
                req_1: {
                    module: 'music.musichallSong.PlayLyricInfo',
                    method: 'GetPlayLyricInfo',
                    param: {
                        songMID: song.songmid,
                        songID: song.songid ?? 0,
                        qrc: 1,
                        crypt: 1,
                    },
                },
            };
            this._postJson(
                'https://u.y.qq.com/cgi-bin/musicu.fcg',
                qrcPayload,
                qrcResponse => {
                    if (this._aborted)
                        return;

                    const info = parseJson(qrcResponse?.text ?? '')?.req_1?.data;
                    const qrcText = decodeBase64(info?.lyric);
                    const qrcDocument = isWordSyncedText(qrcText)
                        ? parseWordSyncedText(qrcText, 'qqmusic')
                        : null;
                    if (qrcDocument)
                        return callback(qrcDocument);

                    this._fetchQqMusicLrc(song.songmid, callback);
                }
            );
        }, {Referer: 'https://y.qq.com/'});
    }

    _fetchQqMusicLrc(songmid, callback) {
        const lyricUri = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encode(songmid)}&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json`;
        this._request(lyricUri, lyricResponse => {
            if (!lyricResponse)
                return callback(null);

            const lyric = decodeBase64(parseJson(lyricResponse.text)?.lyric);
            callback(documentFromText(lyric, 'qqmusic', true));
        }, {Referer: 'https://y.qq.com/'});
    }

    _fetchKugou(callback) {
        const artist = artistText(this._snapshot);
        const title = this._snapshot.title || '';
        const searchUri = `https://mobileservice.kugou.com/api/v3/search/song?keyword=${encode(`${title} ${artist}`)}&page=1&pagesize=10`;

        this._request(searchUri, response => {
            if (!response)
                return callback(null);

            const songs = parseJson(response.text)?.data?.info ?? [];
            const song = bestCandidate(songs, this._snapshot, item => ({
                title: item.songname,
                artist: item.singername ?? '',
                album: item.album_name ?? '',
                duration: Number(item.duration ?? 0),
            }));
            if (!song?.hash)
                return callback(null);

            const lyricSearchUri = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${encode(song.hash)}`;
            this._request(lyricSearchUri, lyricResponse => {
                if (!lyricResponse)
                    return callback(null);

                const candidates = parseJson(lyricResponse.text)?.candidates ?? [];
                const candidate = bestCandidate(candidates, this._snapshot, item => ({
                    title: item.song,
                    artist: item.singer,
                    album: '',
                    duration: Number(item.duration ?? 0) / 1000,
                })) ?? candidates[0];
                if (!candidate?.id || !candidate?.accesskey)
                    return callback(null);

                // Try the encrypted KRC format first for per-word timing;
                // fall back to plain LRC when KRC is unavailable.
                const krcUri = `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=krc&charset=utf8&id=${encode(candidate.id)}&accesskey=${encode(candidate.accesskey)}`;
                this._requestBytes(krcUri, krcResponse => {
                    if (this._aborted)
                        return;

                    const krcText = krcResponse
                        ? decryptKrc(krcResponse.bytes)
                        : '';
                    const krcDocument = krcText
                        ? parseWordSyncedText(krcText, 'kugou')
                        : null;
                    if (krcDocument)
                        return callback(krcDocument);

                    const downloadUri = `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=lrc&charset=utf8&id=${encode(candidate.id)}&accesskey=${encode(candidate.accesskey)}`;
                    this._request(downloadUri, downloadResponse => {
                        if (!downloadResponse)
                            return callback(null);

                        const result = parseJson(downloadResponse.text);
                        const lyric = decodeBase64(result?.content);
                        callback(documentFromText(lyric, 'kugou', true));
                    });
                });
            });
        });
    }
}
