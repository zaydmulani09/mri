// Generates the extension's 128x128 marketplace icon (icon.png) without any
// image dependencies: raw RGBA pixels -> zlib-deflated PNG.
// Motif: blast-radius radar — three concentric rings around an impact dot on
// a dark rounded tile.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 128;
const CENTER = SIZE / 2;

const px = new Uint8Array(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b, a]) {
  const i = (y * SIZE + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

function blendPixel(x, y, color, alpha) {
  const i = (y * SIZE + x) * 4;
  const srcA = alpha;
  const dstA = px[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  px[i] = Math.round((color[0] * srcA + px[i] * dstA * (1 - srcA)) / outA);
  px[i + 1] = Math.round((color[1] * srcA + px[i + 1] * dstA * (1 - srcA)) / outA);
  px[i + 2] = Math.round((color[2] * srcA + px[i + 2] * dstA * (1 - srcA)) / outA);
  px[i + 3] = Math.round(outA * 255);
}

const dist = (x, y) => Math.hypot(x - CENTER, y - CENTER);

const TILE = [30, 36, 48, 255];
const TILE_EDGE = [43, 51, 68, 255];
const RINGS = [
  { radius: 46, width: 4, color: [126, 232, 222] },
  { radius: 32, width: 4, color: [63, 208, 196] },
  { radius: 18, width: 4, color: [46, 168, 160] },
];
const DOT = { radius: 7, color: [245, 184, 61] };
const CORNER_RADIUS = 26;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Rounded-corner tile mask with soft edge.
    const cx = Math.min(Math.max(x, CORNER_RADIUS), SIZE - 1 - CORNER_RADIUS);
    const cy = Math.min(Math.max(y, CORNER_RADIUS), SIZE - 1 - CORNER_RADIUS);
    const cornerDist = Math.hypot(x - cx, y - cy);
    if (cornerDist > CORNER_RADIUS + 0.5) continue;
    const tileAlpha = cornerDist > CORNER_RADIUS - 0.5 ? CORNER_RADIUS - cornerDist : 1;

    // Vertical shade for depth.
    const shade = 1 - ((y / SIZE) * 0.25);
    const tileColor = [
      Math.round(TILE[0] * shade),
      Math.round(TILE[1] * shade),
      Math.round(TILE[2] * shade),
      255,
    ];
    blendPixel(x, y, tileColor, Math.max(0, Math.min(1, tileAlpha)));

    const edge =
      cornerDist > CORNER_RADIUS - 1.5 && cornerDist <= CORNER_RADIUS
        ? CORNER_RADIUS - cornerDist
        : 0;
    if (edge > 0) blendPixel(x, y, TILE_EDGE, edge);

    const d = dist(x, y);
    for (const ring of RINGS) {
      const half = ring.width / 2;
      const delta = d - ring.radius;
      if (Math.abs(delta) <= half + 0.5) {
        const aa = Math.max(0, Math.min(1, half - Math.abs(delta) + 0.5));
        blendPixel(x, y, ring.color, aa);
      }
    }

    if (d <= DOT.radius + 0.5) {
      const aa = Math.max(0, Math.min(1, DOT.radius - d + 0.5));
      blendPixel(x, y, DOT.color, aa);
    }
  }
}

// --- minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(new URL("../icon.png", import.meta.url), png);
console.log(`wrote icon.png (${png.length} bytes)`);
