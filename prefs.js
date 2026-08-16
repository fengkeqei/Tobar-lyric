import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PROVIDERS} from './online.js';

const PANEL_BOXES = [
    {id: 'left', label: '左侧'},
    {id: 'center', label: '中间'},
    {id: 'right', label: '右侧'},
];

function providerOrder(settings) {
    const knownIds = new Set(PROVIDERS.map(provider => provider.id));
    const configured = settings
        .get_strv('online-providers')
        .filter((id, index, ids) => knownIds.has(id) && ids.indexOf(id) === index);

    for (const provider of PROVIDERS) {
        if (!configured.includes(provider.id))
            configured.push(provider.id);
    }

    return configured;
}

function providerById(id) {
    return PROVIDERS.find(provider => provider.id === id);
}

function makeIconButton(iconName, tooltip, callback, sensitive = true) {
    const button = new Gtk.Button({
        icon_name: iconName,
        tooltip_text: tooltip,
        sensitive,
        valign: Gtk.Align.CENTER,
    });
    button.add_css_class('flat');
    button.connect('clicked', callback);
    return button;
}

function makeSpinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 1,
            value: settings.get_int(key),
        }),
        numeric: true,
    });
    const sync = () => {
        const value = settings.get_int(key);
        if (Math.round(row.value) !== value)
            row.value = value;
    };
    row.connect('notify::value', () => {
        settings.set_int(key, Math.round(row.value));
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

export default class LyricExPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const localGroup = new Adw.PreferencesGroup({
            title: '本地歌词',
            description: '先搜索正在播放音频的同目录，再按这里的目录顺序搜索。',
        });
        const localRow = new Adw.EntryRow({
            title: '目录',
            text: settings.get_strv('local-directories').join('\n'),
            show_apply_button: true,
        });
        localRow.connect('apply', row => {
            const directories = row.text
                .split('\n')
                .map(value => value.trim())
                .filter(Boolean);
            settings.set_strv('local-directories', directories);
        });
        localGroup.add(localRow);
        page.add(localGroup);

        const onlineGroup = new Adw.PreferencesGroup({
            title: '在线歌词',
            description: '默认按在线源顺序查找，全部失败后再回退到本地歌词。',
        });
        const fallbackRow = new Adw.SwitchRow({
            title: '启用在线歌词',
            subtitle: '需要网络连接',
        });
        settings.bind(
            'online-fallback',
            fallbackRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        onlineGroup.add(fallbackRow);

        const localFirstRow = new Adw.SwitchRow({
            title: '优先使用本地歌词',
            subtitle: '关闭时先尝试在线歌词',
        });
        settings.bind(
            'prefer-local-lyrics',
            localFirstRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        onlineGroup.add(localFirstRow);
        page.add(onlineGroup);

        const controlsGroup = new Adw.PreferencesGroup({
            title: '播放控制',
        });
        const controlsRow = new Adw.SwitchRow({
            title: '启用播放控制按钮',
            subtitle: '悬停歌词时显示上一曲、播放/暂停和下一曲',
        });
        settings.bind(
            'enable-controls',
            controlsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        controlsGroup.add(controlsRow);
        page.add(controlsGroup);

        const providerGroup = new Adw.PreferencesGroup({
            title: '在线源顺序',
            description: '使用开关关闭不需要的源，用箭头调整尝试顺序。',
        });
        const providerRows = [];
        const rebuildProviderRows = () => {
            for (const row of providerRows)
                providerGroup.remove(row);
            providerRows.length = 0;

            const order = providerOrder(settings);
            const disabled = new Set(settings.get_strv('online-disabled-providers'));
            order.forEach((id, index) => {
                const provider = providerById(id);
                if (!provider)
                    return;

                const row = new Adw.ActionRow({
                    title: provider.name,
                    subtitle: provider.description,
                });
                const enabledSwitch = new Gtk.Switch({
                    active: !disabled.has(id),
                    valign: Gtk.Align.CENTER,
                });
                enabledSwitch.set_tooltip_text('启用歌词源');
                enabledSwitch.connect('notify::active', () => {
                    const nextDisabled = new Set(
                        settings.get_strv('online-disabled-providers')
                    );
                    if (enabledSwitch.active)
                        nextDisabled.delete(id);
                    else
                        nextDisabled.add(id);
                    settings.set_strv(
                        'online-disabled-providers',
                        [...nextDisabled]
                    );
                });
                row.add_suffix(enabledSwitch);
                row.add_suffix(makeIconButton(
                    'go-up-symbolic',
                    '上移',
                    () => {
                        if (index === 0)
                            return;
                        const next = providerOrder(settings);
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        settings.set_strv('online-providers', next);
                    },
                    index > 0
                ));
                row.add_suffix(makeIconButton(
                    'go-down-symbolic',
                    '下移',
                    () => {
                        const next = providerOrder(settings);
                        if (index >= next.length - 1)
                            return;
                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                        settings.set_strv('online-providers', next);
                    },
                    index < order.length - 1
                ));
                providerRows.push(row);
                providerGroup.add(row);
            });
        };
        settings.connect('changed::online-providers', rebuildProviderRows);
        settings.connect('changed::online-disabled-providers', rebuildProviderRows);
        rebuildProviderRows();
        page.add(providerGroup);

        const displayGroup = new Adw.PreferencesGroup({
            title: '显示位置',
        });
        const boxModel = Gtk.StringList.new(PANEL_BOXES.map(box => box.label));
        const boxRow = new Adw.ComboRow({
            title: '顶部栏区域',
            model: boxModel,
        });
        const syncPanelBox = () => {
            const selected = PANEL_BOXES.findIndex(
                box => box.id === settings.get_string('panel-box')
            );
            boxRow.selected = selected >= 0 ? selected : 1;
        };
        syncPanelBox();
        boxRow.connect('notify::selected', () => {
            const box = PANEL_BOXES[boxRow.selected];
            if (box)
                settings.set_string('panel-box', box.id);
        });
        settings.connect('changed::panel-box', syncPanelBox);
        displayGroup.add(boxRow);

        const positionRow = makeSpinRow(
            settings,
            'panel-position',
            '区域内位置',
            '数值越小越靠前',
            0,
            20
        );
        displayGroup.add(positionRow);

        const offsetXRow = makeSpinRow(
            settings,
            'panel-offset-x',
            '横向微调',
            '-100 到 100 像素',
            -100,
            100
        );
        displayGroup.add(offsetXRow);

        const offsetYRow = makeSpinRow(
            settings,
            'panel-offset-y',
            '纵向微调',
            '-20 到 20 像素',
            -20,
            20
        );
        displayGroup.add(offsetYRow);

        const fontRow = makeSpinRow(
            settings,
            'font-size',
            '歌词字号',
            '9 到 24 像素',
            9,
            24
        );
        displayGroup.add(fontRow);
        page.add(displayGroup);

        return page;
    }
}
