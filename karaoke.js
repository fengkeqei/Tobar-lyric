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
        this._charEdges = null;

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
        this._charEdges = null;
        this._progress = 0;
        this._applyProgress();
    }

    // Drive the fill from per-word timing: `words` are {start, end, text}
    // spans in seconds, `seconds` is the playback position. The fill edge
    // follows each character's own pixel width, so wide and narrow
    // characters complete at their real positions — the Flyme-style sweep.
    setWordProgress(words, seconds) {
        if (!words || words.length === 0) {
            this.setProgress(0);
            return;
        }

        this._measure();
        if (!this._charEdges)
            this._measureCharEdges();

        // Locate the active word.
        let wordIndex = -1;
        let within = 0;
        if (seconds < words[0].start) {
            this._applyFraction(0);
            return;
        }
        for (let i = 0; i < words.length; i++) {
            if (seconds < words[i].start) {
                wordIndex = i - 1;
                within = 1;
                break;
            }
            if (seconds < words[i].end) {
                wordIndex = i;
                within = (seconds - words[i].start) /
                    Math.max(0.001, words[i].end - words[i].start);
                break;
            }
        }
        if (wordIndex < 0) {
            this._applyFraction(1);
            return;
        }

        // Count characters covered by completed words.
        let charIndex = 0;
        for (let i = 0; i < wordIndex; i++)
            charIndex += [...words[i].text].length;
        charIndex += within * [...words[wordIndex].text].length;

        const edges = this._charEdges;
        const totalChars = edges.length - 1;
        const clamped = Math.max(0, Math.min(totalChars, charIndex));
        const low = Math.floor(clamped);
        const high = Math.ceil(clamped);
        const blend = clamped - low;
        const width = edges[low] + (edges[high] - edges[low]) * blend;
        this._applyFraction(width / this._textWidth);
    }

    _measureCharEdges() {
        const chars = [...this._text];
        const edges = [0];
        // Measure each character's advance width via a scratch label with
        // identical styling; widths accumulate into pixel edges.
        const scratch = new St.Label({
            style_class: 'lyric-ex-karaoke-fill',
        });
        scratch.clutter_text.set({
            ellipsize: Pango.EllipsizeMode.NONE,
            line_wrap: false,
        });
        const style = this._fillLabel.style;
        if (style)
            scratch.set_style(style);
        let acc = 0;
        for (const char of chars) {
            scratch.text = char;
            const [, natural] = scratch.clutter_text.get_preferred_width(-1);
            acc += Math.ceil(Number(natural)) || 0;
            edges.push(acc);
        }
        scratch.destroy();
        // Normalize against the full-string width to absorb hinting
        // differences between per-char and whole-string measurement.
        const scale = this._textWidth > 0 && acc > 0
            ? this._textWidth / acc
            : 1;
        this._charEdges = scale === 1
            ? edges
            : edges.map(value => value * scale);
    }

    setFontSize(size) {
        const style = `font-size: ${size}px;`;
        this._baseLabel.set_style(style);
        this._fillLabel.set_style(style);
        this._textWidth = 0;
        this._charEdges = null;
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

    _applyFraction(fraction) {
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
