'use strict';

const zlib = require('zlib');

function toSVG(sym, opts = {}) {
  const scale = opts.scale || 8;
  const margin = opts.margin === undefined ? 4 : opts.margin;
  const dim = (sym.size + margin * 2) * scale;
  let rects = '';
  for (let r = 0; r < sym.size; r++) {
    for (let c = 0; c < sym.size; c++) {
      if (sym.modules[r][c]) {
        const x = (c + margin) * scale;
        const y = (r + margin) * scale;
        rects += `<rect x="${x}" y="${y}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<g fill="#000">${rects}</g>` +
    `</svg>`
  );
}

function toASCII(sym, opts = {}) {
  const margin = opts.margin === undefined ? 2 : opts.margin;
  const size = sym.size + margin * 2;
  const lines = [];
  for (let r = 0; r < size; r++) {
    let line = '';
    for (let c = 0; c < size; c++) {
      const rr = r - margin;
      const cc = c - margin;
      const dark =
        rr >= 0 && rr < sym.size && cc >= 0 && cc < sym.size ? sym.modules[rr][cc] : 0;
      line += dark ? '##' : '  ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// --- Minimal from-scratch PNG encoder (8-bit grayscale, no dependencies) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function toPNGBuffer(sym, opts = {}) {
  const scale = opts.scale || 8;
  const margin = opts.margin === undefined ? 4 : opts.margin;
  const dim = (sym.size + margin * 2) * scale;

  const raw = Buffer.alloc(dim * (dim + 1)); // +1 filter byte per row
  for (let y = 0; y < dim; y++) {
    const rowStart = y * (dim + 1);
    raw[rowStart] = 0; // filter type: none
    const modRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < dim; x++) {
      const modCol = Math.floor(x / scale) - margin;
      const dark =
        modRow >= 0 && modRow < sym.size && modCol >= 0 && modCol < sym.size
          ? sym.modules[modRow][modCol]
          : 0;
      raw[rowStart + 1 + x] = dark ? 0 : 255;
    }
  }

  const idatData = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { toSVG, toASCII, toPNGBuffer };
