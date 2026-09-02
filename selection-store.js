import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MAX_ENTRIES = 200;

// Per-track manual lyric choices persisted in the user cache dir, keyed by
// normalized "artist\0title". Each value is {providerId, ref} — the same
// candidate shape used by the online providers, so a remembered pick can be
// refetched directly without running the search again.
export class SelectionStore {
    constructor() {
        this._map = {};
        this._loaded = false;
        this._path = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'lyric-ex',
            'selections.json',
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
                console.warn(`Lyric Ex selection store: ${error.message}`);
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
        const entry = this._map[SelectionStore.normalizeKey(title, artist)];
        return entry && entry.providerId && entry.ref ? entry : null;
    }

    set(title, artist, entry) {
        this._ensureLoaded();
        const key = SelectionStore.normalizeKey(title, artist);
        if (!entry || !entry.providerId || !entry.ref) {
            delete this._map[key];
        } else {
            this._map[key] = {
                providerId: String(entry.providerId),
                ref: entry.ref,
                savedAt: Date.now(),
            };
        }

        // Keep the file bounded; drop the oldest entries beyond the cap.
        const keys = Object.keys(this._map);
        if (keys.length > MAX_ENTRIES) {
            keys.sort((left, right) =>
                (this._map[left].savedAt ?? 0) - (this._map[right].savedAt ?? 0)
            );
            for (const stale of keys.slice(0, keys.length - MAX_ENTRIES))
                delete this._map[stale];
        }

        this._save();
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
