import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const DO_NOT_AUTO_START = Gio.DBusProxyFlags.DO_NOT_AUTO_START;

function unpack(value) {
    if (!value)
        return null;

    try {
        return value.deep_unpack();
    } catch (_error) {
        return null;
    }
}

function asString(value) {
    if (Array.isArray(value))
        return value.map(item => String(item ?? '')).filter(Boolean).join(' ');
    return String(value ?? '');
}

function asBoolean(value) {
    return Boolean(value);
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

const TRACK_IDENTITY_FIELDS = [
    'busName',
    'trackId',
    'title',
    'artist',
    'album',
];

export function sameTrackIdentity(left, right) {
    if (!left || !right)
        return left === right;

    return TRACK_IDENTITY_FIELDS.every(field =>
        String(left[field] ?? '') === String(right[field] ?? '')
    );
}

function unpackMetadata(value) {
    const unpacked = unpack(value) ?? {};
    const metadata = {};

    if (unpacked instanceof Map) {
        for (const [key, field] of unpacked.entries())
            metadata[key] = unpack(field) ?? field;
        return metadata;
    }

    for (const [key, field] of Object.entries(unpacked))
        metadata[key] = unpack(field) ?? field;

    return metadata;
}

export class MprisController {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._players = new Map();
        this._current = null;
        this._destroyed = false;
        this._dbus = Gio.DBus.session;
        this._busProxy = Gio.DBusProxy.new_sync(
            this._dbus,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            'org.freedesktop.DBus',
            null
        );
        this._signalId = this._busProxy.connect(
            'g-signal',
            (_proxy, _sender, signal, parameters) => {
                if (signal !== 'NameOwnerChanged')
                    return;

                const [name] = parameters.deep_unpack();
                if (!String(name).startsWith('org.mpris.MediaPlayer2.'))
                    return;

                this._discoverPlayers();
            }
        );
        this._discoverPlayers();
    }

    destroy() {
        this._destroyed = true;
        if (this._signalId) {
            this._busProxy.disconnect(this._signalId);
            this._signalId = 0;
        }

        for (const player of this._players.values()) {
            player.proxy.disconnect(player.propertySignalId);
            player.proxy.disconnect(player.signalId);
        }

        this._players.clear();
        this._current = null;
        this._onChanged(null);
    }

    next() {
        this._callCurrent('Next');
    }

    previous() {
        this._callCurrent('Previous');
    }

    playPause() {
        this._callCurrent('PlayPause');
    }

    getCurrentPositionSeconds() {
        if (!this._current)
            return 0;

        if (this._current.status !== 'Playing')
            this._refreshCurrentPosition();

        return this._positionAt(GLib.get_monotonic_time()) / 1_000_000;
    }

    _positionAt(timestamp) {
        const current = this._current;
        if (!current)
            return 0;

        const base = asNumber(current.position);
        if (current.status !== 'Playing')
            return base;

        return base + Math.max(
            0,
            timestamp - current.positionTimestamp
        );
    }

    _refreshCurrentPosition() {
        const current = this._current;
        if (!current)
            return;

        const position = asNumber(
            unpack(current.proxy.get_cached_property('Position'))
        );
        if (position === current.position)
            return;

        current.position = position;
        current.positionTimestamp = GLib.get_monotonic_time();
    }

    _callCurrent(method) {
        const player = this._current?.proxy;
        if (!player)
            return;

        player.call(
            method,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    logError(error, `Lyric Ex MPRIS ${method} failed`);
                }
            }
        );
    }

    _discoverPlayers() {
        if (this._destroyed)
            return;

        this._busProxy.call(
            'ListNames',
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (proxy, result) => {
                if (this._destroyed)
                    return;

                try {
                    const [names] = proxy.call_finish(result).deep_unpack();
                    const playerNames = names
                        .filter(name => String(name).startsWith('org.mpris.MediaPlayer2.'))
                        .filter(name => name !== 'org.mpris.MediaPlayer2.playerctld');

                    for (const name of playerNames)
                        this._ensurePlayer(name);

                    for (const name of this._players.keys()) {
                        if (!playerNames.includes(name))
                            this._removePlayer(name);
                    }

                    this._emitCurrent();
                } catch (_error) {
                    this._emitCurrent();
                }
            }
        );
    }

    _ensurePlayer(busName) {
        if (this._players.has(busName))
            return;

        try {
            const proxy = Gio.DBusProxy.new_sync(
                this._dbus,
                DO_NOT_AUTO_START,
                null,
                busName,
                OBJECT_PATH,
                PLAYER_INTERFACE,
                null
            );
            const propertySignalId = proxy.connect(
                'g-properties-changed',
                () => this._emitCurrent()
            );
            const signalId = proxy.connect(
                'g-signal',
                (_proxy, _sender, signal, parameters) => {
                    if (signal !== 'Seeked')
                        return;

                    const [position] = parameters.deep_unpack();
                    const current = this._current;
                    if (!current || current.busName !== busName) {
                        this._emitCurrent();
                        return;
                    }

                    current.position = asNumber(position);
                    current.positionTimestamp = GLib.get_monotonic_time();
                    this._onChanged(current);
                }
            );
            this._players.set(busName, {proxy, propertySignalId, signalId});
        } catch (_error) {
            // A player can disappear between ListNames and proxy creation.
        }
    }

    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;

        player.proxy.disconnect(player.propertySignalId);
        player.proxy.disconnect(player.signalId);
        this._players.delete(busName);
    }

    _snapshot(busName, player) {
        const metadataVariant = player.proxy.get_cached_property('Metadata');
        const metadata = unpackMetadata(metadataVariant);
        const positionVariant = player.proxy.get_cached_property('Position');
        const statusVariant = player.proxy.get_cached_property('PlaybackStatus');
        const canGoNextVariant = player.proxy.get_cached_property('CanGoNext');
        const canGoPreviousVariant = player.proxy.get_cached_property('CanGoPrevious');
        const canPlayVariant = player.proxy.get_cached_property('CanPlay');

        return {
            busName,
            proxy: player.proxy,
            metadata,
            trackId: asString(metadata['mpris:trackid']),
            title: asString(metadata['xesam:title']),
            artist: asString(metadata['xesam:artist']),
            album: asString(metadata['xesam:album']),
            url: asString(metadata['xesam:url']),
            status: asString(unpack(statusVariant)),
            position: asNumber(unpack(positionVariant)),
            canGoNext: asBoolean(unpack(canGoNextVariant)),
            canGoPrevious: asBoolean(unpack(canGoPreviousVariant)),
            canPlay: asBoolean(unpack(canPlayVariant)),
            identity: asString(unpack(player.proxy.get_cached_property('Identity'))),
            positionTimestamp: GLib.get_monotonic_time(),
        };
    }

    _emitCurrent() {
        if (this._destroyed)
            return;

        const snapshots = [...this._players.entries()]
            .map(([name, player]) => this._snapshot(name, player));
        const playing = snapshots.find(snapshot => snapshot.status === 'Playing');
        const paused = snapshots.find(snapshot => snapshot.status === 'Paused');
        const next = playing ?? paused ?? null;
        const previous = this._current;
        const now = GLib.get_monotonic_time();

        if (next && previous && sameTrackIdentity(next, previous)) {
            next.position = previous.status === 'Playing'
                ? this._positionAt(now)
                : previous.position;
            next.positionTimestamp = now;
        }

        const trackChanged =
            Boolean(next) !== Boolean(previous) ||
            !sameTrackIdentity(next, previous);
        const currentChanged = trackChanged ||
            next?.status !== previous?.status ||
            next?.canGoNext !== previous?.canGoNext ||
            next?.canGoPrevious !== previous?.canGoPrevious ||
            next?.canPlay !== previous?.canPlay;

        if (currentChanged) {
            this._current = next;
            this._onChanged(this._current);
            return;
        }

        if (next)
            this._current = next;
    }
}
