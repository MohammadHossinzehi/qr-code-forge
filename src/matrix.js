'use strict';

const { symbolSize, ALIGNMENT_POSITIONS, EC_LEVEL_BITS, EC_LEVEL_BY_BITS } = require('./tables');

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
