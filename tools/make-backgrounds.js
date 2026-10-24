// Generates the low-res character-select backdrops in /Backgrounds (run: node tools/make-backgrounds.js).
// Each one is a tiny 64x48 image with a diagonal two-colour gradient, a soft glow behind the head and a few
// streaks. There is no dithering: the page scales them up smoothly, so they look soft and low-res, not pixel art.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 64, H = 48;
const OUT = path.join(__dirname, '..', 'Backgrounds');

// name, [bottom-left colour, top-right colour, glow colour, streak colour]
const THEMES = [
  ['lime',     [[20, 70, 20],  [150, 210, 40],  [225, 245, 120], [190, 255, 90]]],
  ['violet',   [[60, 20, 110], [200, 50, 70],   [255, 140, 170], [255, 190, 120]]],
  ['ember',    [[110, 20, 10], [250, 130, 30],  [255, 220, 120], [255, 170, 60]]],
  ['ocean',    [[10, 30, 100], [60, 150, 230],  [170, 230, 255], [120, 200, 255]]],
  ['teal',     [[5, 60, 70],   [30, 190, 170],  [160, 255, 230], [90, 240, 200]]],
  ['crimson',  [[50, 5, 15],   [200, 25, 45],   [255, 110, 110], [255, 90, 90]]],
  ['gold',     [[90, 50, 5],   [240, 190, 40],  [255, 240, 150], [255, 220, 90]]],
  ['magenta',  [[40, 15, 100], [220, 50, 170],  [255, 150, 230], [200, 150, 255]]],
  ['steel',    [[25, 35, 55],  [110, 140, 180], [215, 230, 250], [170, 200, 240]]],
  ['olive',    [[35, 45, 10],  [140, 150, 40],  [220, 230, 120], [200, 220, 80]]],
  ['sunset',   [[70, 20, 90],  [250, 110, 60],  [255, 200, 130], [255, 150, 200]]],
  ['night',    [[10, 10, 40],  [70, 60, 170],   [150, 150, 255], [130, 110, 255]]],
];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// small value-noise field, enough for wobbly streaks
function noiseField(seed) {
  const r = mulberry(seed), N = 12, g = Array.from({ length: N * N }, () => r());
  const at = (x, y) => g[((y % N) + N) % N * N + ((x % N) + N) % N];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const top = at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx, bot = at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
}

function render(colors, seed) {
  const [A, B, C, S] = colors, noise = noiseField(seed), rnd = mulberry(seed ^ 0x9e3779b9);
  const flip = rnd() < 0.5; // mirror half of them so neighbours don't all slope the same way
  const pix = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let u = x / (W - 1), v = y / (H - 1);
      if (flip) u = 1 - u;
      let c = mix(A, B, clamp(u * 0.4 + (1 - v) * 0.6));
      const d = Math.hypot((u - 0.5) * 1.25, v - 0.38);
      c = mix(c, C, Math.pow(clamp(1 - d / 0.62), 1.7) * 0.6); // glow behind the head
      const n = noise(u * 4 + v * 1.5, v * 8 - u * 1.2);
      const band = Math.abs(Math.sin((u * 1.5 - v * 0.9) * 15 + n * 7));
      c = mix(c, S, clamp(1 - band * 6) * 0.42 * smooth(0.1, 0.5, v)); // lightning-like streaks
      c = mix(c, [255, 255, 255], smooth(0.78, 1, n) * 0.1); // soft cloud highlights
      const shade = 1 - 0.42 * clamp((d - 0.35) * 1.4) ** 2; // vignette
      for (let k = 0; k < 3; k++) pix[(y * W + x) * 3 + k] = clamp(c[k] * shade, 0, 255);
    }
  }
  return pix;
}

// ---- tiny PNG writer ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// 24-bit RGB, rows stored with the "Sub" filter (each byte minus the pixel to its left), which keeps smooth gradients small.
function png(pix) {
  const stride = W * 3, raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 1; // filter type 1 = Sub
    for (let i = 0; i < stride; i++) {
      const v = Math.round(pix[y * stride + i]), left = i >= 3 ? Math.round(pix[y * stride + i - 3]) : 0;
      raw[y * (stride + 1) + 1 + i] = (v - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit, colour type 2 (RGB)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
THEMES.forEach(([name, colors], i) => {
  const file = path.join(OUT, `bg-${String(i + 1).padStart(2, '0')}-${name}.png`);
  const buf = png(render(colors, 1000 + i * 77));
  fs.writeFileSync(file, buf);
  total += buf.length;
  console.log(path.basename(file), buf.length + ' bytes');
});
console.log(`${THEMES.length} files, ${(total / 1024).toFixed(1)} KB total`);
