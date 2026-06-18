import esbuild from 'esbuild';
import process from 'process';

const prod = process.argv[2] === 'production';

// Node built-ins that must be excluded from the bundle.
const nodeBuiltins = [
  'path', 'fs', 'os', 'crypto', 'stream', 'events', 'util', 'http', 'https',
  'url', 'querystring', 'zlib', 'buffer', 'child_process', 'net', 'tls',
  'dns', 'dgram', 'readline', 'cluster', 'worker_threads', 'vm',
];

await esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', ...nodeBuiltins],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  // prod (npm run build): outputs main.js into this directory (distribution artifact).
  // dev  (npm run dev):   outputs directly into the vault plugin dir for live testing.
  outfile: prod ? 'main.js' : '../../.obsidian/plugins/ocr-proofer/main.js',
});
