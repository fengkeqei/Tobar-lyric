import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {LyricsView} from './lyrics-view.js';

const US_PER_SECOND = 1_000_000;
const DIM_OPACITY = 160;
const DEFAULT_ART_SIZE = 'medium';
const ART_SIZES = {
    small: {size: 72, radius: 14, icon: 32},
    medium: {size: 104, radius: 18, icon: 48},
    large: {size: 132, radius: 22, icon: 60},
};

function formatTime(micros) {
    const total = Math.max(0, Math.floor(Number(micros || 0) / US_PER_SECOND));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const pad = value => String(value).padStart(2, '0');
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${minutes}:${pad(seconds)}`;
}

function cssUrl(path) {
    return `url("${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

function iconButton(iconName, styleClass = 'lyric-ex-card-button') {
    const button = new St.Button({
        style_class: `lyric-ex-control-button ${styleClass}`,
        can_focus: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.set_child(new St.Icon({icon_name: iconName, icon_size: 20}));
    return button;
}

export const NowPlayingCard = GObject.registerClass(
class NowPlayingCard extends St.BoxLayout {
    _init(settings, artCache, callbacks = {}) {
        super._init({
            style_class: 'lyric-ex-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._settings = settings;
        this._artCache = artCache;
        this._callbacks = callbacks;
        this._player = null;
        this._players = [];
        this._active = false;
        this._dragging = false;
        this._length = 0;
        this._position = 0;
        this._pollId = 0;
        this._artGeneration = 0;
        this._artUrl = null;
        this._artPath = null;
        this._artSize = ART_SIZES[DEFAULT_ART_SIZE];
        this._tabsKey = '';
        this._lyricsExpanded = false;
        this._hasLyrics = false;
        this._karaoke = false;
        this._pollInterval = 0;
        this._lyricOffset = 0;

        this._buildHeader();
        this._buildSeekBar();
        this._buildControls();
        this._buildLyricsView();
        this._settingsSignals = [
            settings.connect('changed::card-show-art', () => this.sync()),
            settings.connect('changed::card-show-seek-bar', () => this.sync()),
            settings.connect('changed::card-show-seek-buttons', () => this.sync()),
            settings.connect('changed::card-show-shuffle', () => this.sync()),
            settings.connect('changed::card-show-loop', () => this.sync()),
            settings.connect('changed::card-show-lyrics', () => this._updateLyricsAvailability()),
            settings.connect('changed::karaoke-highlight', () => this._applyKaraoke()),
            settings.connect('changed::card-width', () => this._applyWidth()),
            settings.connect('changed::card-art-size', () => this._applyArtSize()),
        ];
        this._applyWidth();
        this._applyArtSize();
        this.connect('destroy', () => this._cleanup());
    }

    _buildHeader() {
        const header = new St.BoxLayout({
            style_class: 'lyric-ex-card-header',
            orientation: Clutter.Orientation.HORIZONTAL,
        });

        this._artButton = new St.Button({
            style_class: 'lyric-ex-card-art',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._artFallback = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            opacity: DIM_OPACITY,
        });
        this._artButton.set_child(this._artFallback);
        this._artButton.connect('clicked', () => {
            this._callbacks.onRaise?.();
        });
        header.add_child(this._artButton);

        const textBox = new St.BoxLayout({
            style_class: 'lyric-ex-card-text',
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._titleLabel = new St.Label({
            style_class: 'lyric-ex-card-title',
            text: '未播放',
        });
        this._artistLabel = new St.Label({
            style_class: 'lyric-ex-card-artist',
            text: '',
        });
        this._albumLabel = new St.Label({
            style_class: 'lyric-ex-card-album',
            text: '',
        });
        this._titleLabel.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: true,
            line_wrap_mode: Pango.WrapMode.WORD_CHAR,
        });
        this._artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._albumLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        textBox.add_child(this._titleLabel);
        textBox.add_child(this._artistLabel);
        textBox.add_child(this._albumLabel);
        header.add_child(textBox);

        const actions = new St.BoxLayout({
            style_class: 'lyric-ex-card-actions',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.END,
            y_expand: true,
        });
        this._lyricsToggleButton = iconButton('pan-down-symbolic');
        this._lyricsToggleButton.set_child(new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 16,
        }));
        this._lyricsToggleButton.accessible_name = '展开歌词';
        this._lyricsToggleButton.visible = false;
        this._lyricsToggleButton.connect('clicked', () => {
            this._setLyricsExpanded(!this._lyricsExpanded);
        });
        actions.add_child(this._lyricsToggleButton);
        this._settingsButton = iconButton('emblem-system-symbolic');
        this._settingsButton.set_child(new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 16,
        }));
        this._settingsButton.accessible_name = '打开设置';
        this._settingsButton.connect('clicked', () => {
            this._callbacks.onOpenPreferences?.();
        });
        actions.add_child(this._settingsButton);

        this._appLabel = new St.Label({
            style_class: 'lyric-ex-card-app',
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
        });
        actions.add_child(this._appLabel);
        header.add_child(actions);
        this.add_child(header);

        this._tabsBox = new St.BoxLayout({
            style_class: 'lyric-ex-card-tabs',
            orientation: Clutter.Orientation.HORIZONTAL,
            visible: false,
        });
        this.add_child(this._tabsBox);
    }

    _buildSeekBar() {
        this._seekBox = new St.BoxLayout({
            style_class: 'lyric-ex-card-seek-box',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._slider = new Slider(0);
        this._slider.add_style_class_name('lyric-ex-card-seek');
        this._slider.x_expand = true;
        this._slider.connect('drag-begin', () => {
            this._dragging = true;
            return Clutter.EVENT_PROPAGATE;
        });
        this._slider.connect('notify::value', () => {
            if (this._dragging)
                this._updateTimeLabels(this._slider.value * this._length);
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            if (this._player && this._length > 0)
                this._callbacks.onSetPosition?.(
                    this._slider.value * this._length
                );
            this._refreshPosition();
            return Clutter.EVENT_PROPAGATE;
        });

        const times = new St.BoxLayout({
            style_class: 'lyric-ex-card-time-box',
            orientation: Clutter.Orientation.HORIZONTAL,
        });
        this._positionLabel = new St.Label({
            style_class: 'lyric-ex-card-time',
            text: '0:00',
        });
        this._remainingLabel = new St.Label({
            style_class: 'lyric-ex-card-time',
            text: '-0:00',
        });
        this._remainingLabel.x_expand = true;
        this._remainingLabel.x_align = Clutter.ActorAlign.END;
        times.add_child(this._positionLabel);
        times.add_child(this._remainingLabel);
        this._seekBox.add_child(this._slider);
        this._seekBox.add_child(times);
        this.add_child(this._seekBox);
    }

    _buildControls() {
        const row = new St.BoxLayout({
            style_class: 'lyric-ex-card-controls-row',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._shuffleButton = iconButton(
            'media-playlist-shuffle-symbolic',
            'lyric-ex-card-mode-button'
        );
        this._backButton = iconButton('media-seek-backward-symbolic');
        this._previousButton = iconButton('media-skip-backward-symbolic');
        this._playButton = iconButton(
            'media-playback-start-symbolic',
            'lyric-ex-card-button lyric-ex-card-play-button'
        );
        this._forwardButton = iconButton('media-seek-forward-symbolic');
        this._nextButton = iconButton('media-skip-forward-symbolic');
        this._loopButton = iconButton(
            'media-playlist-repeat-symbolic',
            'lyric-ex-card-mode-button'
        );

        this._shuffleButton.connect('clicked', () => {
            if (this._player)
                this._callbacks.onShuffle?.(!this._player.shuffle);
        });
        this._backButton.connect('clicked', () => {
            this._callbacks.onSeek?.(-this._seekStep());
        });
        this._previousButton.connect('clicked', () => {
            this._callbacks.onPrevious?.();
        });
        this._playButton.connect('clicked', () => {
            this._callbacks.onPlayPause?.();
        });
        this._forwardButton.connect('clicked', () => {
            this._callbacks.onSeek?.(this._seekStep());
        });
        this._nextButton.connect('clicked', () => {
            this._callbacks.onNext?.();
        });
        this._loopButton.connect('clicked', () => {
            this._callbacks.onLoop?.();
        });

        for (const button of [
            this._shuffleButton,
            this._previousButton,
            this._backButton,
            this._playButton,
            this._forwardButton,
            this._nextButton,
            this._loopButton,
        ])
            row.add_child(button);
        this.add_child(row);
    }

    _buildLyricsView() {
        this._lyricsView = new LyricsView();
        this._applyKaraoke();
        this._lyricsView.connect('line-activated', (_view, seconds) => {
            // Seek target in playback time: the lyric timestamp plus the
            // active offset keeps the clicked line under the highlight.
            this._callbacks.onSetPosition?.(
                (seconds + this._lyricOffset) * US_PER_SECOND
            );
            this._lyricsView.setPosition(seconds);
        });
        this.add_child(this._lyricsView);

        this._offsetBox = new St.BoxLayout({
            style_class: 'lyric-ex-offset-box',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._offsetDownButton = this._makeOffsetButton('延后半秒', '-0.5s', -0.5);
        this._offsetLabel = new St.Label({
            style_class: 'lyric-ex-offset-label',
            text: '无偏移',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._offsetUpButton = this._makeOffsetButton('推迟半秒', '+0.5s', 0.5);
        this._offsetBox.add_child(this._offsetDownButton);
        this._offsetBox.add_child(this._offsetLabel);
        this._offsetBox.add_child(this._offsetUpButton);
        this.add_child(this._offsetBox);
    }

    _makeOffsetButton(accessibleName, text, delta) {
        const button = new St.Button({
            style_class: 'lyric-ex-offset-button',
            can_focus: true,
            accessible_name: accessibleName,
        });
        button.set_child(new St.Label({text}));
        button.connect('clicked', () => {
            this._callbacks.onOffsetDelta?.(delta);
        });
        return button;
    }

    setLyricOffset(offset) {
        this._lyricOffset = Number(offset) || 0;
        if (this._offsetLabel) {
            this._offsetLabel.text = Math.abs(this._lyricOffset) < 0.01
                ? '无偏移'
                : `${this._lyricOffset > 0 ? '+' : ''}${this._lyricOffset.toFixed(1)}s`;
        }
        this._updateOffsetBoxVisibility();
    }

    _applyKaraoke() {
        this._karaoke = this._settings.get_boolean('karaoke-highlight');
        this._lyricsView?.setKaraokeEnabled(this._karaoke);
        this._updateTimer();
    }

    setLyricDocument(document) {
        const usable = Boolean(document?.lines?.length);
        this._hasLyrics = usable;
        this._lyricsView.setDocument(usable ? document : null);
        this._updateLyricsAvailability();
        if (usable)
            this._lyricsView.setPosition(this._position / US_PER_SECOND);
    }

    _updateLyricsAvailability() {
        const allowed = this._settings.get_boolean('card-show-lyrics');
        this._lyricsToggleButton.visible = Boolean(this._hasLyrics) && allowed;
        if (!this._lyricsToggleButton.visible)
            this._setLyricsExpanded(false);
    }

    _setLyricsExpanded(expanded) {
        this._lyricsExpanded = Boolean(expanded);
        this._lyricsView.expanded = this._lyricsExpanded;
        this._lyricsToggleButton.child.icon_name = this._lyricsExpanded
            ? 'pan-up-symbolic'
            : 'pan-down-symbolic';
        this._lyricsToggleButton.accessible_name = this._lyricsExpanded
            ? '收起歌词'
            : '展开歌词';
        this._updateOffsetBoxVisibility();
        this._updateTimer();
        if (this._lyricsExpanded)
            this._refreshPosition();
    }

    _updateOffsetBoxVisibility() {
        this._offsetBox.visible = this._lyricsExpanded && this._hasLyrics;
    }

    setState(player, players = []) {
        const previousKey = this._trackKey(this._player);
        const nextKey = this._trackKey(player);
        this._player = player;
        this._players = players;
        if (previousKey !== nextKey)
            this._clearArt();
        this._updateTabs();
        this.sync();
        this._refreshPosition();
        this._updateTimer();
    }

    setActive(active) {
        this._active = active;
        this._updateTimer();
        if (active)
            this._refreshPosition();
    }

    _trackKey(player) {
        if (!player)
            return '';
        return [
            player.busName,
            player.trackId,
            player.title,
            player.artist,
            player.album,
        ].join('\u0000');
    }

    _updateTabs() {
        const visible = this._players.length > 1;
        this._tabsBox.visible = visible;
        if (!visible) {
            this._tabsBox.destroy_all_children();
            this._tabsKey = '';
            return;
        }

        const key = this._players.map(player => player.busName).join('\n');
        if (key === this._tabsKey)
            return;
        this._tabsKey = key;
        this._tabsBox.destroy_all_children();
        for (const player of this._players) {
            const button = new St.Button({
                style_class: 'lyric-ex-card-tab',
                can_focus: true,
            });
            button.set_child(new St.Label({
                text: player.identity || player.appId,
            }));
            button.accessible_name = player.identity || player.appId;
            button.connect(
                'clicked',
                () => this._callbacks.onSelectPlayer?.(player.busName)
            );
            this._tabsBox.add_child(button);
        }
    }

    _seekStep() {
        return this._settings.get_int('seek-step-seconds');
    }

    _applyWidth() {
        this.style = `width: ${this._settings.get_int('card-width')}px;`;
    }

    _applyArtSize() {
        const nick = this._settings.get_string('card-art-size');
        this._artSize = ART_SIZES[nick] ?? ART_SIZES[DEFAULT_ART_SIZE];
        this._artFallback.icon_size = this._artSize.icon;
        this._applyArtStyle();
    }

    _applyArtStyle() {
        const {size, radius} = this._artSize;
        const image = this._artPath
            ? ` background-image: ${cssUrl(this._artPath)};`
            : '';
        this._artButton.style =
            `width: ${size}px; height: ${size}px; border-radius: ${radius}px;${image}`;
    }

    _clearArt() {
        this._artGeneration++;
        this._artUrl = null;
        this._artPath = null;
        this._applyArtStyle();
        this._artFallback.visible = true;
        this._artFallback.opacity = DIM_OPACITY;
        this._artFallback.icon_name = 'audio-x-generic-symbolic';
    }

    _updateArt() {
        const player = this._player;
        const showArt = this._settings.get_boolean('card-show-art');
        this._artButton.visible = showArt;
        if (!showArt || !player) {
            this._clearArt();
            return;
        }

        if (player.artUrl === this._artUrl)
            return;
        this._clearArt();
        this._artUrl = player.artUrl;
        if (!this._artUrl)
            return;

        const generation = this._artGeneration;
        this._artCache.resolve(this._artUrl).then(path => {
            if (generation !== this._artGeneration || !path)
                return;
            this._artPath = path;
            this._applyArtStyle();
            this._artFallback.visible = false;
        });
    }

    sync() {
        const player = this._player;
        if (!player) {
            this._titleLabel.text = '未播放';
            this._artistLabel.text = '';
            this._artistLabel.visible = false;
            this._albumLabel.text = '';
            this._albumLabel.visible = false;
            this._appLabel.text = '';
            this._seekBox.visible = false;
            this._setControlsVisible(false);
            this._updateArt();
            this._updateTimeLabels(0, 0);
            return;
        }

        this._titleLabel.text = player.title || '未知歌曲';
        this._artistLabel.text = player.artist || '';
        this._artistLabel.visible = Boolean(player.artist);
        const showAlbum = Boolean(
            player.album &&
            player.album !== player.artist &&
            player.album !== player.title
        );
        this._albumLabel.text = showAlbum ? player.album : '';
        this._albumLabel.visible = showAlbum;
        this._appLabel.text = player.identity || player.appId;

        this._length = Math.max(0, Number(player.length || 0));
        const showSeek = this._settings.get_boolean('card-show-seek-bar') &&
            this._length > 0;
        this._seekBox.visible = showSeek;
        this._slider.reactive = Boolean(player.canSeek);
        this._slider.opacity = player.canSeek ? 255 : 110;

        const showSkip = this._settings.get_boolean('card-show-seek-buttons') &&
            Boolean(player.canSeek);
        this._backButton.visible = showSkip;
        this._forwardButton.visible = showSkip;
        this._shuffleButton.visible =
            this._settings.get_boolean('card-show-shuffle') &&
            Boolean(player.canShuffle);
        this._loopButton.visible =
            this._settings.get_boolean('card-show-loop') &&
            Boolean(player.canLoop);
        this._setControlsVisible(true);

        this._previousButton.visible = true;
        this._nextButton.visible = true;
        this._playButton.visible = true;
        this._setSensitive(this._previousButton, player.canGoPrevious);
        this._setSensitive(this._nextButton, player.canGoNext);
        this._setSensitive(this._playButton, player.canPlay);
        this._playButton.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._loopButton.child.icon_name = player.loopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic'
            : 'media-playlist-repeat-symbolic';
        this._setToggle(this._shuffleButton, player.shuffle === true);
        this._setToggle(
            this._loopButton,
            Boolean(player.canLoop && player.loopStatus !== 'None')
        );
        this._artButton.reactive = Boolean(player.canRaise);
        this._artButton.can_focus = Boolean(player.canRaise);
        this._updateArt();
        this._updateSlider();
    }

    _setControlsVisible(visible) {
        for (const button of [
            this._shuffleButton,
            this._backButton,
            this._previousButton,
            this._playButton,
            this._forwardButton,
            this._nextButton,
            this._loopButton,
        ])
            button.visible = visible && button.visible;
    }

    _setSensitive(button, sensitive) {
        button.reactive = Boolean(sensitive);
        button.opacity = sensitive ? 255 : 110;
    }

    _setToggle(button, enabled) {
        if (enabled === button.has_style_class_name('lyric-ex-card-mode-on'))
            return;
        if (enabled)
            button.add_style_class_name('lyric-ex-card-mode-on');
        else
            button.remove_style_class_name('lyric-ex-card-mode-on');
    }

    _updateSlider() {
        if (this._dragging)
            return;
        this._position = Math.max(0, Number(this._player?.position || 0));
        const fraction = this._length > 0
            ? Math.min(1, Math.max(0, this._position / this._length))
            : 0;
        this._slider.value = fraction;
        this._updateTimeLabels(this._position);
        this._lyricsView?.setPosition(
            this._position / US_PER_SECOND - this._lyricOffset
        );
    }

    _updateTimeLabels(position, length = this._length) {
        this._positionLabel.text = formatTime(position);
        this._remainingLabel.text = `-${formatTime(Math.max(0, length - position))}`;
    }

    _refreshPosition() {
        const player = this._player;
        if (!player || !this._active)
            return;
        Promise.resolve(this._callbacks.getPosition?.(player))
            .then(position => {
                if (player !== this._player || this._dragging)
                    return;
                this._position = Number(position || 0);
                this._updateSlider();
            });
    }

    _updateTimer() {
        const wanted = this._active &&
            this._player?.status === 'Playing' &&
            (this._settings.get_boolean('card-show-seek-bar') ||
                this._lyricsExpanded);
        // Karaoke fill needs a smooth sweep; everything else is fine at 1 Hz.
        const interval = this._lyricsExpanded && this._karaoke ? 100 : 1000;

        if (wanted && this._pollId && this._pollInterval === interval)
            return;
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._pollInterval = 0;
        if (!wanted)
            return;

        this._pollInterval = interval;
        if (interval === 100) {
            this._pollId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                interval,
                () => {
                    this._refreshPosition();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        } else {
            this._pollId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                1,
                () => {
                    this._refreshPosition();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    _cleanup() {
        if (this._pollId)
            GLib.source_remove(this._pollId);
        this._pollId = 0;
        this._artGeneration++;
        for (const id of this._settingsSignals ?? [])
            this._settings.disconnect(id);
        this._settingsSignals = [];
    }
});
