'use strict';

// This library implements QR code versions 1-6 (21x21 to 41x41 modules).
// Versions 7+ require an additional 18-bit BCH-encoded "version information"
// block and are out of scope here — see the README for the rationale.
const MAX_VERSION = 6;

// Per-version, per-EC-level block layout: [totalCodewords, eccPerBlock,
// [ [blockCount, blockDataLen], ... ] ]. Values from the ISO/IEC 18004
// error-correction characteristics table (Annex).
const BLOCK_TABLE = {
  1: {
    L: { total: 26, eccPerBlock: 7, groups: [[1, 19]] },
    M: { total: 26, eccPerBlock: 10, groups: [[1, 16]] },
    Q: { total: 26, eccPerBlock: 13, groups: [[1, 13]] },
    H: { total: 26, eccPerBlock: 17, groups: [[1, 9]] },
  },
  2: {
    L: { total: 44, eccPerBlock: 10, groups: [[1, 34]] },
    M: { total: 44, eccPerBlock: 16, groups: [[1, 28]] },
    Q: { total: 44, eccPerBlock: 22, groups: [[1, 22]] },
    H: { total: 44, eccPerBlock: 28, groups: [[1, 16]] },
  },
  3: {
    L: { total: 70, eccPerBlock: 15, groups: [[1, 55]] },
    M: { total: 70, eccPerBlock: 26, groups: [[1, 44]] },
    Q: { total: 70, eccPerBlock: 18, groups: [[2, 17]] },
    H: { total: 70, eccPerBlock: 22, groups: [[2, 13]] },
  },
  4: {
    L: { total: 100, eccPerBlock: 20, groups: [[1, 80]] },
    M: { total: 100, eccPerBlock: 18, groups: [[2, 32]] },
    Q: { total: 100, eccPerBlock: 26, groups: [[2, 24]] },
    H: { total: 100, eccPerBlock: 16, groups: [[4, 9]] },
  },
  5: {
    L: { total: 134, eccPerBlock: 26, groups: [[1, 108]] },
    M: { total: 134, eccPerBlock: 24, groups: [[2, 43]] },
    Q: { total: 134, eccPerBlock: 18, groups: [[2, 15], [2, 16]] },
    H: { total: 134, eccPerBlock: 22, groups: [[2, 11], [2, 12]] },
  },
  6: {
    L: { total: 172, eccPerBlock: 18, groups: [[2, 68]] },
    M: { total: 172, eccPerBlock: 16, groups: [[4, 27]] },
    Q: { total: 172, eccPerBlock: 24, groups: [[4, 19]] },
    H: { total: 172, eccPerBlock: 28, groups: [[4, 15]] },
  },
};

// Alignment-pattern center coordinates per axis (versions 2-6 have exactly
// one pattern away from the finder corners; version 1 has none).
const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

// Remainder bits appended after the interleaved codeword bitstream.
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };

const EC_LEVEL_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };
const EC_LEVEL_BY_BITS = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const MODE = { NUMERIC: 0b0001, ALPHANUMERIC: 0b0010, BYTE: 0b0100 };

function symbolSize(version) {
  return 17 + 4 * version;
}

module.exports = {
  MAX_VERSION,
  BLOCK_TABLE,
  ALIGNMENT_POSITIONS,
  REMAINDER_BITS,
  EC_LEVEL_BITS,
  EC_LEVEL_BY_BITS,
  ALPHANUMERIC_CHARSET,
  MODE,
  symbolSize,
};
