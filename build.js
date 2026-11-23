// Packs server + pages into one executable for this OS: node build.js  ->  dist/yt-research-scraper[.exe]
// Needs Node 20.12+. CI runs it once per OS (see .github/workflows/release.yml).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const win = process.platform === 'win32', mac = process.platform === 'darwin';
const out = path.join('dist', 'yt-research-scraper' + (win ? '.exe' : ''));

// One file for the app: sea needs a single entry script, so concatenate the modules in require order.
// Local requires become lookups in __mods; 'require' itself is a parameter in the sea wrapper, so it can't be redeclared.
const src = (f) => fs.readFileSync(f, 'utf8').replace(/require\('(\.\/[\w]+)'\)/g, "__local('$1')");
const bundle = ['yt.js', 'filters.js', 'jobs.js'].map((f) =>
  `__mods[${JSON.stringify('./' + f.replace('.js', ''))}] = (() => { const module = { exports: {} }; const exports = module.exports;\n${src(f)}\nreturn module.exports; })();`).join('\n');
const main = `const __mods = {}; const __local = (id) => __mods[id];
${bundle}
${src('server.js')}`;

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/main.js', main);
fs.writeFileSync('dist/sea-config.json', JSON.stringify({
  main: 'dist/main.js', output: 'dist/app.blob', disableExperimentalSEAWarning: true,
  assets: { 'index.html': 'index.html', 'guide.html': 'guide.html' },
}));

run(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json']);
fs.copyFileSync(process.execPath, out);
if (mac) run('codesign', ['--remove-signature', out]);
const inject = ['postject@1.0.0-alpha.6', out, 'NODE_SEA_BLOB', 'dist/app.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (mac) inject.push('--macho-segment-name', 'NODE_SEA');
run('npx', ['--yes', ...inject]);
if (mac) run('codesign', ['--sign', '-', out]); // ad-hoc: Apple Silicon refuses unsigned binaries
console.log('Built', out);
