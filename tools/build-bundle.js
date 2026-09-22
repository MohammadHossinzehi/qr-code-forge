#!/usr/bin/env node
// Regenerates demo/qrcode.bundle.js from the CommonJS modules in src/.
// The demo page is meant to run with no build step and no npm install, so
// we ship the bundle pre-built; run this after changing anything in src/.
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const OUT_FILE = path.join(__dirname, '..', 'demo', 'qrcode.bundle.js');
const MODULES = [
  'gf256',
  'reed-solomon',
  'tables',
  'bitbuffer',
  'encoder',
  'decoder-bits',
  'blocks',
  'matrix',
  'qrcode',
  'render',
];

let out = '// Auto-generated browser bundle of qr-code-forge.\n';
out += '// Source of truth is /src (plain CommonJS Node modules); this file just\n';
out += '// concatenates them with a tiny require() shim so the demo page can run\n';
out += '// without a build step. Regenerate with: node tools/build-bundle.js\n';
out += '(function (global) {\n  "use strict";\n  const __modules = {};\n  const __cache = {};\n';
out +=
  '  function __require(name) {\n    if (__cache[name]) return __cache[name].exports;\n    const mod = { exports: {} };\n    __cache[name] = mod;\n    __modules[name](mod, mod.exports, __require);\n    return mod.exports;\n  }\n';
out +=
  "  __modules['zlib'] = function (module) {\n    module.exports = { deflateSync: function () {\n      throw new Error('PNG export is not available in the browser bundle; use the CLI (bin/cli.js) for PNG output.');\n    } };\n  };\n";

for (const name of MODULES) {
  let src = fs.readFileSync(path.join(SRC_DIR, name + '.js'), 'utf8');
  src = src.replace(/require\('\.\/([a-zA-Z0-9_-]+)'\)/g, "__require('$1')");
  src = src.replace(/require\('zlib'\)/g, "__require('zlib')");
  out += `\n  __modules['${name}'] = function (module, exports, require) {\n${src}\n  };\n`;
}

out += "\n  global.QRCodeForge = __require('qrcode');\n";
out += "  global.QRCodeForgeRender = __require('render');\n";
out += '})(typeof window !== "undefined" ? window : globalThis);\n';

fs.writeFileSync(OUT_FILE, out);
console.log(`Wrote ${path.relative(process.cwd(), OUT_FILE)} (${out.length} bytes)`);
