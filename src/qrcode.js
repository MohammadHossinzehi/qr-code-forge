'use strict';

const encoder = require('./encoder');
const decoderBits = require('./decoder-bits');
const blocks = require('./blocks');
const matrix = require('./matrix');
const { REMAINDER_BITS, BLOCK_TABLE } = require('./tables');

// Encode `text` into a QR code symbol. Returns { version, ecLevel, mask,
// size, modules } where `modules` is a size x size array of 0/1.
function encode(text, opts = {}) {
  const ecLevel = opts.ecLevel || 'M';
  const minVersion = opts.minVersion || 1;
  if (!['L', 'M', 'Q', 'H'].includes(ecLevel)) {
    throw new Error(`Invalid EC level "${ecLevel}" (expected L, M, Q, or H)`);
  }

  const { version, dataCodewords } = encoder.encode(text, ecLevel, minVersion);
  const allCodewords = blocks.buildInterleavedCodewords(dataCodewords, version, ecLevel);

  const bits = [];
  for (const byte of allCodewords) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  const remBits = REMAINDER_BITS[version];
  for (let i = 0; i < remBits; i++) bits.push(0);

  let best = null;
  for (let m = 0; m < 8; m++) {
    const skeleton = matrix.newSkeleton(version);
    matrix.placeData(skeleton, bits);
    matrix.applyMask(skeleton, m);
    matrix.writeFormatInfo(skeleton, ecLevel, m);
    const score = matrix.penaltyScore(skeleton);
    if (!best || score < best.score) best = { score, skeleton, mask: m };
  }

  return {
    version,
    ecLevel,
    mask: best.mask,
    size: best.skeleton.size,
    modules: best.skeleton.modules,
  };
}

// Decode a QR symbol given as { size, modules }. Returns { text, version,
// ecLevel, mask, errorsCorrected }. Throws if the symbol cannot be read.
function decode({ size, modules }) {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 6) {
    throw new Error(`Unsupported symbol size ${size} (expected a version 1-6 QR code)`);
  }

  const skeleton = matrix.newSkeleton(version);
  skeleton.modules = modules.map((row) => row.slice());

  const fmt = matrix.readFormatInfo(skeleton);
  if (!fmt) throw new Error('Could not recover format information (symbol too damaged)');

  matrix.applyMask(skeleton, fmt.maskIndex);
  const bits = matrix.readData(skeleton);

  const totalDataBytes = BLOCK_TABLE[version][fmt.ecLevel].total;
  const totalCodewordBits = totalDataBytes * 8;
  const codewordBytes = [];
  for (let i = 0; i < totalCodewordBits; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] || 0);
    codewordBytes.push(byte);
  }

  const { dataCodewords, totalErrors } = blocks.deinterleaveAndCorrect(
    codewordBytes,
    version,
    fmt.ecLevel
  );
  const text = decoderBits.decodeBits(dataCodewords);

  return {
    text,
    version,
    ecLevel: fmt.ecLevel,
    mask: fmt.maskIndex,
    errorsCorrected: totalErrors,
    formatBitErrors: fmt.bitErrors,
  };
}

module.exports = { encode, decode };
