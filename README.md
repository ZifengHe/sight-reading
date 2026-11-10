# 钢琴视奏练习

自动谱写、自动播放的钢琴视奏练习页面：入门到十级共 11 级，每级 58 首。每首占一屏，弹完自动翻页。支持电脑、iPhone / iPad 横屏，以及 MIDI 键盘评分（电脑 Chrome / Edge，或 iOS 上支持 Web MIDI 的浏览器 App）。

- 在线打开：https://zifenghe.github.io/sight-reading/
- 构建：`python3 build.py`（需要 Pillow），会把 `src/` 打包成 `index.html` 和 `sight_reading.html`。

乐谱渲染：VexFlow（MIT）。钢琴音色：MusyngKite soundfont（gleitz/midi-js-soundfonts，CC BY-SA 3.0）。
