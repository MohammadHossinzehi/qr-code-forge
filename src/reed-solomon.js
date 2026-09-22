// Reed-Solomon encoding and syndrome-based error correction over GF(256),
// as used by QR codes (roots alpha^0 .. alpha^(eccLen-1)).
'use strict';

const gf = require('./gf256');

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
