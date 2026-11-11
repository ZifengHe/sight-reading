/* =====================================================================
 * 学曲子模式：载入自己的曲谱（MusicXML / .mxl / MIDI），分段循环、速度阶梯、
 * 从后往前、按小节统计易错处、记录进度。曲谱只存在本机（IndexedDB），不上传。
 * ===================================================================== */
const LM = {
  active: false, id: null, piece: null, bars: [], data: null,
  startT0: 0, endT0: 0, passFull: false, picking: null, hud: '', loop: true,
};

/* ---------------- 本机存储 ---------------- */
const IDB = {
  db: null, mem: new Map(),
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res) => {
      try {
        const rq = indexedDB.open('sr-learn', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('pieces');
        rq.onsuccess = () => { this.db = rq.result; res(this.db); };
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async put(k, v) {
    const db = await this.open(); this.mem.set(k, v);
    if (!db) return false;
    return new Promise((res) => { try { const tx = db.transaction('pieces', 'readwrite'); tx.objectStore('pieces').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } });
  },
  async get(k) {
    if (this.mem.has(k)) return this.mem.get(k);
    const db = await this.open(); if (!db) return null;
    return new Promise((res) => { try { const rq = db.transaction('pieces').objectStore('pieces').get(k); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch (e) { res(null); } });
  },
  async del(k) {
    this.mem.delete(k);
    const db = await this.open(); if (!db) return;
    return new Promise((res) => { try { const tx = db.transaction('pieces', 'readwrite'); tx.objectStore('pieces').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch (e) { res(); } });
  },
};
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
const pieceList = () => lsGet('sr.pieces', []);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------- 解压 .mxl（zip） ---------------- */
async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const out = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(out);
    } catch (e) { /* 老系统不支持 deflate-raw，用下面的纯 JS 版本 */ }
  }
  return inflateJS(data);
}
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
function inflateJS(src) {
  let pos = 0, bitbuf = 0, bitcnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0;
  const grow = (need) => { if (n + need <= out.length) return; let len = out.length * 2; while (len < n + need) len *= 2; const nb = new Uint8Array(len); nb.set(out.subarray(0, n)); out = nb; };
  const bit = () => { if (!bitcnt) { if (pos >= src.length) throw new Error('压缩数据不完整'); bitbuf = src[pos++]; bitcnt = 8; } const b = bitbuf & 1; bitbuf >>= 1; bitcnt--; return b; };
  const bits = (k) => { let v = 0; for (let i = 0; i < k; i++) v |= bit() << i; return v; };
  const build = (lens) => {
    const counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(lens.length);
    for (const l of lens) counts[l]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    for (let i = 0; i < lens.length; i++) if (lens[i]) symbols[offs[lens[i]]++] = i;
    return { counts, symbols };
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bit();
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('压缩数据有误');
  };
  let fixedL = null, fixedD = null;
  let last;
  do {
    last = bit();
    const type = bits(2);
    if (type === 0) {
      bitcnt = 0;
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      grow(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
      continue;
    }
    let lt, dt;
    if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        fixedL = build(l); fixedD = build(new Uint8Array(30).fill(5));
      }
      lt = fixedL; dt = fixedD;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const ORD = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[ORD[i]] = bits(3);
      const ch = build(cl);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(ch);
        if (sym < 16) lens[i++] = sym;
        else if (sym === 16) { const prev = lens[i - 1]; let r = 3 + bits(2); while (r--) lens[i++] = prev; }
        else if (sym === 17) { let r = 3 + bits(3); while (r--) lens[i++] = 0; }
        else { let r = 11 + bits(7); while (r--) lens[i++] = 0; }
      }
      lt = build(lens.subarray(0, hlit)); dt = build(lens.subarray(hlit));
    } else throw new Error('压缩数据有误');
    for (;;) {
      const sym = decode(lt);
      if (sym < 256) { grow(1); out[n++] = sym; }
      else if (sym === 256) break;
      else {
        const li = sym - 257; const len = LBASE[li] + bits(LEXT[li]);
        const ds = decode(dt); const dist = DBASE[ds] + bits(DEXT[ds]);
        grow(len);
        for (let i = 0; i < len; i++) { out[n] = out[n - dist]; n++; }
      }
    }
  } while (!last);
  return out.subarray(0, n);
}
function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  return new TextDecoder('utf-8').decode(u8);
}
async function unzipMusicXML(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('压缩包已损坏');
  const cnt = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const entries = [];
  for (let k = 0; k < cnt; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, csize, lho });
    p += 46 + nlen + xlen + clen;
  }
  const read = async (en) => {
    const q = en.lho, nlen = dv.getUint16(q + 26, true), xlen = dv.getUint16(q + 28, true);
    const data = u8.subarray(q + 30 + nlen + xlen, q + 30 + nlen + xlen + en.csize);
    if (en.method === 0) return data;
    if (en.method === 8) return inflateRaw(data);
    throw new Error('不支持的压缩方式');
  };
  let target = null;
  const cont = entries.find((x) => x.name === 'META-INF/container.xml');
  if (cont) {
    const m = /full-path="([^"]+)"/.exec(decodeText(await read(cont)));
    if (m) target = entries.find((x) => x.name === m[1]);
  }
  if (!target) target = entries.find((x) => !x.name.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(x.name));
  if (!target) throw new Error('压缩包里没有找到乐谱');
  return decodeText(await read(target));
}

/* ---------------- 乐理小工具 ---------------- */
const MAJ_BY_FIFTHS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const MIN_BY_FIFTHS = { '-6': 'Ebm', '-5': 'Bbm', '-4': 'Fm', '-3': 'Cm', '-2': 'Gm', '-1': 'Dm', 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m' };
function keyFromFifths(f, minor) {
  f = clamp(Math.round(f) || 0, -7, 7);
  return makeKey((minor && MIN_BY_FIFTHS[f]) || MAJ_BY_FIFTHS[f]);
}
const TS_CACHE = {};
function makeTS(n, d) {
  const name = `${n}/${d}`;
  if (TS_CACHE[name]) return TS_CACHE[name];
  const comp = d === 8 && n % 3 === 0 && n >= 6;
  const len = (n * 96) / d;
  return (TS_CACHE[name] = { name, n, d, len, beat: comp ? 36 : 96 / d, strong: [0], comp });
}
const TYPE_CODE = { breve: 'w', whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32', '64th': '64', '128th': '64' };
const TYPE_TICKS = { breve: 192, whole: 96, half: 48, quarter: 24, eighth: 12, '16th': 6, '32nd': 3, '64th': 1.5, '128th': 0.75 };
const ACC_XML = { sharp: '#', flat: 'b', natural: 'n', 'double-sharp': '##', 'sharp-sharp': '##', 'flat-flat': 'bb', 'natural-sharp': '#', 'natural-flat': 'b' };
// 按时值推算记谱（MusicXML 没写 <type> 时用）
function codeFromTicks(t) {
  for (const [v, c, dots] of [[144, 'w', 1], [96, 'w', 0], [72, 'h', 1], [48, 'h', 0], [36, 'q', 1], [24, 'q', 0], [18, '8', 1], [12, '8', 0], [9, '16', 1], [6, '16', 0], [3, '32', 0]]) if (t >= v - 1e-6) return { code: c, dots };
  return { code: '32', dots: 0 };
}
// 根据调号算出每个音要不要标临时记号（MIDI 导入、或 MusicXML 没写 <accidental> 时用）
function computeAccidentals(bars) {
  for (const bar of bars) {
    const sig = bar.key.sig;
    for (const h of ['rh', 'lh']) {
      const st = {};
      const evs = bar[h].filter((e) => !e.rest).sort((a, b) => a.pos - b.pos);
      for (const e of evs) for (const n of e.notes) {
        const cur = n.d in st ? st[n.d] : sig[mod(n.d, 7)];
        if (n.tieStop && n.a === cur) { n.acc = ''; continue; }
        n.acc = n.a !== cur ? ACC[n.a] || '' : '';
        st[n.d] = n.a;
      }
    }
  }
}

/* ---------------- MusicXML ---------------- */
const xKids = (el, name) => { const out = []; for (const c of el.children) if (c.localName === name) out.push(c); return out; };
const xKid = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
const xTxt = (el, name, d) => { const c = el && xKid(el, name); return c ? c.textContent.trim() : d; };
function clefName(c) {
  if (!c) return null;
  const sign = c.sign, line = c.line;
  if (sign === 'F') return 'bass';
  if (sign === 'C') return line === 4 ? 'tenor' : 'alto';
  return 'treble';
}
function parsePart(partEl) {
  let div = 1, keyF = 0, minor = false, tsN = 4, tsD = 4, staves = 1;
  const clefs = {}; const out = []; let tempo = null;
  for (const m of xKids(partEl, 'measure')) {
    const M = { num: m.getAttribute('number'), implicit: m.getAttribute('implicit') === 'yes', notes: [], maxT: 0, fwd: false, bwd: 0, endNums: null, endStop: false };
    let t = 0, lastStart = 0;
    const tk = (x) => (parseFloat(x) || 0) * 24 / div;
    for (const c of m.children) {
      const nm = c.localName;
      if (nm === 'attributes') {
        const dv = xTxt(c, 'divisions'); if (dv) div = parseFloat(dv) || div;
        const st = xTxt(c, 'staves'); if (st) staves = Math.max(staves, +st);
        const k = xKid(c, 'key'); if (k && xKid(k, 'fifths')) { keyF = +xTxt(k, 'fifths', 0); minor = xTxt(k, 'mode', 'major') === 'minor'; }
        const tm = xKid(c, 'time');
        if (tm && xKid(tm, 'beats')) { const b = xTxt(tm, 'beats', '4').split('+').reduce((a, x) => a + (+x || 0), 0); const bt = +xTxt(tm, 'beat-type', '4'); if (b > 0 && bt > 0) { tsN = b; tsD = bt; } }
        for (const cl of xKids(c, 'clef')) {
          const no = +(cl.getAttribute('number') || 1);
          const info = { sign: xTxt(cl, 'sign', 'G'), line: +xTxt(cl, 'line', 0), oct: +xTxt(cl, 'clef-octave-change', 0) };
          (clefs[no] = clefs[no] || []).push({ t, info });   // 小节中间换谱号：从下一小节起生效
        }
      } else if (nm === 'backup') { t -= tk(xTxt(c, 'duration', 0)); if (t < 0) t = 0; }
      else if (nm === 'forward') { t += tk(xTxt(c, 'duration', 0)); M.maxT = Math.max(M.maxT, t); }
      else if (nm === 'note') {
        if (xKid(c, 'grace') || xKid(c, 'cue')) continue;
        const chord = !!xKid(c, 'chord');
        const dur = tk(xTxt(c, 'duration', 0));
        const start = chord ? lastStart : t;
        if (!chord) { lastStart = t; t += dur; M.maxT = Math.max(M.maxT, t); }
        if (c.getAttribute('print-object') === 'no') continue;   // 看不见的音/休止符：当作空档
        const restEl = xKid(c, 'rest');
        const N = { start, dur, chord, staff: +xTxt(c, 'staff', 1), voice: xTxt(c, 'voice', '1'), rest: !!restEl };
        const ty = xTxt(c, 'type');
        if (ty && TYPE_CODE[ty]) { N.code = TYPE_CODE[ty]; N.typeTicks = TYPE_TICKS[ty]; } else { const cf = codeFromTicks(dur); N.code = cf.code; N.dots = cf.dots; N.typeTicks = dur; }
        if (N.dots === undefined) N.dots = xKids(c, 'dot').length;
        N.normTicks = N.typeTicks;
        N.typeTicks *= N.dots === 1 ? 1.5 : N.dots >= 2 ? 1.75 : 1;
        if (restEl) {
          N.mrest = restEl.getAttribute('measure') === 'yes';
          const ds = xTxt(restEl, 'display-step'), dO = xTxt(restEl, 'display-octave');
          if (ds && dO) N.restKey = ds.toLowerCase() + '/' + dO;
        } else {
          const p = xKid(c, 'pitch'); if (!p) continue;    // 打击乐等无音高的音
          const step = xTxt(p, 'step', 'C').toLowerCase(), oct = +xTxt(p, 'octave', 4), alt = Math.round(parseFloat(xTxt(p, 'alter', 0)) || 0);
          N.d = LETTERS.indexOf(step) + 7 * oct; N.a = alt;
          const ac = xTxt(c, 'accidental'); N.acc = ac === undefined ? undefined : ACC_XML[ac] ?? '';
          for (const ti of xKids(c, 'tie')) { if (ti.getAttribute('type') === 'start') N.tieStart = true; if (ti.getAttribute('type') === 'stop') N.tieStop = true; }
          const stem = xTxt(c, 'stem'); if (stem === 'up' || stem === 'down') N.stem = stem;
        }
        const tmod = xKid(c, 'time-modification');
        if (tmod) { N.tupN = +xTxt(tmod, 'actual-notes', 3); N.tupM = +xTxt(tmod, 'normal-notes', 2); const nt = xTxt(tmod, 'normal-type'); if (nt && TYPE_TICKS[nt]) N.normTicks = TYPE_TICKS[nt]; }
        const nots = xKid(c, 'notations');
        if (nots) {
          for (const tp of xKids(nots, 'tuplet')) { if (tp.getAttribute('type') === 'start') N.tupStart = true; if (tp.getAttribute('type') === 'stop') N.tupStop = true; }
          const tech = xKid(nots, 'technical'); const fg = tech && xTxt(tech, 'fingering'); if (fg) N.finger = fg;
          for (const td of xKids(nots, 'tied')) { if (td.getAttribute('type') === 'start') N.tieStart = true; if (td.getAttribute('type') === 'stop') N.tieStop = true; }
        }
        M.notes.push(N);
      } else if (nm === 'barline') {
        const bs = xTxt(c, 'bar-style', '');
        if ((c.getAttribute('location') || 'right') === 'right' && /light-light|light-heavy|heavy-light|heavy-heavy/.test(bs)) M.dbl = true;
        if (xKid(c, 'segno')) M.segno = true;
        if (xKid(c, 'coda')) M.coda = true;
        const rp = xKid(c, 'repeat');
        if (rp) { if (rp.getAttribute('direction') === 'forward') M.fwd = true; else M.bwd = +(rp.getAttribute('times') || 2); }
        const en = xKid(c, 'ending');
        if (en) {
          const ty = en.getAttribute('type');
          if (ty === 'start') M.endNums = (en.getAttribute('number') || '1').split(/[,\s]+/).map(Number).filter((x) => x > 0);
          else M.endStop = true;
        }
      } else if (nm === 'direction' || nm === 'sound') {
        const snd = nm === 'sound' ? c : xKid(c, 'sound');
        // 跳转记号：D.C. / D.S. / Fine / To Coda / Coda / Segno（优先看 <sound>，再看文字）
        if (snd) {
          if (snd.getAttribute('dacapo') === 'yes') M.dc = true;
          if (snd.getAttribute('dalsegno')) M.ds = true;
          if (snd.getAttribute('fine')) M.fine = true;
          if (snd.getAttribute('tocoda')) M.tocoda = true;
          if (snd.getAttribute('coda')) M.coda = true;
          if (snd.getAttribute('segno')) M.segno = true;
        }
        if (nm === 'direction') {
          if (c.getElementsByTagName('segno').length) M.segno = true;
          if (c.getElementsByTagName('coda').length) M.codaSign = true;
          for (const w of c.getElementsByTagName('words')) {
            const t = w.textContent.replace(/\s+/g, ' ').trim();
            if (/^d\.?\s?c\.?(\s|$)|da\s*capo/i.test(t)) M.dc = true;
            else if (/^d\.?\s?s\.?(\s|$)|dal\s*segno/i.test(t)) M.ds = true;
            else if (/to\s*coda/i.test(t)) M.tocoda = true;
            else if (/^fine\.?$/i.test(t)) M.fine = true;
          }
        }
        if (tempo == null && snd && snd.getAttribute('tempo')) tempo = parseFloat(snd.getAttribute('tempo'));
        if (tempo == null && nm === 'direction') {
          const met = c.querySelector('metronome');
          if (met && xKid(met, 'per-minute')) { const bu = xTxt(met, 'beat-unit', 'quarter'); const dots = xKids(met, 'beat-unit-dot').length; tempo = parseFloat(xTxt(met, 'per-minute')) * (TYPE_TICKS[bu] || 24) * (dots ? 1.5 : 1) / 24; }
        }
      }
    }
    M.ts = makeTS(tsN, tsD); M.keyF = keyF; M.minor = minor;
    M.clefStart = {}; M.clefNext = {};
    for (const no of Object.keys(clefs)) {
      const arr = clefs[no]; const atStart = arr.filter((x) => x.t <= 1e-6);
      if (atStart.length) M.clefStart[no] = atStart[atStart.length - 1].info;
      if (arr.length) M.clefNext[no] = arr[arr.length - 1].info;
      clefs[no] = [{ t: 0, info: arr[arr.length - 1].info }];
    }
    out.push(M);
  }
  return { measures: out, staves, tempo };
}
// 反复记号展开：按实际演奏顺序排列小节。
// 支持：反复记号、1/2 房子、D.C. / D.S.（跳回后不再反复，遇到房子走最后一个）、Fine、To Coda → Coda。
// 没有起始反复记号时，回到前一条双小节线（或前一个反复结束处、全曲开头）。
function unrollOrder(R) {
  const n = R.length;
  const segno = R.findIndex((r) => r.segno);
  // Coda：明确的 tocoda 标记 + coda 目标；只有 coda 符号时，第一个当 “To Coda”，最后一个当目标
  const codaMarks = []; R.forEach((r, i) => { if (r.coda || r.codaSign) codaMarks.push(i); });
  let tocoda = new Set(R.map((r, i) => (r.tocoda ? i : -1)).filter((i) => i >= 0));
  let codaT = -1;
  if (tocoda.size) codaT = codaMarks.filter((i) => i > Math.max(...tocoda)).pop() ?? -1;
  else if (codaMarks.length >= 2) { tocoda = new Set([codaMarks[0]]); codaT = codaMarks[codaMarks.length - 1]; }
  const order = []; let i = 0, start = 0, pass = 1, jumped = false, after = false, guard = 0;
  let dcUsed = false, dsUsed = false;
  const done = new Map();
  while (i < n && guard++ < 20000) {
    const r = R[i];
    if (r.fwd && !jumped && !after) { start = i; pass = 1; }
    jumped = false;
    if (r.endNums) {
      let j = i; while (j < n - 1 && !R[j].endStop) j++;
      const skip = after ? !!(R[j + 1] && R[j + 1].endNums) : !r.endNums.includes(pass);
      if (skip) { i = j + 1; continue; }
    }
    order.push(i);
    if (after && r.fine) break;
    if (after && tocoda.has(i) && codaT > i) { i = codaT; continue; }
    if (r.bwd && !after) {
      const c = done.get(i) || 0;
      if (c < r.bwd - 1) { done.set(i, c + 1); pass++; i = start; jumped = true; continue; }
      done.set(i, 0); pass = 1; start = i + 1;
    }
    if (r.dc && !dcUsed) { dcUsed = true; after = true; i = 0; continue; }
    if (r.ds && !dsUsed && segno >= 0) { dsUsed = true; after = true; i = segno; continue; }
    if (r.dbl && !r.bwd && !after) { start = i + 1; pass = 1; }
    i++;
  }
  return order;
}
function parseMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('文件内容不是有效的 MusicXML');
  const root = doc.documentElement;
  if (root.localName === 'score-timewise') throw new Error('暂不支持 timewise 格式的 MusicXML，请导出为普通的 MusicXML');
  if (root.localName !== 'score-partwise') throw new Error('不是 MusicXML 乐谱');
  const wt = root.querySelector('work > work-title'), mt = root.querySelector('movement-title');
  let title = (wt && wt.textContent.trim()) || (mt && mt.textContent.trim()) || '';
  const parts = xKids(root, 'part').map((p) => parsePart(p));
  const hasNotes = (P) => P.measures.some((m) => m.notes.some((n) => !n.rest));
  // 选声部：优先用有两行谱表的钢琴声部；否则按谱号把各声部分给右手（高音）和左手（低音）
  let assign = [];
  const piano = parts.findIndex((P) => P.staves >= 2 && hasNotes(P));
  if (piano >= 0) assign.push({ pi: piano, hand: (st) => (st >= 2 ? 'lh' : 'rh') });
  else {
    parts.forEach((P, pi) => {
      if (!hasNotes(P)) return;
      const c = P.measures[0] && (P.measures[0].clefStart[1] || P.measures[0].clefNext[1]);
      let hand = 'rh';
      if (c && (c.sign === 'F' || (c.sign === 'G' && c.oct < 0))) hand = 'lh';
      else if (c && c.sign === 'C') { const ps = []; P.measures.forEach((m) => m.notes.forEach((n) => { if (!n.rest) ps.push(midiOf(n.d, n.a)); })); hand = ps.reduce((a, x) => a + x, 0) / Math.max(1, ps.length) >= 60 ? 'rh' : 'lh'; }
      assign.push({ pi, hand: () => hand });
    });
  }
  if (!assign.length) throw new Error('乐谱里没有找到音符');
  const P0 = parts[assign[0].pi];
  const nM = Math.min(...assign.map((a) => parts[a.pi].measures.length));
  const order = unrollOrder(P0.measures.slice(0, nM));
  const tempo = assign.map((a) => parts[a.pi].tempo).find((x) => x) || parts.map((p) => p.tempo).find((x) => x) || 80;
  const hasAccTags = /<accidental[\s>]/.test(text);
  // 各小节当前的谱号（按右手、左手）
  const clefFor = (a, mi, staff) => {
    const ms = parts[a.pi].measures;
    for (let j = mi; j >= 0; j--) { if (j < mi && ms[j].clefNext[staff]) return ms[j].clefNext[staff]; if (ms[j].clefStart[staff]) return ms[j].clefStart[staff]; }
    return null;
  };
  const bars = [];
  const openTies = new Map();
  order.forEach((mi, k) => {
    const M0 = P0.measures[mi];
    let len = M0.ts.len;
    const maxT = Math.max(...assign.map((a) => parts[a.pi].measures[mi].maxT));
    if (M0.implicit && maxT > 0 && maxT < len) len = maxT;
    if (maxT > len + 1e-6) len = maxT;
    const bar = { num: k + 1, origNum: M0.num, gidx: k, len, ts: M0.ts, key: keyFromFifths(M0.keyF, M0.minor), clef: { rh: 'treble', lh: 'bass' }, rh: [], lh: [] };
    if (piano >= 0) {
      const c1 = clefName(clefFor(assign[0], mi, 1)), c2 = clefName(clefFor(assign[0], mi, 2));
      bar.clef = { rh: c1 === 'bass' ? 'bass' : 'treble', lh: c2 === 'treble' ? 'treble' : 'bass' };
    }
    // 声部编号（每只手内部按出现顺序排）
    const vkeys = { rh: [], lh: [] };
    const lastEv = new Map(), tupOpen = new Map();
    assign.forEach((a, ai) => {
      const M = parts[a.pi].measures[mi];
      for (const N of M.notes) {
        const hand = a.hand(N.staff);
        const vk = ai + ':' + N.staff + ':' + N.voice;
        if (!vkeys[hand].includes(vk)) vkeys[hand].push(vk);
        if (N.chord && lastEv.has(vk) && !N.rest) {
          const e = lastEv.get(vk);
          if (!e.rest && Math.abs(e.pos - N.start) < 1e-6) { e.notes.push(mkNote(N)); continue; }
        }
        const e = { pos: N.start, dur: N.dur, rest: N.rest, code: N.code, dots: N.dots, notes: N.rest ? [] : [mkNote(N)], vk, hand };
        if (N.restKey) e.restKey = N.restKey;
        if (N.stem) e.stem = N.stem;
        if (N.finger) e.finger = N.finger;
        if (N.rest && (N.mrest || (N.dur >= len - 1e-6 && N.code === 'w'))) { e.full = true; e.dur = len; }
        if (N.tupN && N.tupN !== N.tupM) {
          let g = tupOpen.get(vk);
          // 一组三连音（或其他连音）：按记谱时值累加，满 actual × normal-type 就结束
          if (!g || N.tupStart) { g = { id: vk + '@' + N.start, sum: 0, target: N.normTicks * N.tupN }; tupOpen.set(vk, g); }
          e.tup = g.id; e.tupN = N.tupN; e.tupM = N.tupM;
          g.sum += N.typeTicks;
          if (N.tupStop || g.sum >= g.target - 1e-6) tupOpen.delete(vk);
        } else tupOpen.delete(vk);
        bar[hand].push(e); lastEv.set(vk, e);
      }
    });
    for (const h of ['rh', 'lh']) {
      for (const e of bar[h]) { e.v = vkeys[h].indexOf(e.vk); delete e.vk; delete e.hand; }
      bar[h].sort((x, y) => x.pos - y.pos || x.v - y.v);
      if (!bar[h].length) bar[h].push({ pos: 0, dur: len, rest: true, full: true, code: 'w', dots: 0, notes: [], v: 0 });
      for (const e of bar[h]) if (!e.rest) e.notes.sort((x, y) => x.d - y.d);
    }
    // 连音线：把前后两个音连起来
    for (const h of ['rh', 'lh']) for (const e of bar[h]) {
      if (e.rest) continue;
      e.notes.forEach((n, i) => {
        const key = h + ':' + n.midi;
        if (n.tieStop) {
          const o = openTies.get(key);
          if (o && o.k >= k - 1) { o.n.tieTo = { e, i }; n.tieFrom = { e: o.e, i: o.i }; openTies.delete(key); }
          else n.tieStop = false;
        }
        if (n.tieStart) openTies.set(key, { e, i, n, k });
      });
    }
    for (const [key, o] of openTies) if (o.k < k) { o.n.tieStart = false; openTies.delete(key); }
    bars.push(bar);
  });
  for (const [, o] of openTies) o.n.tieStart = false;
  finishTies(bars);
  if (!hasAccTags) computeAccidentals(bars);
  if (!title) title = '';
  return { title, bpm: Math.round(clamp(tempo, 30, 240)), bars };
}
function mkNote(N) {
  const n = { d: N.d, a: N.a, midi: midiOf(N.d, N.a) };
  if (N.acc !== undefined) n.acc = N.acc;
  if (N.tieStart) n.tieStart = true;
  if (N.tieStop) n.tieStop = true;
  return n;
}
// 连音线的头一个音：发声时值 = 整条连线的总长
function finishTies(bars) {
  for (const b of bars) for (const h of ['rh', 'lh']) for (const e of b[h]) {
    if (e.rest) continue;
    for (const n of e.notes) {
      if (!n.tieTo || n.tieStop) { if (!n.tieTo) delete n.tieStart; continue; }
      let dur = e.dur, cur = n, guard = 0;
      while (cur.tieTo && guard++ < 64) { const t = cur.tieTo; dur += t.e.dur; cur = t.e.notes[t.i]; }
      n.tieDur = dur;
    }
  }
}

/* ---------------- MIDI ---------------- */
function parseMidi(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  if (tag(0) !== 'MThd') throw new Error('不是 MIDI 文件');
  const hlen = dv.getUint32(4), ntr = dv.getUint16(10), div = dv.getInt16(12);
  if (div <= 0) throw new Error('不支持 SMPTE 计时的 MIDI 文件');
  let p = 8 + hlen;
  const notes = []; let tempo = null, ts = null, key = null; const names = []; const tempos = []; const tsList = [], keyList = [];
  let tr = 0;
  while (p + 8 <= u8.length && tr < ntr) {
    const len = dv.getUint32(p + 4);
    if (tag(p) !== 'MTrk') { p += 8 + len; continue; }
    let q = p + 8; const end = Math.min(u8.length, q + len); p = q + len;
    let t = 0, run = 0; const open = new Map();
    const vlq = () => { let v = 0, b; do { b = u8[q++]; v = v * 128 + (b & 0x7f); } while (b & 0x80 && q < end); return v; };
    while (q < end) {
      t += vlq();
      let st = u8[q];
      if (st & 0x80) { q++; if (st < 0xf0) run = st; } else st = run;
      if (st === 0xff) {
        const type = u8[q++]; const l = vlq(); const d = u8.subarray(q, q + l); q += l;
        if (type === 0x51 && l >= 3) { const us = (d[0] << 16) | (d[1] << 8) | d[2]; tempos.push({ tick: t, us }); if (tempo === null) tempo = us; }
        else if (type === 0x58 && l >= 2) { const x = { tick: t, n: d[0], d: 1 << d[1] }; tsList.push(x); if (!ts) ts = x; }
        else if (type === 0x59 && l >= 2) { const x = { tick: t, sf: (d[0] << 24) >> 24, mi: d[1] }; keyList.push(x); if (!key) key = x; }
        else if (type === 0x03) names[tr] = new TextDecoder().decode(d);
        continue;
      }
      if (st === 0xf0 || st === 0xf7) { const l = vlq(); q += l; continue; }
      const hi = st & 0xf0, ch = st & 15;
      const d1 = u8[q++]; const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : u8[q++];
      const k = ch * 128 + d1;
      if (hi === 0x90 && d2 > 0) { if (!open.has(k)) open.set(k, []); open.get(k).push(t); }
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
        const a = open.get(k);
        if (a && a.length) { const s = a.shift(); if (t > s) notes.push({ start: s / div, end: t / div, t0: s, t1: t, midi: d1, track: tr, ch }); }
      }
    }
    tr++;
  }
  tempos.sort((a, b) => a.tick - b.tick); tsList.sort((a, b) => a.tick - b.tick); keyList.sort((a, b) => a.tick - b.tick);
  return { notes, tempo, ts, key, names, tempos, div, tsList, keyList };
}
// MIDI tick → 秒（按速度表）
function midiSecFn(Mi) {
  const tm = Mi.tempos.length ? Mi.tempos : [{ tick: 0, us: 500000 }];
  const seg = []; let sec = 0, lt = 0, us = tm[0].tick === 0 ? tm[0].us : 500000;
  for (const x of tm) { sec += ((x.tick - lt) * us) / 1e6 / Mi.div; seg.push({ tick: x.tick, sec, us: x.us }); lt = x.tick; us = x.us; }
  return (tick) => { let k = 0; while (k + 1 < seg.length && seg[k + 1].tick <= tick) k++; const g = seg[k]; if (!g || tick < g.tick) return (tick * 500000) / 1e6 / Mi.div; return g.sec + ((tick - g.tick) * g.us) / 1e6 / Mi.div; };
}
const MAJ_PCS = [0, 2, 4, 5, 7, 9, 11];
function estimateFifths(notes) {
  const w = new Array(12).fill(0);
  for (const n of notes) w[n.midi % 12] += n.end - n.start;
  let best = 0, bs = -1;
  for (let f = -6; f <= 6; f++) {
    const tonic = mod(f * 7, 12);
    const sc = MAJ_PCS.reduce((a, x) => a + w[(tonic + x) % 12], 0) - Math.abs(f) * 1e-3;
    if (sc > bs) { bs = sc; best = f; }
  }
  return best;
}
// MIDI 音高 → 谱上的音名（按调号决定用升号还是降号）
function spellMidi(m, key) {
  const pc = mod(m, 12);
  let best = null;
  for (let l = 0; l < 7; l++) for (const a of [0, -1, 1]) {
    if (mod(STEP[l] + a, 12) !== pc) continue;
    let score = a === key.sig[l] ? 0 : a === 0 ? 1 : (key.f >= 0 ? a > 0 : a < 0) ? 1.5 : 2.5;
    if (key.f === 0 && (pc === 3 || pc === 10) && a === -1) score = 1.2;   // C 大调里 Eb、Bb 比 D#、A# 常见
    if (!best || score < best.s) best = { l, a, s: score };
  }
  const oct = Math.round((m - STEP[best.l] - best.a) / 12) - 1;
  const d = best.l + 7 * oct;
  return { d, a: best.a, midi: m };
}
const REG_VALS = [[96, 'w', 0, 96], [72, 'h', 1, 24], [48, 'h', 0, 24], [36, 'q', 1, 12], [24, 'q', 0, 12], [18, '8', 1, 6], [12, '8', 0, 6], [9, '16', 1, 3], [6, '16', 0, 3], [3, '32', 0, 3]];
// 分左右手：POP909（MELODY / BRIDGE / PIANO 三轨）右手旋律、左手伴奏；
// 其他：两个以上音轨按音轨（平均音高高的是右手），单轨按声道或中央 C 分
function assignHands(notes, names) {
  const nm = (n) => ((names && names[n.track]) || '').toUpperCase();
  if (notes.some((n) => nm(n) === 'MELODY') && notes.some((n) => nm(n) === 'PIANO')) {
    const mel = notes.filter((n) => nm(n) === 'MELODY');
    const keep = notes.filter((n) => {
      const t = nm(n);
      if (t === 'MELODY') { n.hand = 'rh'; return true; }
      if (t === 'PIANO') { n.hand = 'lh'; return true; }
      // 副旋律：只在主旋律休息的地方放进右手
      n.hand = 'rh';
      return !mel.some((m) => m.start < n.end - 0.05 && m.end > n.start + 0.05);
    });
    return keep;
  }
  const tracks = [...new Set(notes.map((n) => n.track))];
  const avg = (arr) => arr.reduce((a, n) => a + n.midi, 0) / Math.max(1, arr.length);
  if (tracks.length >= 2) {
    const av = tracks.map((t) => ({ t, a: avg(notes.filter((n) => n.track === t)) })).sort((x, y) => y.a - x.a);
    const rhSet = new Set(tracks.length === 2 ? [av[0].t] : av.filter((x) => x.a >= 60).map((x) => x.t));
    if (!rhSet.size) rhSet.add(av[0].t);
    notes.forEach((n) => { n.hand = rhSet.has(n.track) ? 'rh' : 'lh'; });
  } else {
    const chans = [...new Set(notes.map((n) => n.ch))];
    if (chans.length === 2) { const a0 = avg(notes.filter((n) => n.ch === chans[0])), a1 = avg(notes.filter((n) => n.ch === chans[1])); const rc = a0 >= a1 ? chans[0] : chans[1]; notes.forEach((n) => { n.hand = n.ch === rc ? 'rh' : 'lh'; }); }
    else notes.forEach((n) => { n.hand = n.midi >= 60 ? 'rh' : 'lh'; });
  }
  return notes;
}
// 普通 MIDI 文件
function midiToPiece(Mi, fileName) {
  let notes = assignHands(Mi.notes.filter((n) => n.ch !== 9), Mi.names);
  if (!notes.length) throw new Error('MIDI 文件里没有钢琴音符');
  // 整体偏移：有的 MIDI 为了对齐录音，所有音都往后挪了一点；找出偏移量，让音落回十六分音符格点
  const bins = new Array(48).fill(0);
  for (const n of notes) bins[Math.round(mod(n.start, 1) * 48) % 48]++;
  let off = 0, best = -1;
  for (let o = 0; o < 12; o++) { const sc = [0, 12, 24, 36].reduce((a, k) => a + bins[(o + k) % 48] + 0.5 * (bins[(o + k + 47) % 48] + bins[(o + k + 1) % 48]), 0); if (sc > best) { best = sc; off = o; } }
  const base = [0, 12, 24, 36].reduce((a, k) => a + bins[k] + 0.5 * (bins[(k + 47) % 48] + bins[k + 1]), 0);
  const shift = best > base * 1.3 && best > notes.length * 0.5 ? off / 48 : 0;
  if (shift) for (const n of notes) { n.start -= shift; n.end -= shift; }
  // 拍号：没有或是 1/4 这种不可信的，按 4/4，并用低音的位置估计每小节第一拍
  let tsIn = Mi.ts && Mi.ts.n > 1 && [2, 4, 8].includes(Mi.ts.d) ? Mi.ts : null;
  let phase = 0;
  const TSo = tsIn ? makeTS(tsIn.n, tsIn.d) : makeTS(4, 4);
  if (!tsIn) {
    const sc = [0, 0, 0, 0];
    const lows = new Map();
    for (const n of notes) if (n.hand === 'lh') { const q = Math.round(n.start); if (!lows.has(q) || lows.get(q) > n.midi) lows.set(q, n.midi); }
    for (const [q, m] of lows) sc[mod(q, 4)] += m < 52 ? 2 : 1;
    phase = sc.indexOf(Math.max(...sc));
  }
  // 量化：每拍单独判断用十六分音符格还是三连音格
  const allowTrip = TSo.d === 4 || TSo.d === 2;
  const byBeat = new Map();
  for (const n of notes) { const b = Math.floor(n.start + 1e-6); if (!byBeat.has(b)) byBeat.set(b, []); byBeat.get(b).push(n.start - b); }
  const trip = new Set();
  if (allowTrip) for (const [b, fs] of byBeat) {
    const e4 = fs.reduce((a, f) => a + Math.abs(f - Math.round(f * 4) / 4), 0), e3 = fs.reduce((a, f) => a + Math.abs(f - Math.round(f * 3) / 3), 0);
    if (fs.some((f) => Math.abs(f * 3 - Math.round(f * 3)) < 0.06 && Math.abs(f * 4 - Math.round(f * 4)) > 0.15) && e3 < e4 * 0.6) trip.add(b);
  }
  const snap = (x) => { const b = Math.floor(x + 1e-6); const G = trip.has(b) ? 3 : 4; return Math.round((b + Math.round((x - b) * G) / G) * 24); };
  for (const n of notes) { n.s = snap(n.start); n.e = snap(n.end); if (n.e <= n.s) n.e = n.s + (trip.has(Math.floor(n.s / 24)) ? 8 : 6); }
  notes = notes.filter((n) => n.e > 0); notes.forEach((n) => { if (n.s < 0) n.s = 0; });
  const fifths = Mi.key ? Mi.key.sf : estimateFifths(notes);
  const key = keyFromFifths(fifths, Mi.key ? Mi.key.mi === 1 : false);
  // 小节：弱起（phase 拍）+ 等长小节
  const lastEnd = Math.max(...notes.map((n) => n.e));
  const defs = []; let x = 0;
  const pk = (phase * 24) % TSo.len;
  if (pk > 0) { defs.push({ start: 0, len: pk, ts: TSo }); x = pk; }
  while (x < lastEnd) { defs.push({ start: x, len: TSo.len, ts: TSo }); x += TSo.len; }
  const bars = notesToBars(notes, defs, key, (t) => trip.has(Math.floor(t / 24)));
  const bpm = Mi.tempo ? 60e6 / Mi.tempo : 100;
  return { title: (fileName || '').replace(/\.[^.]+$/, ''), bpm: Math.round(clamp(bpm, 30, 240)), bars };
}
// POP909：用数据集自带的节拍文件（beat_midi.txt）对齐、分小节
function pop909ToPiece(Mi, beatText, meta) {
  const rows = beatText.split(/\n/).map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length >= 3 && isFinite(r[0]));
  if (rows.length < 8) throw new Error('节拍文件内容不对');
  const bt = rows.map((r) => r[0]);
  const sec = midiSecFn(Mi);
  const pos = (x) => {
    let i = 0, hi = bt.length - 1;
    if (x <= bt[0]) return (x - bt[0]) / (bt[1] - bt[0]);
    if (x >= bt[hi]) return hi + (x - bt[hi]) / (bt[hi] - bt[hi - 1]);
    while (i < hi) { const m = (i + hi + 1) >> 1; if (bt[m] <= x) i = m; else hi = m - 1; }
    return i + (x - bt[i]) / (bt[i + 1] - bt[i]);
  };
  const trip = meta.F === 3;
  const rowT = trip ? 36 : 24, sub = trip ? 3 : 4;
  let notes = assignHands(Mi.notes.filter((n) => n.ch !== 9), Mi.names);
  for (const n of notes) {
    const a = pos(sec(n.t0)), b = pos(sec(n.t1));
    n.s = Math.round(Math.round(a * sub) * rowT / sub); n.e = Math.round(Math.round(b * sub) * rowT / sub);
    if (n.e <= n.s) n.e = n.s + rowT / sub;
  }
  notes = notes.filter((n) => n.s >= 0);
  // 小节：第三列为 1 的是每小节第一拍
  const db = rows.map((r, i) => (r[2] === 1 ? i : -1)).filter((i) => i >= 0);
  const tsFor = (r) => (trip ? makeTS(r * 3, 8) : makeTS(r, 4));
  const defs = [];
  const add = (r0, r) => {
    if (r <= 0) return;
    if (!trip && (r === 6 || r === 8)) { add(r0, r / 2); add(r0 + r / 2, r / 2); return; }
    defs.push({ start: r0 * rowT, len: r * rowT, ts: tsFor(r) });
  };
  // 弱起：比一个完整小节长时，前面放零头，后面是完整小节
  const addPickup = (r, unit) => { const head = r % unit; if (head) add(0, head); for (let k = head; k < r; k += unit) add(k, unit); };
  const gaps = {}; for (let k = 1; k < db.length; k++) gaps[db[k] - db[k - 1]] = (gaps[db[k] - db[k - 1]] || 0) + 1;
  const common = +Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0] || 4;
  if (db.length && db[0] > 0) addPickup(db[0], !trip && (common === 6 || common === 8) ? common / 2 : common);
  for (let k = 0; k < db.length; k++) add(db[k], (k + 1 < db.length ? db[k + 1] : db[k] + common) - db[k]);
  const lastEnd = Math.max(...notes.map((n) => n.e));
  let x = defs.length ? defs[defs.length - 1].start + defs[defs.length - 1].len : 0;
  while (x < lastEnd) { add(x / rowT, common); x = defs[defs.length - 1].start + defs[defs.length - 1].len; }
  // 弱起小节沿用常用拍号的名字
  if (defs.length > 1 && db[0] > 0) defs[0].ts = defs[1].ts;
  const key = keyFromFifths(estimateFifths(notes), false);
  const bars = notesToBars(notes, defs, key, () => false);
  const rs = []; for (let k = 1; k < bt.length; k++) rs.push(bt[k] - bt[k - 1]);
  rs.sort((a, b) => a - b);
  const rowSec = rs[rs.length >> 1] || 0.5;
  const bpm = (60 / rowSec) * (trip ? 1.5 : 1);
  return { title: meta.name, bpm: Math.round(clamp(bpm, 30, 240)), bars };
}
// POP909-CL：已经量化、校正过小节线、带拍号和调号（含转调、变拍）。速度用原版 POP909 节拍文件换算
function pop909clToPiece(Mi, beatText, meta) {
  const q24 = (tick) => (tick / Mi.div) * 24;
  let notes = assignHands(Mi.notes.filter((n) => n.ch !== 9 && !/CHORD/i.test(Mi.names[n.track] || '')), Mi.names);
  if (!notes.length) throw new Error('文件里没有音符');
  // 每拍判断是三连音格（8）还是普通格（3 的倍数）
  // 只看起音（结束时间是演奏时值，比较乱）；四舍五入到最近的拍内位置
  const byBeat = new Map();
  for (const n of notes) { const x = q24(n.t0); const b = Math.floor(Math.round(x) / 24); if (!byBeat.has(b)) byBeat.set(b, []); byBeat.get(b).push(x - b * 24); }
  const trip = new Set();
  // 只在 x/4 拍的小节里认三连音（x/8 拍的小节线不一定落在四分音符拍点上）
  const tsAt = (x) => { let r = null; for (const y of Mi.tsList) if ((y.tick / Mi.div) * 24 <= x + 1e-6) r = y; return r || { d: 4 }; };
  for (const [b, fs] of byBeat) {
    if (tsAt(b * 24).d !== 4) continue;
    // 三连音：至少一个音正好（±1）落在 1/3 或 2/3 拍上，而且按三连音格对齐的总误差明显更小
    const hit = fs.some((f) => Math.abs(f - 8) <= 1 || Math.abs(f - 16) <= 1);
    const e6 = fs.reduce((a, f) => a + Math.abs(f - Math.round(f / 6) * 6), 0), e8 = fs.reduce((a, f) => a + Math.abs(f - Math.round(f / 8) * 8), 0);
    if (hit && e8 < e6 * 0.6) trip.add(b);
  }
  // 记谱格：普通拍按十六分音符，三连音拍按三连音八分音符
  const snap = (x) => { const b = Math.floor(Math.round(x) / 24); const g = trip.has(b) ? 8 : 6; return Math.round(x / g) * g; };
  for (const n of notes) { n.s = snap(q24(n.t0)); n.e = snap(q24(n.t1)); if (n.e <= n.s) n.e = n.s + (trip.has(Math.floor(n.s / 24)) ? 8 : 6); }
  // 小节线：从 0 开始，按拍号（含中途变拍）排
  const tsl = (Mi.tsList.length ? Mi.tsList : [{ tick: 0, n: 4, d: 4 }]).map((x) => ({ at: Math.round(q24(x.tick)), ts: makeTS(x.n, x.d) }));
  const kl = (Mi.keyList.length ? Mi.keyList : [{ tick: 0, sf: estimateFifths(notes), mi: 0 }]).map((x) => ({ at: Math.round(q24(x.tick)), key: keyFromFifths(x.sf, x.mi === 1) }));
  const at = (list, x) => { let r = list[0]; for (const y of list) if (y.at <= x + 1e-6) r = y; return r; };
  const lastEnd = Math.max(...notes.map((n) => n.e));
  const defs = []; let x = 0, guard = 0;
  while (x < lastEnd && guard++ < 5000) {
    const ts = at(tsl, x).ts; let len = ts.len;
    const nxt = tsl.find((y) => y.at > x + 1e-6); if (nxt && nxt.at < x + len) len = nxt.at - x;   // 变拍不在小节线上：截短这一小节
    defs.push({ start: x, len, ts: len === ts.len ? ts : len % 24 === 0 ? makeTS(len / 24, 4) : len % 12 === 0 ? makeTS(len / 12, 8) : makeTS(Math.max(1, Math.round(len / 6)), 16), key: at(kl, x).key });
    x += len;
  }
  const bars = notesToBars(notes, defs, defs[0].key, (t) => trip.has(Math.floor(t / 24)));
  // 速度：原版节拍文件里一拍的秒数（一拍 = 480 个 CL tick）
  let bpm = (60 * 480) / (0.6 * Mi.div);
  const rows = (beatText || '').split(/\n/).map((l) => parseFloat(l)).filter((v) => isFinite(v));
  if (rows.length > 8) { const rs = []; for (let k = 1; k < rows.length; k++) rs.push(rows[k] - rows[k - 1]); rs.sort((a, b) => a - b); const rowSec = rs[rs.length >> 1]; if (rowSec > 0.1) bpm = (60 * 480) / (rowSec * Mi.div); }
  return { title: meta.name, bpm: Math.round(clamp(bpm, 30, 240)), bars };
}
// 公用：把（已量化的）音按小节摆好，拆成谱上能写的时值，加连音线、谱号、临时记号
function notesToBars(notes, defs, key, tripBeat) {
  const bars = defs.map((d, i) => ({ num: i + 1, gidx: i, len: d.len, ts: d.ts, key: d.key || key, clef: { rh: 'treble', lh: 'bass' }, rh: [], lh: [], _start: d.start }));
  const starts = defs.map((d) => d.start);
  const end = defs.length ? defs[defs.length - 1].start + defs[defs.length - 1].len : 0;
  for (const hand of ['rh', 'lh']) {
    const hn = notes.filter((n) => n.hand === hand && n.s < end);
    const onsets = [...new Set(hn.map((n) => n.s))].sort((a, b) => a - b);
    const segs = [];
    onsets.forEach((o, i) => {
      const nx = i + 1 < onsets.length ? onsets[i + 1] : end;
      const ch = []; const seen = new Set();
      for (const n of hn) if (n.s === o && !seen.has(n.midi)) { seen.add(n.midi); ch.push(n); }
      let e = Math.min(nx, Math.max(...ch.map((n) => n.e)), end);
      // 演奏录下来的音往往比记谱短一点：离下一个音只差一点点时，把它延长过去，免得谱上全是小休止符
      const gap = nx - e;
      if (nx < end && gap > 0 && (gap <= 6 || (gap <= 12 && gap <= (e - o) / 2))) e = nx;
      segs.push({ s: o, e, midis: ch.map((n) => n.midi).sort((a, b) => a - b) });
    });
    const full = []; let cur = 0;
    for (const sg of segs) { if (sg.s > cur) full.push({ s: cur, e: sg.s, rest: true }); full.push(sg); cur = sg.e; }
    if (cur < end) full.push({ s: cur, e: end, rest: true });
    for (const sg of full) placeSegment(bars, starts, sg, hand, key, tripBeat);
  }
  let lhTreble = false, rhBass = false;
  for (const bar of bars) {
    for (const h of ['rh', 'lh']) {
      if (bar[h].every((e) => e.rest)) bar[h] = [{ pos: 0, dur: bar.len, rest: true, full: true, code: 'w', dots: 0, notes: [], v: 0 }];
      bar[h].sort((a, b) => a.pos - b.pos);
    }
    // 谱号：左手整小节都在中央 C 以上时用高音谱号，右手整小节都很低时用低音谱号
    const lm = bar.lh.flatMap((e) => e.notes.map((n) => n.midi)), rm = bar.rh.flatMap((e) => e.notes.map((n) => n.midi));
    if (lm.length) lhTreble = Math.min(...lm) >= 60;
    if (rm.length) rhBass = Math.max(...rm) <= 55;
    bar.clef = { rh: rhBass ? 'bass' : 'treble', lh: lhTreble ? 'treble' : 'bass' };
    delete bar._start;
  }
  finishTies(bars);
  computeAccidentals(bars);
  return bars;
}
// 把一段（可能跨小节、跨拍）拆成谱上写得出来的时值，用连音线连起来
function placeSegment(bars, starts, sg, hand, key, tripBeat) {
  const barAt = (x) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= x) lo = m; else hi = m - 1; } return lo; };
  const cuts = new Set([sg.s, sg.e]);
  for (let k = barAt(sg.s) + 1; k < starts.length && starts[k] < sg.e; k++) cuts.add(starts[k]);
  for (let x = Math.ceil(sg.s / 24) * 24; x < sg.e; x += 24) if (tripBeat(x) || tripBeat(x - 1)) cuts.add(x);
  const pts = [...cuts].sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; if (b <= a) continue;
    if (tripBeat(a) && (b - a) % 8 === 0) {
      const bs = Math.floor(a / 24) * 24;
      if (b - a === 24) pieces.push({ s: a, len: 24, code: 'q', dots: 0 });
      else { let x = a; while (x < b) { const l = b - x >= 16 && (x - bs) % 8 === 0 ? 16 : 8; pieces.push({ s: x, len: l, code: l === 16 ? 'q' : '8', dots: 0, tup: hand + '@' + bs }); x += l; } }
    } else {
      let x = a;
      const bst = starts[barAt(a)];
      while (x < b - 1e-6) {
        const inBar = x - bst;
        const v = REG_VALS.find(([len, , , al]) => len <= b - x + 1e-6 && inBar % al === 0 && (len < 96 || inBar === 0)) || [Math.max(1, b - x), '32', 0, 1];
        pieces.push({ s: x, len: v[0], code: v[1], dots: v[2] }); x += v[0];
      }
    }
  }
  let prev = null;
  pieces.forEach((pc) => {
    const bi = barAt(pc.s); const bar = bars[bi]; if (!bar) return;
    const e = { pos: pc.s - starts[bi], dur: pc.len, rest: !!sg.rest, code: pc.code, dots: pc.dots, notes: [], v: 0 };
    if (pc.tup) { e.tup = pc.tup; e.tupN = 3; e.tupM = 2; }
    if (!sg.rest) {
      e.notes = sg.midis.map((m) => spellMidi(m, bar.key || key));
      if (prev) e.notes.forEach((n, j) => { n.tieStop = true; n.tieFrom = { e: prev, i: j }; prev.notes[j].tieStart = true; prev.notes[j].tieTo = { e, i: j }; });
      prev = e;
    }
    bar[hand].push(e);
  });
}

/* ---------------- 分页 ---------------- */
function learnPages(piece) {
  S.lineBudget = lineBudget();
  const cw = $('score').clientWidth || window.innerWidth;
  const nLines = cw < 700 && window.innerHeight > window.innerWidth ? 4 : 2;
  const bars = piece.bars;
  const est = bars.map((b) => {
    const on = new Set(); let acc = 0;
    for (const h of ['rh', 'lh']) for (const e of b[h]) { if (!e.rest) { on.add(e.pos); acc += e.notes.filter((n) => n.acc).length; } }
    return (34 + 24 * on.size + 7 * acc) * 1.06 + 26;
  });
  const budget = S.lineBudget || 1550;
  const pages = []; let i = 0;
  while (i < bars.length) {
    let per = 1;
    for (const p of [4, 3, 2]) {
      let ok = true;
      for (let l = 0; l < nLines; l++) { const s = i + l * p; if (s >= bars.length) break; const sum = est.slice(s, s + p).reduce((a, x) => a + x, 0); if (150 + sum > budget) { ok = false; break; } }
      if (ok) { per = p; break; }
    }
    const take = Math.min(per * nLines, bars.length - i);
    pages.push(bars.slice(i, i + take)); i += take;
  }
  const exs = pages.map((pb, pi) => {
    pb.forEach((b) => { b.sysIdx = undefined; b.anchors = null; for (const h of ['rh', 'lh']) for (const e of b[h]) { e.el = null; e.sn = null; } });
    return {
      learn: true, li: 3, ei: pi, gi: pi, pageIdx: pi, title: piece.title, key: pb[0].key, ts: pb[0].ts, bpm: piece.bpm, bars: pb,
      noCountIn: true, showTs: pi === 0, barFrom: pb[0].num, barTo: pb[pb.length - 1].num, nBarsTotal: bars.length,
      prevBar: pi > 0 ? pages[pi - 1][pages[pi - 1].length - 1] : null, tex: 'piano',
    };
  });
  return exs;
}

/* ---------------- 练习数据 ---------------- */
function learnDefaults(n) {
  return { a: 1, b: Math.min(n, 8), method: 'free', ladder: { start: 60, step: 5, speed: 60 }, back: { chunk: 2, stage: 1 }, need: 3, streak: 0, speed: 80, heat: true, loop: true, stats: {}, log: [], days: {} };
}
function learnSave() { if (LM.id && LM.data) lsSet('sr.learn.' + LM.id, LM.data); }
function learnActiveRange() {
  const D = LM.data, n = LM.bars.length;
  let a = clamp(D.a, 1, n), b = clamp(D.b, a, n);
  if (D.method === 'back') { const C = D.back.chunk; const stages = Math.ceil((b - a + 1) / C); const s = clamp(D.back.stage, 1, stages); a = Math.max(a, b - s * C + 1); }
  return { a, b };
}
function learnBackStages() { const D = LM.data; return Math.ceil((D.b - D.a + 1) / D.back.chunk); }
function learnSetRangeT0() {
  const R = learnActiveRange();
  LM.startT0 = LM.bars[R.a - 1].t0; LM.endT0 = LM.bars[R.b - 1].t1;
  return R;
}
function learnRangeStartCur() { const R = learnActiveRange(); const b = LM.bars[R.a - 1]; return { ex: b.ex, bar: b.bi }; }
function learnFollowStartT0() { return LM._followFrom ?? LM.startT0; }

/* ---------------- 播放、评分 ---------------- */
function learnStartPlay() {
  const R = learnSetRangeT0();
  let sb = LM.bars[R.a - 1];
  const cex = S.exs[S.cur.ex]; const cb = cex && cex.bars[S.cur.bar];
  if (cb && cb.gidx >= R.a - 1 && cb.gidx <= R.b - 1) sb = cb;
  LM.passFull = sb.gidx === R.a - 1;
  const ex = S.exs[sb.ex];
  P.curEx = sb.ex; P.visEx = sb.ex; P.stopAt = null; P.vq = []; clearHighlights();
  P.pendingPass = null; P.pendingCountIn = null; P.countIn = null;
  if (S.settings.scroll) flipTo(sb.ex);
  learnResetScore(sb.t0);
  if (S.settings.follow && MIDI.connected) { LM._followFrom = sb.t0; S.cur = { ex: sb.ex, bar: sb.bi }; startFollow(); LM._followFrom = null; learnHudUpdate(); return; }
  P.mode = 'play';
  const now = AU.ctx.currentTime + 0.12; const k = spt(ex);
  const bts = sb.ts || ex.ts; const cnt = S.settings.countIn || 1;
  const startT0 = sb.t0 - cnt * bts.len * k;
  for (let c = 0; c < cnt; c++) for (let b = 0; b < bts.len - 1e-6; b += bts.beat) AU.click(now + ((c * bts.len + b) * k) / factor(), b === 0);
  P.countIn = { from: startT0, to: sb.t0, ex: sb.ex, bar: sb };
  P.anchors = [{ ctx: now, t0: startT0, f: factor() }];
  P.startT0 = startT0;
  P.nextIdx = lowerBound(S.ev, sb.t0);
  P.playing = true;
  P.timer = setInterval(schedule, 25);
  schedule();
  updatePlayBtn(); learnHudUpdate();
}
// 播到范围末尾：循环时插一小节预备拍，再回到开头
function learnWrap() {
  if (P.stopAt !== null || (P.pendingPass && !LM.loop)) return false;
  const at = ctxTimeOf(LM.endT0);
  P.pendingPass = { at, full: LM.passFull };
  if (!LM.loop) { P.stopAt = at + 0.3; P.nextIdx = S.ev.length; return false; }
  const R = learnActiveRange(); const sb = LM.bars[R.a - 1]; const ex = S.exs[sb.ex];
  const k = spt(ex); const bts = sb.ts || ex.ts; const f = factor();
  const gap = bts.len * k;
  P.anchors.push({ ctx: at, t0: LM.startT0 - gap, f });
  for (let b = 0; b < bts.len - 1e-6; b += bts.beat) AU.click(at + (b * k) / f, b === 0);
  P.pendingCountIn = { from: LM.startT0 - gap, to: LM.startT0, ex: sb.ex, bar: sb };
  P.nextIdx = lowerBound(S.ev, LM.startT0);
  P.curEx = sb.ex;
  LM.passFull = true;
  return true;
}
function learnResetScore(fromT0 = -1) {
  const from = fromT0 < 0 ? LM.startT0 : fromT0;
  SC.L = { hit: 0, miss: 0, wrong: 0, exp: [], idx: 0, bars: {} };
  for (const b of LM.bars) if (b.t1 > LM.startT0 && b.t0 < LM.endT0) for (const h of ['rh', 'lh']) for (const e of b[h]) if (e.el) e.el.classList.remove('hit', 'miss', 'expect');
  if (MIDI.connected) SC.L.exp = S.ev.filter((e) => e.kind === 'note' && e.t0 >= from - 1e-6 && e.t0 < LM.endT0 - 1e-6 && practiceHand(e.hand)).map((e) => ({ t0: e.t0, midi: e.midi, e: e.e, hit: false }));
  hud();
}
// 一遍结束：统计、判断是否弹对、推进速度阶梯 / 从后往前
function learnPassEnd(pp) {
  const D = LM.data; const sc = SC.L;
  if (sc && MIDI.connected && P.mode === 'play') sweepMisses(LM.endT0 + 60);
  let clean = null;
  if (sc && MIDI.connected && sc.exp.length + sc.hit > 0) {
    const exp = P.mode === 'follow' ? sc.hit : sc.exp.length;
    clean = sc.miss === 0 && sc.wrong <= 1 && sc.hit >= exp;
    for (const [g, s] of Object.entries(sc.bars || {})) {
      const t = (D.stats[g] = D.stats[g] || { exp: 0, hit: 0, wrong: 0, passes: 0 });
      t.exp += s.exp; t.hit += s.hit; t.wrong += s.wrong; t.passes++;
    }
    const day = (D.days[today()] = D.days[today()] || { passes: 0, clean: 0, best: 0 });
    day.passes++;
    if (clean && pp.full) { day.clean++; day.best = Math.max(day.best, S.settings.speed); }
    const pct = Math.round((100 * sc.hit) / Math.max(1, exp));
    HUD.last = `这遍 ${pct}%`;
    if (!pp.full) toast(`这遍从中间开始，不计入过关（弹对 ${sc.hit}/${exp}，错音 ${sc.wrong}）`);
    else learnJudge(clean, `弹对 ${sc.hit}/${exp}，错音 ${sc.wrong}`);
  }
  learnSave(); learnPaint(); learnUpdatePanel();
  learnResetScore(LM.startT0);
}
// 判断一遍的结果（MIDI 自动判断，或手动点“这遍弹对了”）
function learnJudge(clean, detail) {
  const D = LM.data;
  const ok = clean ? '✓ 弹对' : '✗ 没过';
  if (D.method === 'free') { toast(`${ok}（${detail}）`); learnHudUpdate(); return; }
  if (!clean) { D.streak = 0; toast(`${ok}（${detail}），从 0/${D.need} 重新数`); learnHudUpdate(); return; }
  D.streak++;
  if (D.streak < D.need) { toast(`${ok}（${detail}）：连续 ${D.streak}/${D.need}`); learnHudUpdate(); return; }
  D.streak = 0;
  const R = learnActiveRange();
  if (D.method === 'ladder') {
    const sp = S.settings.speed;
    learnLog({ d: today(), a: R.a, b: R.b, m: 'ladder', sp });
    if (sp >= 100) { toast(`🎉 原速连续弹对 ${D.need} 遍！第 ${R.a}–${R.b} 小节过关`); learnHudUpdate(); learnSave(); return; }
    const nsp = Math.min(100, sp + D.ladder.step);
    D.ladder.speed = nsp;
    toast(`🎉 ${sp}% 连续弹对 ${D.need} 遍，速度提到 ${nsp}%`);
    learnRestart(() => setSpeed(nsp));
  } else if (D.method === 'back') {
    const stages = learnBackStages();
    learnLog({ d: today(), a: R.a, b: R.b, m: 'back', st: D.back.stage, of: stages, sp: S.settings.speed });
    if (D.back.stage >= stages) { toast(`🎉 第 ${R.a}–${R.b} 小节从头到尾连续弹对 ${D.need} 遍，整段过关！`); learnHudUpdate(); learnSave(); return; }
    D.back.stage++;
    const R2 = learnActiveRange();
    toast(`🎉 过关！往前加一段：现在练第 ${R2.a}–${R2.b} 小节`);
    learnRestart();
  }
  learnSave();
}
// 过关记录：同一天同一项只记一次
function learnLog(x) {
  const D = LM.data; const k = JSON.stringify(x);
  if (D.log.some((y) => JSON.stringify(y) === k)) return;
  D.log.unshift(x); if (D.log.length > 200) D.log.length = 200;
}
function learnRestart(fn) {
  const was = P.playing;
  if (was) stopPlay(false);
  if (fn) fn();
  learnSetRangeT0(); S.cur = learnRangeStartCur(); placeIdleCursor(); learnPaint(); learnHudUpdate(); learnUpdatePanel();
  if (was) setTimeout(() => { if (LM.active && !P.playing) startPlay(); }, 900);
}
function learnFollowPassEnd() {
  learnPassEnd({ full: LM.passFull });
  if (!P.playing) return;
  if (!LM.loop) { stopPlay(false); S.cur = learnRangeStartCur(); placeIdleCursor(); return; }
  learnSetRangeT0();
  FOL.idx = lowerBound(S.ons, LM.startT0); LM.passFull = true;
  const o = S.ons[FOL.idx]; if (o) P.curEx = o.ex;
  prepFollow();
}
function learnHudUpdate() {
  if (!LM.active) { LM.hud = ''; return hud(); }
  const D = LM.data; const R = learnActiveRange();
  const rng = `第${R.a}–${R.b}小节`;
  if (D.method === 'ladder') LM.hud = `${rng} · 阶梯 ${S.settings.speed}% · ${D.streak}/${D.need}`;
  else if (D.method === 'back') LM.hud = `${rng} · 倒练 ${D.back.stage}/${learnBackStages()} 步 · ${D.streak}/${D.need}`;
  else LM.hud = rng + ' · 循环';
  hud();
  const el = $('lStatus'); if (el) el.textContent = learnStatusText();
}
function learnStatusText() {
  const D = LM.data; const R = learnActiveRange();
  const judge = MIDI.connected ? '每遍结束自动判断（没有漏音、错音不超过 1 个算弹对）' : '没有连接 MIDI：每弹对一遍，点“✓ 这遍弹对了”';
  if (D.method === 'ladder') return `速度阶梯：现在 ${S.settings.speed}%，第 ${R.a}–${R.b} 小节已连续弹对 ${D.streak}/${D.need} 遍。${judge}。`;
  if (D.method === 'back') return `从后往前：第 ${D.back.stage}/${learnBackStages()} 步，现在练第 ${R.a}–${R.b} 小节，已连续弹对 ${D.streak}/${D.need} 遍。${judge}。`;
  return `自由循环：第 ${R.a}–${R.b} 小节反复播放。${MIDI.connected ? '每遍结束显示成绩。' : ''}`;
}

/* ---------------- 谱面底色：练习范围、易错小节 ---------------- */
function learnAfterRender(ex) { learnPaint(ex.gi); }
function learnPaint(onlyGi) {
  if (!LM.active || !LM.data) return;
  const R = learnActiveRange(), D = LM.data;
  for (const s of S.systems) {
    if (!s || (onlyGi !== undefined && s.ex !== onlyGi)) continue;
    s.el.querySelectorAll('.lov').forEach((n) => n.remove());
    for (const b of s.bars) {
      const n = b.num; const div = document.createElement('div'); div.className = 'lov';
      const inR = n >= R.a && n <= R.b;
      const st = D.stats[b.gidx];
      let bg = inR ? 'rgba(47,111,222,.07)' : 'transparent';
      if (D.heat && st && st.exp > 0) {
        const rate = clamp((st.exp - st.hit + st.wrong) / st.exp, 0, 1);
        if (rate > 0.02) bg = `rgba(210,63,63,${(0.06 + rate * 0.3).toFixed(3)})`;
      }
      div.style.cssText = `left:${b.x0 * s.zoom}px;width:${(b.x1 - b.x0) * s.zoom}px;background:${bg}` + (inR && n === R.a ? ';border-left:3px solid rgba(47,111,222,.55)' : '') + (inR && n === R.b ? ';border-right:3px solid rgba(47,111,222,.55)' : '');
      s.el.appendChild(div);
    }
  }
}
function learnPickBar(bar) {
  const D = LM.data;
  if (LM.picking === 'a') { D.a = bar.num; D.b = bar.num; LM.picking = 'b'; toast(`起点：第 ${bar.num} 小节。再点终点小节`); }
  else { const x = bar.num; if (x < D.a) { D.b = D.a; D.a = x; } else D.b = x; LM.picking = null; document.body.classList.remove('lpicking'); toast(`练习范围：第 ${D.a}–${D.b} 小节`); }
  D.streak = 0; D.back.stage = 1;
  learnSave(); learnSetRangeT0(); S.cur = learnRangeStartCur(); placeIdleCursor(); learnPaint(); learnUpdatePanel(); learnHudUpdate();
}

/* ---------------- 进入 / 退出 ---------------- */
async function learnLoadPieceData(id) {
  const rec = await IDB.get('piece:' + id);
  if (!rec) throw new Error('这首曲子的数据找不到了（可能被浏览器清理），请重新载入文件');
  const piece = rec.kind === 'xml' ? parseMusicXML(rec.data) : rec.kind === 'pop909cl' ? pop909clToPiece(parseMidi(rec.data), rec.beat, rec) : rec.kind === 'pop909' ? pop909ToPiece(parseMidi(rec.data), rec.beat, rec) : midiToPiece(parseMidi(rec.data), rec.name);
  piece.title = rec.name || piece.title;
  return piece;
}
async function learnEnter(id) {
  if (P.playing) stopPlay(false);
  $('loading').classList.add('show');
  await new Promise((r) => setTimeout(r, 20));
  let piece;
  try { piece = await learnLoadPieceData(id); } catch (e) { $('loading').classList.remove('show'); toast('打不开：' + e.message); return false; }
  // 从视奏练习进来时记下视奏的速度，退出时恢复（刷新页面后直接回到学曲子时不能覆盖它）
  if (!LM.active && lsGet('sr.mode', 'sight') !== 'learn') lsSet('sr.sightSpeed', S.settings.speed);
  LM.active = true; LM.id = id; LM.piece = piece; LM.bars = piece.bars;
  LM.data = Object.assign(learnDefaults(piece.bars.length), lsGet('sr.learn.' + id, {}));
  LM.data.a = clamp(LM.data.a, 1, piece.bars.length); LM.data.b = clamp(LM.data.b, LM.data.a, piece.bars.length);
  LM.loop = LM.data.loop !== false;
  lsSet('sr.mode', 'learn'); lsSet('sr.lastPiece', id);
  document.body.classList.add('learning');
  S.settings.speed = LM.data.method === 'ladder' ? LM.data.ladder.speed : LM.data.speed; updateSpeedLabel();
  $('learnPanel').hidden = true;
  await learnRebuild(true);
  return true;
}
async function learnRebuild(fresh) {
  const keep = !fresh && S.exs[S.cur.ex] && S.exs[S.cur.ex].bars[S.cur.bar];
  const keepG = keep ? keep.gidx : null;
  $('loading').classList.add('show');
  await new Promise((r) => setTimeout(r, 20));
  S.exs = learnPages(LM.piece);
  buildTimeline();
  await renderAll();
  $('loading').classList.remove('show');
  learnSetRangeT0();
  const b = keepG != null ? LM.bars[keepG] : LM.bars[learnActiveRange().a - 1];
  S.cur = { ex: b.ex, bar: b.bi }; cursor.lastSys = -1; placeIdleCursor(); flipTo(b.ex);
  learnPaint(); learnUpdatePanel(); learnHudUpdate();
}
async function learnExit() {
  if (P.playing) stopPlay(false);
  LM.active = false; LM.picking = null; LM.hud = '';
  document.body.classList.remove('learning', 'lpicking');
  lsSet('sr.mode', 'sight');
  S.settings.speed = lsGet('sr.sightSpeed', 100); saveSettings();
  $('learnPanel').hidden = true;
  let lvl = 0; try { lvl = clamp(parseInt(localStorage.getItem('sr.lastLevel') || '0', 10) || 0, 0, LEVELS.length - 1); } catch (e) { }
  await regenerate(S.seed, lvl);
  hud();
}
async function learnLoadFile(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  let kind, data;
  if (u8[0] === 0x50 && u8[1] === 0x4b) { kind = 'xml'; data = await unzipMusicXML(u8); }
  else if (u8[0] === 0x4d && u8[1] === 0x54 && u8[2] === 0x68 && u8[3] === 0x64) { kind = 'midi'; data = u8; }
  else { const t = decodeText(u8); if (/<score-(partwise|timewise)/.test(t)) { kind = 'xml'; data = t; } else throw new Error('认不出这个文件。请用 MusicXML（.musicxml / .xml / .mxl）或 MIDI（.mid）'); }
  const piece = kind === 'xml' ? parseMusicXML(data) : midiToPiece(parseMidi(data), file.name);
  const name = (piece.title || file.name.replace(/\.[^.]+$/, '')).slice(0, 60);
  const id = 'p' + Date.now().toString(36);
  await IDB.put('piece:' + id, { kind, data, name });
  const list = pieceList(); list.unshift({ id, name, kind, bars: piece.bars.length, added: today() }); lsSet('sr.pieces', list);
  return { id, name, n: piece.bars.length };
}

/* ---------------- POP909 曲库 ---------------- */
const POP909 = POP909_LIST.split('\n').map((l) => { const [id, name, artist, ef] = l.split('|'); return { id: +id, name, artist, E: +ef[0], F: +ef[1] }; });
// 默认显示的老歌
const POP909_PICK = [526, 640, 905, 898, 428, 124, 222, 26, 879, 687, 171, 385, 72, 176, 497, 269, 22, 513, 387, 141, 17, 536, 198, 882, 560, 277, 515, 482, 444, 107, 583, 591, 791, 114, 762, 346];
function pop909Render(q) {
  q = (q || '').trim().toLowerCase();
  const list = q ? POP909.filter((x) => (x.name + ' ' + x.artist).toLowerCase().includes(q)).slice(0, 60) : POP909_PICK.map((id) => POP909[id - 1]).filter(Boolean);
  $('lPop').innerHTML = list.length ? list.map((x) => `<button data-pop="${x.id}">${escHtml(x.name)}<small> · ${escHtml(x.artist)}</small></button>`).join('') : '<span class="muted">没有找到</span>';
}
async function pop909Load(id) {
  const meta = POP909[id - 1]; if (!meta) throw new Error('编号不对');
  const name = `${meta.name}（${meta.artist}）`;
  const have = pieceList().find((p) => p.pop === id);
  if (have) return { id: have.id, name: have.name, n: have.bars, existed: true };
  const n3 = String(id).padStart(3, '0');
  const base = `https://raw.githubusercontent.com/music-x-lab/POP909-Dataset/master/POP909/${n3}/`;
  const cl = `https://raw.githubusercontent.com/AndyWeasley2004/POP909-CL-Dataset/main/POP909_processed/${n3}.mid`;
  let mid, beat, kind = 'pop909cl';
  try {
    // 谱面优先用 POP909-CL（校正过小节线、拍号、调号）；它缺的几首用原版
    const [r1, r2] = await Promise.all([fetch(cl), fetch(base + 'beat_midi.txt')]);
    if (!r2.ok) throw new Error('HTTP ' + r2.status);
    beat = await r2.text();
    if (r1.ok) mid = new Uint8Array(await r1.arrayBuffer());
    else { kind = 'pop909'; const r3 = await fetch(base + n3 + '.mid'); if (!r3.ok) throw new Error('HTTP ' + r3.status); mid = new Uint8Array(await r3.arrayBuffer()); }
  } catch (e) { throw new Error('下载失败（需要能上网）：' + e.message); }
  const rec = { kind, data: mid, beat, name, E: meta.E, F: meta.F };
  const piece = kind === 'pop909cl' ? pop909clToPiece(parseMidi(mid), beat, rec) : pop909ToPiece(parseMidi(mid), beat, rec);
  const pid = 'p' + Date.now().toString(36);
  await IDB.put('piece:' + pid, rec);
  const list = pieceList(); list.unshift({ id: pid, name, kind: 'pop909', pop: id, bars: piece.bars.length, added: today() }); lsSet('sr.pieces', list);
  return { id: pid, name, n: piece.bars.length };
}

/* ---------------- 界面 ---------------- */
function learnUpdatePanel() {
  const list = pieceList();
  const sel = $('lPiece');
  sel.innerHTML = list.length ? list.map((p) => `<option value="${p.id}">${escHtml(p.name)}（${p.bars} 小节）</option>`).join('') : '<option value="">（还没有曲子）</option>';
  if (LM.id) sel.value = LM.id;
  document.querySelectorAll('.lneed').forEach((n) => { n.hidden = !LM.active; });
  $('lIntro').hidden = LM.active;
  if (!LM.active) return;
  const D = LM.data, n = LM.bars.length;
  $('lA').max = n; $('lB').max = n; $('lA').value = D.a; $('lB').value = D.b; $('lTotal').textContent = `共 ${n} 小节`;
  $('lMethod').value = D.method; $('lStep').value = String(D.ladder.step); $('lStart').value = String(D.ladder.start);
  $('lChunk').value = String(D.back.chunk); $('lNeed').value = String(D.need);
  $('lLoop').checked = LM.loop; $('lHeat').checked = D.heat;
  $('lLadderOpts').hidden = D.method !== 'ladder'; $('lBackOpts').hidden = D.method !== 'back';
  $('lOk').hidden = MIDI.connected || D.method === 'free';
  $('lStatus').textContent = learnStatusText();
  // 进度
  const days = Object.entries(D.days).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 5);
  const dayHtml = days.map(([d, x]) => `<li>${d.slice(5)}：练了 ${x.passes} 遍，弹对 ${x.clean} 遍${x.best ? `，弹对时最高速度 ${x.best}%` : ''}</li>`).join('');
  const logHtml = D.log.slice(0, 8).map((x) => `<li>${x.d.slice(5)} 第 ${x.a}–${x.b} 小节：${x.m === 'ladder' ? `${x.sp}% 过关` : `从后往前第 ${x.st}/${x.of} 步过关（${x.sp}%）`}</li>`).join('');
  $('lLog').innerHTML = (dayHtml ? `<b>每天</b><ul>${dayHtml}</ul>` : '') + (logHtml ? `<b>过关记录</b><ul>${logHtml}</ul>` : '') || '<span class="muted">还没有记录。连上 MIDI 弹几遍，这里会显示每天的进步。</span>';
}
function learnInitUI() {
  const panel = $('learnPanel');
  $('bLearn').onclick = () => { $('settings').hidden = true; panel.hidden = !panel.hidden; learnUpdatePanel(); };
  $('bSet').addEventListener('click', () => { panel.hidden = true; });
  $('lFile').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      $('loading').classList.add('show');
      const r = await learnLoadFile(f);
      toast(`已载入《${r.name}》，共 ${r.n} 小节`);
      await learnEnter(r.id);
    } catch (er) { toast('载入失败：' + er.message); console.error(er); }
    finally { $('loading').classList.remove('show'); }
  };
  $('lPiece').onchange = async (e) => { if (e.target.value) await learnEnter(e.target.value); };
  pop909Render('');
  $('lSearch').oninput = (e) => pop909Render(e.target.value);
  $('lPop').onclick = async (e) => {
    const btn = e.target.closest('button[data-pop]'); if (!btn) return;
    try {
      $('loading').classList.add('show');
      const r = await pop909Load(+btn.dataset.pop);
      toast(r.existed ? `打开《${r.name}》` : `已载入《${r.name}》，共 ${r.n} 小节`);
      await learnEnter(r.id);
    } catch (er) { toast('载入失败：' + er.message); console.error(er); }
    finally { $('loading').classList.remove('show'); }
  };
  $('lOpen').onclick = async () => { const id = $('lPiece').value; if (id) await learnEnter(id); };
  $('lDel').onclick = async () => {
    const id = $('lPiece').value; if (!id) return;
    const p = pieceList().find((x) => x.id === id);
    if (!confirm(`删除《${p ? p.name : ''}》和它的练习记录？`)) return;
    await IDB.del('piece:' + id); lsSet('sr.pieces', pieceList().filter((x) => x.id !== id));
    try { localStorage.removeItem('sr.learn.' + id); } catch (er) { }
    if (LM.id === id) { LM.id = null; await learnExit(); }
    learnUpdatePanel();
  };
  $('lExit').onclick = () => learnExit();
  const rangeChanged = () => {
    const D = LM.data, n = LM.bars.length;
    let a = clamp(parseInt($('lA').value, 10) || 1, 1, n), b = clamp(parseInt($('lB').value, 10) || a, 1, n);
    if (b < a) [a, b] = [b, a];
    D.a = a; D.b = b; D.streak = 0; D.back.stage = 1; learnSave();
    learnRestart();
  };
  $('lA').onchange = rangeChanged; $('lB').onchange = rangeChanged;
  $('lAll').onclick = () => { $('lA').value = 1; $('lB').value = LM.bars.length; rangeChanged(); };
  $('lPick').onclick = () => { LM.picking = 'a'; document.body.classList.add('lpicking'); panel.hidden = true; toast('在谱上点起点小节'); };
  $('lMethod').onchange = (e) => {
    const D = LM.data; D.method = e.target.value; D.streak = 0; D.back.stage = 1;
    if (D.method === 'ladder') learnRestart(() => { D.ladder.speed = D.ladder.start; setSpeed(D.ladder.start); });
    else learnRestart();
    learnSave();
  };
  $('lStart').onchange = (e) => { const D = LM.data; D.ladder.start = +e.target.value; D.ladder.speed = D.ladder.start; D.streak = 0; learnSave(); learnRestart(() => setSpeed(D.ladder.start)); };
  $('lStep').onchange = (e) => { LM.data.ladder.step = +e.target.value; learnSave(); learnHudUpdate(); };
  $('lChunk').onchange = (e) => { const D = LM.data; D.back.chunk = +e.target.value; D.back.stage = 1; D.streak = 0; learnSave(); learnRestart(); };
  $('lNeed').onchange = (e) => { LM.data.need = +e.target.value; LM.data.streak = 0; learnSave(); learnHudUpdate(); learnUpdatePanel(); };
  $('lLoop').onchange = (e) => { LM.loop = e.target.checked; LM.data.loop = LM.loop; learnSave(); };
  $('lHeat').onchange = (e) => { LM.data.heat = e.target.checked; learnSave(); learnPaint(); };
  $('lOk').onclick = () => { if (LM.active) { learnJudge(true, '手动确认'); learnSave(); learnUpdatePanel(); } };
  $('lClear').onclick = () => { if (!confirm('清除这首曲子的易错统计和进度记录？')) return; const D = LM.data; D.stats = {}; D.log = []; D.days = {}; D.streak = 0; learnSave(); learnPaint(); learnUpdatePanel(); };
}
// 速度：学曲子时单独记（不影响视奏练习的速度）
function learnOnSpeed(v) { if (!LM.active || !LM.data) return; if (LM.data.method === 'ladder') LM.data.ladder.speed = v; else LM.data.speed = v; learnSave(); learnHudUpdate(); }
async function learnRestore() {
  learnUpdatePanel();
  if (lsGet('sr.mode', 'sight') !== 'learn') return;
  const id = lsGet('sr.lastPiece', null);
  if (id && pieceList().some((p) => p.id === id)) await learnEnter(id);
}
