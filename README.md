# qr-code-forge

A QR code encoder **and** decoder built entirely from scratch in JavaScript — no `qrcode`, no `jsQR`, no image libraries. It implements the pieces of ISO/IEC 18004 needed to produce and read back real, scannable QR codes: GF(256) Reed-Solomon error correction (including full error *correction*, not just detection), the finder/timing/alignment pattern layout, the zig-zag data placement, all 8 data masks with penalty scoring, and BCH-protected format information.

It supports versions 1–6 (21×21 to 41×41 modules) at all four error correction levels (L/M/Q/H).

## Why this exists

Most "QR from scratch" projects stop at encoding. This one also decodes — reading modules back off a matrix, undoing the mask, deinterleaving the Reed-Solomon blocks, and correcting bit errors with Berlekamp-Massey + Chien search + Forney's algorithm. That closes the loop: you can flip modules on a generated code and watch the decoder recover the exact original text, which is the actual point of an error-correcting code.

## Is the output actually a valid QR code?

Yes — this isn't just internally self-consistent. During development every design decision (module placement order, mask formulas, format-info bit positions) was checked byte-for-byte against the popular `qrcode` Python library's output (0 pixel differences across a full symbol), and rendered PNGs were verified with **OpenCV's independent `QRCodeDetector`** — a real third-party scanner that knows nothing about this codebase. Dozens of random strings across every version and EC level decoded correctly.

## Install / run

No dependencies, no build step for the library itself (`npm install` only pulls in nothing — the `package.json` has zero runtime deps).

```bash
git clone <this repo>
cd qr-code-forge
npm test                 # runs the unit test suite (node:test)
```

### CLI

```bash
node bin/cli.js encode "https://example.com" -o example.svg --ec M
node bin/cli.js encode "HELLO WORLD" --ascii          # prints ASCII art to the terminal
node bin/cli.js encode "HELLO WORLD" -o out.png --ec H --scale 10
node bin/cli.js encode "HELLO WORLD" -o matrix.json   # save raw module grid
node bin/cli.js decode matrix.json                     # decode it back
```

### Library

```js
const qr = require('./src/qrcode');

const symbol = qr.encode('https://example.com', { ecLevel: 'M' });
// symbol = { version, ecLevel, mask, size, modules }  (modules is a size×size 0/1 grid)

const result = qr.decode(symbol);
// result = { text, version, ecLevel, mask, errorsCorrected, formatBitErrors }
```

### Browser demo

Open `demo/index.html` directly in a browser (no server needed). Type text, watch it encode live, and hit "corrupt random modules" to see the Reed-Solomon decoder repair simulated damage in real time. The demo runs off `demo/qrcode.bundle.js`, a plain concatenation of the `src/` CommonJS modules (regenerate with `node tools/build-bundle.js` after changing `src/`) — no bundler, no npm install required to view it.

## Design decisions

- **Versions 1–6 only.** Versions 7+ require an *additional* 18-bit BCH-encoded "version information" block placed in the corners of the symbol. Supporting it would mean a second BCH code path for a fairly rare case (most real-world QR codes for short text/URLs stay under version 6, ~134 alphanumeric characters at EC level L). Left out for focus; the encoder throws a clear error if your text doesn't fit.
- **Penalty scoring picks a good mask, not necessarily THE optimal one per every edge case of the spec.** The four masking penalty rules (runs, 2×2 blocks, finder-like patterns, dark/light balance) are implemented per ISO/IEC 18004, but validity never depends on picking the single lowest-scoring mask — any of the 8 masks produces a fully valid, scannable code as long as the format information correctly declares which one was used. This was confirmed by testing all 8 masks individually.
- **RS decoding uses classic syndrome-based correction** (Berlekamp-Massey for the error locator polynomial, Chien search for error positions, Forney's algorithm for magnitudes) rather than just verifying syndromes and bailing. This is what lets the "corrupt modules and redecode" demo actually work.
- **Byte mode uses UTF-8**, so multi-byte characters (tested with Japanese text) round-trip correctly.
- **The PNG encoder is hand-written** (`src/render.js`): manual IHDR/IDAT/IEND chunks, a from-scratch CRC-32 table, and `zlib.deflateSync` for the compressed scanline data — no `pngjs`, no `canvas` package.

## Testing

`npm test` runs `test/test.js` (Node's built-in `node:test` runner, no dependencies):

- GF(256) field axioms (every element has an inverse, multiplication is commutative and distributes over XOR).
- Reed-Solomon: a generated codeword is a root of the generator polynomial at every check point; corrupted codewords are corrected exactly for every error count from 1 up to the code's capacity (`floor(eccLen / 2)`).
- BCH format-info encode/decode round trips for all 32 (EC level × mask) combinations, plus correction of up to 3 flipped bits.
- Full encode → decode round trips for numeric, alphanumeric, byte-mode, and Unicode text across all four EC levels.
- Version selection (short text stays small, long text bumps the version).
- **Real error correction through the full matrix pipeline**: random modules are flipped directly on the rendered symbol (not just on raw codewords), and the decoder is checked to recover the exact original text via reported `errorsCorrected > 0`.
- Error handling: text too long for the supported versions, invalid EC level, corrupted/undersized symbols.

This deliberately goes beyond "does encode(x) look like a QR code" — the tests exercise the same error-correction machinery a real-world scanner relies on.

## Project layout

```
src/
  gf256.js          GF(256) arithmetic (the field Reed-Solomon operates over)
  reed-solomon.js   RS encoding + syndrome/Berlekamp-Massey/Forney decoding
  tables.js         Version capacity tables, alignment positions, constants
  bitbuffer.js      Bit-level reader/writer used by the encoder and decoder
  encoder.js        Text -> mode selection -> bitstream -> padded codewords
  decoder-bits.js   Codewords -> bitstream -> text (inverse of encoder.js)
  blocks.js         Reed-Solomon block interleaving / deinterleaving
  matrix.js         Module grid: finder/timing/alignment patterns, masking,
                     data placement, BCH format information
  qrcode.js         Top-level encode()/decode() API
  render.js         SVG, ASCII, and hand-written PNG output
bin/cli.js          Command-line interface
demo/index.html     Live browser demo (self-contained, no server needed)
tools/build-bundle.js  Regenerates demo/qrcode.bundle.js from src/
test/test.js        Unit test suite (node:test)
```

## License

MIT
