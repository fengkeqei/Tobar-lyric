import GLib from 'gi://GLib';

import {
    MprisController,
    playerAppId,
    sameTrackIdentity,
    selectPreferredPlayer,
} from '../mpris.js';

const firstTrack = {
    busName: 'org.mpris.MediaPlayer2.test',
    trackId: '',
    title: '第一首',
    artist: '歌手',
    album: '专辑',
};
const sameTrack = {...firstTrack};
const nextTrack = {...firstTrack, title: '第二首'};

if (!sameTrackIdentity(firstTrack, sameTrack))
    throw new Error('same track identity lookup failed');
if (sameTrackIdentity(firstTrack, nextTrack))
    throw new Error('track changes must not reuse the old position base');

if (playerAppId(
    'org.mpris.MediaPlayer2.chromium.instance123',
    '抖音',
    ''
) !== '抖音')
    throw new Error('MPRIS identity should be used as the stable app id');

const musicPlayer = {
    busName: 'org.mpris.MediaPlayer2.music',
    appId: 'music',
    status: 'Playing',
};
const videoPlayer = {
    busName: 'org.mpris.MediaPlayer2.video',
    appId: 'video',
    status: 'Playing',
};
if (selectPreferredPlayer([videoPlayer, musicPlayer], {
    filterEnabled: true,
    enabledApps: ['music'],
}) !== musicPlayer)
    throw new Error('disabled MPRIS apps must not be selected');
if (selectPreferredPlayer([musicPlayer, videoPlayer], {
    appOrder: ['video', 'music'],
}) !== videoPlayer)
    throw new Error('MPRIS app priority order should be respected');

const loop = new GLib.MainLoop(null, false);
let received = false;

const controller = new MprisController(snapshot => {
    if (!snapshot)
        return;

    received = true;
    print(`mpris: ${snapshot.identity} [${snapshot.appId}] / ${snapshot.title} / ${snapshot.artist} / ${snapshot.status}`);
    loop.quit();
});

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});

loop.run();
controller.destroy();

if (!received)
    print('mpris: no active player snapshot');
