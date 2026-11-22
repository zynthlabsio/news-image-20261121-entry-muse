// The World in One Picture - Saturday 21 November 2026.
// A newspaper front page drawn entirely in code: seeded procedural renderer,
// hand-defined 5x7 bitmap font, own PNG encoder (zlib deflate + CRC32).
// Node 22, standard library only. No network, no time, no Math.random:
// the same run always writes the same bytes.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32, fixed seed)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261121);

// ---------------------------------------------------------------------------
// CRC32 (PNG chunks) and PNG encoder
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePNG(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter none
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Canvas: 1024x1024 page, rendered at 2x (2048) and downsampled.
// All drawing helpers take page coordinates (0..1024) and scale by S.
// ---------------------------------------------------------------------------
const S = 2;
const PW = 1024;
const PH = 1024;
const W = PW * S;
const H = PH * S;
const canvas = new Uint8Array(W * H * 3);

type RGB = [number, number, number];
const PAPER: RGB = [247, 242, 231];
const INK: RGB = [18, 18, 18];
const NAVY: RGB = [16, 32, 58];
const NAVY2: RGB = [24, 46, 82];
const GOLD: RGB = [242, 193, 78];
const RED: RGB = [178, 32, 44];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [74, 74, 72];
const LGREY: RGB = [214, 208, 194];
const ORANGE: RGB = [232, 116, 28];
const YELLOW: RGB = [250, 204, 64];
const SKY: RGB = [126, 178, 214];
const SEA: RGB = [32, 84, 128];
const GREEN: RGB = [46, 122, 74];

function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    canvas[i * 3] = c[0];
    canvas[i * 3 + 1] = c[1];
    canvas[i * 3 + 2] = c[2];
  }
}

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  canvas[i] = c[0];
  canvas[i + 1] = c[1];
  canvas[i + 2] = c[2];
}

// Rectangle in page coordinates.
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.round(x * S);
  const y0 = Math.round(y * S);
  const x1 = Math.round((x + w) * S);
  const y1 = Math.round((y + h) * S);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) px(xx, yy, c);
  }
}

function hline(x: number, y: number, w: number, t: number, c: RGB): void {
  rect(x, y, w, t, c);
}
function vline(x: number, y: number, h: number, t: number, c: RGB): void {
  rect(x, y, t, h, c);
}

// Line in page coordinates (Bresenham), thickness in page px.
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  let ax = Math.round(x0 * S);
  let ay = Math.round(y0 * S);
  const bx = Math.round(x1 * S);
  const by = Math.round(y1 * S);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  const half = Math.max(0, Math.floor((t * S) / 2));
  for (;;) {
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) px(ax + ox, ay + oy, c);
    }
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  const x0 = Math.round((cx - r) * S);
  const x1 = Math.round((cx + r) * S);
  const y0 = Math.round((cy - r) * S);
  const y1 = Math.round((cy + r) * S);
  const rr = r * r;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx / S - cx;
      const dy = yy / S - cy;
      if (dx * dx + dy * dy <= rr) px(xx, yy, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const steps = Math.max(24, Math.floor(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const b = ((i + 1) / steps) * Math.PI * 2;
    line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(b) * r, cy + Math.sin(b) * r, t, c);
  }
}

// Filled triangle in page coordinates.
function triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.floor(Math.min(x0, x1, x2));
  const maxX = Math.ceil(Math.max(x0, x1, x2));
  const minY = Math.floor(Math.min(y0, y1, y2));
  const maxY = Math.ceil(Math.max(y0, y1, y2));
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (d === 0) return;
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const a = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) / d;
      const b = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) px(Math.round(xx * S), Math.round(yy * S), c);
    }
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (own design). Each glyph: 7 rows of 5 bits, "1" = ink.
// ---------------------------------------------------------------------------
const FONT: Record<string, string> = {
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01110/10001/10000/10000/10000/10001/01110",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01110/10001/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "01110/00100/00100/00100/00100/00100/01110",
  J: "00111/00010/00010/00010/00010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/11011/10001",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  "0": "01110/10001/10011/10101/11001/10001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  "2": "01110/10001/00001/00110/01000/10000/11111",
  "3": "11111/00010/00100/00010/00001/10001/01110",
  "4": "00010/00110/01010/10010/11111/00010/00010",
  "5": "11111/10000/11110/00001/00001/10001/01110",
  "6": "00110/01000/10000/11110/10001/10001/01110",
  "7": "11111/00001/00010/00100/01000/01000/01000",
  "8": "01110/10001/10001/01110/10001/10001/01110",
  "9": "01110/10001/10001/01111/00001/00010/01100",
  " ": "00000/00000/00000/00000/00000/00000/00000",
  ".": "00000/00000/00000/00000/00000/01100/01100",
  ",": "00000/00000/00000/00000/01100/00100/01000",
  "'": "00100/00100/01000/00000/00000/00000/00000",
  "-": "00000/00000/00000/01110/00000/00000/00000",
  ":": "00000/01100/01100/00000/01100/01100/00000",
  ";": "00000/01100/01100/00000/01100/00100/01000",
  "!": "00100/00100/00100/00100/00100/00000/00100",
  "?": "01110/10001/00001/00110/00100/00000/00100",
  "/": "00001/00010/00010/00100/01000/01000/10000",
  "(": "00010/00100/01000/01000/01000/00100/00010",
  ")": "01000/00100/00010/00010/00010/00100/01000",
  "&": "01100/10010/10100/01000/10101/10010/01101",
  "%": "11001/11010/00010/00100/01000/01011/10011",
  "+": "00000/00100/00100/11111/00100/00100/00000",
  "=": "00000/00000/11111/00000/11111/00000/00000",
  '"': "01010/01010/00000/00000/00000/00000/00000",
  "[": "01110/01000/01000/01000/01000/01000/01110",
  "]": "01110/00010/00010/00010/00010/00010/01110",
  "*": "00000/10101/01110/11111/01110/10101/00000",
  "|": "00100/00100/00100/00100/00100/00100/00100",
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  const s = scale * S;
  for (let ci = 0; ci < text.length; ci++) {
    const g = FONT[text[ci].toUpperCase()] ?? FONT["?"];
    const rows = g.split("/");
    const cx = Math.round((x + ci * 6 * scale) * S);
    const cy = Math.round(y * S);
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (rows[r][col] === "1") {
          for (let yy = 0; yy < s; yy++) {
            for (let xx = 0; xx < s; xx++) px(cx + col * s + xx, cy + r * s + yy, c);
          }
        }
      }
    }
  }
}

function drawTextCentered(text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(text, cx - textWidth(text, scale) / 2, y, scale, c);
}

function wrapText(text: string, maxW: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawPara(text: string, x: number, y: number, maxW: number, scale: number, lh: number, c: RGB): number {
  const lines = wrapText(text, maxW, scale);
  for (let i = 0; i < lines.length; i++) drawText(lines[i], x, y + i * lh, scale, c);
  return y + lines.length * lh;
}

// ---------------------------------------------------------------------------
// Scene drawings (simple iconic pictures, page coordinates).
// Every shape is kept inside its (x, y, w, h) box.
// ---------------------------------------------------------------------------
function stars(x: number, y: number, w: number, h: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const sx = x + rng() * (w - 2);
    const sy = y + rng() * (h - 2);
    rect(sx, sy, 2, 2, WHITE);
  }
}

function skyline(x: number, y: number, w: number, h: number, base: number, c: RGB): void {
  let cx = x;
  while (cx < x + w) {
    const bw = Math.min(18 + rng() * 34, x + w - cx);
    if (bw < 8) break;
    const bh = h * (0.35 + rng() * 0.6);
    rect(cx, base - bh, bw, bh, c);
    for (let k = 0; k < 3; k++) {
      if (rng() < 0.6) rect(cx + 4 + rng() * (bw - 8), base - bh + 6 + rng() * (bh - 12), 3, 4, YELLOW);
    }
    cx += bw + 4;
  }
}

function drawLeadScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY); // night sky
  stars(x, y, w, h * 0.5, 26);
  // two missile trails arcing down from the top right
  line(x + w * 0.98, y + 6, x + w * 0.62, y + h * 0.52, 3, ORANGE);
  line(x + w * 0.9, y + 2, x + w * 0.45, y + h * 0.6, 3, YELLOW);
  circle(x + w * 0.62, y + h * 0.52, 7, YELLOW);
  circle(x + w * 0.45, y + h * 0.6, 6, ORANGE);
  skyline(x, y, w, h * 0.62, y + h * 0.82, [10, 20, 38]);
  // explosion burst where the second missile lands
  const ex = x + w * 0.55;
  const ey = y + h * 0.78;
  circle(ex, ey, 26, ORANGE);
  circle(ex, ey, 15, YELLOW);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(ex, ey, ex + Math.cos(a) * 38, ey + Math.sin(a) * 38, 3, YELLOW);
  }
  // smoke
  for (let i = 0; i < 10; i++) {
    circle(ex - 30 + rng() * 70, ey - 46 + rng() * 22, 6 + rng() * 8, [120, 118, 112]);
  }
  // ambulance at bottom left
  rect(x + 14, y + h - 44, 96, 34, WHITE);
  rect(x + 14, y + h - 44, 96, 6, RED);
  rect(x + 46, y + h - 32, 8, 20, RED);
  rect(x + 38, y + h - 26, 24, 8, RED);
  circle(x + 34, y + h - 8, 7, INK);
  circle(x + 92, y + h - 8, 7, INK);
}

function drawGulfScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, NAVY2);
  stars(x, y, w, h * 0.6, 12);
  // radar dish sweeping
  circle(x + w * 0.5, y + h * 0.62, 20, LGREY);
  line(x + w * 0.5, y + h * 0.62, x + w * 0.82, y + h * 0.3, 3, YELLOW);
  line(x + w * 0.5, y + h * 0.62, x + w * 0.5, y + h * 0.62 + 16, 4, LGREY);
  // base buildings
  rect(x + 8, y + h - 22, 34, 22, [8, 16, 32]);
  rect(x + w - 46, y + h - 18, 38, 18, [8, 16, 32]);
  // distant fire glow
  circle(x + w * 0.78, y + h - 20, 12, ORANGE);
  circle(x + w * 0.78, y + h - 20, 6, YELLOW);
}

function drawMexicoScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [232, 222, 196]);
  // police badge: gold disc with a star cut from the same gold
  const cx = x + w * 0.5;
  const cy = y + h * 0.42;
  circle(cx, cy, 22, GOLD);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    triangle(cx, cy, cx + Math.cos(a - 0.2) * 24, cy + Math.sin(a - 0.2) * 24, cx + Math.cos(a + 0.2) * 24, cy + Math.sin(a + 0.2) * 24, GOLD);
  }
  circle(cx, cy, 9, NAVY);
  // handcuffs below
  ring(x + w * 0.32, y + h * 0.8, 10, 3, INK);
  ring(x + w * 0.68, y + h * 0.8, 10, 3, INK);
  line(x + w * 0.32, y + h * 0.8, x + w * 0.68, y + h * 0.8, 3, INK);
}

function drawClimateScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, SKY);
  circle(x + w * 0.82, y + 14, 11, YELLOW);
  // summit hall: rectangular hall with a triangular pediment roof
  rect(x + w * 0.14, y + h * 0.48, w * 0.72, h * 0.52, WHITE);
  triangle(x + w * 0.12, y + h * 0.48, x + w * 0.88, y + h * 0.48, x + w * 0.5, y + h * 0.22, WHITE);
  rect(x + w * 0.5 - 2, y + h * 0.22, 4, h * 0.1, NAVY);
  // flags row
  const cols: RGB[] = [RED, GREEN, GOLD, NAVY, ORANGE];
  for (let i = 0; i < 5; i++) {
    const fx = x + w * 0.2 + i * (w * 0.13);
    vline(fx, y + h * 0.54, 14, 2, INK);
    rect(fx, y + h * 0.54, 13, 8, cols[i]);
  }
  // doors
  rect(x + w * 0.44, y + h * 0.76, w * 0.12, h * 0.24, NAVY);
}

function drawShipScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [188, 214, 228]);
  // sea
  rect(x, y + h * 0.62, w, h * 0.38, SEA);
  for (let i = 0; i < 4; i++) {
    const wy = y + h * (0.68 + i * 0.09);
    line(x + 6, wy, x + w - 6, wy, 2, [150, 196, 222]);
  }
  // hull and containers
  rect(x + w * 0.12, y + h * 0.5, w * 0.76, h * 0.16, [40, 40, 44]);
  rect(x + w * 0.2, y + h * 0.34, w * 0.16, h * 0.16, RED);
  rect(x + w * 0.38, y + h * 0.34, w * 0.16, h * 0.16, GOLD);
  rect(x + w * 0.56, y + h * 0.34, w * 0.16, h * 0.16, GREEN);
  rect(x + w * 0.72, y + h * 0.3, w * 0.1, h * 0.2, WHITE);
  // flames on deck
  for (let i = 0; i < 3; i++) {
    const fx = x + w * (0.3 + i * 0.2);
    triangle(fx - 8, y + h * 0.36, fx + 8, y + h * 0.36, fx, y + h * 0.12, ORANGE);
    triangle(fx - 4, y + h * 0.36, fx + 4, y + h * 0.36, fx, y + h * 0.22, YELLOW);
  }
  // smoke, kept inside the sky part of the box
  for (let i = 0; i < 6; i++) {
    circle(x + w * 0.5 + (rng() - 0.5) * w * 0.3, y + h * 0.06 + rng() * 6, 4 + rng() * 4, [110, 110, 108]);
  }
}

function drawBridgeScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, SKY);
  rect(x, y + h * 0.66, w, h * 0.34, SEA);
  // bridge deck and towers
  rect(x + 6, y + h * 0.5, w - 12, 8, INK);
  rect(x + w * 0.24, y + h * 0.3, 8, h * 0.36, INK);
  rect(x + w * 0.72, y + h * 0.3, 8, h * 0.36, INK);
  line(x + w * 0.24 + 4, y + h * 0.3, x + 6, y + h * 0.5, 2, INK);
  line(x + w * 0.24 + 4, y + h * 0.3, x + w * 0.5, y + h * 0.5, 2, INK);
  line(x + w * 0.72 + 4, y + h * 0.3, x + w * 0.5, y + h * 0.5, 2, INK);
  line(x + w * 0.72 + 4, y + h * 0.3, x + w - 6, y + h * 0.5, 2, INK);
  // blast flash on the deck
  const bx = x + w * 0.5;
  const by = y + h * 0.46;
  circle(bx, by, 13, ORANGE);
  circle(bx, by, 7, YELLOW);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    line(bx, by, bx + Math.cos(a) * 20, by + Math.sin(a) * 20, 2, YELLOW);
  }
}

function drawDenmarkScene(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [232, 222, 196]);
  // warning triangle with exclamation mark
  const cx = x + w * 0.5;
  const cy = y + h * 0.44;
  triangle(cx - 28, cy + 22, cx + 28, cy + 22, cx, cy - 24, YELLOW);
  triangle(cx - 22, cy + 18, cx + 22, cy + 18, cx, cy - 18, INK);
  rect(cx - 2, cy - 6, 4, 16, YELLOW);
  rect(cx - 2, cy + 12, 4, 4, YELLOW);
  // embassy columns below
  for (let i = 0; i < 4; i++) {
    const colx = x + w * 0.2 + i * (w * 0.2);
    rect(colx, y + h * 0.72, 8, h * 0.24, WHITE);
  }
  rect(x + w * 0.14, y + h * 0.66, w * 0.72, 6, NAVY);
  rect(x + w * 0.14, y + h * 0.96, w * 0.72, 4, NAVY);
}

// ---------------------------------------------------------------------------
// Page layout (1024x1024)
//   masthead  0-148 | lead 156-380 | grid 390-638 + 648-896 | ticker 906-1016
// ---------------------------------------------------------------------------
fillAll(PAPER);

// Masthead
rect(0, 0, PW, 148, NAVY);
drawTextCentered("THE WORLD IN ONE PICTURE", PW / 2, 14, 6, WHITE);
hline(24, 62, PW - 48, 2, GOLD);
drawTextCentered("SATURDAY 21 NOVEMBER 2026", PW / 2, 70, 5, GOLD);
drawTextCentered("ONE DAY, SEVEN STORIES FROM AROUND THE WORLD", PW / 2, 114, 3, [220, 224, 232]);

// Lead story panel (ink border, white inside)
const LX = 8;
const LY = 156;
const LW = PW - 16;
const LH = 224;
rect(LX, LY, LW, LH, INK);
rect(LX + 3, LY + 3, LW - 6, LH - 6, WHITE);
hline(LX + 3, LY + 3, LW - 6, 4, RED);
drawLeadScene(LX + 14, LY + 16, 380, 192);
const TX = LX + 408;
drawText("LEAD STORY - UKRAINE", TX, LY + 14, 3, RED);
drawPara("DOUBLE-TAP STRIKE KILLS BOY, 7", TX, LY + 40, 590, 5, 38, INK);
drawPara("A SECOND MISSILE HIT RESCUERS ANSWERING THE FIRST BLAST IN KRYVYI RIH. TWO KILLED, 60 WOUNDED.", TX, LY + 126, 590, 3, 24, [40, 40, 40]);

// Six smaller panels, 3 columns x 2 rows, ink border + accent top rule
type Panel = { tag: string; head: string; cap: string; accent: RGB; draw: (x: number, y: number, w: number, h: number) => void };
const panels: Panel[] = [
  { tag: "GULF", head: "IRAN CLAIMS STRIKES ON US BASES", cap: "BAHRAIN REPORTS A FIRE AT AN INDUSTRIAL SITE.", accent: NAVY2, draw: drawGulfScene },
  { tag: "MEXICO", head: "MEXICO CAPTURES 'EL CHAPO ISIDRO'", cap: "FBI MOST-WANTED BOSS HELD IN SINALOA. 11 KILLED.", accent: GREEN, draw: drawMexicoScene },
  { tag: "CLIMATE - COP31", head: "COP31 TALKS RUN INTO OVERTIME", cap: "SUMMIT IN ANTALYA DEADLOCKED OVER FOSSIL FUELS.", accent: GREEN, draw: drawClimateScene },
  { tag: "BALTIC", head: "SHIP ON FIRE IN GULF OF FINLAND", cap: "RUSSIAN CARGO SHIP HIT BY A DRONE OFF FINLAND.", accent: SEA, draw: drawShipScene },
  { tag: "UKRAINE", head: "ZELENSKY: BRIDGE STRIKES 'FAIR'", cap: "HE MEETS THE UK DEFENCE SECRETARY IN KYIV.", accent: NAVY2, draw: drawBridgeScene },
  { tag: "EUROPE", head: "DENMARK: RUSSIA PLOTTED KILLING", cap: "COPENHAGEN ACCUSES MOSCOW OF A MURDER PLOT.", accent: RED, draw: drawDenmarkScene },
];
const PWID = 328;
const PHGT = 248;
const GX = [8, 348, 688];
const GY = [390, 648];
for (let i = 0; i < panels.length; i++) {
  const p = panels[i];
  const x = GX[i % 3];
  const y = GY[Math.floor(i / 3)];
  rect(x, y, PWID, PHGT, INK);
  rect(x + 2, y + 2, PWID - 4, PHGT - 4, WHITE);
  hline(x + 2, y + 2, PWID - 4, 4, p.accent);
  p.draw(x + 10, y + 10, PWID - 20, 58);
  drawText(p.tag, x + 10, y + 74, 3, p.accent);
  drawPara(p.head, x + 10, y + 98, PWID - 20, 3, 24, INK);
  const headLines = wrapText(p.head, PWID - 20, 3).length;
  drawPara(p.cap, x + 10, y + 98 + headLines * 24 + 6, PWID - 20, 3, 22, GREY);
}

// Ticker
const TY = 906;
rect(0, TY, PW, 110, [22, 22, 22]);
hline(0, TY, PW, 4, RED);
drawText("ALSO TODAY", 16, TY + 14, 3, GOLD);
drawPara("FBI PROBES APPARENT HACK OF ITS NCIC CRIME DATABASE | MAN CONVICTED OF STARTING THE PALISADES FIRE IN LOS ANGELES | TRUMP CALLS PUTIN A FRIEND AS KYIV TALKS CONTINUE", 16, TY + 44, PW - 32, 2, 18, WHITE);

// ---------------------------------------------------------------------------
// Downsample 2x -> 1024x1024 and write PNG
// ---------------------------------------------------------------------------
const out = Buffer.alloc(PW * PH * 3);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) {
        const i = ((y * S + dy) * W + (x * S + dx)) * 3;
        r += canvas[i];
        g += canvas[i + 1];
        b += canvas[i + 2];
      }
    }
    const o = (y * PW + x) * 3;
    out[o] = Math.round(r / 4);
    out[o + 1] = Math.round(g / 4);
    out[o + 2] = Math.round(b / 4);
  }
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "entry.png"), encodePNG(PW, PH, out));
console.log("wrote entry.png");
