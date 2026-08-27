import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
<<<<<<< HEAD
=======
import Pango from 'gi://Pango';
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ArtCache} from './art-cache.js';
<<<<<<< HEAD
import {KaraokeLabel} from './karaoke.js';
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
import {findEmbeddedLyrics, findLocalLyrics} from './lyrics.js';
import {OnlineLyricsFetcher} from './online.js';
import {MprisController} from './mpris.js';
import {NowPlayingCard} from './now-playing-card.js';

export class LyricIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, openPreferences = null) {
        super(0.0, 'Lyric Ex', false);

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._snapshot = null;
        this._players = [];
        this._artCache = new ArtCache();
        this._card = null;
        this._document = null;
        this._onlineFetcher = null;
        this._requestId = 0;
        this._lyricsTrackKey = null;
        this._tickId = 0;
        this._hovered = false;
        this._currentLine = '';
        this._marqueeToken = 0;
        this._marqueeDelayId = 0;
        this._marqueePauseId = 0;
        this._hideControlsId = 0;
        this._controlsEnabled = true;

        this._surface = new St.Widget({
            style_class: 'lyric-ex-surface',
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this.add_child(this._surface);

        this._box = new St.BoxLayout({
            style_class: 'lyric-ex-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._surface.add_child(this._box);
        this.visible = false;

        this._viewport = new St.Widget({
            style_class: 'lyric-ex-viewport',
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._box.add_child(this._viewport);

<<<<<<< HEAD
        this._label = new KaraokeLabel('lyric-ex-label');
=======
        this._label = new St.Label({
            text: '',
            style_class: 'lyric-ex-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: false,
        });
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        this._viewport.add_child(this._label);

        this._controls = new St.Widget({
            style_class: 'lyric-ex-controls',
            visible: false,
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._box.add_child(this._controls);

        this._buttonBox = new St.BoxLayout({
            style_class: 'lyric-ex-button-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._controls.add_child(this._buttonBox);

        this._previousButton = this._makeButton(
            'media-skip-backward-symbolic',
            '上一曲'
        );
        this._playPauseButton = this._makeButton(
            'media-playback-start-symbolic',
            '播放'
        );
        this._nextButton = this._makeButton(
            'media-skip-forward-symbolic',
            '下一曲'
        );
        this._buttonBox.add_child(this._previousButton);
        this._buttonBox.add_child(this._playPauseButton);
        this._buttonBox.add_child(this._nextButton);
        this._controlActions = [
            {
                button: this._previousButton,
                callback: () => this._controller.previous(),
            },
            {
                button: this._playPauseButton,
                callback: () => this._controller.playPause(),
            },
            {
                button: this._nextButton,
                callback: () => this._controller.next(),
            },
        ];
        this._controls.connect('enter-event', () => this._setHovered(true));
        this._controls.connect('leave-event', () => this._setHovered(false));
        this._controls.connect(
            'button-press-event',
            (_actor, event) => this._handleControlPress(event)
        );

        this._settingsChangedIds = [
            this._settings.connect(
                'changed::font-size',
                () => this._applyFontSize()
            ),
            this._settings.connect(
<<<<<<< HEAD
                'changed::karaoke-highlight',
                () => this._applyKaraoke()
            ),
            this._settings.connect(
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
                'changed::panel-offset-x',
                () => this._applyPanelOffset()
            ),
            this._settings.connect(
                'changed::panel-offset-y',
                () => this._applyPanelOffset()
            ),
            this._settings.connect(
                'changed::enable-controls',
                () => this._applyControlsEnabled()
            ),
            this._settings.connect(
                'changed::online-providers',
                () => this._reloadCurrentLyrics()
            ),
            this._settings.connect(
                'changed::online-disabled-providers',
                () => this._reloadCurrentLyrics()
            ),
            this._settings.connect(
                'changed::prefer-local-lyrics',
                () => this._reloadCurrentLyrics()
            ),
            this._settings.connect(
                'changed::online-fallback',
                () => this._reloadCurrentLyrics()
            ),
            this._settings.connect(
                'changed::player-app-filter-enabled',
                () => this._applyPlayerSelection()
            ),
            this._settings.connect(
                'changed::enabled-player-apps',
                () => this._applyPlayerSelection()
            ),
            this._settings.connect(
                'changed::player-app-order',
                () => this._applyPlayerSelection()
            ),
            this._settings.connect(
                'changed::card-width',
                () => this._syncCard()
            ),
            this._settings.connect(
                'changed::panel-lyric-width',
                () => this._applyLyricWidth()
            ),
        ];
        this._applyFontSize();
        this._applyLyricWidth();
        this._applyPanelOffset();
        this._applyControlsEnabled();
<<<<<<< HEAD
        this._applyKaraoke();
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68

        this.connect('enter-event', () => this._setHovered(true));
        this.connect('leave-event', () => this._setHovered(false));

        this._controller = new MprisController(
            snapshot => {
                this._setSnapshot(snapshot);
                this._syncCard();
            },
            {
                onPlayersChanged: players => {
                    this._players = players;
                    this._syncCard();
                },
            }
        );
        this._card = new NowPlayingCard(this._settings, this._artCache, {
            onOpenPreferences: () => this._openPreferences?.(),
            onRaise: () => this._controller.raiseCurrent(),
            onPrevious: () => this._controller.previous(),
            onPlayPause: () => this._controller.playPause(),
            onNext: () => this._controller.next(),
            onSeek: seconds => this._controller.seek(seconds * 1_000_000),
            onSetPosition: position =>
                this._controller.setPosition(position),
            onShuffle: shuffle => this._controller.setShuffle(shuffle),
            onLoop: () => this._cycleLoop(),
            onSelectPlayer: busName => this._controller.selectPlayer(busName),
            getPosition: player => this._controller.getPositionMicros(player),
        });
        // Let PopupMenu keep one native anchor for both open and close.
        this.menu.sourceActor = this._box;
        this.menu._boxPointer?.setSourceAlignment(0.0);
        this.menu.box.add_style_class_name('lyric-ex-card-menu');
        const cardItem = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            reactive: false,
            can_focus: false,
            style_class: 'lyric-ex-card-item',
        });
        cardItem.add_child(this._card);
        this.menu.addMenuItem(cardItem);
        this.menu.connect(
            'open-state-changed',
            (_menu, open) => {
                this._card?.setActive(open);
                if (open && this._card)
                    this._syncCard();
            }
        );
        this._applyPlayerSelection();
        this._syncCard();
<<<<<<< HEAD
    }

    _ensureTick() {
        if (this._tickId)
            return;

=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._updateLyricLine();
            return GLib.SOURCE_CONTINUE;
        });
    }

<<<<<<< HEAD
    _stopTick() {
        if (!this._tickId)
            return;

        GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
    destroy() {
        this._requestId++;
        this._cancelMarquee();
        this._cancelControlsHide();

        if (this._onlineFetcher)
            this._onlineFetcher.abort();
        this._onlineFetcher = null;
        this._card?.destroy();
        this._card = null;
        this._artCache?.destroy();
        this._artCache = null;

        for (const signalId of this._settingsChangedIds ?? [])
            this._settings.disconnect(signalId);
        this._settingsChangedIds = [];

        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }

        this._controller.destroy();
        this._controller = null;
        super.destroy();
    }

    vfunc_event(event) {
        const type = event.type();
        const isPress = type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN;
        if (isPress && this.menu) {
            this.menu.toggle(true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _makeButton(iconName, accessibleName) {
        const button = new St.Button({
            style_class: 'lyric-ex-button',
            reactive: false,
            can_focus: false,
            track_hover: true,
            button_mask: St.ButtonMask.ONE,
            accessible_name: accessibleName,
        });
        button._icon = new St.Icon({
            icon_name: iconName,
            icon_size: 18,
        });
        button.set_child(button._icon);
        return button;
    }

    _applyFontSize() {
        const size = this._settings.get_int('font-size');
<<<<<<< HEAD
        this._label.setFontSize(size);
    }

    _applyKaraoke() {
        this._karaokeEnabled = this._settings.get_boolean('karaoke-highlight');
        this._label.setKaraokeEnabled(this._karaokeEnabled);
        if (this._snapshot && this._document)
            this._updateLyricLine(true);
=======
        this._label.set_style(`font-size: ${size}px;`);
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
    }

    _applyLyricWidth() {
        const width = Math.max(
            160,
            Math.min(600, this._settings.get_int('panel-lyric-width'))
        );
        this._box.style =
            `width: ${width}px; min-width: ${width}px; max-width: ${width}px;`;
    }

    _applyPanelOffset() {
        this.translation_x = this._settings.get_int('panel-offset-x');
        this.translation_y = this._settings.get_int('panel-offset-y');
    }

    _applyControlsEnabled() {
        this._controlsEnabled = this._settings.get_boolean('enable-controls');
        if (this._controlsEnabled)
            return;

        this._cancelControlsHide();
        this._hovered = false;
        this._controls.visible = false;
        this._viewport.visible = true;
    }

    _applyPlayerSelection() {
        this._controller?.setPlayerSelection({
            filterEnabled: this._settings.get_boolean('player-app-filter-enabled'),
            enabledApps: this._settings.get_strv('enabled-player-apps'),
            appOrder: this._settings.get_strv('player-app-order'),
        });
    }

    _cycleLoop() {
        const loopStatus = this._snapshot?.loopStatus;
        const next = loopStatus === null || loopStatus === 'None'
            ? 'Playlist'
            : loopStatus === 'Playlist'
                ? 'Track'
                : 'None';
        this._controller.setLoopStatus(next);
    }

    _syncCard() {
        this._card?.setState(this._snapshot, this._players);
    }

    _handleControlPress(event) {
        if (!this._controlsEnabled || event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        const [pointerX, pointerY] = event.get_coords();
        for (const {button, callback} of this._controlActions) {
            const [buttonX, buttonY] = button.get_transformed_position();
            if (pointerX < buttonX ||
                pointerX > buttonX + button.width ||
                pointerY < buttonY ||
                pointerY > buttonY + button.height) {
                continue;
            }

            callback();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _reloadCurrentLyrics() {
        if (this._snapshot)
            this._loadLyrics(this._snapshot, true);
    }

    _setHovered(hovered) {
        if (hovered) {
            if (!this._controlsEnabled)
                return;

            this._cancelControlsHide();
            if (this._hovered)
                return;

            this._hovered = true;
            this._viewport.visible = false;
            this._controls.visible = true;
            return;
        }

        if (!this._hovered)
            return;

        this._cancelControlsHide();
        this._hideControlsId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            900,
            () => {
                this._hideControlsId = 0;
                if (this._controls.hover || this._isPointerInside(this._controls))
                    return GLib.SOURCE_REMOVE;

                this._hovered = false;
                this._controls.visible = false;
                this._viewport.visible = true;
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelControlsHide() {
        if (!this._hideControlsId)
            return;

        GLib.source_remove(this._hideControlsId);
        this._hideControlsId = 0;
    }

    _isPointerInside(actor) {
        if (!actor?.mapped)
            return false;

        const [pointerX, pointerY] = global.get_pointer();
        const [actorX, actorY] = actor.get_transformed_position();
        return pointerX >= actorX &&
            pointerX <= actorX + actor.width &&
            pointerY >= actorY &&
            pointerY <= actorY + actor.height;
    }

    _setSnapshot(snapshot) {
        if (!snapshot || !['Playing', 'Paused'].includes(snapshot.status)) {
            this._hideWhenIdle();
            return;
        }

        const oldSnapshot = this._snapshot;
        const trackChanged = !oldSnapshot ||
            oldSnapshot.busName !== snapshot.busName ||
            oldSnapshot.trackId !== snapshot.trackId ||
            oldSnapshot.title !== snapshot.title ||
            oldSnapshot.artist !== snapshot.artist ||
            oldSnapshot.album !== snapshot.album;
        this._snapshot = snapshot;
        this.visible = true;
<<<<<<< HEAD
        if (snapshot.status === 'Playing')
            this._ensureTick();
        else
            this._stopTick();
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68

        this._previousButton.opacity = snapshot?.canGoPrevious ? 255 : 110;
        this._nextButton.opacity = snapshot?.canGoNext ? 255 : 110;
        this._playPauseButton.opacity = snapshot?.canPlay ? 255 : 110;

        const isPlaying = snapshot?.status === 'Playing';
        this._playPauseButton._icon.icon_name = isPlaying
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._playPauseButton.accessible_name = isPlaying ? '暂停' : '播放';

        if (trackChanged)
            this._loadLyrics(snapshot);

        this._updateLyricLine();
    }

    _hideWhenIdle() {
        this._requestId++;
<<<<<<< HEAD
        this._stopTick();
        this._snapshot = null;
        this._lyricsTrackKey = null;
        this._document = null;
        this._card?.setLyricDocument(null);
=======
        this._snapshot = null;
        this._lyricsTrackKey = null;
        this._document = null;
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        this._currentLine = '';
        this._label.text = '';
        this._controls.visible = false;
        this._viewport.visible = true;
        this._hovered = false;
        this._cancelControlsHide();
        this._cancelMarquee();

        if (this._onlineFetcher)
            this._onlineFetcher.abort();
        this._onlineFetcher = null;
        this.visible = false;
    }

<<<<<<< HEAD
    async _loadLyrics(snapshot, force = false) {
=======
    _loadLyrics(snapshot, force = false) {
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        const trackKey = [
            snapshot.busName,
            snapshot.trackId,
            snapshot.title,
            snapshot.artist,
            snapshot.album,
        ].join('\u0000');
        if (!force && trackKey === this._lyricsTrackKey)
            return;

        this._lyricsTrackKey = trackKey;
        const requestId = ++this._requestId;
<<<<<<< HEAD
=======
        const embedded = findEmbeddedLyrics(snapshot);
        const local = embedded ?? findLocalLyrics(snapshot, this._settings);
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        const preferLocal = this._settings.get_boolean('prefer-local-lyrics');
        const onlineEnabled = this._settings.get_boolean('online-fallback');
        const disabledProviders = new Set(
            this._settings.get_strv('online-disabled-providers')
        );
        const providerIds = this._settings
            .get_strv('online-providers')
            .filter(providerId => !disabledProviders.has(providerId));

        this._document = null;
        if (this._onlineFetcher)
            this._onlineFetcher.abort();
        this._onlineFetcher = null;
<<<<<<< HEAD

        const local = findEmbeddedLyrics(snapshot) ??
            await findLocalLyrics(snapshot, this._settings);
        if (requestId !== this._requestId)
            return;
=======
        this._setLyricText('加载歌词…');
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68

        if (preferLocal && local) {
            this._setDocument(local);
            return;
        }

        if (onlineEnabled) {
<<<<<<< HEAD
            this._setLyricText('加载歌词…');
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
            this._onlineFetcher = new OnlineLyricsFetcher(
                snapshot,
                providerIds,
                document => {
                    if (requestId !== this._requestId)
                        return;
                    this._setDocument(document);
                },
                providerId => {
                    if (requestId !== this._requestId)
                        return;

                    this._onlineFetcher = null;
                    if (!providerId && local)
                        this._setDocument(local);
                    else if (!providerId)
                        this._setLyricText('未找到歌词');
                }
            ).start();
            return;
        }

        if (local)
            this._setDocument(local);
        else
            this._setLyricText('未找到歌词');
    }

    _setDocument(document) {
        this._document = document;
<<<<<<< HEAD
        this._card?.setLyricDocument(document);
=======
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        this._updateLyricLine(true);
    }

    _updateLyricLine(force = false) {
        if (!this._snapshot || !this._document)
            return;

        const position = this._controller.getCurrentPositionSeconds();
<<<<<<< HEAD
        const entry = this._document.getEntryAt(position);
        const line = entry?.text ?? '';
        if (!force && line === this._currentLine) {
            this._updateKaraokeProgress(entry, position);
            return;
        }

        this._setLyricText(line);
        this._updateKaraokeProgress(entry, position);
    }

    _updateKaraokeProgress(entry, position) {
        if (!this._karaokeEnabled || !this._document?.synced || !entry)
            return;

        const span = Math.max(0.001, entry.end - entry.start);
        this._label.setProgress((position - entry.start) / span);
=======
        const line = this._document.getLineAt(position);
        if (!force && line === this._currentLine)
            return;

        this._setLyricText(line);
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
    }

    _setLyricText(text) {
        const value = String(text ?? '');
        if (value === this._currentLine)
            return;

        this._currentLine = value;
        this._cancelMarquee();
<<<<<<< HEAD
        this._label.setText(value);
=======
        this._label.text = value;
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
        if (!value)
            return;

        this._label.opacity = 0;
        this._label.translation_y = 4;
        this._label.ease({
            opacity: 255,
            translation_y: 0,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._scheduleMarquee();
    }

    _cancelMarquee() {
        this._marqueeToken++;
        if (this._marqueeDelayId) {
            GLib.source_remove(this._marqueeDelayId);
            this._marqueeDelayId = 0;
        }
        if (this._marqueePauseId) {
            GLib.source_remove(this._marqueePauseId);
            this._marqueePauseId = 0;
        }

        this._label.remove_all_transitions();
        this._label.translation_x = 0;
        this._label.translation_y = 0;
        this._label.opacity = 255;
    }

    _scheduleMarquee(delay = 800) {
        const token = this._marqueeToken;
        this._marqueeDelayId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delay,
            () => {
                this._marqueeDelayId = 0;
                if (token !== this._marqueeToken)
                    return GLib.SOURCE_REMOVE;

                if (!this._viewport.mapped || this._viewport.width <= 1) {
                    this._scheduleMarquee(200);
                    return GLib.SOURCE_REMOVE;
                }

<<<<<<< HEAD
                const textWidth = this._label.getNaturalWidth() + 4;
=======
                const [, naturalWidth] =
                    this._label.clutter_text.get_preferred_width(-1);
                const textWidth = Math.ceil(Number(naturalWidth)) + 4;
>>>>>>> e680dc6197e44e4e0575d03e7b495160a7dbcf68
                const viewportWidth = Math.max(
                    Math.floor(Number(this._viewport.width)),
                    1
                );
                if (!Number.isFinite(textWidth) ||
                    !Number.isFinite(viewportWidth)) {
                    this._scheduleMarquee(300);
                    return GLib.SOURCE_REMOVE;
                }
                this._label.width = Math.max(textWidth, viewportWidth);
                const overflow = Math.max(textWidth - viewportWidth, 0);
                if (!Number.isFinite(overflow) || overflow <= 2)
                    return GLib.SOURCE_REMOVE;

                this._runMarquee(overflow, token);
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _runMarquee(overflow, token) {
        if (token !== this._marqueeToken || !Number.isFinite(overflow))
            return;

        this._label.ease({
            translation_x: -overflow,
            duration: Math.max(2400, overflow * 34),
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                if (token !== this._marqueeToken)
                    return;

                this._marqueePauseId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    650,
                    () => {
                        this._marqueePauseId = 0;
                        if (token !== this._marqueeToken)
                            return GLib.SOURCE_REMOVE;

                        this._label.ease({
                            translation_x: 0,
                            duration: 500,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => this._scheduleMarquee(650),
                        });
                        return GLib.SOURCE_REMOVE;
                    }
                );
            },
        });
    }
}
