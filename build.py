#!/usr/bin/env python3
"""把 src/ 下的模板、VexFlow、钢琴采样和程序打包成一个独立的 HTML 文件。"""
import base64, io, json, pathlib, sys
root = pathlib.Path(__file__).parent
src = root / 'src'
tpl = (src / 'template.html').read_text(encoding='utf-8')
vex = (src / 'vendor' / 'vexflow-4.2.2.js').read_text(encoding='utf-8')
samples = json.loads((src / 'vendor' / 'piano_samples.json').read_text())
app = (src / 'app.js').read_text(encoding='utf-8') + '\n' + (src / 'pop909.js').read_text(encoding='utf-8') + '\n' + (src / 'learn.js').read_text(encoding='utf-8')

def make_icon():
    # 主屏幕图标：深色底 + 两个用符杠连起来的八分音符
    from PIL import Image, ImageDraw
    n = 180 * 4
    im = Image.new('RGB', (n, n), (32, 35, 42))
    d = ImageDraw.Draw(im)
    gold = (240, 196, 110)
    for cx, cy in [(250, 520), (500, 470)]:
        d.ellipse([cx - 78, cy - 56, cx + 78, cy + 56], fill=gold)
        d.rectangle([cx + 52, cy - 330, cx + 78, cy], fill=gold)
    d.polygon([(302, 190), (578, 140), (578, 210), (302, 260)], fill=gold)
    buf = io.BytesIO()
    im.resize((180, 180), Image.LANCZOS).save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()
# 录音分析页嵌进主页（iframe srcdoc）：VexFlow 用外层页面已经载入的那份，不重复打包
rec = (root / 'record.html').read_text(encoding='utf-8')
VTAG = '<script src="src/vendor/vexflow-4.2.2.js"></script>'
assert VTAG in rec
rec = rec.replace(VTAG, '<script>window.Vex = parent.Vex;</script>')
rec_js = json.dumps(rec, ensure_ascii=False).replace('</', '<\\/').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
for name, code in [('vexflow', vex), ('app', app)]:
    assert '</script' not in code.lower(), name
out = (tpl.replace('/*__ICON__*/', make_icon())
          .replace('/*__VEXFLOW__*/', vex)
          .replace('/*__SAMPLES__*/', 'window.PIANO_SAMPLES=' + json.dumps(samples, separators=(',', ':')) + ';')
          .replace('/*__RECORD__*/""', rec_js)
          .replace('/*__APP__*/', app))
dst = root / 'sight_reading.html'
dst.write_text(out, encoding='utf-8')
print(dst, round(len(out.encode()) / 1e6, 2), 'MB')
(root / 'index.html').write_text(out, encoding='utf-8')  # GitHub Pages 入口

# 发布版（claude.ai 网页）：发布时会自动套上 <html>/<head>/<body>，这里只保留 <title>、<style> 和正文
if len(sys.argv) > 1:
    import re
    title = re.search(r'<title>.*?</title>', out, re.S).group(0)
    style = re.search(r'<style>.*?</style>', out, re.S).group(0)
    body = re.search(r'<body>(.*)</body>', out, re.S).group(1)
    page = title + '\n' + style + '\n' + body.strip() + '\n'
    art = pathlib.Path(sys.argv[1])
    art.write_text(page, encoding='utf-8')
    print(art, round(len(page.encode()) / 1e6, 2), 'MB')
