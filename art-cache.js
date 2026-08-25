import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const MAX_ART_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_CACHED_FILES = 128;

export class ArtCache {
    constructor() {
        this._session = new Soup.Session({timeout: 15});
        this._cancellable = new Gio.Cancellable();
        this._pending = new Map();
        this._cacheDir = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'lyric-ex',
            'card-art',
        ]));

        try {
            this._cacheDir.make_directory_with_parents(null);
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                console.warn(`Lyric Ex art cache: ${error.message}`);
        }
    }

    async resolve(url) {
        if (!url)
            return null;

        if (url.startsWith('file://')) {
            const file = Gio.File.new_for_uri(url);
            const path = file.get_path();
            return path && GLib.file_test(path, GLib.FileTest.EXISTS)
                ? path
                : null;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://'))
            return null;

        const name = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256,
            url,
            -1
        );
        const target = this._cacheDir.get_child(name);
        const path = target.get_path();
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;

        if (this._pending.has(url))
            return this._pending.get(url);

        const request = this._download(url, target)
            .finally(() => this._pending.delete(url));
        this._pending.set(url, request);
        return request;
    }

    _send(message) {
        return new Promise((resolve, reject) => {
            this._session.send_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (session, result) => {
                    try {
                        resolve(session.send_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    _readChunk(stream) {
        return new Promise((resolve, reject) => {
            stream.read_bytes_async(
                CHUNK_BYTES,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (source, result) => {
                    try {
                        resolve(source.read_bytes_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    async _readBounded(stream) {
        const chunks = [];
        let total = 0;
        for (;;) {
            const chunk = await this._readChunk(stream);
            const size = chunk.get_size();
            if (size === 0)
                break;

            total += size;
            if (total > MAX_ART_BYTES)
                return null;
            chunks.push(chunk.toArray());
        }

        if (!total)
            return null;

        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return new GLib.Bytes(data);
    }

    _writeBytes(file, bytes) {
        return new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                bytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                this._cancellable,
                (target, result) => {
                    try {
                        target.replace_contents_finish(result);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                }
            );
        });
    }

    async _download(url, target) {
        try {
            const message = Soup.Message.new('GET', url);
            const stream = await this._send(message);
            if (message.get_status() !== Soup.Status.OK) {
                stream.close(null);
                return null;
            }

            const declared =
                message.get_response_headers().get_content_length();
            if (declared > MAX_ART_BYTES) {
                stream.close(null);
                return null;
            }

            const bytes = await this._readBounded(stream);
            stream.close(null);
            if (!bytes)
                return null;

            await this._writeBytes(target, bytes);
            this._prune();
            return target.get_path();
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Lyric Ex art download failed: ${error.message}`);
            return null;
        }
    }

    _prune() {
        const attributes = [
            Gio.FILE_ATTRIBUTE_STANDARD_NAME,
            Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
        ].join(',');
        this._cacheDir.enumerate_children_async(
            attributes,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW,
            this._cancellable,
            (directory, result) => {
                let enumerator;
                try {
                    enumerator = directory.enumerate_children_finish(result);
                } catch (_error) {
                    return;
                }
                enumerator.next_files_async(
                    MAX_CACHED_FILES + 16,
                    GLib.PRIORITY_LOW,
                    this._cancellable,
                    (source, nextResult) => {
                        let infos;
                        try {
                            infos = source.next_files_finish(nextResult);
                        } catch (_error) {
                            return;
                        }
                        if (infos.length <= MAX_CACHED_FILES)
                            return;

                        infos.sort((left, right) =>
                            Number(right.get_attribute_uint64(
                                Gio.FILE_ATTRIBUTE_TIME_MODIFIED
                            ) - left.get_attribute_uint64(
                                Gio.FILE_ATTRIBUTE_TIME_MODIFIED
                            ))
                        );
                        for (const info of infos.slice(MAX_CACHED_FILES)) {
                            this._cacheDir.get_child(info.get_name()).delete_async(
                                GLib.PRIORITY_LOW,
                                this._cancellable,
                                () => {}
                            );
                        }
                    }
                );
            }
        );
    }

    destroy() {
        this._cancellable.cancel();
        this._pending.clear();
        this._session?.abort();
        this._session = null;
    }
}
