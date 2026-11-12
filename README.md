# 钢琴视奏练习

自动谱写、自动播放的钢琴视奏练习页面：入门到十级共 11 级，每级 198 首。每首占一屏，弹完自动翻页。支持电脑、iPhone / iPad 横屏，以及 MIDI 键盘评分（电脑 Chrome / Edge，或 iOS 上支持 Web MIDI 的浏览器 App）。

- 在线打开：https://zifenghe.github.io/sight-reading/
- **学曲子模式**（📖）：载入自己的 MusicXML / .mxl / MIDI 曲谱（只存在本机），或从 POP909 曲库选歌；选范围循环、速度阶梯、从后往前、按小节统计易错处、记录每天进度。
- 构建：`python3 build.py`（需要 Pillow），会把 `src/` 打包成 `index.html` 和 `sight_reading.html`。

曲库：曲目表来自 [POP909](https://github.com/music-x-lab/POP909-Dataset)（MIT），谱面来自 [POP909-CL](https://github.com/AndyWeasley2004/POP909-CL-Dataset)（MIT）。本仓库不包含这些乐谱，选歌时才从原仓库下载。

乐谱渲染：VexFlow（MIT）。钢琴音色：MusyngKite soundfont（gleitz/midi-js-soundfonts，CC BY-SA 3.0）。
