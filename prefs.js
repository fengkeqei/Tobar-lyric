import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {MprisController} from './mpris.js';
import {OffsetStore} from './offset-store.js';
import {PROVIDERS} from './online.js';
import {SelectionStore} from './selection-store.js';

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

function playerAppOrder(settings, appIds) {
    const configured = settings
        .get_strv('player-app-order')
        .filter((id, index, ids) => id && ids.indexOf(id) === index);
    const result = [...configured];
    for (const appId of appIds) {
        if (!result.includes(appId))
            result.push(appId);
    }
    return result;
}

function uniquePlayerApps(players) {
    const apps = new Map();
    for (const player of players) {
        const current = apps.get(player.appId);
        if (!current || player.status === 'Playing')
            apps.set(player.appId, player);
    }
    return [...apps.values()];
}

function playerStatus(player) {
    if (player.status === 'Playing')
        return '正在播放';
    if (player.status === 'Paused')
        return '已暂停';
    return player.status || '未播放';
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

function rgbaToHex(color) {
    const channel = value =>
        Math.round(Math.max(0, Math.min(1, value)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function rgbaFromHex(hex) {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(String(hex ?? ''))) {
        rgba.red = 1;
        rgba.green = 0.48;
        rgba.blue = 0.62;
    }
    return rgba;
}

// Preset swatches for the karaoke fill color, tuned to read well on the
// dark panel.
const COLOR_SWATCHES = [
    '#ff7a9e', '#e94f64', '#ff9f43', '#ffd166', '#a3e635', '#7bd88f',
    '#4ecdc4', '#54a0ff', '#a29bfe', '#f472b6', '#f8f7ff', '#b8c1cc',
];

function makeSpinRow(watch, settings, key, title, subtitle, lower, upper) {
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
    watch(key, sync);
    return row;
}

export default class LyricExPreferences extends ExtensionPreferences {
    getPreferencesWidget() {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        // Signal ids to detach when the page is torn down, so repeatedly
        // opening preferences does not accumulate listeners.
        const settingsSignalIds = [];
        const watchSetting = (key, callback) =>
            settingsSignalIds.push(settings.connect(`changed::${key}`, callback));
        page.connect('destroy', () => {
            for (const id of settingsSignalIds)
                settings.disconnect(id);
            settingsSignalIds.length = 0;
            playerController?.destroy();
        });

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

        const playerGroup = new Adw.PreferencesGroup({
            title: '播放器识别',
            description: 'MPRIS 会同时报告音乐和视频应用。开启筛选后，只识别下方启用的应用；多个应用同时播放时按应用优先级选择。',
        });
        const playerFilterRow = new Adw.SwitchRow({
            title: '仅识别已启用的播放器',
            subtitle: '关闭时识别所有 MPRIS 播放器',
        });
        settings.bind(
            'player-app-filter-enabled',
            playerFilterRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        playerGroup.add(playerFilterRow);

        const playerRows = [];
        let discoveredPlayers = [];
        let discoveredSignature = '';
        const rebuildPlayerRows = () => {
            for (const row of playerRows)
                playerGroup.remove(row);
            playerRows.length = 0;

            const apps = uniquePlayerApps(discoveredPlayers);
            const appIds = apps.map(player => player.appId);
            const order = playerAppOrder(settings, appIds);
            const visibleOrder = order.filter(appId => appIds.includes(appId));
            const appsById = new Map(apps.map(player => [player.appId, player]));
            const enabled = new Set(settings.get_strv('enabled-player-apps'));

            if (!visibleOrder.length) {
                const emptyRow = new Adw.ActionRow({
                    title: '未检测到播放器应用',
                    subtitle: '启动音乐或视频应用后，这里会自动显示可识别的 MPRIS 应用',
                });
                playerRows.push(emptyRow);
                playerGroup.add(emptyRow);
                return;
            }

            for (const appId of visibleOrder) {
                const player = appsById.get(appId);
                const row = new Adw.ActionRow({
                    title: player.identity || appId,
                    subtitle: `${appId} · ${playerStatus(player)}`,
                });
                const enabledSwitch = new Gtk.Switch({
                    active: enabled.has(appId),
                    valign: Gtk.Align.CENTER,
                });
                enabledSwitch.set_tooltip_text('允许此应用触发歌词搜索');
                enabledSwitch.connect('notify::active', () => {
                    const nextEnabled = new Set(
                        settings.get_strv('enabled-player-apps')
                    );
                    if (enabledSwitch.active)
                        nextEnabled.add(appId);
                    else
                        nextEnabled.delete(appId);
                    settings.set_strv(
                        'enabled-player-apps',
                        [...nextEnabled]
                    );
                });
                row.add_suffix(enabledSwitch);

                const rowIndex = visibleOrder.indexOf(appId);
                row.add_suffix(makeIconButton(
                    'go-up-symbolic',
                    '提升应用优先级',
                    () => {
                        if (rowIndex === 0)
                            return;
                        const next = [...visibleOrder];
                        [next[rowIndex - 1], next[rowIndex]] =
                            [next[rowIndex], next[rowIndex - 1]];
                        settings.set_strv('player-app-order', next);
                    },
                    rowIndex > 0
                ));
                row.add_suffix(makeIconButton(
                    'go-down-symbolic',
                    '降低应用优先级',
                    () => {
                        if (rowIndex >= visibleOrder.length - 1)
                            return;
                        const next = [...visibleOrder];
                        [next[rowIndex], next[rowIndex + 1]] =
                            [next[rowIndex + 1], next[rowIndex]];
                        settings.set_strv('player-app-order', next);
                    },
                    rowIndex < visibleOrder.length - 1
                ));
                playerRows.push(row);
                playerGroup.add(row);
            }
        };
        const playerController = new MprisController(
            () => {},
            {
                onPlayersChanged: players => {
                    const apps = uniquePlayerApps(players);
                    const signature = apps
                        .map(player => `${player.appId}\u0000${player.identity}`)
                        .sort()
                        .join('\u0001');
                    if (signature === discoveredSignature)
                        return;
                    discoveredSignature = signature;
                    discoveredPlayers = players;
                    rebuildPlayerRows();
                },
            }
        );
        rebuildPlayerRows();
        // Rebuild on reorder too, otherwise the rows keep the previous
        // visual order and stale up/down sensitivity until a player change.
        watchSetting('player-app-order', rebuildPlayerRows);
        page.add(playerGroup);

        const cardGroup = new Adw.PreferencesGroup({
            title: '正在播放卡片',
            description: '点击顶部栏歌词区域打开，显示封面、进度和播放控制。',
        });
        for (const [key, title, subtitle] of [
            ['card-show-art', '显示专辑封面', '封面由播放器通过 MPRIS 提供'],
            ['card-show-seek-bar', '显示进度条', '支持拖动调整播放位置'],
            ['card-show-seek-buttons', '显示快进快退按钮', '按下方设置的秒数跳转'],
            ['card-show-shuffle', '显示随机播放按钮', '仅对支持随机播放的应用显示'],
            ['card-show-loop', '显示循环播放按钮', '仅对支持循环播放的应用显示'],
            ['card-show-lyrics', '显示完整歌词页', '展开后当前行高亮，点击歌词行跳转播放位置'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(
                key,
                row,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            cardGroup.add(row);
        }
        cardGroup.add(makeSpinRow(
            watchSetting,
            settings,
            'seek-step-seconds',
            '快进快退秒数',
            '1 到 60 秒',
            1,
            60
        ));
        cardGroup.add(makeSpinRow(
            watchSetting,
            settings,
            'card-width',
            '卡片宽度',
            '300 到 560 像素',
            300,
            560
        ));
        const artSizeModel = Gtk.StringList.new(['小', '中', '大']);
        const artSizeRow = new Adw.ComboRow({
            title: '专辑封面尺寸',
            model: artSizeModel,
        });
        const artSizes = ['small', 'medium', 'large'];
        const syncArtSize = () => {
            const selected = artSizes.indexOf(settings.get_string('card-art-size'));
            artSizeRow.selected = selected >= 0 ? selected : 1;
        };
        syncArtSize();
        artSizeRow.connect('notify::selected', () => {
            const value = artSizes[artSizeRow.selected];
            if (value)
                settings.set_string('card-art-size', value);
        });
        watchSetting('card-art-size', syncArtSize);
        cardGroup.add(artSizeRow);
        page.add(cardGroup);

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
        watchSetting('online-providers', rebuildProviderRows);
        watchSetting('online-disabled-providers', rebuildProviderRows);
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
        watchSetting('panel-box', syncPanelBox);
        displayGroup.add(boxRow);

        const positionRow = makeSpinRow(
            watchSetting,
            settings,
            'panel-position',
            '区域内位置',
            '数值越小越靠前',
            0,
            20
        );
        displayGroup.add(positionRow);

        const lyricWidthRow = makeSpinRow(
            watchSetting,
            settings,
            'panel-lyric-width',
            '歌词固定宽度',
            '160 到 600 像素',
            160,
            600
        );
        displayGroup.add(lyricWidthRow);

        const LYRIC_ALIGNS = [
            {id: 'start', label: '起点'},
            {id: 'center', label: '居中'},
            {id: 'end', label: '终点'},
        ];
        const alignModel = Gtk.StringList.new(
            LYRIC_ALIGNS.map(item => item.label)
        );
        const alignRow = new Adw.ComboRow({
            title: '区域内对齐',
            model: alignModel,
        });
        const syncAlign = () => {
            const selected = LYRIC_ALIGNS.findIndex(
                item => item.id === settings.get_string('lyric-align')
            );
            alignRow.selected = selected >= 0 ? selected : 0;
        };
        syncAlign();
        alignRow.connect('notify::selected', () => {
            const item = LYRIC_ALIGNS[alignRow.selected];
            if (item)
                settings.set_string('lyric-align', item.id);
        });
        watchSetting('lyric-align', syncAlign);
        displayGroup.add(alignRow);

        const offsetXRow = makeSpinRow(
            watchSetting,
            settings,
            'panel-offset-x',
            '横向微调',
            '-100 到 100 像素',
            -100,
            100
        );
        displayGroup.add(offsetXRow);

        const offsetYRow = makeSpinRow(
            watchSetting,
            settings,
            'panel-offset-y',
            '纵向微调',
            '-20 到 20 像素',
            -20,
            20
        );
        displayGroup.add(offsetYRow);

        const fontRow = makeSpinRow(
            watchSetting,
            settings,
            'font-size',
            '歌词字号',
            '9 到 24 像素',
            9,
            24
        );
        displayGroup.add(fontRow);

        const karaokeRow = new Adw.SwitchRow({
            title: '逐字卡拉OK高亮',
            subtitle: '当前行按行时长从左到右填充主题色；需要带时间轴的歌词',
        });
        settings.bind(
            'karaoke-highlight',
            karaokeRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(karaokeRow);

        const translationRow = new Adw.SwitchRow({
            title: '显示歌词翻译',
            subtitle: '在线源提供翻译时，卡片歌词页逐行显示，顶栏副行优先显示翻译',
        });
        settings.bind(
            'show-translation',
            translationRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(translationRow);

        const nextPreviewRow = new Adw.SwitchRow({
            title: '顶栏下一句预览',
            subtitle: '顶栏副行在当前行没有翻译时显示下一句歌词',
        });
        settings.bind(
            'panel-next-preview',
            nextPreviewRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(nextPreviewRow);

        const autoWidthRow = new Adw.SwitchRow({
            title: '自适应宽度',
            subtitle: '歌词条随当前行伸缩（灵动词岛式），上限为固定宽度设置',
        });
        settings.bind(
            'panel-auto-width',
            autoWidthRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(autoWidthRow);

        displayGroup.add(makeSpinRow(
            watchSetting,
            settings,
            'panel-opacity',
            '顶栏歌词不透明度',
            '40% 到 100%',
            40,
            100
        ));

        const accentModel = Gtk.StringList.new([
            '跟随主题强调色',
            '自定义颜色',
        ]);
        const accentRow = new Adw.ComboRow({
            title: '卡拉OK填充色',
            model: accentModel,
        });
        const customColorRows = [];
        const syncAccentMode = () => {
            const custom =
                settings.get_string('lyric-accent-mode') === 'custom';
            accentRow.selected = custom ? 1 : 0;
            for (const row of customColorRows)
                row.sensitive = custom;
        };
        accentRow.connect('notify::selected', () => {
            settings.set_string(
                'lyric-accent-mode',
                accentRow.selected === 1 ? 'custom' : 'theme'
            );
        });
        watchSetting('lyric-accent-mode', syncAccentMode);
        displayGroup.add(accentRow);

        // Swatch picker: the button shows the current color and opens a
        // preset palette plus a custom color editor.
        const colorRow = new Adw.ActionRow({
            title: '选色卡',
            subtitle: '为卡拉OK填充挑选颜色',
        });
        const colorDialog = new Gtk.ColorDialog({
            title: '选择填充颜色',
            with_alpha: false,
            modal: true,
        });
        try {
            colorDialog.palette =
                COLOR_SWATCHES.map(hex => rgbaFromHex(hex));
        } catch (_error) {
            // Palette marshalling is unavailable; the picker still works
            // with the custom editor alone.
        }
        const colorButton = new Gtk.ColorDialogButton({
            dialog: colorDialog,
            valign: Gtk.Align.CENTER,
        });
        colorButton.rgba = rgbaFromHex(settings.get_string('lyric-color'));
        colorButton.connect('notify::rgba', () => {
            settings.set_string('lyric-color', rgbaToHex(colorButton.rgba));
        });
        watchSetting('lyric-color', () => {
            const rgba = rgbaFromHex(settings.get_string('lyric-color'));
            if (colorButton.rgba?.to_string() !== rgba.to_string())
                colorButton.rgba = rgba;
        });
        colorRow.add_suffix(colorButton);
        customColorRows.push(colorRow);
        displayGroup.add(colorRow);

        const hexRow = new Adw.EntryRow({
            title: '十六进制颜色',
            text: settings.get_string('lyric-color'),
            show_apply_button: true,
        });
        hexRow.connect('apply', () => {
            const value = hexRow.text.trim();
            if (/^#?[0-9a-fA-F]{6}$/.test(value))
                settings.set_string(
                    'lyric-color',
                    value.startsWith('#') ? value : `#${value}`
                );
        });
        watchSetting('lyric-color', () => {
            const value = settings.get_string('lyric-color');
            if (hexRow.text !== value)
                hexRow.text = value;
        });
        customColorRows.push(hexRow);
        displayGroup.add(hexRow);

        const familyRow = new Adw.EntryRow({
            title: '歌词字体',
            text: settings.get_string('lyric-font-family'),
            show_apply_button: true,
        });
        familyRow.connect('apply', () => {
            settings.set_string('lyric-font-family', familyRow.text.trim());
        });
        watchSetting('lyric-font-family', () => {
            const value = settings.get_string('lyric-font-family');
            if (familyRow.text !== value)
                familyRow.text = value;
        });
        displayGroup.add(familyRow);

        syncAccentMode();
        page.add(displayGroup);

        const cacheGroup = new Adw.PreferencesGroup({
            title: '缓存管理',
            description: '清理后不影响扩展运行，相关数据会按需重建。',
        });
        const makeCacheRow = (title, subtitle, onClear) => {
            const row = new Adw.ActionRow({title, subtitle});
            const button = new Gtk.Button({
                label: '清理',
                valign: Gtk.Align.CENTER,
            });
            button.connect('clicked', () => {
                button.sensitive = false;
                try {
                    onClear();
                } finally {
                    button.sensitive = true;
                }
            });
            row.add_suffix(button);
            return row;
        };
        cacheGroup.add(makeCacheRow(
            '歌词偏移记忆',
            '清除所有歌曲的手动歌词偏移校正记录',
            () => new OffsetStore().clear()
        ));
        cacheGroup.add(makeCacheRow(
            '手动歌词选择记录',
            '清除“重新匹配”功能保存的按曲目歌词选择',
            () => new SelectionStore().clear()
        ));
        cacheGroup.add(makeCacheRow(
            '封面图片缓存',
            `删除已下载的专辑封面（位于 ${GLib.build_filenamev([
                GLib.get_user_cache_dir(),
                'lyric-ex',
                'card-art',
            ])}）`,
            () => {
                const dir = Gio.File.new_for_path(GLib.build_filenamev([
                    GLib.get_user_cache_dir(),
                    'lyric-ex',
                    'card-art',
                ]));
                try {
                    const enumerator = dir.enumerate_children(
                        'standard::name',
                        Gio.FileQueryInfoFlags.NONE,
                        null
                    );
                    for (;;) {
                        const infos = enumerator.next_files(64);
                        if (!infos || infos.length === 0)
                            break;
                        for (const info of infos)
                            dir.get_child(info.get_name()).delete(null);
                    }
                    enumerator.close(null);
                } catch (_error) {
                    // Nothing cached yet.
                }
            }
        ));
        page.add(cacheGroup);

        return page;
    }
}
