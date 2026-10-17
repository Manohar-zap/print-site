/**
 * generate-icons.js
 * Generates minimal PNG/ICO icons using raw binary data.
 * Produces:
 *   assets/tray.png  — 16x16 PNG (blue printer icon)
 *   assets/icon.png  — 256x256 PNG
 *   assets/icon.ico  — 256x256 ICO (required by NSIS)
 *
 * Run: node scripts/generate-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// ── Minimal PNG builder ─────────────────────────────────────────────────────
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tc = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tc, data])));
  return Buffer.concat([len, tc, data, crc]);
}

function buildPng(size, drawFn) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  
  // Build raw image rows
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = drawFn(x, y, size);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Draw function: printer icon ─────────────────────────────────────────────
function drawPrinter(x, y, s) {
  const BG = [10, 10, 10];
  const BLUE = [26, 107, 255];
  const WHITE = [250, 250, 248];

  // Normalized coords 0..1
  const nx = x / s, ny = y / s;

  // Outer rounded square (blue)
  const margin = 0.08;
  if (nx < margin || nx > 1 - margin || ny < margin || ny > 1 - margin) return BG;

  // Printer body: 15%..85% x, 30%..75% y
  const inBody = nx >= 0.15 && nx <= 0.85 && ny >= 0.30 && ny <= 0.75;
  // Paper slot: 20%..80% x, 15%..35% y
  const inPaper = nx >= 0.20 && nx <= 0.80 && ny >= 0.15 && ny <= 0.35;
  // Output tray: 25%..75% x, 70%..85% y
  const inTray = nx >= 0.25 && nx <= 0.75 && ny >= 0.70 && ny <= 0.85;

  if (inBody) return BLUE;
  if (inPaper) return WHITE;
  if (inTray) return WHITE;
  return BG;
}

// ── Generate icons ──────────────────────────────────────────────────────────
const trayPng = buildPng(16, drawPrinter);
const iconPng = buildPng(256, drawPrinter);

fs.writeFileSync(path.join(ASSETS, 'tray.png'), trayPng);
fs.writeFileSync(path.join(ASSETS, 'icon.png'), iconPng);
console.log('✓ assets/tray.png (16x16)');
console.log('✓ assets/icon.png (256x256)');

// ── Minimal ICO builder ──────────────────────────────────────────────────────
// ICO = 6-byte header + 16-byte dir entry + PNG data
function buildIco(pngData) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: 1=ICO
  header.writeUInt16LE(1, 4);  // count: 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = 0;   // width  (0 = 256)
  dirEntry[1] = 0;   // height (0 = 256)
  dirEntry[2] = 0;   // color count
  dirEntry[3] = 0;   // reserved
  dirEntry.writeUInt16LE(1, 4);  // color planes
  dirEntry.writeUInt16LE(32, 6); // bits per pixel
  dirEntry.writeUInt32LE(pngData.length, 8);          // size of image data
  dirEntry.writeUInt32LE(6 + 16, 12);                 // offset of image data

  return Buffer.concat([header, dirEntry, pngData]);
}

const ico = buildIco(iconPng);
fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
console.log('✓ assets/icon.ico (256x256)');
console.log('\nAll icons generated successfully.');
