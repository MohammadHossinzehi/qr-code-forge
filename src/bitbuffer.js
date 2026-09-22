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
