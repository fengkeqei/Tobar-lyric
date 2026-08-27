import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LyricIndicator} from './indicator.js';

export default class LyricExExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = null;
        this._settingsChangedIds = [
            this._settings.connect(
                'changed::panel-box',
                () => this._rebuildIndicator()
            ),
            this._settings.connect(
                'changed::panel-position',
                () => this._rebuildIndicator()
            ),
        ];

        this._rebuildIndicator();
    }

    disable() {
        for (const signalId of this._settingsChangedIds ?? [])
            this._settings.disconnect(signalId);
        this._settingsChangedIds = [];

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _rebuildIndicator() {
        if (!this._settings)
            return;

        this._indicator?.destroy();
        this._indicator = new LyricIndicator(
            this._settings,
            () => {
                try {
                    Promise.resolve(this.openPreferences()).catch(error =>
                        console.warn(`Lyric Ex preferences: ${error?.message ?? error}`)
                    );
                } catch (error) {
                    console.warn(`Lyric Ex preferences: ${error?.message ?? error}`);
                }
            }
        );

        const configuredBox = this._settings.get_string('panel-box');
        const box = ['left', 'center', 'right'].includes(configuredBox)
            ? configuredBox
            : 'center';
        const position = Math.max(
            0,
            Math.min(20, this._settings.get_int('panel-position'))
        );

        Main.panel.addToStatusArea(
            'lyric-ex',
            this._indicator,
            position,
            box
        );
    }
}
