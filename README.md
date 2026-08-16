# Lyric Ex

一个适配 GNOME Shell 50 的顶部栏歌词扩展。

## 功能

- 读取当前 MPRIS 播放器的歌曲信息。
- 优先查找音频同目录下同名 `.lrc` 文件。
- 然后查找设置中的本地歌词目录。
- 本地歌词不存在时，可回退到在线歌词接口。
- 鼠标移入顶部栏歌词区域后隐藏歌词，显示上一曲、播放/暂停、下一曲按钮。
- 可在设置中开关播放控制按钮。
- 支持多个 MPRIS 播放器，优先跟随正在播放的播放器。
- 没有正在播放或暂停的曲目时自动隐藏，不占用顶部栏空间。
- 支持网易云音乐、QQ 音乐、酷狗音乐等多个在线歌词源。
- 可在扩展设置中关闭单个在线源、调整源顺序、歌词字号、顶部栏区域和位置微调。

## 安装

```bash
gnome-extensions pack \
  --extra-source=indicator.js \
  --extra-source=lyrics.js \
  --extra-source=mpris.js \
  --extra-source=online.js \
  . --force
gnome-extensions install --force lyric-ex@local.shell-extension.zip
gnome-extensions enable lyric-ex@local
```

安装后可以在 GNOME 扩展设置中配置本地歌词目录、在线源开关与顺序、歌词字号和顶部栏位置。

## 本地歌词命名

优先级如下：

1. 音频文件同目录下的同名 `.lrc`。
2. `艺术家 - 歌曲名.lrc`。
3. `歌曲名.lrc`。
4. `艺术家-歌曲名.lrc`。

## 在线接口

默认按网易云音乐、QQ 音乐、酷狗音乐、LRCLIB、Lyrics.ovh 的顺序尝试在线歌词。全部在线源不可用时，再回退到本地歌词；歌词服务的可用性取决于网络和服务端。
