#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const qr = require('../src/qrcode');
const render = require('../src/render');

function usage() {
  console.error(`qr-code-forge - a from-scratch QR code encoder/decoder

Usage:
  qr encode <text> [-o output.svg|.png] [--ec L|M|Q|H] [--ascii] [--scale N]
  qr decode <matrix.json>

Examples:
  node bin/cli.js encode "https://example.com" -o example.svg --ec M
  node bin/cli.js encode "HELLO WORLD" --ascii
  node bin/cli.js decode matrix.json
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--output') args.output = argv[++i];
    else if (a === '--ec') args.ec = argv[++i];
    else if (a === '--ascii') args.ascii = true;
    else if (a === '--scale') args.scale = parseInt(argv[++i], 10);
    else args._.push(a);
  }
  return args;
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (cmd === 'encode') {
    const text = args._[0];
    if (text === undefined) {
      usage();
      process.exit(1);
    }
    const ecLevel = args.ec || 'M';
    const sym = qr.encode(text, { ecLevel });
    console.error(
      `Encoded: version ${sym.version}, EC level ${sym.ecLevel}, mask ${sym.mask}, ${sym.size}x${sym.size} modules`
    );

    if (args.ascii || !args.output) {
      console.log(render.toASCII(sym));
    }
    if (args.output) {
      const ext = path.extname(args.output).toLowerCase();
      if (ext === '.svg') {
        fs.writeFileSync(args.output, render.toSVG(sym, { scale: args.scale || 8 }));
      } else if (ext === '.png') {
        fs.writeFileSync(args.output, render.toPNGBuffer(sym, { scale: args.scale || 8 }));
      } else if (ext === '.json') {
        fs.writeFileSync(args.output, JSON.stringify({ size: sym.size, modules: sym.modules }));
      } else {
        console.error(`Unsupported output extension: ${ext} (use .svg, .png, or .json)`);
        process.exit(1);
      }
      console.error(`Wrote ${args.output}`);
    }
    return;
  }

  if (cmd === 'decode') {
    const file = args._[0];
    if (!file) {
      usage();
      process.exit(1);
    }
    const symbol = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = qr.decode(symbol);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  usage();
  process.exit(1);
}

main();
