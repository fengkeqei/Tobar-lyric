import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const ROOT_INTERFACE = 'org.mpris.MediaPlayer2';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
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

function logError(error, context) {
    if (error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        return;
    console.warn(`${context}: ${error?.message ?? error}`);
}

function normalizeAppId(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\.desktop$/, '');
}

export function playerAppId(busName, identity = '', desktopEntry = '') {
    const stableId = normalizeAppId(desktopEntry) || normalizeAppId(identity);
    if (stableId)
        return stableId;

    const prefix = 'org.mpris.MediaPlayer2.';
    const suffix = String(busName ?? '').startsWith(prefix)
        ? String(busName).slice(prefix.length)
        : String(busName ?? '');
    return suffix.replace(/\.instance[0-9]+$/, '') || suffix;
}

export function selectPreferredPlayer(
    snapshots,
    {filterEnabled = false, enabledApps = [], appOrder = []} = {}
) {
    const enabled = new Set(
        enabledApps.map(appId => normalizeAppId(appId)).filter(Boolean)
    );
    const order = appOrder
        .map(appId => normalizeAppId(appId))
        .filter((appId, index, ids) => appId && ids.indexOf(appId) === index);
    const rank = snapshot => {
        const index = order.indexOf(normalizeAppId(snapshot.appId));
        return index >= 0 ? index : order.length;
    };
    const allowed = [...snapshots]
        .filter(snapshot =>
            !filterEnabled || enabled.has(normalizeAppId(snapshot.appId))
        )
        .sort((left, right) => {
            const rankDifference = rank(left) - rank(right);
            if (rankDifference)
                return rankDifference;
            const appDifference = normalizeAppId(left.appId)
                .localeCompare(normalizeAppId(right.appId));
            if (appDifference)
                return appDifference;
            return String(left.busName ?? '').localeCompare(
                String(right.busName ?? '')
            );
        });

    return allowed.find(snapshot => snapshot.status === 'Playing') ??
        allowed.find(snapshot => snapshot.status === 'Paused') ??
        null;
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
    constructor(onChanged, options = {}) {
        this._onChanged = onChanged;
        this._onPlayersChanged = options.onPlayersChanged ?? null;
        this._players = new Map();
        this._current = null;
        this._selectedBusName = null;
        this._destroyed = false;
<<<<<<< HEAD
        this._discoverPendingId = 0;
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        this._filterEnabled = false;
        this._enabledApps = new Set();
        this._appOrder = [];
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

<<<<<<< HEAD
                const [name, oldOwner, newOwner] = parameters.deep_unpack();
                if (!String(name).startsWith('org.mpris.MediaPlayer2.'))
                    return;
                if (!oldOwner && !newOwner)
                    return;

                this._scheduleDiscover();
=======
                const [name] = parameters.deep_unpack();
                if (!String(name).startsWith('org.mpris.MediaPlayer2.'))
                    return;

                this._discoverPlayers();
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
            }
        );
        this._discoverPlayers();
    }

<<<<<<< HEAD
    _scheduleDiscover() {
        if (this._destroyed || this._discoverPendingId)
            return;

        this._discoverPendingId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            300,
            () => {
                this._discoverPendingId = 0;
                this._discoverPlayers();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
    setPlayerSelection({filterEnabled = false, enabledApps = [], appOrder = []} = {}) {
        this._filterEnabled = Boolean(filterEnabled);
        this._enabledApps = new Set(
            enabledApps.map(appId => normalizeAppId(appId)).filter(Boolean)
        );
        this._appOrder = appOrder
            .map(appId => normalizeAppId(appId))
            .filter((appId, index, ids) => appId && ids.indexOf(appId) === index);
        this._emitCurrent();
    }

    getPlayers() {
        return this._getSnapshots();
    }

    selectPlayer(busName) {
        const player = this._getSnapshots().find(
            snapshot => snapshot.busName === busName && this._isAllowed(snapshot)
        );
        if (!player)
            return;

        this._selectedBusName = busName;
        this._emitCurrent();
    }

    clearSelectedPlayer() {
        if (!this._selectedBusName)
            return;
        this._selectedBusName = null;
        this._emitCurrent();
    }

    destroy() {
        this._destroyed = true;
<<<<<<< HEAD
        if (this._discoverPendingId) {
            GLib.source_remove(this._discoverPendingId);
            this._discoverPendingId = 0;
        }
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        if (this._signalId) {
            this._busProxy.disconnect(this._signalId);
            this._signalId = 0;
        }

        for (const player of this._players.values()) {
            player.proxy.disconnect(player.propertySignalId);
            player.proxy.disconnect(player.signalId);
            player.rootProxy?.disconnect(player.rootPropertySignalId);
        }

        this._players.clear();
        this._current = null;
        this._selectedBusName = null;
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

    getCurrentPositionMicros() {
        if (!this._current)
            return 0;

        if (this._current.status !== 'Playing')
            this._refreshCurrentPosition();

        return this._positionAt(GLib.get_monotonic_time());
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

    seek(offsetMicros) {
        const player = this._current?.proxy;
        if (!player || !this._current.canSeek)
            return;

        player.call(
            'Seek',
            new GLib.Variant('(x)', [Math.trunc(offsetMicros)]),
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    logError(error, 'Lyric Ex seek failed');
                }
            }
        );
    }

    setPosition(positionMicros) {
        const current = this._current;
        if (!current || !current.canSeek)
            return;

        const trackId = current.trackId;
        if (trackId && trackId.startsWith('/')) {
            current.proxy.call(
                'SetPosition',
                new GLib.Variant('(ox)', [
                    trackId,
                    Math.max(0, Math.trunc(positionMicros)),
                ]),
                Gio.DBusCallFlags.NO_AUTO_START,
                -1,
                null,
                (proxy, result) => {
                    try {
                        proxy.call_finish(result);
                    } catch (error) {
                        logError(error, 'Lyric Ex set position failed');
                    }
                }
            );
            return;
        }

        this.getPositionMicros(current).then(position =>
            this.seek(Math.trunc(positionMicros) - position)
        );
    }

    setShuffle(shuffle) {
        this._setCurrentProperty(
            'Shuffle',
            new GLib.Variant('b', Boolean(shuffle))
        );
    }

    setLoopStatus(status) {
        this._setCurrentProperty(
            'LoopStatus',
            new GLib.Variant('s', String(status))
        );
    }

    raiseCurrent() {
        const rootProxy = this._current?.rootProxy;
        if (!rootProxy || !this._current.canRaise)
            return;

        rootProxy.call(
            'Raise',
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    logError(error, 'Lyric Ex raise player failed');
                }
            }
        );
    }

    getPositionMicros(snapshot = this._current) {
        if (!snapshot?.propertiesProxy)
            return Promise.resolve(snapshot?.position ?? 0);

        return new Promise(resolve => {
            snapshot.propertiesProxy.call(
                'Get',
                new GLib.Variant('(ss)', [PLAYER_INTERFACE, 'Position']),
                Gio.DBusCallFlags.NO_AUTO_START,
                -1,
                null,
                (proxy, result) => {
                    try {
                        const [value] = proxy.call_finish(result).deep_unpack();
                        resolve(asNumber(value.deep_unpack()));
                    } catch (_error) {
                        resolve(snapshot.position ?? 0);
                    }
                }
            );
        });
    }

    _setCurrentProperty(name, value) {
        const propertiesProxy = this._current?.propertiesProxy;
        if (!propertiesProxy)
            return;

        propertiesProxy.call(
            'Set',
            new GLib.Variant('(ssv)', [PLAYER_INTERFACE, name, value]),
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    logError(error, `Lyric Ex set ${name} failed`);
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
            let rootProxy = null;
            try {
                rootProxy = Gio.DBusProxy.new_sync(
                    this._dbus,
                    DO_NOT_AUTO_START,
                    null,
                    busName,
                    OBJECT_PATH,
                    ROOT_INTERFACE,
                    null
                );
            } catch (_error) {
                // Older or incomplete MPRIS implementations may omit the root interface.
            }
            const propertiesProxy = Gio.DBusProxy.new_sync(
                this._dbus,
                DO_NOT_AUTO_START,
                null,
                busName,
                OBJECT_PATH,
                PROPERTIES_INTERFACE,
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
            const rootPropertySignalId = rootProxy?.connect(
                'g-properties-changed',
                () => this._emitCurrent()
            ) ?? 0;
            this._players.set(busName, {
                proxy,
                propertySignalId,
                signalId,
                rootProxy,
                rootPropertySignalId,
                propertiesProxy,
            });
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
        player.rootProxy?.disconnect(player.rootPropertySignalId);
        this._players.delete(busName);
        if (this._selectedBusName === busName)
            this._selectedBusName = null;
    }

    _snapshot(busName, player) {
        const metadataVariant = player.proxy.get_cached_property('Metadata');
        const metadata = unpackMetadata(metadataVariant);
        const positionVariant = player.proxy.get_cached_property('Position');
        const statusVariant = player.proxy.get_cached_property('PlaybackStatus');
        const canGoNextVariant = player.proxy.get_cached_property('CanGoNext');
        const canGoPreviousVariant = player.proxy.get_cached_property('CanGoPrevious');
        const canPlayVariant = player.proxy.get_cached_property('CanPlay');
        const canSeekVariant = player.proxy.get_cached_property('CanSeek');
        const shuffleVariant = player.proxy.get_cached_property('Shuffle');
        const loopStatusVariant = player.proxy.get_cached_property('LoopStatus');
        const identity = asString(unpack(
            player.rootProxy?.get_cached_property('Identity')
        ));
        const desktopEntry = asString(unpack(
            player.rootProxy?.get_cached_property('DesktopEntry')
        ));

        return {
            busName,
            proxy: player.proxy,
            metadata,
            trackId: asString(metadata['mpris:trackid']),
            title: asString(metadata['xesam:title']),
            artist: asString(metadata['xesam:artist']),
            album: asString(metadata['xesam:album']),
            url: asString(metadata['xesam:url']),
            artUrl: asString(metadata['mpris:artUrl']),
            length: asNumber(metadata['mpris:length']),
            status: asString(unpack(statusVariant)),
            position: asNumber(unpack(positionVariant)),
            canGoNext: asBoolean(unpack(canGoNextVariant)),
            canGoPrevious: asBoolean(unpack(canGoPreviousVariant)),
            canPlay: asBoolean(unpack(canPlayVariant)),
            canSeek: asBoolean(unpack(canSeekVariant)),
            canShuffle: shuffleVariant !== null,
            shuffle: shuffleVariant === null ? null : asBoolean(unpack(shuffleVariant)),
            canLoop: loopStatusVariant !== null,
            loopStatus: loopStatusVariant === null
                ? null
                : asString(unpack(loopStatusVariant)),
            identity: identity || busName,
            desktopEntry,
            appId: playerAppId(busName, identity, desktopEntry),
            canRaise: asBoolean(unpack(
                player.rootProxy?.get_cached_property('CanRaise')
            )),
            propertiesProxy: player.propertiesProxy,
            positionTimestamp: GLib.get_monotonic_time(),
        };
    }

    _getSnapshots() {
        return [...this._players.entries()]
            .map(([name, player]) => this._snapshot(name, player));
    }

    _isAllowed(snapshot) {
        return !this._filterEnabled ||
            this._enabledApps.has(normalizeAppId(snapshot.appId));
    }

    _emitCurrent() {
        if (this._destroyed)
            return;

        const snapshots = this._getSnapshots();
        const allowedSnapshots = snapshots.filter(snapshot => this._isAllowed(snapshot));
        this._onPlayersChanged?.(allowedSnapshots);

        const selected = this._selectedBusName
            ? allowedSnapshots.find(
                snapshot => snapshot.busName === this._selectedBusName
            )
            : null;
        const next = selected ?? selectPreferredPlayer(allowedSnapshots, {
            filterEnabled: false,
            appOrder: this._appOrder,
        });
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
