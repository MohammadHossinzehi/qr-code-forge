'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const gf = require('../src/gf256');
const rs = require('../src/reed-solomon');
const qr = require('../src/qrcode');
const encoder = require('../src/encoder');
const matrix = require('../src/matrix');
const { BLOCK_TABLE } = require('../src/tables');

// --- GF(256) field arithmetic ---

test('GF(256): every nonzero element has a multiplicative inverse', () => {
  for (let a = 1; a < 256; a++) {
    assert.equal(gf.mul(a, gf.inv(a)), 1);
  }
});

test('GF(256): multiplication is commutative and distributes over XOR', () => {
  const samples = [1, 2, 3, 17, 100, 200, 255];
  for (const a of samples) {
    for (const b of samples) {
      assert.equal(gf.mul(a, b), gf.mul(b, a));
    }
  }
  for (const a of samples) {
    for (const b of samples) {
      for (const c of samples) {
        // a*(b^c) == a*b ^ a*c  (distributivity over the field's addition, XOR)
        assert.equal(gf.mul(a, b ^ c), gf.mul(a, b) ^ gf.mul(a, c));
      }
    }
  }
});

test('GF(256): pow/mul/log/exp agree', () => {
  for (let a = 1; a < 256; a++) {
    assert.equal(gf.pow(a, 2), gf.mul(a, a));
    assert.equal(gf.pow(a, 0), 1);
  }
});

// --- Reed-Solomon ---

test('Reed-Solomon: an untouched codeword is a root of the generator (all syndromes zero)', () => {
  const data = [64, 6, 135, 71, 71, 7, 51, 162, 242, 246, 87, 134, 22, 215, 6];
  const eccLen = 10;
  const ecc = rs.computeECC(data, eccLen);
  const codeword = data.concat(ecc);
  for (let j = 0; j < eccLen; j++) {
    assert.equal(rs.polyEval(codeword, gf.EXP[j]), 0);
  }
});

test('Reed-Solomon: corrects errors up to floor(eccLen/2) and detects the rest', () => {
  const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) % 256);
  const eccLen = 16; // corrects up to 8 byte errors
  const ecc = rs.computeECC(data, eccLen);
  const codeword = data.concat(ecc);

  // Within capability: exact recovery.
  for (let numErrors = 1; numErrors <= 8; numErrors++) {
    const corrupted = codeword.slice();
    const positions = new Set();
    while (positions.size < numErrors) positions.add(Math.floor(Math.random() * corrupted.length));
    for (const p of positions) corrupted[p] ^= 0xff;
    const { codewords, errorCount } = rs.decodeECC(corrupted, eccLen);
    assert.deepEqual(codewords, data, `failed with ${numErrors} errors`);
    assert.equal(errorCount, numErrors);
  }
});

test('Reed-Solomon: no-error codewords decode with zero corrections', () => {
  const data = [1, 2, 3, 4, 5, 6, 7, 8];
  const ecc = rs.computeECC(data, 10);
  const { codewords, errorCount } = rs.decodeECC(data.concat(ecc), 10);
  assert.deepEqual(codewords, data);
  assert.equal(errorCount, 0);
});

// --- Format information (BCH) ---

test('Format info: encode/decode round trip for every EC level and mask', () => {
  for (const ec of ['L', 'M', 'Q', 'H']) {
    for (let mask = 0; mask < 8; mask++) {
      const bits = matrix.computeFormatBits(ec, mask);
      const decoded = matrix.decodeFormatBits(bits);
      assert.deepEqual(decoded, { ecLevel: ec, maskIndex: mask, bitErrors: 0 });
    }
  }
});

test('Format info: corrects up to 3 flipped bits', () => {
  const bits = matrix.computeFormatBits('Q', 5);
  for (let trial = 0; trial < 20; trial++) {
    const numFlips = 1 + Math.floor(Math.random() * 3);
    let corrupted = bits;
    const flipped = new Set();
    while (flipped.size < numFlips) flipped.add(Math.floor(Math.random() * 15));
    for (const b of flipped) corrupted ^= 1 << b;
    const decoded = matrix.decodeFormatBits(corrupted);
    assert.deepEqual(decoded, { ecLevel: 'Q', maskIndex: 5, bitErrors: numFlips });
  }
});

// --- End-to-end encode/decode ---

test('QR: round-trips short strings across all EC levels', () => {
  for (const ecLevel of ['L', 'M', 'Q', 'H']) {
    for (const text of ['HELLO WORLD', '0123456789', 'A', '']) {
      const sym = qr.encode(text, { ecLevel });
      const result = qr.decode(sym);
      assert.equal(result.text, text);
      assert.equal(result.ecLevel, ecLevel);
    }
  }
});

test('QR: round-trips byte-mode text with punctuation and unicode', () => {
  const texts = [
    'The quick brown fox jumps over the lazy dog.',
    'Mixed Content 123 test!@#',
    '短いテスト',
    'https://example.com/path?query=1&x=2#frag',
  ];
  for (const text of texts) {
    const sym = qr.encode(text, { ecLevel: 'M' });
    const result = qr.decode(sym);
    assert.equal(result.text, text);
  }
});

test('QR: picks the smallest version that fits, and versions scale with length', () => {
  const short = qr.encode('HI', { ecLevel: 'M' });
  const long = qr.encode('X'.repeat(150), { ecLevel: 'M' });
  assert.ok(short.version < long.version);
});

test('QR: throws a clear error when text exceeds the max supported version', () => {
  assert.throws(() => qr.encode('X'.repeat(2000), { ecLevel: 'H' }), /Text too long/);
});

test('QR: rejects an invalid EC level', () => {
  assert.throws(() => qr.encode('hi', { ecLevel: 'Z' }), /Invalid EC level/);
});

test('QR: numeric mode is chosen for digit-only strings (smaller payload)', () => {
  const mode = encoder.detectMode('0123456789');
  const { MODE } = require('../src/tables');
  assert.equal(mode, MODE.NUMERIC);
});

test('QR: recovers the original text after random errors within EC capability', () => {
  const text = 'Reed-Solomon protects this message from damage.';
  for (const ecLevel of ['L', 'M', 'Q', 'H']) {
    const sym = qr.encode(text, { ecLevel });
    const { eccPerBlock } = BLOCK_TABLE[sym.version][ecLevel];
    const maxErrors = Math.floor(eccPerBlock / 2);

    const skeleton = matrix.newSkeleton(sym.version);
    const dataPositions = [];
    for (let r = 0; r < skeleton.size; r++) {
      for (let c = 0; c < skeleton.size; c++) {
        if (!skeleton.isFunction[r][c]) dataPositions.push([r, c]);
      }
    }

    const modules = sym.modules.map((row) => row.slice());
    const numFlips = Math.max(1, Math.floor(maxErrors / 2));
    const used = new Set();
    while (used.size < numFlips) {
      const [r, c] = dataPositions[Math.floor(Math.random() * dataPositions.length)];
      used.add(`${r},${c}`);
    }
    for (const key of used) {
      const [r, c] = key.split(',').map(Number);
      modules[r][c] ^= 1;
    }

    const result = qr.decode({ size: sym.size, modules });
    assert.equal(result.text, text);
    assert.ok(result.errorsCorrected > 0, 'expected at least one corrected error to be reported');
  }
});

test('QR: decode rejects a symbol with an unsupported size', () => {
  assert.throws(() => qr.decode({ size: 22, modules: [] }), /Unsupported symbol size/);
});
