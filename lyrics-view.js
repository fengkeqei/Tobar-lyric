import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {KaraokeLabel} from './karaoke.js';

const FOLLOW_RESUME_MS = 4000;

export const LyricsView = GObject.registerClass({
    Signals: {
        'line-activated': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class LyricsView extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            visible: false,
            style_class: 'lyric-ex-lyrics',
        });

        this._document = null;
        this._lineButtons = [];
        this._activeIndex = -1;
        this._follow = true;
        this._followResumeId = 0;
        this._karaokeEnabled = false;
        this._showTranslation = true;
        this._textStyle = {color: null, fontFamily: null};

        this._scrollView = new St.ScrollView({
            style_class: 'lyric-ex-lyrics-scroll',
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            hscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
        });
        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'lyric-ex-lyrics-content',
        });
        this._scrollView.set_child(this._content);
        this._scrollView.connect('scroll-event', () => {
            this._suspendFollow();
            return Clutter.EVENT_PROPAGATE;
        });
        this.add_child(this._scrollView);
    }

    vfunc_destroy() {
        this._cancelFollowResume();
        super.vfunc_destroy();
    }

    get expanded() {
        return this.visible;
    }

    set expanded(value) {
        this.visible = Boolean(value);
        if (this.visible)
            this.scrollToActive(false);
    }

    setDocument(document) {
        this._document = document ?? null;
        this._activeIndex = -1;
        this._cancelFollowResume();
        this._follow = true;
        this._content.destroy_all_children();
        this._lineButtons = [];

        const lines = this._document?.lines ?? [];
        for (const line of lines) {
            const button = new St.Button({
                style_class: 'lyric-ex-lyrics-line',
                can_focus: false,
                x_align: Clutter.ActorAlign.FILL,
                x_expand: true,
            });
            const box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
            });
            const label = new KaraokeLabel('lyric-ex-lyrics-line-text');
            label.setText(line.text);
            label.setAlign('center');
            label.setKaraokeEnabled(this._karaokeEnabled);
            label.setTextStyle(this._textStyle);
            button._karaokeLabel = label;
            box.add_child(label);
            const translation = this._showTranslation
                ? String(line.trans ?? '') : '';
            if (translation) {
                const transLabel = new St.Label({
                    text: translation,
                    style_class: 'lyric-ex-lyrics-trans',
                });
                box.add_child(transLabel);
            }
            button.set_child(box);
            if (this._document.synced) {
                button.connect('clicked', () =>
                    this.emit('line-activated', line.time)
                );
            } else {
                button.reactive = false;
            }
            this._content.add_child(button);
            this._lineButtons.push(button);
        }
    }

    setShowTranslation(enabled) {
        const value = Boolean(enabled);
        if (value === this._showTranslation)
            return;
        this._showTranslation = value;
        if (this._document)
            this.setDocument(this._document);
    }

    setTextStyle(style) {
        this._textStyle = {
            color: style?.color ?? null,
            fontFamily: style?.fontFamily ?? null,
        };
        for (const button of this._lineButtons)
            button._karaokeLabel?.setTextStyle(this._textStyle);
    }

    setKaraokeEnabled(enabled) {
        const value = Boolean(enabled);
        if (value === this._karaokeEnabled)
            return;

        this._karaokeEnabled = value;
        for (const button of this._lineButtons)
            button._karaokeLabel?.setKaraokeEnabled(value);
    }

    setPosition(seconds) {
        if (!this._document?.synced || this._lineButtons.length === 0)
            return;

        const index = this._document.getLineIndexAt(seconds);
        if (index !== this._activeIndex) {
            const previous = this._lineButtons[this._activeIndex];
            previous?.remove_style_class_name('lyric-ex-lyrics-line-active');
            previous?._karaokeLabel?.setProgress(0);

            this._activeIndex = index;
            const active = this._lineButtons[index];
            if (active) {
                active.add_style_class_name('lyric-ex-lyrics-line-active');
                if (this.visible && this._follow)
                    this._scrollToButton(active);
            }
        }

        const active = this._lineButtons[index];
        if (active?._karaokeLabel && this._karaokeEnabled) {
            const start = this._document.lines[index].time;
            const end = this._document.lines[index + 1]?.time ?? start + 10;
            const span = Math.max(0.001, end - start);
            const words = this._document.lines[index].words;
            if (words && words.length > 0)
                active._karaokeLabel.setWordProgress(words, seconds);
            else
                active._karaokeLabel.setProgress((seconds - start) / span);
        }
    }

    scrollToActive(smooth = true) {
        const active = this._lineButtons[this._activeIndex];
        if (active)
            this._scrollToButton(active, smooth);
    }

    _scrollToButton(button, smooth = true) {
        const adjustment = this._scrollView.vadjustment;
        if (!adjustment)
            return;

        const [, contentY] = this._content.get_transformed_position();
        const [, buttonY] = button.get_transformed_position();
        const buttonOffset = buttonY - contentY;
        const viewportHeight = adjustment.page_size;
        if (!Number.isFinite(buttonOffset) ||
            buttonOffset < 0 ||
            this._content.height <= viewportHeight)
            return;

        const target = Math.max(
            adjustment.lower,
            Math.min(
                adjustment.upper - viewportHeight,
                buttonOffset - (viewportHeight - button.height) / 2
            )
        );
        if (!Number.isFinite(target))
            return;

        if (smooth && typeof adjustment.ease === 'function')
            adjustment.ease(target, {
                duration: 240,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        else
            adjustment.value = target;
    }

    _suspendFollow() {
        this._follow = false;
        this._cancelFollowResume();
        this._followResumeId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            FOLLOW_RESUME_MS,
            () => {
                this._followResumeId = 0;
                this._follow = true;
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _cancelFollowResume() {
        if (!this._followResumeId)
            return;
        GLib.source_remove(this._followResumeId);
        this._followResumeId = 0;
    }
});
