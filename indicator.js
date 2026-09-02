import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {ArtCache} from './art-cache.js';
import {KaraokeLabel} from './karaoke.js';
import {findEmbeddedLyrics, findLocalLyrics} from './lyrics.js';
import {fetchCandidateLyrics, OnlineLyricsFetcher, providerName, searchAllProviders} from './online.js';
import {MprisController} from './mpris.js';
import {NowPlayingCard} from './now-playing-card.js';
import {OffsetStore} from './offset-store.js';
import {SelectionStore} from './selection-store.js';

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
        this._lyricsSource = null;
        this._lyricsManual = false;
        this._selectionStore = new SelectionStore();
        this._tickId = 0;
        this._hovered = false;
        this._currentLine = '';
        this._subCurrent = '';
        this._marqueeToken = 0;
        this._marqueeDelayId = 0;
        this._marqueePauseId = 0;
        this._autoWidthDelayId = 0;
        this._hideControlsId = 0;
        this._controlsEnabled = true;
        this._showTranslation = true;
        this._panelNextPreview = true;
        this._autoWidth = false;
        this._lyricMaxWidth = 400;
        this._offsetStore = new OffsetStore();

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

        // Vertical stack: current line on top, translation or next-line
        // preview (Lyricify-style double-line mode) underneath.
        this._viewport = new St.BoxLayout({
            style_class: 'lyric-ex-viewport',
            clip_to_allocation: true,
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._box.add_child(this._viewport);

        this._label = new KaraokeLabel('lyric-ex-label');
        this._label.x_expand = true;
        this._viewport.add_child(this._label);

        this._subLabel = new St.Label({
            style_class: 'lyric-ex-subline',
            text: '',
            visible: false,
            x_expand: true,
        });
        this._subLabel.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.END,
            line_wrap: false,
        });
        this._viewport.add_child(this._subLabel);

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
                () => this._applyTextStyle()
            ),
            this._settings.connect(
                'changed::lyric-font-family',
                () => this._applyTextStyle()
            ),
            this._settings.connect(
                'changed::lyric-accent-mode',
                () => this._applyTextStyle()
            ),
            this._settings.connect(
                'changed::lyric-color',
                () => this._applyTextStyle()
            ),
            this._settings.connect(
                'changed::karaoke-highlight',
                () => this._applyKaraoke()
            ),
            this._settings.connect(
                'changed::panel-offset-x',
                () => this._applyPanelOffset()
            ),
            this._settings.connect(
                'changed::panel-offset-y',
                () => this._applyPanelOffset()
            ),
            this._settings.connect(
                'changed::panel-opacity',
                () => this._applyPanelOpacity()
            ),
            this._settings.connect(
                'changed::enable-controls',
                () => this._applyControlsEnabled()
            ),
            this._settings.connect(
                'changed::show-translation',
                () => this._applySubLineSettings()
            ),
            this._settings.connect(
                'changed::panel-next-preview',
                () => this._applySubLineSettings()
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
            this._settings.connect(
                'changed::panel-auto-width',
                () => this._applyLyricWidth()
            ),
            this._settings.connect(
                'changed::lyric-align',
                () => this._applyLyricAlign()
            ),
        ];
        this._applyTextStyle();
        this._applyLyricWidth();
        this._applyLyricAlign();
        this._applyPanelOffset();
        this._applyPanelOpacity();
        this._applyControlsEnabled();
        this._applyKaraoke();
        this._applySubLineSettings();

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
            onOffsetDelta: delta => this._adjustLyricOffset(delta),
            onSearchCandidates: () => this._searchCandidates(),
            onPickCandidate: candidate => this._pickCandidate(candidate),
            onClearSelection: () => this._clearSelection(),
            getPosition: player => this._controller.getPositionMicros(player),
            getEstimatedPosition: () => this._controller.getCurrentPositionMicros(),
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
    }

    _ensureTick() {
        if (this._tickId)
            return;

        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._updateLyricLine();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTick() {
        if (!this._tickId)
            return;

        GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    destroy() {
        this._requestId++;
        this._cancelMarquee();
        this._cancelAutoWidth();
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

    _applyTextStyle() {
        const customColor =
            this._settings.get_string('lyric-accent-mode') === 'custom'
                ? this._settings.get_string('lyric-color')
                : null;
        const style = {
            fontSize: this._settings.get_int('font-size'),
            fontFamily: this._settings.get_string('lyric-font-family') || null,
            color: customColor || null,
        };
        this._label.setTextStyle(style);
        this._card?.setLyricTextStyle({
            color: style.color,
            fontFamily: style.fontFamily,
        });
    }

    _applyKaraoke() {
        this._karaokeEnabled = this._settings.get_boolean('karaoke-highlight');
        this._label.setKaraokeEnabled(this._karaokeEnabled);
        if (this._snapshot && this._document)
            this._updateLyricLine(true);
    }

    _applyLyricWidth() {
        this._lyricMaxWidth = Math.max(
            160,
            Math.min(600, this._settings.get_int('panel-lyric-width'))
        );
        this._autoWidth = this._settings.get_boolean('panel-auto-width');
        if (this._autoWidth) {
            // The island shrink-wraps to the current line; the setting only
            // caps it.
            this._box.style = `min-width: 0; max-width: ${this._lyricMaxWidth}px;`;
            this._label.width = -1;
            this._cancelMarquee();
        } else {
            this._box.style =
                `width: ${this._lyricMaxWidth}px; ` +
                `min-width: ${this._lyricMaxWidth}px; ` +
                `max-width: ${this._lyricMaxWidth}px;`;
        }
        this._resizeBoxForLine();
    }

    _applyLyricAlign() {
        const value = this._settings.get_string('lyric-align');
        const align = ['start', 'center', 'end'].includes(value)
            ? value
            : 'start';
        this._label.setAlign(align);
        this._subLabel.x_align = align === 'center'
            ? Clutter.ActorAlign.CENTER
            : align === 'end'
                ? Clutter.ActorAlign.END
                : Clutter.ActorAlign.FILL;
    }

    _applyPanelOffset() {
        this.translation_x = this._settings.get_int('panel-offset-x');
        this.translation_y = this._settings.get_int('panel-offset-y');
    }

    _applyPanelOpacity() {
        const percent = Math.max(
            40,
            Math.min(100, this._settings.get_int('panel-opacity'))
        );
        this._surface.opacity = Math.round(percent * 255 / 100);
    }

    _applySubLineSettings() {
        this._showTranslation = this._settings.get_boolean('show-translation');
        this._panelNextPreview =
            this._settings.get_boolean('panel-next-preview');
        this._subCurrent = null;
        if (this._snapshot && this._document)
            this._updateLyricLine(true);
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
        if (snapshot.status === 'Playing')
            this._ensureTick();
        else
            this._stopTick();

        this._previousButton.opacity = snapshot.canGoPrevious ? 255 : 110;
        this._nextButton.opacity = snapshot.canGoNext ? 255 : 110;
        this._playPauseButton.opacity = snapshot.canPlay ? 255 : 110;

        const isPlaying = snapshot.status === 'Playing';
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
        this._stopTick();
        this._snapshot = null;
        this._lyricsTrackKey = null;
        this._document = null;
        this._lyricsSource = null;
        this._lyricsManual = false;
        this._card?.setLyricDocument(null);
        this._currentLine = '';
        this._subCurrent = '';
        this._subLabel.text = '';
        this._subLabel.visible = false;
        this._label.text = '';
        this._controls.visible = false;
        this._viewport.visible = true;
        this._hovered = false;
        this._cancelControlsHide();
        this._cancelMarquee();
        this._cancelAutoWidth();

        if (this._onlineFetcher)
            this._onlineFetcher.abort();
        this._onlineFetcher = null;
        this.visible = false;
    }

    async _loadLyrics(snapshot, force = false) {
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
        const preferLocal = this._settings.get_boolean('prefer-local-lyrics');
        const onlineEnabled = this._settings.get_boolean('online-fallback');
        const disabledProviders = new Set(
            this._settings.get_strv('online-disabled-providers')
        );
        const providerIds = this._settings
            .get_strv('online-providers')
            .filter(providerId => !disabledProviders.has(providerId));

        this._document = null;
        this._lyricsSource = null;
        this._subCurrent = null;
        this._subLabel.text = '';
        this._subLabel.visible = false;
        if (this._onlineFetcher)
            this._onlineFetcher.abort();
        this._onlineFetcher = null;

        // A manually matched candidate (歌词纠错) overrides everything else.
        const selection = this._selectionStore.get(
            snapshot.title,
            snapshot.artist
        );
        this._lyricsManual = Boolean(selection);
        if (selection) {
            const manual = await fetchCandidateLyrics(selection, snapshot);
            if (requestId !== this._requestId)
                return;
            if (manual) {
                this._setDocument(manual, selection.providerId);
                return;
            }
        }

        const local = findEmbeddedLyrics(snapshot) ??
            await findLocalLyrics(snapshot, this._settings);
        if (requestId !== this._requestId)
            return;

        if (preferLocal && local) {
            this._setDocument(local, 'local');
            return;
        }

        if (onlineEnabled) {
            this._setLyricText('加载歌词…');
            this._onlineFetcher = new OnlineLyricsFetcher(
                snapshot,
                providerIds,
                (document, providerId) => {
                    if (requestId !== this._requestId)
                        return;
                    this._setDocument(document, providerId);
                },
                providerId => {
                    if (requestId !== this._requestId)
                        return;

                    this._onlineFetcher = null;
                    if (!providerId && local)
                        this._setDocument(local, 'local');
                    else if (!providerId)
                        this._setLyricText('未找到歌词');
                }
            ).start();
            return;
        }

        if (local)
            this._setDocument(local, 'local');
        else
            this._setLyricText('未找到歌词');
    }

    _setDocument(document, source = null) {
        this._document = document;
        if (source)
            this._lyricsSource = source;
        this._card?.setLyricDocument(document);
        this._card?.setLyricOffset(this._getLyricOffset());
        this._card?.setLyricSource(this._sourceLabel(), this._lyricsManual);
        this._updateLyricLine(true);
    }

    _sourceLabel() {
        if (!this._lyricsSource)
            return '';
        const base = this._lyricsSource === 'embedded'
            ? '内嵌歌词'
            : this._lyricsSource === 'local'
                ? '本地歌词'
                : providerName(this._lyricsSource);
        return this._lyricsManual ? `手动选择 · ${base}` : base;
    }

    _searchCandidates() {
        if (!this._snapshot)
            return Promise.resolve([]);

        const disabledProviders = new Set(
            this._settings.get_strv('online-disabled-providers')
        );
        const providerIds = this._settings
            .get_strv('online-providers')
            .filter(providerId => !disabledProviders.has(providerId));
        return searchAllProviders(this._snapshot, providerIds);
    }

    async _pickCandidate(candidate) {
        if (!candidate || !this._snapshot)
            return;

        const requestId = ++this._requestId;
        if (this._onlineFetcher) {
            this._onlineFetcher.abort();
            this._onlineFetcher = null;
        }
        this._lyricsManual = true;
        this._selectionStore.set(
            this._snapshot.title,
            this._snapshot.artist,
            candidate
        );
        this._setLyricText('获取歌词…');

        const document = await fetchCandidateLyrics(candidate, this._snapshot);
        if (requestId !== this._requestId)
            return;
        if (document)
            this._setDocument(document, candidate.providerId);
        else
            this._setLyricText('匹配歌词失败');
    }

    _clearSelection() {
        if (!this._snapshot)
            return;
        this._selectionStore.set(this._snapshot.title, this._snapshot.artist, null);
        this._lyricsManual = false;
        this._loadLyrics(this._snapshot, true);
    }

    _getLyricOffset() {
        if (!this._snapshot)
            return 0;
        return this._offsetStore.get(this._snapshot.title, this._snapshot.artist);
    }

    _adjustLyricOffset(delta) {
        if (!this._snapshot)
            return;

        const value = this._offsetStore.set(
            this._snapshot.title,
            this._snapshot.artist,
            this._getLyricOffset() + delta
        );
        this._card?.setLyricOffset(value);
        this._updateLyricLine(true);
    }

    _updateLyricLine(force = false) {
        if (!this._snapshot || !this._document)
            return;

        const position = this._controller.getCurrentPositionSeconds() -
            this._getLyricOffset();
        const entry = this._document.getEntryAt(position);
        const line = entry?.text ?? '';
        if (!force && line === this._currentLine) {
            this._updateKaraokeProgress(entry, position);
            return;
        }

        this._setLyricText(line);
        this._updateSubLine(entry);
        this._updateKaraokeProgress(entry, position);
    }

    // Second row: the current line's translation when available, otherwise
    // a preview of the next line (Lyricify's double-line taskbar mode).
    _updateSubLine(entry) {
        let text = '';
        if (this._showTranslation && entry?.trans) {
            text = entry.trans;
        } else if (this._panelNextPreview && this._document &&
                   entry && entry.index >= 0) {
            text = this._document.lines[entry.index + 1]?.text ?? '';
        }

        if (text === this._subCurrent)
            return;
        this._subCurrent = text;
        this._subLabel.text = text;
        this._subLabel.visible = text !== '';
    }

    _updateKaraokeProgress(entry, position) {
        if (!this._karaokeEnabled || !this._document?.synced || !entry)
            return;

        if (entry.words && entry.words.length > 0) {
            this._label.setWordProgress(entry.words, position);
            return;
        }

        const span = Math.max(0.001, entry.end - entry.start);
        this._label.setProgress((position - entry.start) / span);
    }

    _setLyricText(text) {
        const value = String(text ?? '');
        if (value === this._currentLine)
            return;

        this._currentLine = value;
        this._cancelMarquee();
        this._label.setText(value);
        if (this._autoWidth)
            this._label.width = -1;
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
        if (this._autoWidth)
            this._scheduleAutoWidth();
        this._scheduleMarquee();
    }

    // Dynamic-island sizing: ease the fixed-width slab down/up to hug the
    // current line, capped at the configured maximum width.
    _cancelAutoWidth() {
        if (!this._autoWidthDelayId)
            return;

        GLib.source_remove(this._autoWidthDelayId);
        this._autoWidthDelayId = 0;
    }

    _scheduleAutoWidth() {
        this._cancelAutoWidth();
        const token = this._marqueeToken;
        this._autoWidthDelayId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            60,
            () => {
                this._autoWidthDelayId = 0;
                if (token !== this._marqueeToken)
                    return GLib.SOURCE_REMOVE;

                this._resizeBoxForLine();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _resizeBoxForLine() {
        if (!this._autoWidth)
            return;

        const natural = this._currentLine
            ? this._label.getNaturalWidth()
            : 0;
        const target = Math.min(
            this._lyricMaxWidth,
            Math.max(natural + 18, 60)
        );
        if (!Number.isFinite(target) || Math.abs(target - this._box.width) < 2)
            return;

        this._box.ease({
            width: target,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
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

                const textWidth = this._label.getNaturalWidth() + 4;
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
                // In auto-width mode a shorter line fits the island, so the
                // label never needs to scroll.
                if (this._autoWidth &&
                    this._box.width < this._lyricMaxWidth - 2)
                    return GLib.SOURCE_REMOVE;
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
