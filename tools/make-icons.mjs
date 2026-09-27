// Renders the app icons from the icon_sprout sprite. Run: node tools/make-icons.mjs
// Pure Node (zlib only): nearest-neighbour upscale onto a solid tile, written as PNG.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderToRGBA } from '../js/sprites.js';

const BG = [0x1e, 0x6b, 0x45];     // dark green
const BG2 = [0xf2, 0xe6, 0xc9];    // cream plate behind the sprite
const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });

function icon(size, { pad, plate }) {
  const spr = renderToRGBA('icon_sprout');
  const px = Math.floor((size * (1 - 2 * pad)) / 16);
  const off = Math.floor((size - px * 16) / 2);
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inPlate = plate && x >= off - px && x < off + px * 17 && y >= off - px && y < off + px * 17;
      const [r, g, b] = inPlate ? BG2 : BG;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      const sx = Math.floor((x - off) / px), sy = Math.floor((y - off) / px);
      if (sx < 0 || sy < 0 || sx > 15 || sy > 15) continue;
      const j = (sy * 16 + sx) * 4;
      const a = spr.data[j + 3] / 255;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(spr.data[j + c] * a + buf[i + c] * (1 - a));
    }
  }
  return png(size, size, buf);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return crc ^ 0xffffffff;
}

writeFileSync(new URL('icon-32.png', out), icon(32, { pad: 0, plate: false }));
writeFileSync(new URL('icon-192.png', out), icon(192, { pad: 0.12, plate: true }));
writeFileSync(new URL('icon-512.png', out), icon(512, { pad: 0.12, plate: true }));
writeFileSync(new URL('icon-maskable-512.png', out), icon(512, { pad: 0.22, plate: false }));
console.log('icons written');
