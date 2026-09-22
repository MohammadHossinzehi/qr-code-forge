'use strict';

const rs = require('./reed-solomon');
const { BLOCK_TABLE } = require('./tables');

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
