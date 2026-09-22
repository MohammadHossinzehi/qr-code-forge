'use strict';

const { BitReader } = require('./bitbuffer');
const { MODE, ALPHANUMERIC_CHARSET } = require('./tables');

function decodeBits(dataCodewords) {
  const reader = new BitReader(dataCodewords);
  if (reader.bitsLeft() < 4) return '';
  const mode = reader.read(4);
  if (mode === 0) return '';

  if (mode === MODE.NUMERIC) {
    const count = reader.read(10);
    let digits = '';
    let remaining = count;
    while (remaining >= 3) {
      digits += String(reader.read(10)).padStart(3, '0');
      remaining -= 3;
    }
    if (remaining === 2) digits += String(reader.read(7)).padStart(2, '0');
    else if (remaining === 1) digits += String(reader.read(4));
    return digits;
  }

  if (mode === MODE.ALPHANUMERIC) {
    const count = reader.read(9);
    let out = '';
    let remaining = count;
    while (remaining >= 2) {
      const v = reader.read(11);
      out += ALPHANUMERIC_CHARSET[Math.floor(v / 45)] + ALPHANUMERIC_CHARSET[v % 45];
      remaining -= 2;
    }
    if (remaining === 1) out += ALPHANUMERIC_CHARSET[reader.read(6)];
    return out;
  }

  if (mode === MODE.BYTE) {
    const count = reader.read(8);
    const bytes = [];
    for (let i = 0; i < count; i++) bytes.push(reader.read(8));
    return Buffer.from(bytes).toString('utf8');
  }

  throw new Error(`Unsupported or corrupted mode indicator: ${mode}`);
}

module.exports = { decodeBits };
