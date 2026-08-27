import {LyricDocument, parseLyricsText} from '../lyrics.js';

const document = LyricDocument.fromLrc(
    '[ar:测试歌手]\n[00:01.00]第一句\n[00:03.50]第二句'
);

if (document.getLineAt(0) !== '')
    throw new Error('LRC should not show a line before its timestamp');
if (document.getLineAt(2) !== '第一句')
    throw new Error('LRC first line lookup failed');
if (document.getLineAt(4) !== '第二句')
    throw new Error('LRC second line lookup failed');

const plain = LyricDocument.fromPlain('第一行\n第二行');
if (plain.getLineAt(0) !== '第一行')
    throw new Error('plain lyrics first line lookup failed');
if (plain.getLineAt(5) !== '第二行')
    throw new Error('plain lyrics second line lookup failed');

if (LyricDocument.fromLrc('[ar:只有元数据]').lines.length !== 0)
    throw new Error('metadata-only LRC should not contain lyric lines');

const robust = LyricDocument.fromLrc(
    '\uFEFF[offset:-500]\n[ar:测试歌手]\n[00:01.5][00:02.250]带小数时间\n[00:03]包含 [方括号] 的歌词'
);
if (robust.lines.length !== 3)
    throw new Error('common LRC timestamp formats should be parsed');
if (robust.lines[0].time !== 1)
    throw new Error('LRC offset should be applied after metadata parsing');
if (robust.lines[2].text !== '包含 [方括号] 的歌词')
    throw new Error('lyric bracket text should be preserved');

const plainWithBrackets = parseLyricsText(
    '[Chorus]\n第一行\n第二行'
);
if (plainWithBrackets?.getLineAt(0) !== '[Chorus]')
    throw new Error('plain lyrics with brackets should remain plain text');

print('lrc-parser: ok');
