// 用法：node enc_score.js <曲谱文件> <输出目录>   → 输出 <目录>/<随机编号>.bin，打印短链接的 # 部分
// 内容：12 字节 IV + AES-128-GCM（密文+16 字节校验）；明文是 deflate-raw 压缩后的曲谱。密钥只出现在链接里。
const fs = require('fs'), crypto = require('crypto'), zlib = require('zlib'), path = require('path');
const [src, outDir] = process.argv.slice(2);
const data = zlib.deflateRawSync(fs.readFileSync(src), { level: 9 });
const key = crypto.randomBytes(16), iv = crypto.randomBytes(12);
const c = crypto.createCipheriv('aes-128-gcm', key, iv);
const ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
const id = crypto.randomBytes(8).toString('hex');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, id + '.bin'), Buffer.concat([iv, ct]));
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
console.log(`#e=${id}&k=${b64u(key)}`);
