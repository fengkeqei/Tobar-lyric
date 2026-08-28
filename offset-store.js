import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MAX_ENTRIES = 500;

// Per-track lyric offsets persisted in the user cache dir, keyed by
// normalized "artist - title". Values are seconds; positive delays the
// lyric timeline relative to playback.
export class OffsetStore {
    constructor() {
        this._map = {};
        this._loaded = false;
        this._path = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'lyric-ex',
            'offsets.json',
        ]);
    }

    _ensureLoaded() {
        if (this._loaded)
            return;
        this._loaded = true;

        try {
            const [ok, contents] = Gio.File.new_for_path(this._path)
                .load_contents(null);
            if (!ok)
                return;
            const parsed = JSON.parse(new TextDecoder().decode(contents));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                this._map = parsed;
        } catch (_error) {
            this._map = {};
        }
    }

    _save() {
        try {
            const file = Gio.File.new_for_path(this._path);
            file.get_parent().make_directory_with_parents(null);
            file.replace_contents(
                JSON.stringify(this._map),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                console.warn(`Lyric Ex offset store: ${error.message}`);
        }
    }

    static normalizeKey(title, artist) {
        const clean = value => String(value ?? '')
            .trim()
            .toLowerCase();
        return `${clean(artist)}\u0000${clean(title)}`;
    }

    get(title, artist) {
        this._ensureLoaded();
        const value = Number(
            this._map[OffsetStore.normalizeKey(title, artist)]
        );
        return Number.isFinite(value) ? value : 0;
    }

    set(title, artist, seconds) {
        this._ensureLoaded();
        const key = OffsetStore.normalizeKey(title, artist);
        const value = Math.max(-20, Math.min(20, Number(seconds) || 0));
        if (Math.abs(value) < 0.01)
            delete this._map[key];
        else
            this._map[key] = value;

        // Keep the file bounded; drop arbitrary entries beyond the cap.
        const keys = Object.keys(this._map);
        if (keys.length > MAX_ENTRIES) {
            for (const stale of keys.slice(0, keys.length - MAX_ENTRIES))
                delete this._map[stale];
        }

        this._save();
        return value;
    }

    clear() {
        this._map = {};
        this._loaded = true;
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch (_error) {
            // Missing file is fine; nothing to clear.
        }
    }
}
