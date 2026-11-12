'use strict';
/* =====================================================================
 * 视奏练习 —— 从入门到十级的自动生成钢琴谱
 * 结构：工具 → 乐理 → 节奏/和声素材 → 级别配置 → 生成器 → 渲染 → 音频 → 播放/跟随 → UI
 * ===================================================================== */
const VF = Vex.Flow;
const LETTERS = 'cdefgab';
const STEP = [0, 2, 4, 5, 7, 9, 11];
const mod = (n, m) => ((n % m) + m) % m;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const midiOf = (d, a) => 12 * (Math.floor(d / 7) + 1) + STEP[mod(d, 7)] + a;
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------------- 随机数（可复现） ---------------- */
let _r = Math.random;
function seedRng(s) {
  let a = s >>> 0;
  _r = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) { h ^= x >>> 0; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return h >>> 0;
}
const rnd = () => _r();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
function wpick(items, ws) {
  let s = 0; for (const w of ws) s += w;
  if (s <= 0) return items[Math.floor(rnd() * items.length)];
  let x = rnd() * s;
  for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}
function wpickObj(obj) { const ks = Object.keys(obj); return wpick(ks, ks.map((k) => obj[k])); }

/* ======================= 调性 ======================= */
const KEY_DEFS = {
  'C': [0, 0, 'M', 0], 'G': [4, 0, 'M', 1], 'D': [1, 0, 'M', 2], 'A': [5, 0, 'M', 3], 'E': [2, 0, 'M', 4],
  'B': [6, 0, 'M', 5], 'F#': [3, 1, 'M', 6], 'C#': [0, 1, 'M', 7], 'F': [3, 0, 'M', -1], 'Bb': [6, -1, 'M', -2],
  'Eb': [2, -1, 'M', -3], 'Ab': [5, -1, 'M', -4], 'Db': [1, -1, 'M', -5], 'Gb': [4, -1, 'M', -6], 'Cb': [0, -1, 'M', -7],
  'Am': [5, 0, 'm', 0], 'Em': [2, 0, 'm', 1], 'Bm': [6, 0, 'm', 2], 'F#m': [3, 1, 'm', 3], 'C#m': [0, 1, 'm', 4],
  'G#m': [4, 1, 'm', 5], 'D#m': [1, 1, 'm', 6], 'Dm': [1, 0, 'm', -1], 'Gm': [4, 0, 'm', -2], 'Cm': [0, 0, 'm', -3],
  'Fm': [3, 0, 'm', -4], 'Bbm': [6, -1, 'm', -5], 'Ebm': [2, -1, 'm', -6],
};
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
function keyCn(name) {
  const minor = name.endsWith('m');
  const body = minor ? name.slice(0, -1) : name;
  const acc = body.slice(1).replace('#', '♯').replace('b', '♭');
  return minor ? body[0].toLowerCase() + acc + ' 小调' : body[0] + acc + ' 大调';
}
function makeKey(name) {
  const [l, a, mode, f] = KEY_DEFS[name];
  const sig = [0, 0, 0, 0, 0, 0, 0];
  if (f > 0) for (let i = 0; i < f; i++) sig[SHARP_ORDER[i]] = 1;
  else for (let i = 0; i < -f; i++) sig[FLAT_ORDER[i]] = -1;
  return { name, l, a, mode, f, sig, t4: l + 28, cn: keyCn(name) };
}
const semiPc = (key, pc, chrom) => { const d = key.t4 + pc; return midiOf(d, key.sig[mod(d, 7)] + chrom); };

/* ======================= 和弦 ======================= */
const ROMAN_M = { I: [0, 'M'], ii: [1, 'm'], iii: [2, 'm'], IV: [3, 'M'], V: [4, 'M'], V7: [4, '7'], vi: [5, 'm'], viio: [6, 'd'], iv: [3, 'm'] };
const ROMAN_m = { i: [0, 'm'], iio: [1, 'd'], III: [2, 'M'], iv: [3, 'm'], V: [4, 'M'], V7: [4, '7'], VI: [5, 'M'], VII: [6, 'M'], viio: [6, 'd', 1] };
function makeChord(key, rootPc, q, rootChrom, sym) {
  const pcs = [rootPc, rootPc + 2, rootPc + 4];
  if (q === '7') pcs.push(rootPc + 6);
  const want = { M: [0, 4, 7], m: [0, 3, 7], d: [0, 3, 6], '7': [0, 4, 7, 10] }[q];
  const rootS = semiPc(key, rootPc, rootChrom);
  const tones = pcs.map((pc, i) => {
    let chrom = i === 0 ? rootChrom : 0;
    if (i > 0) {
      const cur = mod(semiPc(key, pc, 0) - rootS, 12);
      chrom = want[i] - cur; if (chrom > 6) chrom -= 12; if (chrom < -6) chrom += 12;
    }
    return { pc: mod(pc, 7), chrom };
  });
  return { key, root: mod(rootPc, 7), q, tones, sym };
}
function chordFromSym(key, sym) {
  if (sym.startsWith('V/')) { const t = chordFromSym(key, sym.slice(2)); return makeChord(key, t.root + 4, '7', 0, sym); }
  const tbl = key.mode === 'M' ? ROMAN_M : ROMAN_m;
  const [r, q, rc] = tbl[sym];
  return makeChord(key, r, q, rc || 0, sym);
}
const isCT = (ch, pc) => ch.tones.some((t) => t.pc === pc);
// 给音级找升降：和弦音用和弦里的变化；非和弦音避免增二度
function resolveChrom(pc, ch) {
  pc = mod(pc, 7);
  for (const t of ch.tones) if (t.pc === pc) return t.chrom;
  const key = ch.key; let c = 0;
  const up = ch.tones.find((t) => t.pc === mod(pc + 1, 7));
  if (up && mod(semiPc(key, pc + 1, up.chrom) - semiPc(key, pc, 0), 12) === 3) c = 1;
  const dn = ch.tones.find((t) => t.pc === mod(pc - 1, 7));
  if (c === 0 && dn && mod(semiPc(key, pc, 0) - semiPc(key, pc - 1, dn.chrom), 12) === 3) c = -1;
  return c;
}

/* ======================= 拍号与节奏素材 ======================= */
const TS = {
  '4/4': { name: '4/4', n: 4, d: 4, len: 96, beat: 24, strong: [0, 48], comp: false, split: [48, 48] },
  '3/4': { name: '3/4', n: 3, d: 4, len: 72, beat: 24, strong: [0], comp: false, split: [48, 24] },
  '2/4': { name: '2/4', n: 2, d: 4, len: 48, beat: 24, strong: [0], comp: false, split: [24, 24] },
  '6/8': { name: '6/8', n: 6, d: 8, len: 72, beat: 36, strong: [0, 36], comp: true, split: [36, 36] },
  '12/8': { name: '12/8', n: 12, d: 8, len: 144, beat: 36, strong: [0, 72], comp: true, split: [72, 72] },
};
const TOK = { w: 96, hd: 72, h: 48, qd: 36, q: 24, '8d': 18, '8': 12, '16': 6, t: 8 };
const rep = (t, n) => Array(n).fill(t).join(' ');
const S16 = (n) => rep('16', n);
// 每个拍号 8 个难度层（0 最简单）
const RHY = {
  '4/4': [
    ['w', 'h h', 'q q h', 'h q q', 'q q q q'],
    ['hd q', 'q hd', 'q h q', 'q q q q', 'h h', 'q q h'],
    ['8 8 q h', 'q 8 8 q q', '8 8 8 8 h', 'q q 8 8 q', '8 8 q 8 8 q', 'q q q 8 8', 'rq q q q', 'q q h'],
    ['qd 8 h', 'qd 8 q q', 'q qd 8 q', 'qd 8 qd 8', 'h qd 8', 'q rq q q', '8 8 qd 8 q', 'q q qd 8'],
    ['16 16 16 16 q h', 'q 16 16 16 16 h', '8 16 16 q q q', '8 q 8 h', 'q 8 q 8 q', '8d 16 q h', '8d 16 8d 16 h', '16 16 8 q q q', 'q 8 8 16 16 16 16 q'],
    ['t t t q h', 'q t t t h', 't t t t t t h', 't t t q t t t q', 'q t t t q q', '8 8 t t t q q'],
    [S16(8) + ' h', S16(4) + ' q ' + S16(4) + ' q', '8d 16 8d 16 q q', '8 16 16 8 16 16 q q', '16 16 16 16 8 8 16 16 16 16 q', '8 8 16 16 16 16 8 8 q', 'r8 8 16 16 16 16 q q'],
    [S16(16), rep('t', 12), '16 16 16 16 t t t 16 16 16 16 q', '8 16 16 16 16 8 16 16 16 16 8 8', '16 16 8 16 16 8 16 16 16 16 q', 't t t 16 16 16 16 t t t q', S16(12) + ' q'],
  ],
  '3/4': [
    ['hd', 'h q', 'q q q', 'q h'],
    ['q q q', 'h q', 'hd', 'q h'],
    ['8 8 q q', 'q 8 8 q', 'q q 8 8', '8 8 8 8 q', 'rq q q'],
    ['qd 8 q', 'h 8 8', 'q qd 8', 'qd 8 8 8'],
    ['16 16 16 16 q q', 'q 16 16 16 16 q', '8d 16 q q', '8 q 8 q', '8 16 16 q q', 'q 8 16 16 q'],
    ['t t t q q', 'q t t t q', 't t t t t t q', 'q q t t t'],
    [S16(8) + ' q', '8d 16 8d 16 q', '16 16 16 16 8 8 q', '8 16 16 8 16 16 q'],
    [S16(12), rep('t', 9), '16 16 16 16 t t t 16 16 16 16', 'q ' + S16(8)],
  ],
  '2/4': [
    ['h', 'q q'],
    ['q q', 'h'],
    ['8 8 q', 'q 8 8', '8 8 8 8'],
    ['qd 8', 'q rq', '8 q 8'],
    ['16 16 16 16 q', 'q 16 16 16 16', '8 16 16 8 8', '8d 16 q', '8 16 16 q'],
    ['t t t q', 'q t t t', 't t t t t t', 't t t 8 8'],
    [S16(8), '8 16 16 16 16 8', '8d 16 8d 16', '16 16 8 16 16 8'],
    ['16 16 16 16 t t t', 't t t 16 16 16 16', '8 16 16 t t t', S16(8)],
  ],
  '6/8': [
    ['hd', 'qd qd'],
    ['q 8 qd', 'qd q 8', 'qd qd', 'q 8 q 8'],
    ['8 8 8 qd', 'qd 8 8 8', '8 8 8 8 8 8', 'q 8 8 8 8'],
    ['8 8 8 q 8', 'qd r8 8 8', 'q 8 8 q', '8 q qd'],
    ['8d 16 8 qd', '16 16 16 16 8 qd', 'qd 16 16 16 16 8', '8 16 16 8 qd', '8d 16 8 8d 16 8'],
    ['16 16 8 8 16 16 8 8', '8d 16 8 16 16 16 16 8', '8 8 8 16 16 16 16 8'],
    [S16(6) + ' qd', 'qd ' + S16(6), '8 16 16 16 16 8 8 8', '16 16 16 16 8 16 16 16 16 8'],
    [S16(12), '8d 16 8 ' + S16(6), S16(4) + ' 8 ' + S16(6)],
  ],
};
// 乐句结尾（半终止/中间终止）用：最后一个音较长
const CAD = {
  '4/4': [['w', 0], ['h h', 0], ['q q h', 0], ['8 8 q h', 2], ['qd 8 h', 3], ['16 16 16 16 q h', 4], ['t t t q h', 5], ['16 16 16 16 8 8 h', 6]],
  '3/4': [['hd', 0], ['q h', 0], ['8 8 h', 2], ['16 16 16 16 h', 4], ['t t t h', 5]],
  '2/4': [['h', 0], ['q q', 0], ['8 8 q', 2], ['16 16 16 16 q', 4], ['t t t q', 5]],
  '6/8': [['hd', 0], ['qd qd', 0], ['q 8 qd', 1], ['8 8 8 qd', 2], ['16 16 16 16 8 qd', 4]],
};
const FINAL = { '4/4': ['w', 'h h', 'q q h'], '3/4': ['hd', 'q h'], '2/4': ['h', '8 8 q'], '6/8': ['hd', 'qd qd', '8 8 8 qd'] };

function parseRhythm(str) {
  let pos = 0, tcount = 0, tid = 0; const out = [];
  for (let tok of str.trim().split(/\s+/)) {
    let rest = false;
    if (tok[0] === 'r') { rest = true; tok = tok.slice(1); }
    const dur = TOK[tok];
    if (!dur) throw new Error('bad token ' + tok);
    const e = { pos, dur, rest, notes: [] };
    if (tok === 't') { if (tcount % 3 === 0) tid++; e.tup = tid; tcount++; }
    out.push(e); pos += dur;
  }
  return { evs: out, len: pos };
}
function tierWeights(maxTier, p) {
  const ws = [];
  for (let t = 0; t <= maxTier; t++) {
    if (t < maxTier - 4) ws.push(0);
    else if (t === maxTier) ws.push(0.7 + 2.6 * p);
    else if (t === maxTier - 1) ws.push(1.6);
    else ws.push(0.7 / (maxTier - t));
  }
  return ws;
}
function pickRhythm(tsName, maxTier, p) {
  if (tsName === '12/8') return pickRhythm('6/8', maxTier, p) + ' ' + pickRhythm('6/8', maxTier, p);
  const tiers = RHY[tsName]; maxTier = Math.min(maxTier, tiers.length - 1);
  const t = wpick([...Array(maxTier + 1).keys()], tierWeights(maxTier, p));
  return pick(tiers[t]);
}
function pickCad(tsName, maxTier, p) {
  if (tsName === '12/8') return pickRhythm('6/8', maxTier, p) + ' ' + pickCad('6/8', maxTier, p);
  const pool = CAD[tsName].filter((c) => c[1] <= maxTier);
  return wpick(pool.map((c) => c[0]), pool.map((c) => 1 + (c[1] === maxTier ? 2 * p : 0) + c[1] * 0.3));
}
function pickFinal(tsName, maxTier, p) {
  if (tsName === '12/8') return pickRhythm('6/8', Math.min(maxTier, 3), p) + ' hd';
  return pick(FINAL[tsName]);
}

/* ======================= 和声进行素材 ======================= */
const ANT = {
  M: [['I I V V', 'I V I V', 'I I I V', 'I V7 I V'],
      ['I IV I V', 'I I IV V', 'I IV V V', 'I IV IV V'],
      ['I vi IV V', 'I vi ii V', 'I iii IV V', 'I ii V V', 'I IV ii V', 'I V vi V']],
  m: [['i i V V', 'i V i V', 'i i i V'],
      ['i iv i V', 'i i iv V', 'i iv V V'],
      ['i VI iv V', 'i iio V V', 'i VII VI V', 'i III iv V', 'i iv VI V']],
};
const CONTRAST = {
  M: [['V7 I V7 V', 'V7 V7 I V'], ['IV I IV V', 'IV IV I V', 'V I IV V', 'IV V I V'],
      ['vi IV ii V', 'vi iii IV V', 'IV I ii V', 'ii V I V', 'vi ii V V']],
  m: [['V i V V', 'V7 i i V'], ['iv i iv V', 'iv iv i V', 'V i iv V'],
      ['VI iv iio V', 'III VI iv V', 'VI VII III V', 'iv VII III V']],
};
const NEXT = {
  M: { I: ['vi', 'IV', 'V'], ii: ['V'], iii: ['vi', 'IV'], IV: ['V', 'ii', 'I'], V: ['V7'], V7: ['V7'], vi: ['ii', 'IV'], iv: ['V'] },
  m: { i: ['iv', 'VI', 'V'], iio: ['V'], III: ['VI', 'iv'], iv: ['V', 'iio', 'i'], V: ['V7'], V7: ['V7'], VI: ['iv', 'iio', 'VII'], VII: ['III'] },
};
const SEC_TARGET = { M: ['V', 'ii', 'vi', 'IV'], m: ['V', 'iv', 'VI'] };
function pickTier(arrs, tier) {
  const t = Math.min(tier, arrs.length - 1);
  const ws = [], items = [];
  for (let i = 0; i <= t; i++) for (const s of arrs[i]) { items.push(s); ws.push(i === t ? 3 : 1); }
  return wpick(items, ws).split(' ');
}

/* ======================= 级别配置 ======================= */
// 音域用绝对音级 d：C4 = 28（每升一个白键 +1）
const LEVELS = [
  { name: '入门', en: 'Beginner', desc: '中央C五指位置 · 全音符、二分音符、四分音符 · 先右手，再左手，再双手',
    keys: ['C'], newKeys: [], times: ['4/4'], tier: 0, chordTier: 0, tempo: [60, 72], rh: [28, 32], lh: [21, 25], maxLeap: 2,
    lhPat: { whole: 1 }, bars: 8, finger: true,
    exercises: [
      { tex: 'rh', rhythms: ['w', 'h h', 'h h'], maxLeap: 1, title: '右手 · 一步一步' },
      { tex: 'rh', rhythms: ['h h', 'q q h', 'h q q', 'q q q q'], title: '右手 · 四分音符' },
      { tex: 'lh', rhythms: ['w', 'h h', 'q q h', 'h q q'], maxLeap: 1, title: '左手 · 低音谱号' },
      { tex: 'alt', title: '双手轮流 · 一问一答' },
      { tex: 'both', title: '双手合奏 · 左手长音' },
      { tex: 'both', time: '3/4', title: '三拍子 · 圆舞曲的感觉' },
    ] },
  { name: '一级', en: 'Grade 1', desc: 'G、F 大调 · 3/4 拍 · 附点二分音符 · 三度跳进 · 左手根音与五度',
    keys: ['C', 'G', 'F'], newKeys: ['G', 'F'], times: ['4/4', '3/4'], tier: 1, chordTier: 1, tempo: [63, 80], rh: [28, 35], lh: [18, 25], maxLeap: 2,
    lhPat: { whole: 2, halfRoot: 2, block2: 1 }, bars: 8, finger: true },
  { name: '二级', en: 'Grade 2', desc: 'D 大调、a 小调 · 2/4 拍 · 八分音符 · 五度以内跳进 · 力度记号 · 左手四分音符伴奏',
    keys: ['C', 'G', 'F', 'D', 'Am'], newKeys: ['D', 'Am'], times: ['4/4', '3/4', '2/4'], tier: 2, chordTier: 1, tempo: [66, 84], rh: [28, 36], lh: [17, 25], maxLeap: 4,
    lhPat: { halfRoot: 2, block2: 2, quarters: 2, whole: 1 }, bars: 8, dyn: true, stacc: 0.15, finger: true },
  { name: '三级', en: 'Grade 3', desc: '降B 大调、e/d 小调 · 附点四分音符 · 休止符 · 跳音 · 分解和弦与圆舞曲伴奏 · 加线',
    keys: ['C', 'G', 'F', 'D', 'Bb', 'Am', 'Em', 'Dm'], newKeys: ['Bb', 'Em', 'Dm'], times: ['4/4', '3/4', '2/4'], tier: 3, chordTier: 2, tempo: [69, 92], rh: [27, 38], lh: [16, 26], maxLeap: 5,
    lhPat: { broken: 3, block3: 2, waltz: 2, quarters: 1, halfRoot: 1 }, bars: 8, dyn: true, stacc: 0.25 },
  { name: '四级', en: 'Grade 4', desc: 'A/降E 大调、b/g 小调 · 6/8 拍 · 十六分音符 · 切分音 · 阿尔贝蒂低音 · 右手双音 · 临时变音记号',
    keys: ['C', 'G', 'F', 'D', 'Bb', 'A', 'Eb', 'Am', 'Em', 'Dm', 'Bm', 'Gm'], newKeys: ['A', 'Eb', 'Bm', 'Gm'], times: ['4/4', '3/4', '2/4', '6/8'], newTimes: ['6/8'], tier: 4, chordTier: 2, tempo: [72, 96], rh: [27, 39], lh: [15, 27], maxLeap: 7,
    lhPat: { alberti: 3, broken: 2, waltz: 2, block3: 1, quarters: 1 }, bars: 8, dyn: true, stacc: 0.25, chrom: 0.06, tex: { thirds: 0.15 } },
  { name: '五级', en: 'Grade 5', desc: 'E/降A 大调、升f/c 小调 · 三连音 · 八度跳进 · 八度低音 · 一小节两个和弦 · 旋律在左手',
    keys: ['G', 'F', 'D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'Em', 'Dm', 'Bm', 'Gm', 'F#m', 'Cm'], newKeys: ['E', 'Ab', 'F#m', 'Cm'], times: ['4/4', '3/4', '2/4', '6/8'], tier: 5, chordTier: 2, tempo: [72, 100], rh: [26, 40], lh: [14, 27], maxLeap: 7,
    lhPat: { alberti: 3, broken: 2, waltz: 2, octaves: 2, block3: 1 }, bars: 8, dyn: true, stacc: 0.25, chrom: 0.1, split: 0.15, swap: 0.15, tex: { thirds: 0.2 } },
  { name: '六级', en: 'Grade 6', desc: 'B/降D 大调、升c/f 小调 · 连续十六分音符 · 右手和弦 · 大跨度琶音 · 跨步低音 · 重音',
    keys: ['D', 'Bb', 'A', 'Eb', 'E', 'Ab', 'B', 'Db', 'Bm', 'Gm', 'F#m', 'Cm', 'C#m', 'Fm'], newKeys: ['B', 'Db', 'C#m', 'Fm'], times: ['4/4', '3/4', '2/4', '6/8'], tier: 6, chordTier: 2, tempo: [76, 104], rh: [26, 42], lh: [13, 28], maxLeap: 7,
    lhPat: { arp8: 3, alberti: 2, stride: 2, waltz: 1, octaves: 2, triplet: 1 }, bars: 8, dyn: true, stacc: 0.2, accent: true, chrom: 0.14, split: 0.25, swap: 0.2, tex: { thirds: 0.22, chordal: 0.12 }, chordNotes: 2 },
  { name: '七级', en: 'Grade 7', desc: '升F/降G 大调、升g/降b 小调 · 副属和弦 · 十六分音符琶音伴奏 · 复调式低音线条',
    keys: ['A', 'Eb', 'E', 'Ab', 'B', 'Db', 'F#', 'Gb', 'F#m', 'Cm', 'C#m', 'Fm', 'G#m', 'Bbm'], newKeys: ['F#', 'Gb', 'G#m', 'Bbm'], times: ['4/4', '3/4', '2/4', '6/8'], tier: 6, chordTier: 2, tempo: [76, 108], rh: [26, 43], lh: [12, 28], maxLeap: 7,
    lhPat: { arp16: 1.5, arp8: 2, alberti: 2, bassLine: 2, stride: 1.5, brokenOct: 1, triplet: 1, waltz: 1 }, bars: 8, dyn: true, stacc: 0.2, accent: true, chrom: 0.18, split: 0.35, sec: 0.2, swap: 0.25, tex: { thirds: 0.2, chordal: 0.2 }, chordNotes: 2 },
  { name: '八级', en: 'Grade 8', desc: '全部调号（升C、降C 大调、升d/降e 小调）· 12/8 拍 · 八度旋律 · 十六分阿尔贝蒂 · 密集变化音',
    keys: Object.keys(KEY_DEFS), newKeys: ['C#', 'Cb', 'D#m', 'Ebm'], times: ['4/4', '3/4', '2/4', '6/8', '12/8'], newTimes: ['12/8'], tier: 7, chordTier: 2, tempo: [72, 126], rh: [25, 44], lh: [11, 28], maxLeap: 7,
    lhPat: { arp16: 1.5, alberti16: 1.2, bassLine: 2, stride: 1.5, brokenOct: 1, arp8: 1.5, triplet: 1, octaves: 1, alberti: 1 }, bars: 8, dyn: true, stacc: 0.2, accent: true, chrom: 0.22, split: 0.45, sec: 0.35, swap: 0.3, tex: { thirds: 0.2, chordal: 0.25, octaves: 0.12 }, chordNotes: 2 },
  { name: '九级', en: 'Grade 9', desc: '多升降号调为主 · 借用和弦 · 四音和弦 · 三对二节奏 · 极宽音域',
    keys: Object.keys(KEY_DEFS), newKeys: [], heavyKeys: true, times: ['4/4', '3/4', '2/4', '6/8', '12/8'], tier: 7, chordTier: 2, tempo: [76, 132], rh: [25, 45], lh: [10, 29], maxLeap: 7,
    lhPat: { arp16: 1.5, alberti16: 1.2, bassLine: 2, stride: 1.5, brokenOct: 1.2, triplet: 1.5, arp8: 1, octaves: 1 }, bars: 8, dyn: true, stacc: 0.2, accent: true, chrom: 0.27, split: 0.5, sec: 0.45, borrow: 0.3, swap: 0.3, tex: { thirds: 0.2, chordal: 0.28, octaves: 0.18 }, chordNotes: 3 },
  { name: '十级', en: 'Grade 10', desc: '综合：全部调号 · 复杂节奏 · 双手快速经过句 · 厚重和弦与八度 · 高密度变化音',
    keys: Object.keys(KEY_DEFS), newKeys: [], heavyKeys: true, times: ['4/4', '3/4', '2/4', '6/8', '12/8'], tier: 7, chordTier: 2, tempo: [80, 138], rh: [24, 46], lh: [9, 29], maxLeap: 7,
    lhPat: { arp16: 1.8, alberti16: 1.2, bassLine: 2, stride: 1.5, brokenOct: 1.5, triplet: 1.5, octaves: 1.2, arp8: 1 }, bars: 8, dyn: true, stacc: 0.2, accent: true, chrom: 0.3, split: 0.55, sec: 0.55, borrow: 0.35, swap: 0.35, tex: { thirds: 0.2, chordal: 0.3, octaves: 0.22 }, chordNotes: 3 },
];
const EX_PER_LEVEL = 198;
const PASS_PCT = 100;   // “自动接下一首”：这一首的正确率要达到它（每个音都弹对）、并且没有错键才进下一首，否则重弹这一首
const ONSET_RATE = [0.9, 1.2, 1.5, 1.9, 2.3, 2.7, 3.1, 3.5, 4.0, 4.5, 5.1];   // 各级目标：每秒起音数
const BUSY = { arp16: 2, alberti16: 2, brokenOct: 1, alberti: 1, broken: 1, arp8: 1, triplet: 1, bassLine: 1 };
const COMPAT = { triplet: ['4/4', '3/4', '2/4'], arp16: ['4/4', '3/4', '2/4', '6/8'], alberti16: ['4/4', '3/4', '2/4', '6/8'] };

/* ======================= 伴奏音型 ======================= */
function tonesIn(ch, lo, hi, triad) {
  const pcs = (triad ? ch.tones.slice(0, 3) : ch.tones).map((t) => t.pc);
  const out = [];
  for (let d = lo; d <= hi; d++) if (pcs.includes(mod(d, 7))) out.push(d);
  return out;
}
function rootNear(ch, target, lo, hi) {
  let best = null;
  for (let d = lo; d <= hi; d++) if (mod(d, 7) === ch.root && (best === null || Math.abs(d - target) < Math.abs(best - target))) best = d;
  return best === null ? lo + mod(ch.root - lo, 7) : best;
}
function closeTriad(ch, lo, hi, prev, center) {
  const ts = tonesIn(ch, lo - 4, hi + 3, true);
  let best = null, bs = 1e9;
  for (let i = 0; i + 2 < ts.length; i++) {
    const v = [ts[i], ts[i + 1], ts[i + 2]];
    if (v[2] - v[0] > 5) continue;
    const out = Math.max(0, lo - v[0]) + Math.max(0, v[2] - hi);   // 超出音域的惩罚
    const s = prev ? Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]) : Math.abs((v[0] + v[2]) / 2 - center);
    const sc = s + out * 4 + rnd() * 0.6;
    if (sc < bs) { bs = sc; best = v; }
  }
  if (!best) { const r = rootNear(ch, center, lo - 4, hi); best = [r, r + 2, r + 4]; }
  return best;
}
const mkNotes = (degs, ch) => [...new Set(degs)].sort((a, b) => a - b).map((d) => ({ deg: d, chrom: resolveChrom(d, ch) }));
const NOTATABLE = new Set([96, 72, 48, 36, 24, 18, 12, 6]);
function splitDur(len) { if (NOTATABLE.has(len)) return [len]; return [...splitDur(len / 2), ...splitDur(len / 2)]; }
function bounce(i, m) { if (m <= 1) return 0; const per = 2 * (m - 1); const k = i % per; return k < m ? k : per - k; }

// 一个和弦片段（span）里的伴奏
function accSpan(pat, span, ts, reg, st) {
  const ch = span.ch, out = [], L = span.len, P = span.start;
  const lo = reg[0], hi = reg[1];
  const pushE = (pos, dur, degs, extra) => out.push(Object.assign({ pos: P + pos, dur, rest: false, notes: mkNotes(degs.filter((d) => d >= lo - 4 && d <= hi + 3), ch) }, extra || {}));
  const floor = Math.max(lo - 1, 12 - st.t4);           // 低于 A1 的八度不用
  const bassRoot = (need) => {
    const top = Math.max(lo, hi - need);
    const pref = clamp((need >= 7 ? 17 : 19) - st.t4, lo, top);   // F2 / A2 附近
    const tgt = st.prevBass == null ? pref : st.prevBass * 0.6 + pref * 0.4;
    const r = rootNear(ch, tgt, lo, top);
    st.prevBass = r; return r;
  };
  const lowOct = (r) => (r - 7 >= floor ? [r - 7, r] : [r, r + 7]);
  const halves = () => {
    if (ts.comp) return L === 144 ? [36, 36, 36, 36] : L === 72 ? [36, 36] : [L];
    return L === 96 ? [48, 48] : L === 72 ? [48, 24] : L === 48 ? [24, 24] : [L];
  };
  const fifthOf = (r) => (r + 4 <= hi ? r + 4 : r - 3);
  const sub = (n) => { const a = []; for (let p = 0; p < L; p += n) a.push(p); return a; };
  const beats = sub(ts.beat);
  switch (pat) {
    case 'whole': { const r = bassRoot(0); let p = 0; for (const d of splitDur(L)) { pushE(p, d, [r]); p += d; } break; }
    case 'final': {
      const r = bassRoot(7); const lvl = st.level;
      const degs = lvl <= 1 ? [r] : lvl <= 4 ? [r, r + 4] : lowOct(r);
      let p = 0; for (const d of splitDur(L)) { pushE(p, d, degs); p += d; } break;
    }
    case 'halfRoot': case 'block2': case 'block3': {
      const r = bassRoot(pat === 'block3' ? 0 : 4);
      let p = 0; const hs = halves();
      hs.forEach((d, i) => {
        if (pat === 'halfRoot') pushE(p, d, [i % 2 === 0 ? r : fifthOf(r)]);
        else if (pat === 'block2') pushE(p, d, [r, r + 4]);
        else { const v = closeTriad(ch, lo + 2, hi, st.prevTri, hi - 3); st.prevTri = v; pushE(p, d, v); }
        p += d;
      });
      break;
    }
    case 'quarters': {
      const r = bassRoot(7); const seq = [r, r + 4, r + 7, r + 4].filter((d) => d <= hi);
      beats.forEach((b, i) => pushE(b, ts.beat, [seq[i % seq.length]]));
      break;
    }
    case 'broken': case 'arp8': case 'arp16': case 'triplet': case 'brokenOct': {
      const s = pat === 'arp16' ? 6 : pat === 'triplet' ? 8 : 12;
      const need = pat === 'arp16' ? 11 : pat === 'broken' ? 7 : 9;
      const r = bassRoot(need);
      let tones;
      if (pat === 'brokenOct') tones = [r, r + 7];
      else if (pat === 'broken') tones = ts.comp ? [r, r + 4, r + 7, r + 9] : [r, r + 4, r + 7];
      else if (pat === 'arp16') tones = [r, r + 4, r + 7, r + 9, r + 11, r + 14];
      else tones = [r, r + 4, r + 7, r + 9];
      tones = tones.filter((d) => d <= hi + 1);
      const pos = sub(s);
      pos.forEach((q, i) => {
        let idx;
        if (pat === 'brokenOct') idx = i % 2;
        else if (pat === 'broken' && !ts.comp) idx = [0, 1, 2, 1][i % 4];
        else idx = bounce(i, tones.length);
        const e = { tup: undefined };
        if (pat === 'triplet') e.tup = (st.tup = (st.tup || 0) + (i % 3 === 0 ? 1 : 0));
        pushE(q, s, [tones[Math.min(idx, tones.length - 1)]], pat === 'triplet' ? { tup: st.tup } : null);
      });
      break;
    }
    case 'alberti': case 'alberti16': {
      const aLo = clamp(17 - st.t4, lo, hi - 5), aHi = clamp(27 - st.t4, aLo + 5, hi);   // F2–B3 之间
      const v = closeTriad(ch, aLo, aHi, st.prevTri, 22 - st.t4); st.prevTri = v;
      const s = pat === 'alberti16' ? 6 : 12;
      const seq = ts.comp ? [0, 2, 1] : [0, 2, 1, 2];
      sub(s).forEach((q, i) => pushE(q, s, [v[seq[i % seq.length]]]));
      break;
    }
    case 'waltz': case 'stride': {
      const r = bassRoot(pat === 'stride' ? 7 : 4);
      const v = closeTriad(ch, r + 2, hi, st.prevTri, hi - 2); st.prevTri = v;
      const up = st.level >= 5 ? v : v.slice(1);
      const bass = pat === 'stride' ? lowOct(r) : [r];
      if (ts.comp) {
        beats.forEach((b) => { pushE(b, 12, bass); pushE(b + 12, 12, up); pushE(b + 24, 12, up); });
      } else {
        beats.forEach((b, i) => {
          const gi = (P + b) / ts.beat;
          if (ts.n === 3) pushE(b, 24, gi % 3 === 0 ? bass : up);
          else pushE(b, 24, gi % 2 === 0 ? (gi % 4 === 2 && pat === 'waltz' ? [fifthOf(r)] : bass) : up);
        });
      }
      break;
    }
    case 'octaves': {
      const r = bassRoot(7); const f = r - 3 >= lo ? r - 3 : r + 4;
      beats.forEach((b, i) => { const x = i % 2 === 0 ? r : f; pushE(b, ts.beat, x + 7 <= hi + 1 ? [x, x + 7] : [x - 7, x]); });
      break;
    }
    default: { const r = bassRoot(0); let p = 0; for (const d of splitDur(L)) { pushE(p, d, [r]); p += d; } }
  }
  return out;
}

/* ======================= 旋律线条生成 ======================= */
function chordAt(bar, pos) { let c = bar.spans[0]; for (const s of bar.spans) if (s.start <= pos) c = s; return c.ch; }
function noteSemi(key, deg, chrom) { const d = key.t4 + deg; return midiOf(d, key.sig[mod(d, 7)] + chrom); }

// 在 bars 中的 hand 声部（节奏已就绪）填入音高
function fillLine(piece, barIdxs, hand, range, opt) {
  const key = piece.key, ts = piece.ts;
  const [lo, hi] = range;
  const total = barIdxs.length * ts.len;
  const s0 = 0.25 + 0.3 * rnd(), pk = 0.75 + 0.25 * rnd(), xp = 0.35 + 0.4 * rnd();
  const e1 = opt.cad === 'PAC' ? 0.15 + 0.3 * rnd() : 0.35 + 0.3 * rnd();
  const shape = (x) => (x < xp ? s0 + (pk - s0) * (x / xp) : pk + (e1 - pk) * ((x - xp) / (1 - xp)));
  const sig = opt.bass ? 3.5 : Math.max(2.2, (hi - lo) / 3.2);
  let prev = opt.prev ?? null, prevChrom = 0, lastInt = 0, prevNCT = false;
  // 末音位置
  let lastBi = -1, lastEi = -1;
  barIdxs.forEach((b, bi) => { const evs = piece.bars[b][hand] || []; evs.forEach((e, ei) => { if (!e.rest) { lastBi = bi; lastEi = ei; } }); });
  barIdxs.forEach((b, bi) => {
    const bar = piece.bars[b];
    if (bar.copyOf != null && !opt.bass) {
      bar[hand] = clone(piece.bars[bar.copyOf][hand]);
      const ns = bar[hand].filter((e) => !e.rest);
      if (ns.length) { const l = ns[ns.length - 1].notes[0]; prev = l.deg; prevChrom = l.chrom; lastInt = 0; prevNCT = false; }
      return;
    }
    const evs = bar[hand];
    evs.forEach((ev, ei) => {
      if (ev.rest) return;
      const ch = chordAt(bar, ev.pos);
      const x = (bi * ts.len + ev.pos) / total;
      const target = opt.bass ? (lo + hi) / 2 - 1 : lo + (hi - lo) * shape(x);
      const strong = ts.strong.includes(ev.pos);
      const onBeat = ev.pos % ts.beat === 0;
      const isLast = bi === lastBi && ei === lastEi && !opt.bass;
      const isPen = !opt.bass && opt.cad === 'PAC' && bi === lastBi && (() => { const r = evs.slice(ei + 1).filter((e) => !e.rest); return r.length === 1; })();
      const fast = ev.dur <= 8;
      let allowPcs = null;
      if (isLast) allowPcs = opt.cad === 'PAC' ? [0] : [4, 6, 1];
      if (opt.bass && ev.pos === 0) allowPcs = [ch.root];
      const cands = [], ws = [];
      const maxLeap = opt.maxLeap;
      for (let d = lo; d <= hi; d++) {
        const pc = mod(d, 7);
        if (allowPcs && !allowPcs.includes(pc)) continue;
        const ct = isCT(ch, pc);
        const chrom = resolveChrom(pc, ch);
        let w;
        if (prev === null) {
          w = ct ? 3 : 0.05;
          if (opt.startTonic && pc === 0) w *= 3;
          w *= Math.exp(-((d - target) ** 2) / (2 * 2.5 * 2.5));
        } else {
          const iv = d - prev, ai = Math.abs(iv), dir = Math.sign(iv);
          if (ai > maxLeap && !allowPcs) continue;
          w = ai === 0 ? (ev.dur >= 24 ? 0.55 : 0.18) : ai === 1 ? 4 : ai === 2 ? 2.2 : ai === 3 ? 0.9 : ai === 4 ? 0.6 : ai === 5 ? 0.3 : ai === 7 ? 0.35 : 0.15;
          if (ai > maxLeap) w *= 0.02;
          if (fast || ev.dur <= 6) { if (ai === 1) w *= 1.8; if (ai >= 3) w *= 0.3; if (ai === 0) w *= 0.3; }
          if (strong) w *= ct ? 2.6 : 0.05;
          else if (onBeat) w *= ct ? 1.8 : 0.3;
          else if (!ct && ai !== 1) w *= 0.12;
          if (prevNCT && ai !== 1) w *= 0.12;
          if (lastInt && dir === Math.sign(lastInt) && ai === 1) w *= (ev.dur <= 6 ? 2.4 : 1.25);
          if (Math.abs(lastInt) >= 3) { if (dir === Math.sign(lastInt)) w *= 0.25; else if (ai <= 2) w *= 2; }
          const semi = Math.abs(noteSemi(key, d, chrom) - noteSemi(key, prev, prevChrom));
          if ((ai > 1 && semi === 6) || (ai === 1 && semi === 3) || (ai === 2 && semi === 5) || (ai === 3 && semi === 4)) w *= 0.04;
          w *= Math.exp(-((d - target) ** 2) / (2 * sig * sig));
          if (isPen && (pc === 1 || pc === 6)) w *= 3;
          if (isLast && ai <= 2) w *= 3;
        }
        cands.push({ d, chrom, ct }); ws.push(w);
      }
      let c;
      if (!cands.length) {
        // 退路：取范围内离前音最近的合法音
        let best = null;
        for (let d = lo; d <= hi; d++) { const pc = mod(d, 7); if (allowPcs && !allowPcs.includes(pc)) continue; if (best === null || Math.abs(d - (prev ?? target)) < Math.abs(best - (prev ?? target))) best = d; }
        if (best === null) best = Math.round(target);
        c = { d: best, chrom: resolveChrom(best, ch), ct: isCT(ch, mod(best, 7)) };
      } else c = wpick(cands, ws);
      ev.notes = [{ deg: c.d, chrom: c.chrom }];
      ev.nct = !c.ct;
      if (prev !== null) lastInt = c.d - prev;
      prev = c.d; prevChrom = c.chrom; prevNCT = !c.ct && !strong;
    });
  });
  return prev;
}

/* ======================= 乐曲生成 ======================= */
// 超过重升/重降时改用等音拼写
function respell(d, a) {
  const midi = midiOf(d, a);
  if (Math.abs(a) <= 2) return { d, a, midi };
  const d2 = d + Math.sign(a);
  return { d: d2, a: midi - midiOf(d2, 0), midi };
}
function levelOf(li) { return LEVELS[li]; }
function pickKeyFor(L, p, li) {
  const ws = L.keys.map((k) => {
    const f = Math.abs(KEY_DEFS[k][3]);
    let w = L.newKeys.includes(k) ? 1 + 4 * p : 1;
    if (L.heavyKeys) w = 0.3 + Math.pow(f, li >= 10 ? 1.8 : 1.4) * (0.6 + p);
    return w;
  });
  return wpick(L.keys, ws);
}
function pickTimeFor(L, p, ei) {
  const base = { '4/4': 3, '3/4': 2, '2/4': 1.1, '6/8': 2, '12/8': 1.2 };
  const ws = L.times.map((t) => base[t] * ((L.newTimes || []).includes(t) ? 1 + 2 * p : 1));
  return wpick(L.times, ws);
}
function compatPattern(pat, ts) { return !COMPAT[pat] || COMPAT[pat].includes(ts); }
function pickPattern(L, tsName, avoid) {
  const o = {};
  for (const [k, w] of Object.entries(L.lhPat)) if (compatPattern(k, tsName) && k !== avoid) o[k] = w;
  if (!Object.keys(o).length) return 'halfRoot';
  return wpickObj(o);
}

function genExercise(li, ei, seed, forceBars) {
  seedRng(hash(seed, li * 101 + 7, ei * 37 + 3));
  const L = levelOf(li);
  const ov = (L.exercises && L.exercises[Math.floor(ei * L.exercises.length / EX_PER_LEVEL)]) || {};
  const p = ei / (EX_PER_LEVEL - 1);
  const keyName = ov.key || pickKeyFor(L, p, li);
  const key = makeKey(keyName);
  const tsName = ov.time || (ei === 0 && li > 0 ? L.times[0] : pickTimeFor(L, p, ei));
  const ts = TS[tsName];
  const nBars = forceBars || L.bars;
  const PL = nBars <= 8 ? nBars / 2 : 4;   // 乐句长度（小节）
  const tex = ov.tex || 'both';
  const maxLeap = ov.maxLeap ?? L.maxLeap;
  const piece = { li, ei, key, ts, tex, bars: [], level: L, p };

  /* ---- 1. 和声计划 ---- */
  const mode = key.mode;
  const ant = pickTier(ANT[mode], L.chordTier);
  const contrast = pickTier(CONTRAST[mode], L.chordTier);
  const types = nBars <= 8 ? ['ant', 'cons'] : nBars === 12 ? ['ant', 'contrast', 'cons'] : ['ant', 'cons', 'contrast', 'cons'];
  const tonic = mode === 'M' ? 'I' : 'i';
  // 后半句把旋律交给左手（同样的和声，换一只手唱）
  const swapCons = !!L.swap && tex === 'both' && chance(L.swap);
  const dom = chance(0.5) ? 'V7' : 'V';
  types.forEach((type, k) => {
    let syms, copy = [null, null, null, null];
    if (type === 'ant') syms = PL === 4 ? ant.slice() : PL === 3 ? [ant[0], pick([ant[1], ant[2]]), ant[3]] : [ant[0], ant[3]];
    else if (type === 'cons') {
      syms = PL === 4 ? [ant[0], ant[1], dom, tonic] : PL === 3 ? [ant[0], dom, tonic] : [dom, tonic];
      if (!swapCons) copy = PL === 4 ? [0, 1, null, null] : PL === 3 ? [0, null, null] : copy;
    } else syms = contrast.slice();
    for (let i = 0; i < PL; i++) {
      piece.bars.push({ len: ts.len, phrase: k, type, idx: i, copyOf: copy[i], cad: i === PL - 1 ? (type === 'cons' ? 'PAC' : 'HC') : null,
        spans: [{ start: 0, len: ts.len, sym: syms[i] }] });
    }
  });
  const split = L.split || 0, sec = L.sec || 0, borrow = L.borrow || 0;
  piece.bars.forEach((bar) => {
    if (bar.copyOf != null) return;
    const s = bar.spans[0];
    if (borrow && mode === 'M' && s.sym === 'IV' && chance(borrow)) s.sym = 'iv';
    if (!split) return;
    if (bar.type === 'cons' && bar.idx === PL - 2 && bar.idx > 0 && chance(split + 0.15)) {
      bar.spans = [{ start: 0, len: ts.split[0], sym: pick(mode === 'M' ? ['IV', 'ii'] : ['iv', 'iio']) }, { start: ts.split[0], len: ts.split[1], sym: s.sym }];
    } else if (bar.idx > 0 && bar.idx < PL - 1 && chance(split)) {
      const nx = NEXT[mode][s.sym];
      if (nx) bar.spans = [{ start: 0, len: ts.split[0], sym: s.sym }, { start: ts.split[0], len: ts.split[1], sym: pick(nx) }];
    }
  });
  if (sec) {
    for (let k = 0; k < types.length; k++) {
      const spans = [];
      piece.bars.forEach((b) => { if (b.phrase === k) b.spans.forEach((s) => spans.push({ s, b })); });
      for (let i = spans.length - 1; i >= 1; i--) {
        const tgt = spans[i].s.sym, prv = spans[i - 1];
        if (!SEC_TARGET[mode].includes(tgt) || prv.b.copyOf != null || prv.s.sym === tgt) continue;
        if (!chance(sec)) continue;
        if (prv.b.idx === 0 && prv.s.start === 0 && prv.b.spans.length === 1) {
          prv.b.spans = [{ start: 0, len: ts.split[0], sym: prv.s.sym }, { start: ts.split[0], len: ts.split[1], sym: 'V/' + tgt }];
        } else if (!(prv.b.idx === 0 && prv.s.start === 0)) prv.s.sym = 'V/' + tgt;
        else continue;
        break;
      }
    }
  }
  piece.bars.forEach((bar) => { if (bar.copyOf != null) bar.spans = clone(piece.bars[bar.copyOf].spans); });
  piece.bars.forEach((bar) => bar.spans.forEach((s) => { s.ch = chordFromSym(key, s.sym); }));

  /* ---- 2. 织体与伴奏音型 ---- */
  let pattern = pickPattern(L, tsName);
  const phraseInfo = types.map((type, k) => ({ type, melHand: 'rh', pattern, rhTex: 'single', rhPat: null }));
  phraseInfo.forEach((ph) => {
    const swapHere = ph.type === 'contrast' ? (L.swap && chance(L.swap)) : (ph.type === 'cons' && swapCons);
    if (ph.type === 'contrast' && li >= 4 && chance(0.4)) ph.pattern = pickPattern(L, tsName, pattern);
    if (swapHere) { ph.melHand = 'lh'; ph.rhPat = pick(ts.comp ? ['block3', 'alberti', 'waltz'] : ['block3', 'alberti', 'waltz', 'broken']); }
    if (L.tex && ph.melHand === 'rh') {
      const o = { single: 1 };
      for (const [k, v] of Object.entries(L.tex)) o[k] = v * 3;
      ph.rhTex = wpickObj(o);
    }
  });

  /* ---- 3. 节奏 ---- */
  const rhR = L.rh.map((d) => d - key.t4), lhR = L.lh.map((d) => d - key.t4);
  const fullRest = () => [{ pos: 0, dur: ts.len, rest: true, full: true, notes: [] }];
  types.forEach((type, k) => {
    const ph = phraseInfo[k];
    const busy = ph.melHand === 'rh' ? (BUSY[ph.pattern] || 0) : 1;
    const maxT = clamp(L.tier - (li >= 8 ? Math.max(0, busy - 1) : busy), 0, 7);
    const mA = ov.rhythms ? pick(ov.rhythms) : pickRhythm(tsName, maxT, p);
    const mB = ov.rhythms ? pick(ov.rhythms) : pickRhythm(tsName, maxT, p);
    piece.bars.forEach((bar, bi) => {
      if (bar.phrase !== k) return;
      let r;
      if (bar.copyOf != null) r = null;
      else if (bar.idx === PL - 1) r = bi === piece.bars.length - 1 ? (ov.rhythms ? pick(ov.rhythms.filter((x) => !/^q q q q$/.test(x))) || 'w' : pickFinal(tsName, maxT, p))
        : (ov.rhythms ? pick(ov.rhythms) : pickCad(tsName, maxT, p));
      else if (bar.idx === 0) r = mA;
      else if (bar.idx === 1) r = mB;
      else r = chance(0.5) ? mA : (ov.rhythms ? pick(ov.rhythms) : pickRhythm(tsName, maxT, p));
      bar.mel = r ? parseRhythm(r).evs : null;
    });
  });

  /* ---- 4. 旋律 ---- */
  let prevRH = null;
  types.forEach((type, k) => {
    const ph = phraseInfo[k];
    const idxs = piece.bars.map((b, i) => i).filter((i) => piece.bars[i].phrase === k);
    let range = ph.melHand === 'rh' ? rhR : [lhR[0] + 3, Math.min(lhR[1] + 1, 28 - key.t4 + 1)];
    if (tex === 'lh') range = lhR;
    idxs.forEach((i) => { const b = piece.bars[i]; b.melHand = (tex === 'lh') ? 'lh' : ph.melHand; b.m = b.mel ? b.mel : null; });
    // 先把节奏放进临时声部 m
    idxs.forEach((i) => { const b = piece.bars[i]; if (b.copyOf == null) b.m = clone(b.mel); });
    const last = fillLine(piece, idxs, 'm', range, { maxLeap, cad: piece.bars[idxs[idxs.length - 1]].cad, prev: ph.melHand === 'rh' ? prevRH : null, startTonic: li <= 1 });
    if (ph.melHand === 'rh') prevRH = last;
  });

  /* ---- 5. 分配声部 + 伴奏 ---- */
  const st = { level: li, t4: key.t4 }, stR = { level: li, t4: key.t4 };
  piece.bars.forEach((bar, bi) => {
    const ph = phraseInfo[bar.phrase];
    const isFinal = bi === piece.bars.length - 1;
    const mel = bar.m;
    if (tex === 'rh') { bar.rh = mel; bar.lh = fullRest(); return; }
    if (tex === 'lh') { bar.lh = mel; bar.rh = fullRest(); return; }
    if (tex === 'alt') {
      const lhTurn = Math.floor(bi / 2) % 2 === 1;
      if (lhTurn) { bar.lh = clone(mel); bar.lh.forEach((e) => e.notes.forEach((n) => { n.deg -= 7; })); bar.rh = fullRest(); }
      else { bar.rh = mel; bar.lh = fullRest(); }
      return;
    }
    if (bar.melHand === 'lh') {
      bar.lh = mel;
      const reg = [rhR[0] + 2, Math.min(rhR[1] - 2, rhR[0] + 11)];
      bar.rh = [];
      for (const s of bar.spans) bar.rh.push(...accSpan(isFinal ? 'final' : ph.rhPat, s, ts, reg, stR));
    } else {
      bar.rh = mel;
      bar.lh = [];
      const pat = isFinal ? 'final' : ph.pattern;
      if (pat === 'bassLine') {
        let r = '';
        for (let b = 0; b < ts.len; b += ts.beat) r += (ts.comp ? (chance(0.45) ? '8 8 8 ' : 'qd ') : (chance(li >= 8 ? 0.5 : 0.3) ? '8 8 ' : 'q ')) ;
        bar.lh = parseRhythm(r).evs;
      } else for (const s of bar.spans) bar.lh.push(...accSpan(pat, s, ts, lhR, st));
    }
  });
  // 低音线条（复调）——用旋律生成器填写
  phraseInfo.forEach((ph, k) => {
    if (ph.pattern !== 'bassLine' || ph.melHand !== 'rh' || tex !== 'both') return;
    const idxs = piece.bars.map((b, i) => i).filter((i) => piece.bars[i].phrase === k && i !== piece.bars.length - 1);
    fillLine(piece, idxs, 'lh', [lhR[0], lhR[0] + 9], { maxLeap: 4, bass: true });
  });

  /* ---- 6. 半音化装饰（经过音/辅助音） ---- */
  const chromP = L.chrom || 0;
  if (chromP) {
    const seq = [];
    piece.bars.forEach((bar, bi) => { const h = bar.melHand || 'rh'; bar[h].forEach((e) => { if (!e.rest) seq.push({ bar, bi, e, h }); }); });
    for (let i = 1; i + 1 < seq.length; i++) {
      const A = seq[i - 1].e.notes[0], B = seq[i].e.notes[0], C = seq[i + 1].e.notes[0];
      const { bar, e } = seq[i];
      if (ts.strong.includes(e.pos) || !e.nct || !chance(chromP)) continue;
      const sA = noteSemi(key, A.deg, A.chrom), sB = noteSemi(key, B.deg, B.chrom), sC = noteSemi(key, C.deg, C.chrom);
      let nc = null;
      if (A.deg === C.deg && B.deg === A.deg - 1 && sA - sB === 2) nc = B.chrom + 1;
      else if (A.deg === C.deg && B.deg === A.deg + 1 && sB - sA === 2 && chance(0.4)) nc = B.chrom - 1;
      else if (B.deg === C.deg - 1 && A.deg <= B.deg && sC - sB === 2 && (seq[i + 1].e.pos % ts.beat === 0)) nc = B.chrom + 1;
      if (nc === null) continue;
      if (Math.abs(key.sig[mod(key.t4 + B.deg, 7)] + nc) > (li >= 9 ? 2 : 1)) continue;
      // 与另一只手同时发声的同名音冲突则放弃
      const other = seq[i].h === 'rh' ? 'lh' : 'rh';
      const dB = key.t4 + B.deg;
      const clash = bar[other].some((o) => !o.rest && o.pos < e.pos + e.dur && o.pos + o.dur > e.pos && o.notes.some((n) => mod(key.t4 + n.deg, 7) === mod(dB, 7)));
      if (clash) continue;
      B.chrom = nc; e.chromatic = true;
    }
  }

  /* ---- 7. 右手织体：三六度、和弦、八度 ---- */
  piece.bars.forEach((bar) => {
    const ph = phraseInfo[bar.phrase];
    if (bar.melHand !== 'rh' || tex !== 'both' || ph.rhTex === 'single') return;
    const iv = ph.ivl ?? (ph.ivl = chance(0.6) ? 2 : 5);
    bar.rh.forEach((e) => {
      if (e.rest || e.chromatic || !e.notes.length) return;
      const m = e.notes[0].deg, ch = chordAt(bar, e.pos);
      const lowLim = rhR[0] - 2;
      let add = [];
      if (ph.rhTex === 'thirds') {
        if (e.dur >= 12 && chance(e.dur >= 24 ? 0.75 : 0.55)) add = [m - iv];
      } else if (ph.rhTex === 'chordal') {
        if (e.dur >= 24 && e.pos % ts.beat === 0 && !e.nct) {
          const below = tonesIn(ch, m - 7, m - 1, false).reverse();
          add = below.slice(0, L.chordNotes || 2);
        } else if (e.dur >= 12 && chance(0.4)) add = [m - iv];
      } else if (ph.rhTex === 'octaves') {
        if (e.dur >= 12) { add = [m - 7]; if (e.dur >= 24 && !e.nct && li >= 9) { const inner = tonesIn(ch, m - 6, m - 2, true); if (inner.length) add.push(pick(inner)); } }
      }
      add = add.filter((d) => d >= lowLim);
      for (const d of add) e.notes.push({ deg: d, chrom: resolveChrom(d, ch) });
    });
  });

  /* ---- 8. 转换为实际音高，并避免两手交叉 ---- */
  piece.bars.forEach((bar) => {
    for (const h of ['rh', 'lh']) for (const e of bar[h]) {
      const seen = new Set();
      e.notes = e.notes.filter((n) => { if (seen.has(n.deg)) return false; seen.add(n.deg); return true; })
        .map((n) => { const d = key.t4 + n.deg; const a = key.sig[mod(d, 7)] + n.chrom; return respell(d, a); })
        .sort((x, y) => x.d - y.d);
    }
    for (const h of ['rh', 'lh']) for (const e of bar[h]) if (!e.rest && !e.notes.length) e.rest = true;
    const accHand = bar.melHand === 'lh' ? 'rh' : 'lh';
    const melHand = accHand === 'rh' ? 'lh' : 'rh';
    for (const e of bar[accHand]) {
      if (e.rest) continue;
      const ov2 = bar[melHand].filter((o) => !o.rest && o.pos < e.pos + e.dur && o.pos + o.dur > e.pos);
      if (!ov2.length) continue;
      const shift = (n, k) => ({ d: n.d + 7 * k, a: n.a, midi: n.midi + 12 * k });
      const dedupe = (arr) => { const seen = new Set(); return arr.filter((n) => !seen.has(n.d) && seen.add(n.d)).sort((x, y) => x.d - y.d); };
      if (accHand === 'lh') {
        const lim = Math.min(...ov2.map((o) => o.notes[0].d));
        e.notes = dedupe(e.notes.map((n) => (n.d < lim ? n : n.d - 7 >= L.lh[0] - 3 ? shift(n, -1) : null)).filter((n) => n && n.d < lim));
      } else {
        const lim = Math.max(...ov2.map((o) => o.notes[o.notes.length - 1].d));
        e.notes = dedupe(e.notes.map((n) => (n.d > lim ? n : n.d + 7 <= L.rh[1] + 3 ? shift(n, 1) : null)).filter((n) => n && n.d > lim));
      }
      if (!e.notes.length) e.rest = true;
    }
  });

  /* ---- 9. 表情：力度、跳音、重音、指法 ---- */
  const dynSeq = { ant: ['mf', 'p', 'mp'], cons: ['mf', 'f', 'mp'], contrast: ['p', 'f', 'mp', 'mf'] };
  let lastDyn = null;
  piece.bars.forEach((bar, bi) => {
    const ph = phraseInfo[bar.phrase];
    if (L.dyn && bar.idx === 0) {
      let dy = pick(dynSeq[bar.type]); if (dy === lastDyn) dy = pick(dynSeq[bar.type]);
      if (dy !== lastDyn) { const first = bar.rh[0]; first.dyn = dy; lastDyn = dy; }
    }
    if (ph.stacc === undefined) ph.stacc = chance(L.stacc || 0);
    const mel = bar[bar.melHand || 'rh'];
    mel.forEach((e, i) => {
      if (e.rest) return;
      if (ph.stacc && (e.dur === 12 || e.dur === 24) && i < mel.length - 1 && !mel[i + 1].rest && chance(0.5)) e.art = 'a.';
      if (L.accent && !e.art && e.dur >= 24 && e.pos % ts.beat !== 0) e.art = 'a>';
      else if (L.accent && !e.art && ts.strong.includes(e.pos) && chance(0.06)) e.art = 'a>';
    });
  });
  if (L.finger) {
    for (const h of ['rh', 'lh']) {
      const first = []; for (const b of piece.bars.slice(0, 2)) for (const e of b[h]) if (!e.rest) first.push(e);
      if (!first.length) continue;
      const ds = first.map((e) => e.notes[0].d), lo = Math.min(...ds), hi = Math.max(...ds);
      if (hi - lo > 4) continue;
      const e0 = first[0], d0 = e0.notes[0].d;
      e0.finger = String(h === 'rh' ? d0 - lo + 1 : hi - d0 + 1);
    }
  }

  /* ---- 10. 篇幅：保证两行能清楚地放下 ---- */
  // 估算每小节宽度（与 VexFlow 实测相近），一行逻辑宽度不超过 ~1650（1366 屏宽约 0.8 倍缩放）
  if (!forceBars) {
    let est = 0;
    piece.bars.forEach((b) => {
      const on = new Set(); let acc = 0;
      for (const h of ['rh', 'lh']) for (const e of b[h]) { if (!e.rest) { on.add(e.pos); acc += e.notes.filter((n) => n.a !== key.sig[mod(n.d, 7)]).length; } }
      est += (34 + 24 * on.size + 7 * acc) * 1.06 + 26;
    });
    est /= piece.bars.length;
    const budget = S.lineBudget || 1550;
    const per = 150 + 4 * est <= budget ? 4 : 150 + 3 * est <= budget ? 3 : 2;
    if (per < 4) return genExercise(li, ei, seed, per * 2);
  }

  /* ---- 11. 速度与标题 ---- */
  // 以“每秒起音数”为难度目标来定速度：保证级别之间密度单调上升
  let onsets = 0;
  piece.bars.forEach((b) => { const on = new Set(); for (const h of ['rh', 'lh']) for (const e of b[h]) if (!e.rest) on.add(e.pos); onsets += on.size; });
  const perQuarter = onsets / (piece.bars.length * ts.len / 24);
  const nextBase = ONSET_RATE[li + 1] ?? ONSET_RATE[li] * 1.12;
  const target = lerp(ONSET_RATE[li], nextBase, clamp(p * 0.85 + (rnd() - 0.5) * 0.15, 0, 1));
  const bpm = clamp(target * 60 / Math.max(0.25, perQuarter), L.tempo[0] * 0.8, L.tempo[1]);
  piece.bpm = Math.max(44, Math.round(bpm / 2) * 2);
  piece.title = ov.title || '';
  piece.texName = tex === 'both' ? ({ whole: '长音', halfRoot: '根音五度', block2: '双音', block3: '柱式和弦', quarters: '四分低音', broken: '分解和弦', alberti: '阿尔贝蒂', alberti16: '十六分阿尔贝蒂', waltz: '圆舞曲', stride: '跨步低音', octaves: '八度', brokenOct: '分解八度', arp8: '琶音', arp16: '十六分琶音', triplet: '三连音琶音', bassLine: '复调低音' }[pattern] || '') : '';
  piece.swapped = phraseInfo.some((p2) => p2.melHand === 'lh');
  delete piece.level;
  piece.bars.forEach((b) => { delete b.m; delete b.mel; b.spans.forEach((s) => { s.chSym = s.sym; delete s.ch; }); });
  return piece;
}

/* ======================= 校验（测试用） ======================= */
function validatePiece(pc) {
  const errs = [];
  pc.bars.forEach((b, i) => {
    for (const h of ['rh', 'lh']) {
      let pos = 0;
      for (const e of b[h]) {
        if (e.pos !== pos) errs.push(`bar ${i} ${h} pos ${e.pos}!=${pos}`);
        if (!e.rest && !e.notes.length) errs.push(`bar ${i} ${h} empty note`);
        pos += e.dur;
      }
      if (pos !== b.len && !(b[h].length === 1 && b[h][0].full)) errs.push(`bar ${i} ${h} len ${pos}!=${b.len}`);
    }
  });
  return errs;
}

/* ======================= 全部乐谱 ======================= */
const S = {
  seed: 0, exs: [], levelStart: [], ev: [], bars: [], systems: [],
  cur: { ex: 0, bar: 0 },
  settings: { speed: 100, metro: false, sound: 'all', hand: 'both', loop: false, cont: true, scroll: true, kbd: true, vol: 80, scale: 100, follow: false, midiSound: false, countIn: 1, cnum: true, fing: true },
};
// 一行谱的逻辑宽度预算：触屏设备按横屏的长边计算，保证横屏时音符不会太小
function lineBudget() {
  const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  const w = coarse ? Math.max(screen.width || 0, screen.height || 0, window.innerWidth) : window.innerWidth;
  return clamp((w - 60) / 0.78, 900, 1550);
}
function generateAll(seed) {
  S.lineBudget = lineBudget();
  S.seed = seed; S.exs = []; S.levelStart = [];
  LEVELS.forEach((L, li) => {
    S.levelStart.push(S.exs.length);
    for (let ei = 0; ei < EX_PER_LEVEL; ei++) {
      const pc = genExercise(li, ei, seed);
      pc.gi = S.exs.length;
      S.exs.push(pc);
    }
  });
  buildTimeline();
}
function spt(ex) { return 60 / (ex.bpm * 24); }
function buildTimeline() {
  let T = 0; const ev = []; S.bars = [];
  S.exs.forEach((ex) => {
    const ts = ex.ts, k = spt(ex);
    ex.countInStart = T;
    // 学曲子模式的分页是同一首曲子，页与页之间不插预备拍（预备拍在开始播放时临时加）
    if (!ex.noCountIn) for (let c = 0; c < (S.settings.countIn || 1); c++) {
      for (let b = 0; b < ts.len; b += ts.beat) ev.push({ t0: T + b * k, kind: 'click', strong: b === 0, countIn: true, ex: ex.gi });
      T += ts.len * k;
    }
    ex.startT0 = T;
    ex.bars.forEach((bar, bi) => {
      bar.t0 = T; bar.t1 = T + bar.len * k; bar.ex = ex.gi; bar.bi = bi;
      S.bars.push(bar);
      const bts = bar.ts || ts;
      for (let b = 0; b < bar.len - 1e-6; b += bts.beat) ev.push({ t0: T + b * k, kind: 'click', strong: b === 0, ex: ex.gi });
      for (const h of ['rh', 'lh']) for (const e of bar[h]) {
        if (e.rest) continue;
        const melody = (bar.melHand || 'rh') === h || ex.tex !== 'both';
        const dynF = { p: 0.62, mp: 0.78, mf: 0.92, f: 1.08 };
        e.hand = h; e.t0 = T + e.pos * k; e.bar = bar;
        e.notes.forEach((n, ni) => {
          if (n.tieStop) return;   // 连音线的后半：不重新发声（前半的时值已经延长）
          let vel = (melody ? 0.82 : 0.52) * (ni < e.notes.length - 1 && melody ? 0.8 : 1);
          if (e.art === 'a>') vel *= 1.22;
          ev.push({ t0: e.t0, kind: 'note', midi: n.midi, dur0: (n.tieDur || e.dur) * k * (e.art === 'a.' ? 0.42 : 0.96), vel, hand: h, e, ex: ex.gi });
        });
      }
      T = bar.t1;
    });
    // 力度：从每句开头的记号向后传递
    let dyn = 'mf';
    ev.forEach((x) => { if (x.kind === 'note' && x.ex === ex.gi) { /* 由下面统一处理 */ } });
    ex.endT0 = T;
  });
  // 力度传递
  let curEx = -1, dyn = 'mf';
  const dynF = { p: 0.62, mp: 0.78, mf: 0.92, f: 1.08 };
  ev.sort((a, b) => a.t0 - b.t0 || (a.kind === 'click' ? -1 : 1));
  for (const x of ev) {
    if (x.kind !== 'note') continue;
    if (x.ex !== curEx) { curEx = x.ex; dyn = 'mf'; }
    if (x.e.hand === 'rh' && x.e.dyn) dyn = x.e.dyn;
    else { const rh0 = x.e.bar.rh[0]; if (rh0 && rh0.dyn && rh0.t0 !== undefined && rh0.t0 <= x.t0) dyn = rh0.dyn; }
    x.vel *= dynF[dyn];
  }
  S.ev = ev;
  S.totalT0 = T;
  // 起音点（用于跟随模式）
  const ons = [];
  S.exs.forEach((ex) => ex.bars.forEach((bar) => {
    const map = new Map();
    for (const h of ['rh', 'lh']) for (const e of bar[h]) { if (e.rest || e.notes.every((n) => n.tieStop)) continue; if (!map.has(e.pos)) map.set(e.pos, []); map.get(e.pos).push(e); }
    [...map.keys()].sort((a, b) => a - b).forEach((pos) => ons.push({ t0: bar.t0 + pos * spt(ex), ex: ex.gi, bar, pos, evs: map.get(pos) }));
  }));
  S.ons = ons;
}

/* ======================= 渲染 ======================= */
const ACC = { '-2': 'bb', '-1': 'b', '0': 'n', '1': '#', '2': '##' };
const DUR = { 96: 'w', 72: 'hd', 48: 'h', 36: 'qd', 24: 'q', 18: '8d', 12: '8', 6: '16', 8: '8' };
function keyStr(d) { return LETTERS[mod(d, 7)] + '/' + Math.floor(d / 7); }

// 空档（某个声部中间没有音的地方）用看不见的 GhostNote 占位，保证同一小节里各声部对齐
const GAP_VALS = [[96, 'w'], [48, 'h'], [24, 'q'], [12, '8'], [6, '16'], [3, '32'], [1.5, '64']];
function gapNotes(ticks) {
  const out = []; let r = ticks;
  for (const [v, c] of GAP_VALS) while (r >= v - 1e-6) { out.push(new VF.GhostNote({ duration: c })); r -= v; }
  return out;
}
// 休止符的纵向位置：单声部在中间，多声部时上声部靠上、下声部靠下
const REST_KEY = { treble: ['b/4', 'e/5', 'f/4'], bass: ['d/3', 'g/3', 'a/2'] };
function buildBarVF(ex, bar) {
  const ts = bar.ts || ex.ts;
  const ksig = (bar.key || ex.key).sig;
  const mk = (evs, clef, hand) => {
    const notes = []; const tg = {}; const voices = []; const beams = []; const tuplets = [];
    const byV = new Map();
    for (const e of evs) { const v = e.v || 0; if (!byV.has(v)) byV.set(v, []); byV.get(v).push(e); }
    const vids = [...byV.keys()].sort((a, b) => a - b);
    const multi = vids.length > 1;
    const acc = {};
    vids.forEach((vid, vi) => {
      const list = byV.get(vid).slice().sort((a, b) => a.pos - b.pos);
      const tick = []; let pos = 0;
      for (const e of list) {
        if (e.pos > pos + 1e-6) tick.push(...gapNotes(e.pos - pos));
        let sn;
        const code0 = e.code || DUR[e.dur];
        const base = code0.replace(/d+$/, '');
        const dots = e.dots ?? (code0.length - base.length);
        const dstr = base + 'd'.repeat(dots);
        const rk = REST_KEY[clef] || REST_KEY.treble;
        if (e.rest) {
          const full = e.full && list.length === 1;
          sn = new VF.StaveNote({ clef, keys: [e.restKey || rk[multi ? (vi === 0 ? 1 : 2) : 0]], duration: (full ? 'w' : dstr) + 'r', align_center: !!full });
          if (!full) for (let k = 0; k < dots; k++) VF.Dot.buildAndAttach([sn], { all: true });
        } else {
          const opt = { clef, keys: e.notes.map((n) => keyStr(n.d)), duration: dstr };
          if (multi) opt.stem_direction = vi === 0 ? 1 : -1; else opt.auto_stem = true;
          sn = new VF.StaveNote(opt);
          e.notes.forEach((n, i) => {
            if (n.acc !== undefined) { if (n.acc) sn.addModifier(new VF.Accidental(n.acc), i); return; }   // 导入的曲谱：照原谱标的临时记号
            const cur = (n.d in acc) ? acc[n.d] : ksig[mod(n.d, 7)];
            if (n.a !== cur) { sn.addModifier(new VF.Accidental(ACC[n.a]), i); acc[n.d] = n.a; }
          });
          for (let k = 0; k < dots; k++) VF.Dot.buildAndAttach([sn], { all: true });
        }
        e.sn = sn; notes.push(sn); tick.push(sn);
        if (e.tup) { const key = vi + ':' + e.tup; (tg[key] = tg[key] || []).push(e); }
        pos = Math.max(pos, e.pos + e.dur);
      }
      // 连音（三连音等）要在连符杠之前建：它会改变音符的时值，影响符杠分组
      for (const [key, g] of Object.entries(tg)) {
        if (!key.startsWith(vi + ':')) continue;
        const t0 = g[0];
        // 导入的曲谱：右手的连音数字写在谱表上方、左手写在下方，免得两手的数字挤在两行谱表之间重叠
        if (t0.tupN) { const tp = new VF.Tuplet(g.map((e) => e.sn), { num_notes: t0.tupN, notes_occupied: t0.tupM, ratioed: false, location: hand === 'rh' ? VF.Tuplet.LOCATION_TOP : VF.Tuplet.LOCATION_BOTTOM }); tp._imp = hand; tuplets.push(tp); }
        else if (g.length === 3) tuplets.push(new VF.Tuplet(g.map((e) => e.sn), { num_notes: 3, notes_occupied: 2, bracketed: false, ratioed: false }));
      }
      const voice = new VF.Voice({ num_beats: ts.n, beat_value: ts.d }).setMode(VF.Voice.Mode.SOFT).addTickables(tick);
      voices.push(voice);
      const vnotes = tick.filter((t) => t instanceof VF.StaveNote);
      const opt = { groups: [ts.comp ? new VF.Fraction(3, 8) : new VF.Fraction(1, 4)] };
      if (multi) opt.maintain_stem_directions = true;
      try { beams.push(...VF.Beam.generateBeams(vnotes, opt)); } catch (er) { }
      // 连好符杠后再决定括号：数字正好在符杠那一侧就不要括号，否则加括号标出是哪几个音
      for (const tp of tuplets) {
        if (!tp._imp || tp._bk) continue; tp._bk = 1;
        const ns = tp.getNotes ? tp.getNotes() : tp.notes;
        const beamed = ns.every((n) => n.hasBeam && n.hasBeam());
        const side = ns[0].getStemDirection() === 1 ? VF.Tuplet.LOCATION_TOP : VF.Tuplet.LOCATION_BOTTOM;
        const want = tp._imp === 'rh' ? VF.Tuplet.LOCATION_TOP : VF.Tuplet.LOCATION_BOTTOM;
        tp.setTupletLocation(want);   // 连符杠时 VexFlow 会把位置改回符杠一侧，这里再设回来
        tp.setBracketed(!(beamed && side === want));
      }
    });
    // 修饰：跳音、重音、力度、指法（在符干方向确定后）
    for (const e of evs) {
      const sn = e.sn;
      if (e.rest) { if (e.dyn) sn.addModifier(dynAnno(e.dyn), 0); continue; }
      const up = sn.getStemDirection() === 1;
      if (e.art) sn.addModifier(new VF.Articulation(e.art).setPosition(up ? VF.Modifier.Position.BELOW : VF.Modifier.Position.ABOVE), 0);
      if (e.dyn) sn.addModifier(dynAnno(e.dyn), 0);
      if (e.finger) sn.addModifier(new VF.FretHandFinger(e.finger).setPosition(hand === 'rh' ? VF.Modifier.Position.ABOVE : VF.Modifier.Position.BELOW), hand === 'rh' ? e.notes.length - 1 : 0);
    }
    return { voices, beams, tuplets, notes };
  };
  const T = mk(bar.rh, (bar.clef && bar.clef.rh) || 'treble', 'rh'), B = mk(bar.lh, (bar.clef && bar.clef.lh) || 'bass', 'lh');
  const fmt = new VF.Formatter();
  fmt.joinVoices(T.voices); fmt.joinVoices(B.voices);
  const minW = fmt.preCalculateMinTotalWidth([...T.voices, ...B.voices]);
  bar.vf = { T, B, fmt, minW };
}
function dynAnno(t) {
  return new VF.Annotation(t).setFont('Times New Roman', 15, 'bold', 'italic').setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM);
}
const modsCache = {};
function modsWidth(ex, withTime) {
  const k = ex.key.name + '|' + (withTime ? ex.ts.name : '');
  if (modsCache[k]) return modsCache[k];
  const s = new VF.Stave(0, 0, 600); s.addClef('treble').addKeySignature(ex.key.name); if (withTime) s.addTimeSignature(ex.ts.name);
  const s2 = new VF.Stave(0, 0, 600); s2.addClef('bass').addKeySignature(ex.key.name); if (withTime) s2.addTimeSignature(ex.ts.name);
  return (modsCache[k] = Math.max(s.getNoteStartX(), s2.getNoteStartX()) + 4);
}
// 每首练习占一屏：可用高度 = 窗口高度 − 顶栏 − 屏幕键盘
function pageMetrics() {
  return { pageH: Math.max(200, $('wrap').clientHeight) };
}
function renderAll(progressCb) {
  const score = document.getElementById('score');
  score.querySelectorAll('.ex').forEach((n) => n.remove());
  S.systems = [];
  const { pageH } = pageMetrics();
  document.documentElement.style.setProperty('--pageH', pageH + 'px');
  const cw = score.clientWidth;
  const nLines = cw < 700 && window.innerHeight > window.innerWidth ? 4 : 2;   // 只有竖屏窄屏才每屏 4 行
  S.lay = { cw, pageH, nLines };
  S.rendered = new Set();
  if (S.io) S.io.disconnect();
  S.exs.forEach((ex) => {
    const div = document.createElement('section'); div.className = 'ex'; div.id = 'ex' + ex.gi;
    const tm = ex.ts.comp ? `♩. = ${Math.round(ex.bpm / 1.5)}` : `♩ = ${ex.bpm}`;
    if (ex.learn) {
      const tags = (ex.pageIdx === 0 ? [ex.key.cn, ex.ts.name, tm] : []).map((t) => `<span class="tag">${t}</span>`).join('');
      div.innerHTML = `<div class="ex-head"><div class="ex-line"><span class="ex-no"><span class="lv">${escHtml(ex.title)}</span> 第 ${ex.barFrom}–${ex.barTo} 小节<small>/${ex.nBarsTotal}</small></span>${tags}<span class="ex-score" id="sc${ex.gi}"></span></div></div><div class="ex-body"></div>`;
    } else {
      const li = ex.li, ei = ex.ei, L = LEVELS[li];
      const tags = [ex.key.cn, ex.ts.name, tm, ex.texName, ex.swapped ? '左手旋律' : ''].filter(Boolean).map((t) => `<span class="tag">${t}</span>`).join('');
      const lvName = li === 0 ? '入门' : L.name;
      const banner = ei === 0 ? `<div class="lvl-banner"><b>${lvName}</b><span class="en">${L.en}</span><span>${L.desc}</span></div>` : '';
      div.innerHTML = `<div class="ex-head">${banner}<div class="ex-line"><span class="ex-no"><span class="lv">${lvName}</span> 练习 ${ei + 1}<small>/${EX_PER_LEVEL}</small></span>${ex.title ? `<span class="ex-title">${ex.title}</span>` : ''}${tags}<span class="ex-score" id="sc${ex.gi}"></span></div></div><div class="ex-body"></div>`;
    }
    score.appendChild(div);
  });
  // 一共几百首，全部画出来手机吃不消：只画当前页附近的，滑到哪里画到哪里
  S.io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) ensureRendered(+en.target.id.slice(2));
  }, { root: $('wrap'), rootMargin: '150% 0px' });
  score.querySelectorAll('.ex').forEach((n) => S.io.observe(n));
  progressCb && progressCb(1);
  return Promise.resolve();
}
const KEEP_RENDERED = 14;
function ensureRendered(gi) {
  const ex = S.exs[gi]; if (!ex || S.rendered.has(gi)) return;
  const div = document.getElementById('ex' + gi); if (!div) return;
  const { cw, pageH, nLines } = S.lay;
  renderExercise(ex, div, cw, pageH, nLines, ex.li);
  S.rendered.add(gi);
  computeSystemGeometry(ex);
  if (S.rendered.size > KEEP_RENDERED) pruneRendered(gi);
}
// 按滚动位置算出正在看的是第几首
function visibleEx() {
  const a = document.getElementById('ex0'), b = document.getElementById('ex1');
  const step = a && b ? b.offsetTop - a.offsetTop : S.lay.pageH;
  return clamp(Math.round($('wrap').scrollTop / Math.max(1, step)), 0, S.exs.length - 1);
}
// 离当前页太远的谱面清掉（需要时再画）
function pruneRendered(justDrawn) {
  const vis = visibleEx();
  const keep = [vis, justDrawn, S.cur.ex, P.playing ? P.curEx : null, P.playing ? P.visEx : null].filter((x) => x != null);
  const near = (gi) => keep.some((k) => Math.abs(gi - k) <= 3);
  const far = [...S.rendered].filter((gi) => !near(gi)).sort((x, y) => Math.abs(y - vis) - Math.abs(x - vis));
  while (S.rendered.size > KEEP_RENDERED && far.length) unrender(far.shift());
}
function unrender(gi) {
  const ex = S.exs[gi];
  S.systems.forEach((s, i) => { if (s && s.ex === gi) S.systems[i] = null; });
  ex.bars.forEach((b) => { b.sysIdx = undefined; b.anchors = null; ['rh', 'lh'].forEach((h) => b[h].forEach((e) => { e.el = null; e.sn = null; })); });
  const body = document.querySelector('#ex' + gi + ' .ex-body'); if (body) body.innerHTML = '';
  S.rendered.delete(gi);
  if (cursor.lastSys != null && !S.systems[cursor.lastSys]) cursor.lastSys = -1;
}
// 一行（大谱表）的纵向尺寸（逻辑单位）
function lineGeom(ex, ln) {
  let rhMax = 38, rhMin = 30, lhMax = 26, lhMin = 18, dyn = false;
  ln.forEach((i) => {
    const b = ex.bars[i];
    // 上谱表用低音谱号、下谱表用高音谱号时，音在谱表上的位置差 12 个音级
    const offR = b.clef && b.clef.rh === 'bass' ? 12 : 0, offL = b.clef && b.clef.lh === 'treble' ? -12 : 0;
    b.rh.forEach((e) => { if (e.dyn) dyn = true; e.notes.forEach((n) => { rhMax = Math.max(rhMax, n.d + offR); rhMin = Math.min(rhMin, n.d + offR); }); });
    b.lh.forEach((e) => e.notes.forEach((n) => { lhMax = Math.max(lhMax, n.d + offL); lhMin = Math.min(lhMin, n.d + offL); }));
  });
  // VexFlow 的第一线在 y+40；按实际音域留出上下空间
  let above = Math.max(22, (rhMax - 38) * 5 + 20);
  let below = Math.max(18, (18 - lhMin) * 5 + 20);
  // 导入的曲谱：右手连音数字写在上方、左手写在下方，要多留出位置，免得和上下两行挤在一起
  if (ex.learn) {
    const has = (h) => ln.some((i) => ex.bars[i][h].some((e) => e.tupN));
    if (has('rh')) above += 26;
    if (has('lh')) below += 28;
  }
  {
    // 指法数字：右手写在上方、左手写在下方（和弦的几个数字竖着叠）
    const fgN = (h) => Math.max(0, ...ln.map((i) => Math.max(0, ...ex.bars[i][h].map((e) => (e.fgShow ? e.fgShow.filter(Boolean).length : 0)))));
    if (fgN('rh')) above += 4 + 11 * fgN('rh');
    if (fgN('lh')) below += 4 + 11 * fgN('lh');
  }
  const gap = Math.min(150, 44 + Math.max(0, 30 - rhMin) * 5 + Math.max(0, lhMax - 26) * 5 + (dyn ? 16 : 0));
  const trebleY = above - 40, bassY = trebleY + 40 + gap;
  return { trebleY, bassY, H: above + 80 + gap + below };
}
function renderExercise(ex, div, cw, pageH, nLines, li) {
  if (!ex.learn) fgSightApply(ex, S.settings.fing !== false);
  ex.bars.forEach((bar) => buildBarVF(ex, bar));
  const body = div.querySelector('.ex-body');
  const minMW = li <= 2 ? 130 : 100;
  const widths = ex.bars.map((b) => Math.max(minMW, b.vf.minW * clamp(1.5 - b.vf.minW / 900, 1.06, 1.45) + 26));
  const mods0 = modsWidth(ex, true), mods1 = modsWidth(ex, false);
  // 固定行数：每行小节数相同
  const per = Math.ceil(ex.bars.length / nLines);
  const lines = [];
  for (let i = 0; i < ex.bars.length; i += per) lines.push([...Array(Math.min(per, ex.bars.length - i)).keys()].map((k) => i + k));
  const need = lines.map((ln, k) => (k === 0 ? mods0 : mods1) + ln.reduce((a, i) => a + widths[i], 0) + 18);
  const geo = lines.map((ln) => lineGeom(ex, ln));
  const headH = div.querySelector('.ex-head').offsetHeight;
  const availH = pageH - headH - 18;
  const sumH = geo.reduce((a, g) => a + g.H, 0) + (lines.length - 1) * 6;
  // 默认占满一屏（宽、高都放得下的最大尺寸），“谱面大小”按比例缩小
  const zoom = clamp(Math.min(2, (cw - 8) / Math.max(...need), availH / sumH) * (S.settings.scale || 100) / 100, 0.4, 3);
  const W = (cw - 8) / zoom - 18;
  lines.forEach((ln, lnIdx) => {
    const first = lnIdx === 0;
    const mods = first ? mods0 : mods1;
    const sum = ln.reduce((a, i) => a + widths[i], 0);
    const scale = (W - mods) / sum;
    const { trebleY, bassY, H } = geo[lnIdx];
    const sys = document.createElement('div'); sys.className = 'system';
    body.appendChild(sys);
    const renderer = new VF.Renderer(sys, VF.Renderer.Backends.SVG);
    renderer.resize(Math.ceil((W + 16) * zoom), Math.ceil(H * zoom));
    const ctx = renderer.getContext();
    ctx.scale(zoom, zoom);
    let x = 12;
    const sysObj = { el: sys, ex: ex.gi, bars: ln.map((i) => ex.bars[i]), zoom, trebleTop: trebleY + 40, bassBot: bassY + 80, H };
    ln.forEach((i, k) => {
      const bar = ex.bars[i];
      const w = widths[i] * scale + (k === 0 ? mods : 0);
      const top = new VF.Stave(x, trebleY, w), bot = new VF.Stave(x, bassY, w);
      const prev = ex.bars[i - 1] || ex.prevBar;
      const clefOf = (b, h) => (b && b.clef && b.clef[h]) || (h === 'rh' ? 'treble' : 'bass');
      const keyOf = (b) => ((b && b.key) || ex.key).name, tsOf = (b) => ((b && b.ts) || ex.ts).name;
      if (k === 0) {
        top.addClef(clefOf(bar, 'rh')).addKeySignature(keyOf(bar)); bot.addClef(clefOf(bar, 'lh')).addKeySignature(keyOf(bar));
        const showTs = ex.learn ? (first && ex.showTs) || (prev && tsOf(prev) !== tsOf(bar)) : first;
        if (showTs) { top.addTimeSignature(tsOf(bar)); bot.addTimeSignature(tsOf(bar)); }
        if (!first || ex.learn) top.setMeasure(bar.num || i + 1);
      } else {
        top.setBegBarType(VF.Barline.type.NONE); bot.setBegBarType(VF.Barline.type.NONE);
        // 行中间换谱号、调号、拍号（只有导入的曲谱会出现）
        if (clefOf(prev, 'rh') !== clefOf(bar, 'rh')) top.addClef(clefOf(bar, 'rh'), 'small');
        if (clefOf(prev, 'lh') !== clefOf(bar, 'lh')) bot.addClef(clefOf(bar, 'lh'), 'small');
        if (keyOf(prev) !== keyOf(bar)) { top.addKeySignature(keyOf(bar), keyOf(prev)); bot.addKeySignature(keyOf(bar), keyOf(prev)); }
        if (tsOf(prev) !== tsOf(bar)) { top.addTimeSignature(tsOf(bar)); bot.addTimeSignature(tsOf(bar)); }
      }
      const isEnd = i === ex.bars.length - 1;
      if (isEnd) { top.setEndBarType(VF.Barline.type.END); bot.setEndBarType(VF.Barline.type.END); }
      top.setContext(ctx); bot.setContext(ctx);
      const sx = Math.max(top.getNoteStartX(), bot.getNoteStartX());
      top.setNoteStartX(sx); bot.setNoteStartX(sx);
      top.draw(); bot.draw();
      if (k === 0) {
        new VF.StaveConnector(top, bot).setType('brace').setContext(ctx).draw();
        new VF.StaveConnector(top, bot).setType('singleLeft').setContext(ctx).draw();
      }
      new VF.StaveConnector(top, bot).setType(isEnd ? 'boldDoubleRight' : 'singleRight').setContext(ctx).draw();
      const { T, B, fmt } = bar.vf;
      T.notes.forEach((n) => n.setStave(top)); B.notes.forEach((n) => n.setStave(bot));
      const noteW = top.getNoteEndX() - sx - 14;
      fmt.format([...T.voices, ...B.voices], Math.max(30, noteW));
      // 每只手画在自己的组里（单手练习时另一只手画成浅色）
      for (const [h, V, st] of [['rh', T, top], ['lh', B, bot]]) {
        ctx.openGroup('h' + h);
        V.voices.forEach((v) => v.draw(ctx, st));
        V.beams.forEach((b) => b.setContext(ctx).draw());
        V.tuplets.forEach((t) => t.setContext(ctx).draw());
        drawFingerings(ctx, bar[h], h, st, V.tuplets);
        ctx.closeGroup();
      }
      // 光标锚点：每个起音位置的 x
      const pts = new Map();
      for (const h of ['rh', 'lh']) for (const e of bar[h]) {
        const sn = e.sn; let cx;
        if (e.full) continue;
        try { cx = e.rest ? sn.getAbsoluteX() + 6 : (sn.getNoteHeadBeginX() + sn.getNoteHeadEndX()) / 2; } catch (er) { cx = sn.getAbsoluteX(); }
        if (!pts.has(e.pos) || h === 'rh') pts.set(e.pos, cx);
        e.el = e.rest ? null : sn.getSVGElement();
      }
      if (!pts.has(0)) pts.set(0, sx + 12);
      const anchors = [...pts.entries()].sort((a, b) => a[0] - b[0]);
      anchors.push([bar.len, x + w - 6]);
      // 同一行里，上一小节的终点接到这一小节第一个音上：光标在最后一个音的时值里匀速越过小节线，不在小节线处跳
      if (ancPrev && ancPrev.sys === S.systems.length && ancPrev.ex === ex) ancPrev.a[ancPrev.a.length - 1][1] = anchors[0][1];
      ancPrev = { a: anchors, sys: S.systems.length, ex };
      bar.anchors = anchors; bar.sysIdx = S.systems.length; bar.x0 = x; bar.x1 = x + w;
      x += w;
      bar.vf = null; // 释放
    });
    drawTies(ex, ln, ctx);
    sysObj.idx = S.systems.length;
    S.systems.push(sysObj);
  });
  ex.zoom = zoom;
  if (ex.learn) learnAfterRender(ex);
}
// 指法数字（学曲子模式）：右手在音符上方、左手在下方，躲开符干、符杠和连音数字
function drawFingerings(ctx, evs, h, stave, tuplets) {
  const up = h === 'rh';
  // 连音数字（和括号）的位置：指法要写到它的外面
  const tupY = new Map();
  for (const tp of tuplets || []) { try { const y = tp.getYPosition(); for (const n of (tp.getNotes ? tp.getNotes() : tp.notes)) tupY.set(n, y); } catch (er) { } }
  for (const e of evs) {
    if (!e.fgShow || !e.sn) continue;
    const fs = []; e.fgShow.forEach((f) => { if (f) fs.push(f); });
    if (!fs.length) continue;
    let cx, y0, y1;
    try {
      cx = (e.sn.getNoteHeadBeginX() + e.sn.getNoteHeadEndX()) / 2;
      const ys = e.sn.getYs(); y0 = Math.min(...ys) - 5; y1 = Math.max(...ys) + 5;
      if (e.sn.hasStem()) { const se = e.sn.getStemExtents(); y0 = Math.min(y0, se.topY, se.baseY); y1 = Math.max(y1, se.topY, se.baseY); }
    } catch (er) { continue; }
    if (tupY.has(e.sn)) { const ty = tupY.get(e.sn); if (up) y0 = Math.min(y0, ty - 9); else y1 = Math.max(y1, ty + 9); }
    ctx.save(); ctx.setFont('Arial', 12, 'bold'); ctx.setFillStyle('#1d5fd6');   // 蓝色：和连音的 3 区分开
    if (up) { let y = Math.min(y0, stave.getYForLine(0)) - 4; for (const f of fs) { ctx.fillText(String(f), cx - 3, y); y -= 11; } }
    else { let y = Math.max(y1, stave.getYForLine(4)) + 12; for (const f of fs.reverse()) { ctx.fillText(String(f), cx - 3, y); y += 11; } }
    ctx.restore();
  }
}
// 连音线：同一行内画完整的；跨行、跨页的两头各画半条
function drawTies(ex, ln, ctx) {
  const inLine = new Set(ln.map((i) => ex.bars[i]));
  for (const h of ['rh', 'lh']) { ctx.openGroup('h' + h); for (const i of ln) for (const e of ex.bars[i][h]) {
    if (e.rest || !e.sn) continue;
    e.notes.forEach((n, ni) => {
      try {
        if (n.tieTo) {
          const t = n.tieTo;
          if (inLine.has(t.e.bar) && t.e.sn) new VF.StaveTie({ first_note: e.sn, last_note: t.e.sn, first_indices: [ni], last_indices: [t.i] }).setContext(ctx).draw();
          else new VF.StaveTie({ first_note: e.sn, last_note: null, first_indices: [ni], last_indices: [ni] }).setContext(ctx).draw();
        }
        if (n.tieFrom && !inLine.has(n.tieFrom.e.bar)) new VF.StaveTie({ first_note: null, last_note: e.sn, first_indices: [ni], last_indices: [ni] }).setContext(ctx).draw();
      } catch (er) { }
    });
  } ctx.closeGroup(); }
}
function updateHandDim() { const h = S.settings.hand; document.body.classList.toggle('dim-lh', h === 'rh'); document.body.classList.toggle('dim-rh', h === 'lh'); }
function computeSystemGeometry(ex) {
  S.systems.forEach((s) => {
    if (!s || (ex && s.ex !== ex.gi)) return;
    s.top = s.el.offsetTop;
    s.t0 = s.bars[0].t0; s.t1 = s.bars[s.bars.length - 1].t1;
    if (s.bars[0].bi === 0) s.t0 = S.exs[s.ex].countInStart;
  });
}

/* ======================= 音频 ======================= */
// iOS：静音开关打开时 Web Audio 默认无声。声明为“媒体播放”，并在手指触发时播放一段无声音频以解锁
let _iosAudio = null;
function unlockIOSAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }
  if (_iosAudio) return;
  try {
    const n = 2205, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 22050, true); v.setUint32(28, 22050, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    _iosAudio = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    _iosAudio.loop = true; _iosAudio.setAttribute('playsinline', '');
    const pr = _iosAudio.play(); if (pr && pr.catch) pr.catch(() => { });
  } catch (e) { }
}

const AU = {
  ctx: null, master: null, buffers: {}, ready: false, live: [],
  async init() {
    unlockIOSAudio();
    if (this.ctx) { if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { } } return; }
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = new C({ latencyHint: 'interactive' });
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { } }
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = this.ctx.createGain(); this.master.gain.value = S.settings.vol / 100;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    try {
      const entries = Object.entries(window.PIANO_SAMPLES || {});
      await Promise.all(entries.map(async ([m, b64]) => {
        const bin = atob(b64); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        this.buffers[m] = await new Promise((res, rej) => this.ctx.decodeAudioData(u.buffer, res, rej));
      }));
      this.ready = entries.length > 0;
    } catch (e) { console.warn('采样解码失败，改用合成音色', e); this.ready = false; }
  },
  setVol(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); },
  note(midi, when, dur, vel) {
    const c = this.ctx; if (!c) return;
    const g = c.createGain(); g.connect(this.master);
    let src;
    const v = clamp(vel, 0.05, 1.3);
    if (this.ready) {
      const base = clamp(Math.round(midi / 3) * 3, 21, 108);
      src = c.createBufferSource(); src.buffer = this.buffers[base];
      src.playbackRate.value = Math.pow(2, (midi - base) / 12);
      g.gain.setValueAtTime(v * v * 1.1, when);
      src.connect(g);
    } else {
      src = c.createOscillator(); src.type = 'triangle'; src.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      src.connect(lp); lp.connect(g);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(v * 0.5, when + 0.008);
      g.gain.exponentialRampToValueAtTime(v * 0.18, when + 0.6);
    }
    const end = when + Math.max(0.06, dur);
    g.gain.setTargetAtTime(0, end, 0.09);
    src.start(when); src.stop(end + 0.8);
    const rec = { src, g, end: end + 0.8 };
    this.live.push(rec);
    if (this.live.length > 400) this.live = this.live.filter((r) => r.end > c.currentTime);
  },
  click(when, strong) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = strong ? 1760 : 1180;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(strong ? 0.22 : 0.13, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.05);
    o.connect(g); g.connect(this.master); o.start(when); o.stop(when + 0.07);
  },
  stopAll() {
    const c = this.ctx; if (!c) return; const now = c.currentTime;
    for (const r of this.live) { try { r.g.gain.cancelScheduledValues(now); r.g.gain.setTargetAtTime(0, now, 0.03); r.src.stop(now + 0.25); } catch (e) { } }
    this.live = [];
  },
};

/* ======================= 播放引擎 ======================= */
const P = {
  playing: false, mode: 'play', anchors: [], nextIdx: 0, timer: null, stopAt: null, curEx: 0, vq: [], elCount: new Map(), keyCount: new Map(),
  synthetic: [],
};
function factor() { return S.settings.speed / 100; }
function ctxTimeOf(t0) { const a = P.anchors[P.anchors.length - 1]; return a.ctx + (t0 - a.t0) / a.f; }
function posT0(now) {
  let a = P.anchors[0];
  for (const x of P.anchors) if (x.ctx <= now) a = x;
  return a.t0 + (now - a.ctx) * a.f;
}
function lowerBound(arr, t0) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t0 < t0) lo = m + 1; else hi = m; } return lo; }
function handPlays(h) { const s = S.settings.sound; if (s === 'none') return false; if (s === 'all') return true; const mine = S.settings.hand === 'both' || S.settings.hand === h; return s === 'mine' ? mine : !mine; }
function practiceHand(h) { return S.settings.hand === 'both' || S.settings.hand === h; }

async function startPlay() {
  await AU.init();
  if (LM.active) return learnStartPlay();
  const { ex: exI, bar: bI } = S.cur;
  const ex = S.exs[exI];
  P.curEx = exI; P.visEx = exI; P.stopAt = null; P.hold = null; P.pendingReset = null; P.vq = []; clearHighlights();
  if (S.settings.scroll) flipTo(exI);
  resetScore(exI, ex.bars[bI].t0);
  if (S.settings.follow && MIDI.connected) return startFollow();
  P.mode = 'play';
  const now = AU.ctx.currentTime + 0.12;
  let startT0;
  if (bI === 0) startT0 = ex.countInStart;
  else {
    const bar = ex.bars[bI]; const k = spt(ex);
    startT0 = bar.t0 - ex.ts.len * k;
    for (let b = 0; b < ex.ts.len; b += ex.ts.beat) AU.click(now + (b * k) / factor(), b === 0);
    P.countIn = { from: startT0, to: bar.t0, ex: exI, bar };
  }
  P.anchors = [{ ctx: now, t0: startT0, f: factor() }];
  P.startT0 = startT0;
  P.nextIdx = lowerBound(S.ev, bI === 0 ? startT0 : ex.bars[bI].t0);
  P.playing = true;
  P.timer = setInterval(schedule, 25);
  schedule();
  updatePlayBtn();
}
function stopPlay(keepPos = true) {
  if (!P.playing) return;
  if (keepPos && P.mode === 'play' && AU.ctx) {
    const t = posT0(AU.ctx.currentTime);
    const b = P.countIn && t < P.countIn.to ? P.countIn.bar : locateBar(t);
    if (b) S.cur = { ex: b.ex, bar: b.bi };
  }
  P.playing = false; clearInterval(P.timer); P.timer = null; P.countIn = null;
  if (toast.sticky) { clearTimeout(toast._t); toast._t = setTimeout(toastUnstick, 10000); }
  if (FOL.timer) { clearTimeout(FOL.timer); FOL.timer = null; }
  AU.stopAll(); P.vq = []; clearHighlights();
  updatePlayBtn(); placeIdleCursor();
}
function schedule() {
  if (!P.playing || P.mode !== 'play') return;
  const horizon = AU.ctx.currentTime + 0.15;
  while (P.nextIdx < S.ev.length) {
    const e = S.ev[P.nextIdx];
    const ex = S.exs[P.curEx];
    if (LM.active && e.t0 >= LM.endT0 - 1e-6) { if (learnWrap()) continue; return; }
    if (e.t0 >= ex.endT0 - 1e-6) {
      if (LM.active) { P.curEx = Math.min(P.curEx + 1, S.exs.length - 1); continue; }
      if (S.settings.loop) {
        const at = ctxTimeOf(ex.endT0);
        P.anchors.push({ ctx: at, t0: ex.startT0, f: P.anchors[P.anchors.length - 1].f });
        P.nextIdx = lowerBound(S.ev, ex.startT0);
        P.pendingReset = { at, ex: ex.gi };
        continue;
      }
      if (!S.settings.cont) { if (P.stopAt === null) P.stopAt = ctxTimeOf(ex.endT0) + 0.3; return; }
      if (P.stopAt !== null) return;
      const last = P.curEx === S.exs.length - 1;
      if (exPct(ex.gi) === null) {   // 没有评分（没接 MIDI 键盘）：照旧直接接下一首
        if (last) { P.stopAt = ctxTimeOf(ex.endT0) + 0.3; return; }
        P.curEx++;
        continue;
      }
      // 有评分：等这一首真正弹完再看正确率，光标先停在末尾
      const at = ctxTimeOf(ex.endT0);
      if (AU.ctx.currentTime < at) { P.hold = { t0: ex.endT0, until: Infinity }; return; }
      const pass = exPass(ex.gi);
      if (pass && last) { P.stopAt = AU.ctx.currentTime + 0.3; return; }
      const c = AU.ctx.currentTime + 0.06;
      P.hold = { t0: ex.endT0, until: c };
      const f = P.anchors[P.anchors.length - 1].f;
      if (pass) { P.anchors.push({ ctx: c, t0: ex.endT0, f }); P.curEx++; continue; }
      P.anchors.push({ ctx: c, t0: ex.countInStart, f });
      P.nextIdx = lowerBound(S.ev, ex.countInStart);
      P.pendingReset = { at: c, ex: ex.gi, again: true };
      continue;
    }
    const tc = ctxTimeOf(e.t0);
    if (tc > horizon) break;
    if (e.kind === 'click') {
      if (e.countIn || S.settings.metro) AU.click(tc, e.strong);
    } else {
      const f = P.anchors[P.anchors.length - 1].f;
      const dur = e.dur0 / f;
      if (handPlays(e.hand)) AU.note(e.midi, tc, dur, e.vel);
      P.vq.push({ on: tc, off: tc + Math.max(0.08, dur * 0.98), n: e.e, midi: e.midi, started: false });
    }
    P.nextIdx++;
  }
  if (LM.active && P.nextIdx >= S.ev.length && ctxTimeOf(LM.endT0) <= horizon) learnWrap();
}
function setSpeed(v) {
  S.settings.speed = v; saveSettings();
  // 已经排好“下一遍从头开始”的时间点时不插新锚点（新速度从下一遍生效）
  if (P.playing && P.mode === 'play') { const now = AU.ctx.currentTime; if (!P.anchors.some((a) => a.ctx > now)) { P.anchors.push({ ctx: now, t0: posT0(now), f: factor() }); P.anchors = P.anchors.filter((a, i, arr) => i >= arr.length - 3); } }
  updateSpeedLabel();
  learnOnSpeed(v);
}
function locateBar(t) {
  const b = barAtT0(t);
  if (b && t >= b.t1 && b.ex + 1 < S.exs.length) return S.exs[b.ex + 1].bars[0];   // 处于下一首的预备拍
  return b;
}
function barAtT0(t) {
  const arr = S.bars; let lo = 0, hi = arr.length - 1;
  if (!arr.length) return null;
  if (t < arr[0].t0) return arr[0];
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m].t0 <= t) lo = m; else hi = m - 1; }
  return arr[lo];
}

/* ---- 高亮 ---- */
function hl(el, on) {
  if (!el) return;
  const c = (P.elCount.get(el) || 0) + (on ? 1 : -1);
  P.elCount.set(el, Math.max(0, c));
  el.classList.toggle('on', c > 0);
}
function keyHl(m, on, cls = 'play') {
  const k = KBD.keys[m]; if (!k) return;
  const key = cls + m;
  const c = (P.keyCount.get(key) || 0) + (on ? 1 : -1);
  P.keyCount.set(key, Math.max(0, c));
  k.classList.toggle(cls, c > 0);
}
function clearHighlights() {
  document.querySelectorAll('.vf-stavenote.on').forEach((n) => n.classList.remove('on'));
  document.querySelectorAll('.k.play').forEach((n) => n.classList.remove('play'));
  P.elCount.clear(); P.keyCount.clear();
}

/* ---- 光标与滚动 ---- */
const cursor = { el: null, badge: null, x: 0, y: 0, h: 0, tx: 0, ty: 0 };
let ancPrev = null;
// 光标下面的拍点数字：每小节从 0 数起，一个八分音符加 1（4/4 是 0–7），给眼睛一个均匀的节奏参照
function setCNum(tick, len) {
  const el = cursor.num; if (!el) return;
  if (tick == null || !S.settings.cnum) { if (cursor.numTxt !== '') { el.style.display = 'none'; cursor.numTxt = ''; } return; }
  const n = String(clamp(Math.floor(tick / 12 + 1e-6), 0, Math.max(0, Math.ceil(len / 12 - 1e-6) - 1)));
  if (cursor.numTxt !== n) { el.textContent = n; el.style.display = 'block'; cursor.numTxt = n; }
}
function cursorXForBar(bar, tick) {
  const a = bar.anchors; if (!a) return 0;
  for (let i = 0; i < a.length - 1; i++) {
    if (tick >= a[i][0] && tick <= a[i + 1][0]) { const f = (tick - a[i][0]) / Math.max(1, a[i + 1][0] - a[i][0]); return lerp(a[i][1], a[i + 1][1], f); }
  }
  return a[a.length - 1][1];
}
function setCursor(sysIdx, xLogical, idle) {
  const s = S.systems[sysIdx]; if (!s) return;
  const z = s.zoom;
  const left = s.el.offsetLeft + xLogical * z;
  const top = s.top + (s.trebleTop - 22) * z;
  const h = (s.bassBot - s.trebleTop + 44) * z;
  cursor.el.style.transform = `translate(${left - 9}px, ${top}px)`;
  cursor.el.style.height = h + 'px';
  cursor.el.classList.toggle('idle', !!idle);
  cursor.sys = sysIdx;
  if (cursor.lastSys !== sysIdx) {
    S.systems.forEach((x, i) => { if (x && x.ex === s.ex) x.el.classList.toggle('past', i < sysIdx); });
    cursor.lastSys = sysIdx;
  }
}
function placeIdleCursor() {
  const ex = S.exs[S.cur.ex]; if (!ex) return;
  ensureRendered(ex.gi);
  const bar = ex.bars[S.cur.bar];
  if (bar.sysIdx === undefined) return;
  setCursor(bar.sysIdx, bar.anchors[0][1], true);
  setCNum(null);
  updateStatus(bar);
}
// 翻页：把某首练习整屏显示（播放中不滚动，只在换曲时翻页）
function flipTo(exIdx, smooth = false) {
  const el = document.getElementById('ex' + exIdx); if (!el) return;
  ensureRendered(exIdx); ensureRendered(exIdx + 1);
  const wrap = $('wrap');
  const top = el.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
  P.flipping = performance.now();
  wrap.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  P.shownEx = exIdx;
}

let lastFrame = performance.now(), lastStatusBar = null;
function frame() {
  const nowP = performance.now(); const dt = Math.min(0.1, (nowP - lastFrame) / 1000); lastFrame = nowP;
  if (P.playing && AU.ctx) {
    const now = AU.ctx.currentTime;
    // 高亮队列
    for (const v of P.vq) {
      if (!v.started && v.on <= now) { v.started = true; v.el = v.n.el; hl(v.el, true); keyHl(v.midi, true); }
    }
    P.vq = P.vq.filter((v) => { if (v.started && v.off <= now) { hl(v.el, false); keyHl(v.midi, false); return false; } return true; });
    if (P.mode === 'play') {
      while (P.anchors.length > 1 && P.anchors[1].ctx <= now) P.anchors.shift();
      if (P.pendingReset && now >= P.pendingReset.at) { showScore(P.pendingReset.ex, P.pendingReset.again); resetScore(P.pendingReset.ex); P.pendingReset = null; }
      if (P.pendingPass && now >= P.pendingPass.at) { const pp = P.pendingPass; P.pendingPass = null; if (P.pendingCountIn) { P.countIn = P.pendingCountIn; P.pendingCountIn = null; } learnPassEnd(pp); if (!P.playing) return requestAnimationFrame(frame); }
      let t = posT0(now);
      if (P.hold) { if (now >= P.hold.until) P.hold = null; else t = Math.min(t, P.hold.t0 - 1e-4); }
      if (P.countIn && t >= P.countIn.to) P.countIn = null;
      // 开始后的头 0.12 秒 t 还在起点之前，会落到上一首的最后一小节，这里按起点算
      const bar = P.countIn && t < P.countIn.to ? P.countIn.bar : locateBar(Math.max(t, (P.startT0 ?? -Infinity) + 1e-6));
      if (bar) {
        const ex = S.exs[bar.ex];
        if (!S.rendered.has(bar.ex) || !S.rendered.has(bar.ex + 1)) { ensureRendered(bar.ex); ensureRendered(bar.ex + 1); }
        const inCount = t < bar.t0;
        const x = inCount ? bar.anchors[0][1] : cursorXForBar(bar, (t - bar.t0) / spt(ex));
        if (S.settings.scroll && bar.ex !== P.shownEx) flipTo(bar.ex);
        setCursor(bar.sysIdx, x, false);
        setCNum(inCount ? null : (t - bar.t0) / spt(ex), bar.len);
        // 预备拍倒数：还剩几拍
        if (inCount) {
          const beatDur = ex.ts.beat * spt(ex);
          cursor.badge.textContent = String(Math.max(1, Math.ceil((bar.t0 - t) / beatDur - 1e-6)));
          cursor.badge.style.display = 'block';
        } else cursor.badge.style.display = 'none';
        if (lastStatusBar !== bar) { lastStatusBar = bar; updateStatus(bar); }
        if (bar.ex !== P.visEx) { if (LM.active) P.visEx = bar.ex; else { showScore(P.visEx); P.visEx = bar.ex; resetScore(bar.ex); } }
        sweepMisses(t);
      }
      if (P.stopAt !== null && now >= P.stopAt) {
        const lastEx = S.exs[P.curEx];
        stopPlay(false);
        if (LM.active) S.cur = learnRangeStartCur();
        else {
          S.cur = { ex: Math.min(P.curEx + (S.settings.cont ? 0 : 1), S.exs.length - 1), bar: 0 };
          if (lastEx) showScore(lastEx.gi);
        }
        placeIdleCursor();
      }
    } else if (P.mode === 'follow') followFrame(dt);
  }
  requestAnimationFrame(frame);
}

/* ======================= MIDI 输入、评分、跟随模式 ======================= */
const MIDI = { connected: false, access: null, held: new Set(), bound: new WeakSet(), seen: new WeakSet(), lastOn: new Map() };
// 所有 MIDI 输入口共用的处理函数。同一下按键可能送来不止一次（两种挂法各送一次、键盘有两个端口、
// 有的 iOS 实现每次给不同的事件对象）：同一个事件对象只认一次，同一个键 20 毫秒内的重复“按下”也只认一次。
function midiHandle(msg) {
  if (!msg || !msg.data) return;
  if (typeof msg === 'object') { if (MIDI.seen.has(msg)) return; MIDI.seen.add(msg); }
  const st = msg.data[0], d1 = msg.data[1], d2 = msg.data[2]; const cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) {
    const now = performance.now(), last = MIDI.lastOn.get(d1);
    if (last !== undefined && now - last < 20) return;
    MIDI.lastOn.set(d1, now);
    onNoteOn(d1, d2);
  } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) onNoteOff(d1);
}
const SC = {}; // 每首练习的分数
function resetScore(gi, fromT0 = -1) {
  if (LM.active) return learnResetScore(fromT0);
  SC[gi] = { hit: 0, miss: 0, wrong: 0, exp: [], idx: 0 };
  const ex = S.exs[gi];
  ex.bars.forEach((b) => ['rh', 'lh'].forEach((h) => b[h].forEach((e) => { if (e.el) e.el.classList.remove('hit', 'miss', 'expect'); e.hitN = 0; })));
  if (!MIDI.connected) return;
  SC[gi].exp = S.ev.filter((e) => e.kind === 'note' && e.ex === gi && e.t0 >= fromT0 - 1e-6 && practiceHand(e.hand)).map((e) => ({ t0: e.t0, midi: e.midi, e: e.e, hit: false }));
  const el = document.getElementById('sc' + gi); if (el) el.textContent = '';
  hud();
}
// 当前用哪一份分数：学曲子模式按“一遍”统计（跨页），视奏练习按每首统计
function scKey() { return LM.active ? 'L' : (P.mode === 'follow' ? P.curEx : P.visEx); }
function barStat(sc, bar) { if (!sc.bars || !bar) return null; const k = bar.gidx ?? bar.bi; return (sc.bars[k] = sc.bars[k] || { exp: 0, hit: 0, wrong: 0 }); }
function sweepMisses(t) {
  if (!MIDI.connected) return;
  const sc = SC[scKey()]; if (!sc) return;
  const W = 0.25 * factor();
  while (sc.idx < sc.exp.length && sc.exp[sc.idx].t0 < t - W) {
    const x = sc.exp[sc.idx];
    if (!x.hit) { sc.miss++; if (x.e.el) x.e.el.classList.add('miss'); }
    const bs = barStat(sc, x.e.bar); if (bs) { bs.exp++; if (x.hit) bs.hit++; }
    sc.idx++;
  }
}
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
// MIDI 状态小窗：最近收到的音、实时分数、上一首成绩（手机横屏时顶栏状态被隐藏，所以单独放一个）
const HUD = { note: '', noteT: 0, last: '' };
function hud() {
  const el = document.getElementById('midiHud'); if (!el) return;
  if (!MIDI.connected && !LM.active) { el.classList.remove('on'); return; }
  const parts = [];
  if (!MIDI.connected) { el.innerHTML = `<span>${LM.hud}</span>`; el.classList.add('on'); return; }   // 学曲子模式、没连 MIDI：只显示练习进度
  if (HUD.note && performance.now() - HUD.noteT < 1500) parts.push('🎹 ' + HUD.note); else parts.push('🎹');
  const sc = SC[scKey()];
  if (P.playing && sc && sc.exp.length) parts.push(`✓${sc.hit} ✗${sc.miss} 错${sc.wrong}`);
  else if (!P.playing) parts.push('按 ▶ 播放后跟着弹');
  if (LM.active && LM.hud) parts.push(LM.hud);
  else if (HUD.last) parts.push(HUD.last);
  el.innerHTML = parts.map((x) => `<span>${x}</span>`).join('');
  el.classList.add('on');
}
setInterval(() => { if (HUD.note && performance.now() - HUD.noteT >= 1500) { HUD.note = ''; hud(); } }, 500);
function onNoteOn(m, vel) {
  keyHl(m, true, 'user');
  HUD.note = noteName(m); HUD.noteT = performance.now(); hud();
  if (!P.playing && !onNoteOn.hinted) { onNoteOn.hinted = true; toast('已收到琴键：按 ▶ 播放后跟着弹，弹对变绿、漏掉变红；想让光标等你，在设置里打开“等待模式”'); }
  if (S.settings.midiSound && AU.ctx) AU.note(m, AU.ctx.currentTime, 0.6, 0.4 + vel / 200);
  if (!P.playing) return;
  if (LM.active && planListening()) return;   // “先听一遍”这一步不评分
  if (P.mode === 'follow') return followNote(m);
  const sc = SC[scKey()]; if (!sc) return;
  const t = posT0(AU.ctx.currentTime);
  if (P.countIn && t < P.countIn.to - 0.25 * factor()) return;   // 预备拍里按的键不算
  { const cx = !LM.active && S.exs[P.visEx]; if (cx && t < cx.bars[0].t0 - 0.25 * factor()) return; }   // 接下一首（或重弹）时的预备拍也一样
  const W = 0.25 * factor();
  let found = null;
  for (let i = Math.max(0, lowerBound(sc.exp, t - W)); i < sc.exp.length && sc.exp[i].t0 <= t + W; i++) {
    const x = sc.exp[i]; if (!x.hit && x.midi === m) { found = x; break; }
  }
  if (found) {
    found.hit = true; sc.hit++; toastUnstick();
    found.e.hitN = (found.e.hitN || 0) + 1;
    if (found.e.el && found.e.hitN >= found.e.notes.length) { found.e.el.classList.remove('miss'); found.e.el.classList.add('hit'); }
  } else { sc.wrong++; const bs = barStat(sc, locateBar(t)); if (bs) bs.wrong++; }
  updateLiveScore();
}
function onNoteOff(m) { keyHl(m, false, 'user'); }
function updateLiveScore() {
  const sc = SC[scKey()]; if (!sc) return;
  hud();
}
// 这一首的正确率（取整，和显示的一样）；没有评分时返回 null
function exPct(gi) {
  const sc = SC[gi];
  if (LM.active || !MIDI.connected || !sc || !sc.exp.length) return null;
  return sc.hit >= sc.exp.length ? 100 : Math.min(99, Math.round((100 * sc.hit) / sc.exp.length));   // 差一个音也不显示成 100%
}
// 过关：每个该弹的音都弹对，而且一个错键都没有
function exPass(gi) { return exPct(gi) >= PASS_PCT && SC[gi].wrong === 0; }
function showScore(gi, again) {
  if (LM.active) return;
  const sc = SC[gi]; if (!sc || !MIDI.connected) return;
  const tot = sc.exp.length; if (!tot) return;
  const pct = sc.hit >= tot ? 100 : Math.min(99, Math.round((100 * sc.hit) / tot));
  if (sc.hit + sc.miss === 0) return;
  const el = document.getElementById('sc' + gi);
  if (el) el.textContent = `正确率 ${pct}%  错音 ${sc.wrong}`;
  const ex = S.exs[gi];
  const name = ex ? `${ex.li === 0 ? '入门' : LEVELS[ex.li].name} 练习 ${ex.ei + 1}` : '上一首';
  HUD.last = `${name}：${pct}%`;
  toast(`${name}：正确率 ${pct}%（弹对 ${sc.hit}/${tot}，错音 ${sc.wrong}）` + (again ? (pct < PASS_PCT ? `，没到 ${PASS_PCT}%` : `，有 ${sc.wrong} 个错键`) + '，再弹一遍' : ''), true);
  if (!P.playing) toast._t = setTimeout(toastUnstick, 10000);
  hud();
}
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { toast('当前浏览器不支持 Web MIDI，请用 Chrome / Edge 打开'); return; }
  try {
    const acc = await navigator.requestMIDIAccess();
    MIDI.access = acc;
    const bind = () => {
      let n = 0;
      acc.inputs.forEach((inp) => {
        n++;
        // 有些 iOS 上的 Web MIDI 实现只支持其中一种写法，两种都挂上；同一个事件对象只处理一次
        // 设备状态一变 bind 就会再跑一遍：每个输入口只挂一次，否则同一下按键会被处理好几遍（多出来的几遍都被记成错键）
        inp.onmidimessage = midiHandle;
        if (inp.addEventListener && !MIDI.bound.has(inp)) { MIDI.bound.add(inp); try { inp.addEventListener('midimessage', midiHandle); } catch (e) { } }
      });
      MIDI.connected = n > 0;
      document.getElementById('bMidi').textContent = n ? `🎹 已连接 ${n} 个 MIDI 设备` : '🎹 未发现 MIDI 设备（插上后重试）';
      document.getElementById('cFollow').disabled = !MIDI.connected;
      if (LM.active) { learnHudUpdate(); learnUpdatePanel(); }
      if (MIDI.connected && P.playing && P.mode === 'play' && AU.ctx && (!SC[P.visEx] || !SC[P.visEx].exp.length)) resetScore(P.visEx, posT0(AU.ctx.currentTime));
      hud();
    };
    bind(); acc.onstatechange = bind;
  } catch (e) { toast('无法访问 MIDI：' + e.message); }
}
const FOL = { idx: 0, need: new Set(), got: new Set(), timer: null, x: 0 };
function startFollow() {
  P.mode = 'follow'; P.playing = true;
  const ex = S.exs[S.cur.ex];
  FOL.idx = lowerBound(S.ons, ex.bars[S.cur.bar].t0);
  if (LM.active) FOL.idx = lowerBound(S.ons, learnFollowStartT0());
  prepFollow();
  updatePlayBtn();
}
function prepFollow() {
  if (FOL.timer) { clearTimeout(FOL.timer); FOL.timer = null; }
  const o = S.ons[FOL.idx];
  if (!o && LM.active) { learnFollowPassEnd(); return; }
  if (!o && !LM.active && !S.settings.loop && S.settings.cont && exPct(P.curEx) !== null && !exPass(P.curEx)) {   // 最后一首没过关：也重弹
    showScore(P.curEx, true); FOL.idx = lowerBound(S.ons, S.exs[P.curEx].startT0); resetScore(P.curEx); return prepFollow();
  }
  if (!o) { stopPlay(false); return; }
  ensureRendered(o.ex);
  if (LM.active && (o.t0 >= LM.endT0 - 1e-6 || !o)) { learnFollowPassEnd(); return; }
  if (LM.active && o.ex !== P.curEx) P.curEx = o.ex;
  if (o.ex !== P.curEx) {
    const again = !S.settings.loop && S.settings.cont && exPct(P.curEx) !== null && !exPass(P.curEx);
    showScore(P.curEx, again);
    if (S.settings.loop || again) { const ex = S.exs[P.curEx]; FOL.idx = lowerBound(S.ons, ex.startT0); resetScore(P.curEx); return prepFollow(); }
    if (!S.settings.cont) { S.cur = { ex: o.ex, bar: 0 }; stopPlay(false); return; }
    P.curEx = o.ex; resetScore(o.ex);
  }
  FOL.need = new Set(); FOL.got = new Set();
  for (const e of o.evs) if (practiceHand(e.hand)) { e.notes.forEach((n) => { if (!n.tieStop) FOL.need.add(n.midi); }); if (e.el) e.el.classList.add('expect'); }
  updateStatus(o.bar);
  if (!FOL.need.size) {
    playOthers(o);
    const nx = S.ons[FOL.idx + 1];
    const gap = nx ? Math.min(2, (nx.t0 - o.t0) / factor()) : 0.5;
    FOL.timer = setTimeout(() => { FOL.idx++; prepFollow(); }, gap * 1000);
  }
}
function playOthers(o) {
  if (!AU.ctx) return;
  const now = AU.ctx.currentTime;
  const ex = S.exs[o.ex];
  for (const e of o.evs) {
    if (practiceHand(e.hand) || !handPlays(e.hand)) continue;   // 等待模式：自己弹的手不由 App 出声
    const dur = e.dur * spt(ex) / factor();
    e.notes.forEach((n) => { if (!n.tieStop) AU.note(n.midi, now, (n.tieDur || e.dur) * spt(ex) / factor(), 0.55); });
    P.vq.push({ on: now, off: now + dur, n: e, midi: e.notes[0].midi, started: false });
  }
}
function followNote(m) {
  const sc = SC[scKey()];
  if (FOL.need.has(m)) {
    FOL.got.add(m); toastUnstick();
    if ([...FOL.need].every((x) => FOL.got.has(x))) {
      const o = S.ons[FOL.idx];
      for (const e of o.evs) if (practiceHand(e.hand) && e.el) { e.el.classList.remove('expect'); e.el.classList.add('hit'); }
      if (sc) { sc.hit += FOL.need.size; const bs = barStat(sc, o.bar); if (bs) { bs.exp += FOL.need.size; bs.hit += FOL.need.size; } }
      playOthers(o);
      FOL.idx++; prepFollow();
    }
  } else { if (sc) { sc.wrong++; const bs = barStat(sc, S.ons[FOL.idx] && S.ons[FOL.idx].bar); if (bs) bs.wrong++; } flashKey(m); }
  updateLiveScore();
}
function flashKey(m) { const k = KBD.keys[m]; if (!k) return; k.classList.add('bad'); setTimeout(() => k.classList.remove('bad'), 250); }
function followFrame(dt) {
  const o = S.ons[FOL.idx]; if (!o) return;
  const bar = o.bar;
  if (!S.rendered.has(bar.ex) || !S.rendered.has(bar.ex + 1)) { ensureRendered(bar.ex); ensureRendered(bar.ex + 1); }
  const x = cursorXForBar(bar, o.pos);
  FOL.x = cursor.sys === bar.sysIdx ? lerp(FOL.x, x, Math.min(1, dt * 14)) : x;
  if (S.settings.scroll && bar.ex !== P.shownEx) flipTo(bar.ex);
  setCursor(bar.sysIdx, FOL.x, false);
  setCNum(o.pos, bar.len);
  cursor.badge.style.display = 'none';
}

/* ======================= 屏幕键盘 ======================= */
const KBD = { keys: {} };
function buildKeyboard() {
  const box = document.getElementById('kbd'); box.innerHTML = '';
  const inner = document.createElement('div'); inner.className = 'kin'; box.appendChild(inner);
  const whites = []; for (let m = 21; m <= 108; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
  const ww = 100 / whites.length;
  whites.forEach((m, i) => { const k = document.createElement('div'); k.className = 'k w' + (m === 60 ? ' c4' : ''); k.style.left = i * ww + '%'; k.style.width = ww + '%'; inner.appendChild(k); KBD.keys[m] = k; });
  for (let m = 21; m <= 108; m++) if ([1, 3, 6, 8, 10].includes(m % 12)) {
    const wi = whites.indexOf(m - 1);
    const k = document.createElement('div'); k.className = 'k b'; k.style.left = (wi + 1) * ww - ww * 0.32 + '%'; k.style.width = ww * 0.64 + '%'; inner.appendChild(k); KBD.keys[m] = k;
  }
}

/* ======================= UI ======================= */
function $(id) { return document.getElementById(id); }
function escHtml(t) { return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, sticky) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t);
  toast.sticky = !!sticky;
  if (!sticky) toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}
// 一首的成绩留在屏幕上，直到在下一首（或重弹的这一首）里弹对第一个音；没在播放时 10 秒后自己消失
function toastUnstick() { if (!toast.sticky) return; toast.sticky = false; clearTimeout(toast._t); $('toast').classList.remove('show'); }
function updatePlayBtn() { $('bPlay').innerHTML = P.playing ? '❚❚ 暂停' : '▶ 播放'; $('bPlay').classList.toggle('on', P.playing); hud(); }
function updateSpeedLabel() {
  const ex = S.exs[P.playing ? P.curEx : S.cur.ex];
  const bpm = ex ? Math.round(ex.bpm * factor()) : 0;
  $('spdTxt').innerHTML = `${S.settings.speed}%` + (ex ? `<span class="bpm"> · ♩=${bpm}</span>` : '');
  $('spd').value = S.settings.speed;
}
function updateStatus(bar) {
  const ex = S.exs[bar.ex];
  if (ex.learn) { $('status').innerHTML = `<b>${escHtml(ex.title)}</b> <span class="long">第 </span>${bar.num}/${ex.nBarsTotal}<span class="long"> 小节</span>`; updateSpeedLabel(); return; }
  const L = LEVELS[ex.li];
  $('status').innerHTML = `<b>${ex.li === 0 ? '入门' : L.name}</b> <span class="long">练习 </span>${ex.ei + 1}/${EX_PER_LEVEL} · <span class="long">第 </span>${bar.bi + 1}/${ex.bars.length}<span class="long"> 小节</span>`;
  if ($('selLevel').value !== String(ex.li)) $('selLevel').value = String(ex.li);
  if ($('selEx').value !== String(ex.ei)) $('selEx').value = String(ex.ei);
  updateSpeedLabel();
}
function seek(exI, barI, scroll = true) {
  const was = P.playing;
  if (was) stopPlay(false);
  S.cur = { ex: clamp(exI, 0, S.exs.length - 1), bar: barI };
  placeIdleCursor();
  const bar = S.exs[S.cur.ex].bars[barI];
  if (scroll) flipTo(S.cur.ex);
  saveSettings();
  if (was) startPlay();
}
function saveSettings() { try { localStorage.setItem('sr.settings', JSON.stringify(S.settings)); if (!LM.active) localStorage.setItem('sr.lastLevel', String(S.exs[S.cur.ex]?.li ?? 0)); } catch (e) { } }
function loadSettings() {
  // 矮屏（手机横屏）默认不显示屏幕键盘，把高度留给谱面
  S.settings.kbd = Math.min(window.innerWidth, window.innerHeight) >= 520;
  try { const s = JSON.parse(localStorage.getItem('sr.settings') || 'null'); if (s) Object.assign(S.settings, s); } catch (e) { }
  S.settings.follow = false;
}
function applySettingsToUI() {
  const st = S.settings;
  $('cMetro').checked = st.metro; $('selSound').value = st.sound; $('selHand').value = st.hand; $('cLoop').checked = st.loop;
  $('cCont').checked = st.cont; $('cScroll').checked = st.scroll; $('cKbd').checked = st.kbd; $('cNum').checked = st.cnum !== false; $('cFing').checked = st.fing !== false; $('vol').value = st.vol; $('zoom').value = st.scale;
  $('cMidiSound').checked = st.midiSound; $('selCount').value = String(st.countIn || 1);
  document.body.classList.toggle('nokbd', !st.kbd);
  updateHandDim();
  updateSpeedLabel();
}
async function regenerate(seed, keepLevel) {
  const lvl = keepLevel ?? 0;
  if (P.playing) stopPlay(false);
  $('loading').classList.add('show');
  await new Promise((r) => setTimeout(r, 20));
  const t0 = performance.now();
  generateAll(seed);
  const t1 = performance.now();
  await renderAll((f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; });
  const t2 = performance.now();
  window.__perf = { gen: t1 - t0, render: t2 - t1 };
  $('loading').classList.remove('show');
  $('seedTxt').textContent = `谱号 #${seed}`;
  try { history.replaceState(null, '', '#' + seed); } catch (e) { }
  S.cur = { ex: S.levelStart[lvl], bar: 0 };
  cursor.lastSys = -1;
  placeIdleCursor();
  flipTo(S.cur.ex);
}
function initUI() {
  const sel = $('selLevel');
  LEVELS.forEach((L, i) => { const o = document.createElement('option'); o.value = i; o.textContent = i === 0 ? '入门' : L.name; sel.appendChild(o); });
  sel.onchange = () => seek(S.levelStart[+sel.value], 0);
  const selEx = $('selEx');
  for (let i = 0; i < EX_PER_LEVEL; i++) { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1}/${EX_PER_LEVEL}`; selEx.appendChild(o); }
  selEx.onchange = () => { seek(S.levelStart[+sel.value] + +selEx.value, 0); selEx.blur(); };
  // 录音分析页：整页嵌在主页里（iframe），和单独打开 record.html 是同一份
  $('bRec').onclick = () => {
    if (P.playing) stopPlay(true);
    const f = $('recFrame');
    if (!f.dataset.on) { f.dataset.on = '1'; f.srcdoc = window.RECORD_HTML; }
    $('recOv').hidden = false;
  };
  $('recClose').onclick = () => { $('recOv').hidden = true; };
  $('bPlay').onclick = () => (P.playing ? stopPlay(true) : startPlay());
  $('bPrev').onclick = () => seek((P.playing ? P.curEx : S.cur.ex) - (S.cur.bar > 0 && !P.playing ? 0 : 1), 0);
  $('bNext').onclick = () => seek((P.playing ? P.curEx : S.cur.ex) + 1, 0);
  $('spd').oninput = (e) => setSpeed(+e.target.value);
  $('spdDn').onclick = () => setSpeed(clamp(S.settings.speed - 5, 30, 150));
  $('spdUp').onclick = () => setSpeed(clamp(S.settings.speed + 5, 30, 150));
  $('cMetro').onchange = (e) => { S.settings.metro = e.target.checked; saveSettings(); };
  $('selSound').onchange = (e) => { S.settings.sound = e.target.value; saveSettings(); };
  $('selHand').onchange = (e) => { S.settings.hand = e.target.value; saveSettings(); updateHandDim(); };
  $('cLoop').onchange = (e) => { S.settings.loop = e.target.checked; saveSettings(); };
  $('cCont').onchange = (e) => { S.settings.cont = e.target.checked; saveSettings(); };
  $('cScroll').onchange = (e) => { S.settings.scroll = e.target.checked; saveSettings(); };
  $('cNum').onchange = (e) => { S.settings.cnum = e.target.checked; if (!e.target.checked) setCNum(null); saveSettings(); };
  $('cFing').onchange = (e) => { S.settings.fing = e.target.checked; saveSettings(); rerender(); };
  $('cKbd').onchange = (e) => { S.settings.kbd = e.target.checked; document.body.classList.toggle('nokbd', !e.target.checked); saveSettings(); rerender(); };
  $('selCount').onchange = (e) => { S.settings.countIn = +e.target.value; saveSettings(); if (P.playing) stopPlay(true); buildTimeline(); computeSystemGeometry(); };
  $('cMidiSound').onchange = (e) => { S.settings.midiSound = e.target.checked; saveSettings(); };
  $('vol').oninput = (e) => { S.settings.vol = +e.target.value; AU.setVol(S.settings.vol / 100); saveSettings(); };
  $('zoom').onchange = (e) => { S.settings.scale = +e.target.value; saveSettings(); rerender(); };
  $('bMidi').onclick = connectMidi;
  $('cFollow').onchange = (e) => { S.settings.follow = e.target.checked; if (P.playing) { stopPlay(true); } };
  $('bNew').onclick = () => regenerate(Math.floor(Math.random() * 900000) + 100000, S.exs[S.cur.ex].li);
  $('bSet').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('bHelp').onclick = () => $('help').classList.add('show');
  $('help').onclick = (e) => { if (e.target.id === 'help' || e.target.classList.contains('close')) $('help').classList.remove('show'); };
  $('score').addEventListener('click', (e) => {
    const sys = e.target.closest('.system'); if (!sys) return;
    const s = S.systems.find((x) => x && x.el === sys); if (!s) return;
    const r = sys.getBoundingClientRect();
    const x = (e.clientX - r.left) / s.zoom;
    let bar = s.bars.find((b) => x >= b.x0 && x < b.x1) || s.bars[s.bars.length - 1];
    if (LM.active && LM.picking) { learnPickBar(bar); return; }
    seek(bar.ex, bar.bi, false);
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if (e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('bPlay').click(); }
    else if (e.code === 'ArrowRight' || e.code === 'PageDown') { e.preventDefault(); $('bNext').click(); }
    else if (e.code === 'ArrowLeft' || e.code === 'PageUp') { e.preventDefault(); $('bPrev').click(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); setSpeed(clamp(S.settings.speed + 5, 30, 150)); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); setSpeed(clamp(S.settings.speed - 5, 30, 150)); }
    else if (e.key === 'm' || e.key === 'M') { $('cMetro').click(); }
    else if (e.key === 'l' || e.key === 'L') { $('cLoop').click(); }
  });
  let rw = window.innerWidth, rh = window.innerHeight, rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => {
    if (Math.abs(window.innerWidth - rw) > 40 || Math.abs(window.innerHeight - rh) > 60) { rw = window.innerWidth; rh = window.innerHeight; rerender(); }
  }, 400); });
  // 手动滑到哪一页，空闲时“当前练习”就跟到哪一页（按播放即从这一页开始）
  const wrap = $('wrap'); let st = null;
  wrap.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => {
    if (P.playing || performance.now() - (P.flipping || 0) < 400 || !S.exs.length) return;
    const wr = wrap.getBoundingClientRect(); let best = null, bd = 1e9;
    for (const sec of document.querySelectorAll('.ex')) { const d = Math.abs(sec.getBoundingClientRect().top - wr.top); if (d < bd) { bd = d; best = sec; } if (sec.getBoundingClientRect().top > wr.bottom) break; }
    if (!best) return;
    const gi = +best.id.slice(2);
    P.shownEx = gi;
    if (gi !== S.cur.ex) { S.cur = { ex: gi, bar: 0 }; placeIdleCursor(); saveSettings(); }
  }, 160); }, { passive: true });
  // 左右滑动：上一首 / 下一首
  let tx = 0, ty = 0, tt = 0;
  wrap.addEventListener('touchstart', (e) => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = performance.now(); }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]; const dx = t.clientX - tx, dy = t.clientY - ty;
    if (performance.now() - tt < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 45) { (dx < 0 ? $('bNext') : $('bPrev')).click(); }
  }, { passive: true });
  learnInitUI();
  // 切到后台时暂停（iOS 会挂起声音）
  document.addEventListener('visibilitychange', () => { if (document.hidden && P.playing) stopPlay(true); });
}
async function rerender() {
  const was = P.playing; if (was) stopPlay(true);
  if (LM.active) return learnRebuild();
  const cur = { ...S.cur };
  $('loading').classList.add('show');
  await renderAll((f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; });
  $('loading').classList.remove('show');
  S.cur = cur; cursor.lastSys = -1; placeIdleCursor();
  flipTo(cur.ex);
}

async function main() {
  const initHash = location.hash;   // 每首曲子的链接（#pop=… / #z=…），在生成乐谱改写网址之前先记下
  cursor.el = $('cursor'); cursor.badge = $('cbadge'); cursor.num = $('cnum');
  // MIDI 状态：设置面板里始终显示一行，方便在 iPhone 等设备上确认浏览器到底有没有提供 Web MIDI
  const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
  const midiInfo = () => {
    const g = Object.getOwnPropertyNames(window).filter((n) => /midi/i.test(n));
    const nv = []; for (const k in navigator) if (/midi/i.test(k)) nv.push(k);
    const wk = !!(window.webkit && window.webkit.messageHandlers);
    const ua = (navigator.userAgent.match(/\(([^)]*)\)/) || ['', ''])[1];
    return `req=${typeof navigator.requestMIDIAccess}，nav=${nv.join('/') || '无'}，win=${g.length}，wk=${wk ? '有' : '无'}，${ua}`;
  };
  const midiReady = (late) => {
    document.body.classList.remove('nomidi');
    $('midiDiag').textContent = 'MIDI：浏览器支持' + (late ? '（页面打开后才出现）' : '') + '，插上键盘后点下面的“🎹 连接 MIDI 键盘”。';
    if (coarse) toast('检测到 MIDI 支持：点 ⚙ 设置 → 🎹 连接 MIDI 键盘');
  };
  if (navigator.requestMIDIAccess) midiReady(false);
  else {
    // iOS 上的 MIDI 浏览器（如 MIDIWeb Browser）可能在页面脚本之后才注入 Web MIDI，这里再等 10 秒
    document.body.classList.add('nomidi');
    $('midiDiag').textContent = 'MIDI：正在检测浏览器是否支持…';
    let tries = 0;
    const poll = setInterval(() => {
      if (navigator.requestMIDIAccess) { clearInterval(poll); midiReady(true); }
      else if (++tries >= 20) { clearInterval(poll); $('midiDiag').textContent = 'MIDI：当前浏览器不支持 Web MIDI（已等 10 秒）。诊断：' + midiInfo(); }
    }, 500);
  }
  $('bRotOk').onclick = () => document.body.classList.add('rot-ok');
  loadSettings();
  buildKeyboard();
  initUI();
  applySettingsToUI();
  const h = parseInt((location.hash || '').slice(1), 10);
  const seed = Number.isFinite(h) && h > 0 ? h : Math.floor(Math.random() * 900000) + 100000;
  let lvl = 0; try { lvl = clamp(parseInt(localStorage.getItem('sr.lastLevel') || '0', 10) || 0, 0, LEVELS.length - 1); } catch (e) { }
  await regenerate(seed, lvl);
  await learnRestore(initHash);
  requestAnimationFrame(frame);
  // 通过歌曲链接打开时直接看谱，不弹使用说明
  try { if (!localStorage.getItem('sr.seenHelp') && !isSongLink(initHash)) { $('help').classList.add('show'); localStorage.setItem('sr.seenHelp', '1'); } } catch (e) { }
}
window.__SR = { planGo, planStepLabel, planSteps, unrollOrder, pop909ToPiece, pop909clToPiece, pop909Load, get POP909() { return POP909; }, get LM() { return LM; }, get SCL() { return SC.L; }, learnPages, parseMusicXML, parseMidi, midiToPiece, unzipMusicXML, inflateJS, learnEnter, learnExit, buildTimeline, renderAll, ensureRendered, AU, MIDI, onNoteOn, FOL, SC, posT0, setSpeed, S, P, genExercise, validatePiece, LEVELS, EX_PER_LEVEL, generateAll, seek, startPlay, stopPlay, buildBarVF, modsWidth };
window.addEventListener('DOMContentLoaded', main);
