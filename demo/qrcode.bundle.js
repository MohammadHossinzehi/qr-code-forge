// Auto-generated browser bundle of qr-code-forge.
// Source of truth is /src (plain CommonJS Node modules); this file just
// concatenates them with a tiny require() shim so the demo page can run
// without a build step. Regenerate with: node tools/build-bundle.js
(function (global) {
  "use strict";
  const __modules = {};
  const __cache = {};
  function __require(name) {
    if (__cache[name]) return __cache[name].exports;
    const mod = { exports: {} };
    __cache[name] = mod;
    __modules[name](mod, mod.exports, __require);
    return mod.exports;
  }
  __modules['zlib'] = function (module) {
    module.exports = { deflateSync: function () {
      throw new Error('PNG export is not available in the browser bundle; use the CLI (bin/cli.js) for PNG output.');
    } };
  };

  __modules['gf256'] = function (module, exports, require) {
// GF(256) arithmetic for Reed-Solomon, using the QR code primitive polynomial
// x^8 + x^4 + x^3 + x^2 + 1 (0x11D) with generator element 2.
'use strict';

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function init() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function inv(a) {
  if (a === 0) throw new Error('GF256: no inverse of 0');
  return EXP[255 - LOG[a]];
}

function div(a, b) {
  if (b === 0) throw new Error('GF256: division by 0');
  if (a === 0) return 0;
  return EXP[(LOG[a] - LOG[b] + 255) % 255];
}

function pow(a, n) {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP[(LOG[a] * ((n % 255) + 255)) % 255];
}

module.exports = { EXP, LOG, mul, inv, div, pow };

  };

  __modules['reed-solomon'] = function (module, exports, require) {
// Reed-Solomon encoding and syndrome-based error correction over GF(256),
// as used by QR codes (roots alpha^0 .. alpha^(eccLen-1)).
'use strict';

const gf = __require('gf256');

// Multiply two polynomials given as coefficient arrays, highest degree first.
function mulPoly(a, b) {
  const res = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      res[i + j] ^= gf.mul(a[i], b[j]);
    }
  }
  return res;
}

// Generator polynomial g(x) = product_{i=0}^{degree-1} (x - alpha^i)
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = mulPoly(poly, [1, gf.EXP[i]]);
  }
  return poly;
}

// Evaluate polynomial (highest degree first) at x using Horner's method.
function polyEval(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) {
    y = gf.mul(y, x) ^ poly[i];
  }
  return y;
}

// Compute `eccLen` error-correction codewords for `data` (array of bytes).
function computeECC(data, eccLen) {
  const gen = generatorPoly(eccLen);
  const remainder = new Uint8Array(data.length + eccLen);
  remainder.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = remainder[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        remainder[i + j] ^= gf.mul(gen[j], coef);
      }
    }
  }
  return Array.from(remainder.slice(data.length));
}

// Berlekamp-Massey algorithm. `synd` is the syndrome sequence S_0..S_{n-1}.
// Returns the error locator polynomial Lambda(x) as [1, l1, l2, ...] with
// coefficient of x^0 first (low-degree first).
function berlekampMassey(synd) {
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < synd.length; n++) {
    let delta = synd[n];
    for (let i = 1; i <= L; i++) {
      delta ^= gf.mul(C[i] || 0, synd[n - i]);
    }
    if (delta === 0) {
      m++;
    } else if (2 * L <= n) {
      const T = C.slice();
      const coef = gf.div(delta, b);
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) {
        C[i + m] ^= gf.mul(coef, B[i]);
      }
      L = n + 1 - L;
      B = T;
      b = delta;
      m = 1;
    } else {
      const coef = gf.div(delta, b);
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) {
        C[i + m] ^= gf.mul(coef, B[i]);
      }
      m++;
    }
  }
  // trim trailing zero coefficients beyond the true degree
  let deg = C.length - 1;
  while (deg > 0 && C[deg] === 0) deg--;
  return C.slice(0, deg + 1);
}

// Decode a received codeword (array of bytes, highest-degree/data byte
// first) that carries `eccLen` error-correction codewords. Returns
// { codewords, errorCount } with corrected bytes, or throws if the errors
// exceed the code's correction capability.
function decodeECC(received, eccLen) {
  const n = received.length;
  const poly = received.slice(); // high-degree first, same order as sent

  // Syndromes S_j = poly(alpha^j) for j = 0..eccLen-1
  const synd = new Array(eccLen);
  let allZero = true;
  for (let j = 0; j < eccLen; j++) {
    const s = polyEval(poly, gf.EXP[j]);
    synd[j] = s;
    if (s !== 0) allZero = false;
  }
  if (allZero) {
    return { codewords: poly.slice(0, n - eccLen), errorCount: 0 };
  }

  const lambda = berlekampMassey(synd); // low-degree first
  const errDeg = lambda.length - 1;
  if (errDeg <= 0 || errDeg > eccLen / 2) {
    throw new Error('Reed-Solomon: too many errors to correct');
  }

  // Chien search: find roots of lambda(x). Position index i (0-based from
  // the start of `poly`, i.e. exponent n-1-i in the codeword polynomial)
  // is an error location if lambda(alpha^-(n-1-i)) == 0, equivalently
  // lambda(alpha^i) == 0 when we index positions from the end.
  const errorPositions = [];
  for (let i = 0; i < n; i++) {
    const exponent = (n - 1 - i) % 255;
    const x = gf.EXP[(255 - exponent) % 255]; // alpha^-(n-1-i)
    let y = lambda[0];
    for (let k = 1; k < lambda.length; k++) {
      y ^= gf.mul(lambda[k], gf.pow(x, k));
    }
    if (y === 0) errorPositions.push(i);
  }
  if (errorPositions.length !== errDeg) {
    throw new Error('Reed-Solomon: Chien search failed (uncorrectable)');
  }

  // Formal derivative of lambda for Forney's algorithm: lambda'(x).
  // d/dx (c_k x^k) = k*c_k x^(k-1); in GF(2^m) arithmetic k*c_k is c_k for
  // odd k and 0 for even k, so odd-degree terms survive at exponent k-1.
  const lambdaDeriv = new Array(Math.max(lambda.length - 1, 0)).fill(0);
  for (let k = 1; k < lambda.length; k++) {
    if (k % 2 === 1) lambdaDeriv[k - 1] = lambda[k];
  }

  // Error evaluator polynomial Omega(x) = [S(x) * Lambda(x)] mod x^eccLen,
  // built from low-degree-first syndrome/lambda representations.
  const sLow = synd.slice(); // S_0 .. S_{eccLen-1}, low-degree first
  const omegaFull = new Array(sLow.length + lambda.length - 1).fill(0);
  for (let i = 0; i < sLow.length; i++) {
    if (sLow[i] === 0) continue;
    for (let j = 0; j < lambda.length; j++) {
      omegaFull[i + j] ^= gf.mul(sLow[i], lambda[j]);
    }
  }
  const omega = omegaFull.slice(0, eccLen);

  function evalLowFirst(poly, x) {
    let y = 0;
    let xp = 1;
    for (let i = 0; i < poly.length; i++) {
      y ^= gf.mul(poly[i], xp);
      xp = gf.mul(xp, x);
    }
    return y;
  }

  const corrected = poly.slice();
  for (const i of errorPositions) {
    const exponent = (n - 1 - i) % 255;
    const xInv = gf.EXP[(255 - exponent) % 255];
    const x = gf.EXP[exponent % 255];
    const omegaVal = evalLowFirst(omega, xInv);
    const lambdaDerivVal = evalLowFirst(lambdaDeriv, xInv);
    if (lambdaDerivVal === 0) {
      throw new Error('Reed-Solomon: Forney algorithm division by zero');
    }
    const magnitude = gf.mul(x, gf.div(omegaVal, lambdaDerivVal));
    corrected[i] ^= magnitude;
  }

  // Verify
  for (let j = 0; j < eccLen; j++) {
    if (polyEval(corrected, gf.EXP[j]) !== 0) {
      throw new Error('Reed-Solomon: correction failed verification');
    }
  }

  return { codewords: corrected.slice(0, n - eccLen), errorCount: errorPositions.length };
}

module.exports = { computeECC, decodeECC, generatorPoly, polyEval, mulPoly };

  };

  __modules['tables'] = function (module, exports, require) {
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

  };

  __modules['bitbuffer'] = function (module, exports, require) {
'use strict';

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  pushBit(bit) {
    this.bits.push(bit & 1);
  }
  get length() {
    return this.bits.length;
  }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] || 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

// Reader over a flat array of bytes, MSB-first, for decoding.
class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0; // bit position
  }
  read(length) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      const byteIndex = this.pos >> 3;
      const bitIndex = 7 - (this.pos & 7);
      const byte = this.bytes[byteIndex] || 0;
      const bit = (byte >> bitIndex) & 1;
      value = (value << 1) | bit;
      this.pos++;
    }
    return value;
  }
  bitsLeft() {
    return this.bytes.length * 8 - this.pos;
  }
}

module.exports = { BitBuffer, BitReader };

  };

  __modules['encoder'] = function (module, exports, require) {
'use strict';

const { BitBuffer } = __require('bitbuffer');
const { MODE, ALPHANUMERIC_CHARSET, BLOCK_TABLE, MAX_VERSION } = __require('tables');

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

  };

  __modules['decoder-bits'] = function (module, exports, require) {
'use strict';

const { BitReader } = __require('bitbuffer');
const { MODE, ALPHANUMERIC_CHARSET } = __require('tables');

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

  };

  __modules['blocks'] = function (module, exports, require) {
'use strict';

const rs = __require('reed-solomon');
const { BLOCK_TABLE } = __require('tables');

function blockLayout(version, ecLevel) {
  const { groups, eccPerBlock } = BLOCK_TABLE[version][ecLevel];
  const lengths = [];
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) lengths.push(len);
  }
  return { lengths, eccPerBlock };
}

// Split padded data codewords into blocks, compute ECC per block, and
// interleave data then ECC codewords the way QR codes transmit them.
function buildInterleavedCodewords(dataCodewords, version, ecLevel) {
  const { lengths, eccPerBlock } = blockLayout(version, ecLevel);
  const blocks = [];
  let offset = 0;
  for (const len of lengths) {
    const block = dataCodewords.slice(offset, offset + len);
    offset += len;
    const ecc = rs.computeECC(block, eccPerBlock);
    blocks.push({ data: block, ecc });
  }

  const maxDataLen = Math.max(...lengths);
  const dataInterleaved = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) if (i < b.data.length) dataInterleaved.push(b.data[i]);
  }
  const eccInterleaved = [];
  for (let i = 0; i < eccPerBlock; i++) {
    for (const b of blocks) eccInterleaved.push(b.ecc[i]);
  }
  return dataInterleaved.concat(eccInterleaved);
}

// Inverse: given the full interleaved codeword stream read back off a
// symbol, split it into blocks, Reed-Solomon-correct each one, and return
// the original (unpadded-by-blocks) data codewords plus total errors fixed.
function deinterleaveAndCorrect(allCodewords, version, ecLevel) {
  const { lengths, eccPerBlock } = blockLayout(version, ecLevel);
  const numBlocks = lengths.length;
  const maxDataLen = Math.max(...lengths);
  const totalData = lengths.reduce((a, b) => a + b, 0);

  const blockData = lengths.map(() => []);
  let idx = 0;
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < lengths[b]) blockData[b].push(allCodewords[idx++]);
    }
  }
  const blockEcc = lengths.map(() => []);
  for (let i = 0; i < eccPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) blockEcc[b].push(allCodewords[idx++]);
  }

  let totalErrors = 0;
  const dataCodewords = [];
  for (let b = 0; b < numBlocks; b++) {
    const codeword = blockData[b].concat(blockEcc[b]);
    const { codewords, errorCount } = rs.decodeECC(codeword, eccPerBlock);
    totalErrors += errorCount;
    for (const c of codewords) dataCodewords.push(c);
  }
  return { dataCodewords, totalErrors, totalDataLen: totalData };
}

module.exports = { blockLayout, buildInterleavedCodewords, deinterleaveAndCorrect };

  };

  __modules['matrix'] = function (module, exports, require) {
'use strict';

const { symbolSize, ALIGNMENT_POSITIONS, EC_LEVEL_BITS, EC_LEVEL_BY_BITS } = __require('tables');

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

const ALIGNMENT = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];

function makeGrid(size, fill) {
  return Array.from({ length: size }, () => new Array(size).fill(fill));
}

function newSkeleton(version) {
  const size = symbolSize(version);
  const modules = makeGrid(size, 0);
  const isFunction = makeGrid(size, false);

  function setF(row, col, val) {
    modules[row][col] = val ? 1 : 0;
    isFunction[row][col] = true;
  }

  function drawFinder(r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inPattern = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        setF(rr, cc, inPattern ? FINDER[r][c] : 0);
      }
    }
  }
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const positions = ALIGNMENT_POSITIONS[version];
  for (const r of positions) {
    for (const c of positions) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setF(r + dr, c + dc, ALIGNMENT[dr + 2][dc + 2]);
        }
      }
    }
  }

  // Reserve format-info areas (values filled in later, after masking).
  for (let i = 0; i <= 8; i++) {
    if (!isFunction[8][i]) setF(8, i, 0);
    if (!isFunction[i][8]) setF(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    setF(8, size - 1 - i, 0);
    setF(size - 1 - i, 8, 0);
  }

  // Dark module (always on).
  setF(size - 8, 8, true);

  return { size, modules, isFunction };
}

function maskBit(index, row, col) {
  switch (index) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new Error('invalid mask index');
  }
}

// Place data bits into the zig-zag data region, skipping function modules.
function placeData(skeleton, bits) {
  const { size, modules, isFunction } = skeleton;
  let bitIndex = 0;
  let dir = -1;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let vert = 0; vert < size; vert++) {
      const row = dir === -1 ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (isFunction[row][x]) continue;
        modules[row][x] = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex++;
      }
    }
    dir = -dir;
  }
  return bitIndex;
}

// Read data bits back out in the exact same order they were placed.
function readData(skeleton) {
  const { size, modules, isFunction } = skeleton;
  const bits = [];
  let dir = -1;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col--;
    for (let vert = 0; vert < size; vert++) {
      const row = dir === -1 ? size - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const x = col - c;
        if (isFunction[row][x]) continue;
        bits.push(modules[row][x]);
      }
    }
    dir = -dir;
  }
  return bits;
}

function applyMask(skeleton, maskIndex, invert) {
  const { size, modules, isFunction } = skeleton;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isFunction[row][col]) continue;
      if (maskBit(maskIndex, row, col)) {
        modules[row][col] ^= 1;
      }
    }
  }
}

// BCH(15,5) format-information encoding, generator 0x537, mask 0x5412.
function computeFormatBits(ecLevel, maskIndex) {
  const data = (EC_LEVEL_BITS[ecLevel] << 3) | maskIndex;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  rem &= 0x3ff;
  const bits = ((data << 10) | rem) ^ 0x5412;
  return bits & 0x7fff;
}

// Decode 15-bit format info with BCH error correction (up to 3 bit errors)
// by finding the closest of the 32 valid codewords via Hamming distance.
function decodeFormatBits(bits15) {
  let best = null;
  let bestDist = Infinity;
  for (let data = 0; data < 32; data++) {
    const candidate = computeFormatBits(
      Object.keys(EC_LEVEL_BITS).find((k) => EC_LEVEL_BITS[k] === (data >> 3)),
      data & 0b111
    );
    let dist = 0;
    let x = candidate ^ bits15;
    while (x) {
      dist += x & 1;
      x >>>= 1;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = data;
    }
  }
  if (bestDist > 3) return null;
  const ecLevel = EC_LEVEL_BY_BITS[best >> 3];
  const maskIndex = best & 0b111;
  return { ecLevel, maskIndex, bitErrors: bestDist };
}

function writeFormatInfo(skeleton, ecLevel, maskIndex) {
  const { size, modules } = skeleton;
  const bits = computeFormatBits(ecLevel, maskIndex);
  const get = (i) => (bits >> i) & 1;

  // Vertical run, always column 8: bits 0-5 go down rows 0-5 (skipping the
  // row-6 timing module via the +1 offset for bits 6-7), bits 8-14 go up
  // from the bottom-left copy.
  for (let i = 0; i < 15; i++) {
    let row;
    if (i < 6) row = i;
    else if (i < 8) row = i + 1;
    else row = size - 15 + i;
    modules[row][8] = get(i);
  }

  // Horizontal run, always row 8: bits 0-7 go left from the top-right
  // copy, bit 8 sits just right of the timing column, bits 9-14 go left
  // to finish the top-left copy.
  for (let i = 0; i < 15; i++) {
    let col;
    if (i < 8) col = size - 1 - i;
    else if (i < 9) col = 15 - i;
    else col = 14 - i;
    modules[8][col] = get(i);
  }
}

function readFormatInfo(skeleton) {
  const { size, modules } = skeleton;

  let bitsV = 0;
  for (let i = 0; i < 15; i++) {
    let row;
    if (i < 6) row = i;
    else if (i < 8) row = i + 1;
    else row = size - 15 + i;
    bitsV |= modules[row][8] << i;
  }
  const decodedV = decodeFormatBits(bitsV);
  if (decodedV) return decodedV;

  let bitsH = 0;
  for (let i = 0; i < 15; i++) {
    let col;
    if (i < 8) col = size - 1 - i;
    else if (i < 9) col = 15 - i;
    else col = 14 - i;
    bitsH |= modules[8][col] << i;
  }
  return decodeFormatBits(bitsH);
}

// --- Penalty scoring (used to pick the best of the 8 masks) ---
function penaltyScore(skeleton) {
  const { size, modules } = skeleton;
  let penalty = 0;

  // Rule 1: runs of 5+ same-color modules, per row and per column.
  for (let row = 0; row < size; row++) {
    let runColor = -1;
    let runLen = 0;
    for (let col = 0; col < size; col++) {
      const v = modules[row][col];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let col = 0; col < size; col++) {
    let runColor = -1;
    let runLen = 0;
    for (let row = 0; row < size; row++) {
      const v = modules[row][col];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of the same color.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const v = modules[row][col];
      if (
        v === modules[row][col + 1] &&
        v === modules[row + 1][col] &&
        v === modules[row + 1][col + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules alongside.
  const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  function matchesAt(arr, start, pattern) {
    for (let i = 0; i < pattern.length; i++) {
      if (arr[start + i] !== pattern[i]) return false;
    }
    return true;
  }
  for (let row = 0; row < size; row++) {
    const line = modules[row];
    for (let col = 0; col + 11 <= size; col++) {
      if (matchesAt(line, col, patternA) || matchesAt(line, col, patternB)) penalty += 40;
    }
  }
  for (let col = 0; col < size; col++) {
    const line = modules.map((r) => r[col]);
    for (let row = 0; row + 11 <= size; row++) {
      if (matchesAt(line, row, patternA) || matchesAt(line, row, patternB)) penalty += 40;
    }
  }

  // Rule 4: proportion of dark modules vs. 50%.
  let dark = 0;
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) dark += modules[row][col];
  const percent = (dark * 100) / (size * size);
  const deviation = Math.floor(Math.abs(percent - 50) / 5) * 10;
  penalty += deviation;

  return penalty;
}

module.exports = {
  newSkeleton,
  placeData,
  readData,
  applyMask,
  maskBit,
  computeFormatBits,
  decodeFormatBits,
  writeFormatInfo,
  readFormatInfo,
  penaltyScore,
  symbolSize,
};

  };

  __modules['qrcode'] = function (module, exports, require) {
'use strict';

const encoder = __require('encoder');
const decoderBits = __require('decoder-bits');
const blocks = __require('blocks');
const matrix = __require('matrix');
const { REMAINDER_BITS, BLOCK_TABLE } = __require('tables');

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

  };

  __modules['render'] = function (module, exports, require) {
'use strict';

const zlib = __require('zlib');

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

  };

  global.QRCodeForge = __require('qrcode');
  global.QRCodeForgeRender = __require('render');
})(typeof window !== "undefined" ? window : globalThis);
