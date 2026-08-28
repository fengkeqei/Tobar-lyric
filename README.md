# Lyric Ex

一个适配 GNOME Shell 50 的仿Flyme状态栏歌词风味顶部栏歌词扩展。

## 功能

- 读取当前 MPRIS 播放器的歌曲信息。
- 优先查找音频同目录下同名 `.lrc` 文件。
- 然后查找设置中的本地歌词目录。
- 本地歌词不存在时，可回退到在线歌词接口。
- 鼠标移入顶部栏歌词区域后隐藏歌词，显示上一曲、播放/暂停、下一曲按钮。
- 可在设置中开关播放控制按钮。
- 自动发现 MPRIS 播放器应用，可在设置中开启应用筛选、单独开关应用，并调整多个应用同时播放时的优先级。
- 支持多个 MPRIS 播放器；正在播放的应用优先于暂停的应用，同一状态下按应用优先级选择。
- 点击顶部栏歌词可打开类似 iOS 的正在播放卡片，显示专辑封面、歌曲信息、进度条和播放控制。
- 卡片支持上一曲、快退、播放/暂停、快进、下一曲，以及播放器支持时的随机和循环播放。
- 卡片内可展开完整歌词页：当前行高亮并自动居中，点击任意歌词行跳转播放位置。
- 逐字卡拉OK高亮（可在设置中开关）：酷狗 KRC、QQ 音乐 QRC 提供逐字时间轴时按每个字的实际时间与宽度填充，否则按行时长近似填充；作用于顶部栏与卡片歌词页。
- 歌词偏移校正：展开卡片歌词页后可按 ±0.5s 微调歌词时序，按歌曲记忆，设置中可一键清理偏移记录与封面缓存。
- 没有正在播放或暂停的曲目时自动隐藏，不占用顶部栏空间。
- 支持网易云音乐、QQ 音乐、酷狗音乐等多个在线歌词源。
- 可在扩展设置中关闭单个在线源、调整源顺序、歌词字号、顶部栏区域和位置微调。
- 改进 LRC/纯文本解析、UTF-16 本地歌词读取，以及在线源匹配和回退逻辑。

## 安装

```bash
gnome-extensions pack \
  --extra-source=indicator.js \
  --extra-source=lyrics.js \
  --extra-source=mpris.js \
  --extra-source=online.js \
  --extra-source=art-cache.js \
  --extra-source=now-playing-card.js \
  --extra-source=lyrics-view.js \
  --extra-source=karaoke.js \
  --extra-source=krc.js \
  --extra-source=offset-store.js \
  . --force
gnome-extensions install --force lyric-ex@local.shell-extension.zip
gnome-extensions enable lyric-ex@local
```

也可以直接使用仓库里的 `install.sh`，它会把全部模块文件复制到扩展目录并重新编译 schema。

安装后可以在 GNOME 扩展设置中配置本地歌词目录、在线源开关与顺序、播放器应用识别和优先级、正在播放卡片显示内容、歌词字号及顶部栏位置。

## 本地歌词命名

优先级如下：

1. 音频文件同目录下的同名 `.lrc`。
2. `艺术家 - 歌曲名.lrc`。
3. `歌曲名.lrc`。
4. `艺术家-歌曲名.lrc`。

## 在线接口

默认按网易云音乐、QQ 音乐、酷狗音乐、LRCLIB、Lyrics.ovh 的顺序尝试在线歌词。全部在线源不可用时，再回退到本地歌词；歌词服务的可用性取决于网络和服务端。
