// Builds the card for release: every readable file in this folder is minified into
// custom_components/crow_media_player/www, which is what Home Assistant serves.
// Edit the files here, then run:  npm install  (once)  and  npm run build
// Names the files share (and the card's method names) are kept as they are; only names
// inside a function are shortened, and comments and spacing are removed.
// Each file also gets compressed copies beside it (.br and .gz), which Home Assistant sends
// instead of the file itself to browsers that accept them.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { minify } = require('terser');

const SRC = __dirname;
const OUT = path.join(__dirname, '..', 'custom_components', 'crow_media_player', 'www');

(async () => {
  const files = fs.readdirSync(SRC).filter(f => /^crow-media-.*\.js$/.test(f));
  let before = 0, after = 0;
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    const res = await minify(code, {
      ecma: 2020,
      module: false,
      toplevel: false,
      keep_classnames: true,
      keep_fnames: true,
      compress: { passes: 1, keep_fargs: true, keep_infinity: true },
      mangle: { toplevel: false, keep_classnames: true, keep_fnames: true },
      format: { comments: false, ascii_only: false },
    });
    fs.writeFileSync(path.join(OUT, f), res.code + '\n');
    before += code.length; after += res.code.length;
    console.log(f.padEnd(32), (code.length / 1024).toFixed(0).padStart(6) + ' KB ->', (res.code.length / 1024).toFixed(0).padStart(6) + ' KB');
  }
  console.log('total'.padEnd(32), (before / 1024).toFixed(0).padStart(6) + ' KB ->', (after / 1024).toFixed(0).padStart(6) + ' KB');
  // the compressed copies, for every file Home Assistant serves (the Sendspin file is already minified)
  let sent = 0;
  for (const f of fs.readdirSync(OUT).filter(f => /^crow-media-.*\.js$/.test(f))) {
    const buf = fs.readFileSync(path.join(OUT, f));
    const gz = zlib.gzipSync(buf, { level: 9 });
    const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    fs.writeFileSync(path.join(OUT, f + '.gz'), gz);
    fs.writeFileSync(path.join(OUT, f + '.br'), br);
    sent += Math.min(gz.length, br.length);
  }
  console.log('sent compressed'.padEnd(32), (sent / 1024).toFixed(0).padStart(6) + ' KB in all');
})().catch(e => { console.error(e); process.exit(1); });
