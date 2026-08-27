import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

// Two stacked labels: a dimmed base and an accent-colored copy clipped to a
// fraction of the text width, sweeping left-to-right across the line's span.
export const KaraokeLabel = GObject.registerClass(
class KaraokeLabel extends St.Widget {
    _init(styleClass = '') {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            style_class: styleClass,
        });

        this._text = '';
        this._textWidth = 0;
        this._progress = 0;
        this._karaokeEnabled = false;

        this._baseLabel = new St.Label({
            style_class: 'lyric-ex-karaoke-base',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._baseLabel.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: false,
        });
        this.add_child(this._baseLabel);

        this._overlayBox = new St.Widget({
            style_class: 'lyric-ex-karaoke-overlay',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fillLabel = new St.Label({
            style_class: 'lyric-ex-karaoke-fill',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fillLabel.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: false,
        });
        this._overlayBox.add_child(this._fillLabel);
        this.add_child(this._overlayBox);
    }

    setText(value) {
        const text = String(value ?? '');
        if (text === this._text)
            return;

        this._text = text;
        this._baseLabel.text = text;
        this._fillLabel.text = text;
        this._textWidth = 0;
        this._progress = 0;
        this._applyProgress();
    }

    setFontSize(size) {
        const style = `font-size: ${size}px;`;
        this._baseLabel.set_style(style);
        this._fillLabel.set_style(style);
        this._textWidth = 0;
        this._applyProgress();
    }

    setKaraokeEnabled(enabled) {
        const value = Boolean(enabled);
        if (value === this._karaokeEnabled)
            return;

        this._karaokeEnabled = value;
        if (value)
            this.add_style_class_name('lyric-ex-karaoke-on');
        else
            this.remove_style_class_name('lyric-ex-karaoke-on');
        this._applyProgress();
    }

    setProgress(fraction) {
        const value = Math.max(0, Math.min(1, Number(fraction) || 0));
        if (value === this._progress)
            return;

        this._progress = value;
        this._applyProgress();
    }

    getNaturalWidth() {
        this._measure();
        return this._textWidth;
    }

    _measure() {
        if (this._textWidth > 0)
            return;

        const [, natural] =
            this._fillLabel.clutter_text.get_preferred_width(-1);
        this._textWidth = Math.max(
            1,
            Math.ceil(Number(natural)) || 1
        );
        // Both layers share the same fixed width so the BinLayout keeps
        // them pixel-aligned regardless of its centering behavior.
        this._baseLabel.width = this._textWidth;
        this._fillLabel.width = this._textWidth;
        this._overlayBox.width = this._textWidth;
        this._applyProgress();
    }

    _applyProgress() {
        if (this._text) {
            this._measure();
            const clipWidth = this._karaokeEnabled
                ? Math.round(this._progress * this._textWidth)
                : 0;
            // Clip from the left edge; the box itself stays full width and
            // aligned over the base label. The height only needs to cover
            // the actor — a taller clip rect is harmless.
            const clipHeight = Math.max(this._overlayBox.height, 256);
            this._overlayBox.set_clip(0, 0, clipWidth, clipHeight);
        }
        this._overlayBox.visible = this._karaokeEnabled;
    }
});
