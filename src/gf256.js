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
