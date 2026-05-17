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
  outfile: '../../.obsidian/plugins/ocr-proofer/main.js',
});
