'use strict';

const { BitBuffer } = require('./bitbuffer');
const { MODE, ALPHANUMERIC_CHARSET, BLOCK_TABLE, MAX_VERSION } = require('./tables');

function detectMode(text) {
  if (text.length > 0 && /^[0-9]+$/.test(text)) return MODE.NUMERIC;
  if (text.length > 0 && [...text].every((c) => ALPHANUMERIC_CHARSET.includes(c))) {
    return MODE.ALPHANUMERIC;
  }
  return MODE.BYTE;
}

// Versions 1-9 all share the same char-count-indicator widths.
function charCountBits(mode) {
  if (mode === MODE.NUMERIC) return 10;
  if (mode === MODE.ALPHANUMERIC) return 9;
  return 8;
}

function payloadBitLength(mode, text, byteLen) {
  if (mode === MODE.NUMERIC) {
    const n = text.length;
    const full = Math.floor(n / 3);
    const rem = n % 3;
    return full * 10 + (rem === 2 ? 7 : rem === 1 ? 4 : 0);
  }
  if (mode === MODE.ALPHANUMERIC) {
    const n = text.length;
    return Math.floor(n / 2) * 11 + (n % 2 === 1 ? 6 : 0);
  }
  return byteLen * 8;
}

function dataCapacityBytes(version, ecLevel) {
  const { groups } = BLOCK_TABLE[version][ecLevel];
  return groups.reduce((sum, [count, len]) => sum + count * len, 0);
}

function chooseVersion(mode, text, byteLen, ecLevel, minVersion) {
  for (let v = Math.max(1, minVersion); v <= MAX_VERSION; v++) {
    const headerBits = 4 + charCountBits(mode);
    const bodyBits = payloadBitLength(mode, text, byteLen);
    const capacityBits = dataCapacityBytes(v, ecLevel) * 8;
    if (headerBits + bodyBits <= capacityBits) return v;
  }
  return null;
}

function encodeNumeric(buf, text) {
  for (let i = 0; i < text.length; i += 3) {
    const chunk = text.slice(i, i + 3);
    const bits = chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4;
    buf.push(parseInt(chunk, 10), bits);
  }
}

function encodeAlphanumeric(buf, text) {
  for (let i = 0; i < text.length; i += 2) {
    const a = ALPHANUMERIC_CHARSET.indexOf(text[i]);
    if (i + 1 < text.length) {
      const b = ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
      buf.push(a * 45 + b, 11);
    } else {
      buf.push(a, 6);
    }
  }
}

function encodeByte(buf, bytes) {
  for (const b of bytes) buf.push(b, 8);
}

// Build the padded data codeword array for `text` at the smallest version
// (>= minVersion) that fits at the requested EC level.
function encode(text, ecLevel, minVersion = 1) {
  const mode = detectMode(text);
  const byteData = mode === MODE.BYTE ? Array.from(Buffer.from(text, 'utf8')) : null;
  const byteLen = byteData ? byteData.length : 0;

  const version = chooseVersion(mode, text, byteLen, ecLevel, minVersion);
  if (version === null) {
    throw new Error(
      `Text too long: no supported version (max ${MAX_VERSION}) at EC level ${ecLevel} can hold ${text.length} characters`
    );
  }

  const buf = new BitBuffer();
  buf.push(mode, 4);
  const count = mode === MODE.BYTE ? byteLen : text.length;
  buf.push(count, charCountBits(mode));

  if (mode === MODE.NUMERIC) encodeNumeric(buf, text);
  else if (mode === MODE.ALPHANUMERIC) encodeAlphanumeric(buf, text);
  else encodeByte(buf, byteData);

  const capacityBits = dataCapacityBytes(version, ecLevel) * 8;
  const terminatorLen = Math.min(4, capacityBits - buf.length);
  for (let i = 0; i < terminatorLen; i++) buf.pushBit(0);
  while (buf.length % 8 !== 0) buf.pushBit(0);

  const dataCodewords = buf.toBytes();
  const capacityBytes = capacityBits / 8;
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (dataCodewords.length < capacityBytes) {
    dataCodewords.push(padBytes[p % 2]);
    p++;
  }

  return { version, mode, dataCodewords };
}

module.exports = {
  detectMode,
  charCountBits,
  payloadBitLength,
  dataCapacityBytes,
  chooseVersion,
  encode,
};
