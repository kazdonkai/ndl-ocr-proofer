#!/usr/bin/env node
/**
 * Distribution artifact check for the Obsidian bridge plugin.
 *
 * Verifies that all four files required for manual/GitHub-Release distribution
 * exist in obsidian-plugin/ and are non-empty.
 */
import { statSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'obsidian-plugin');

const ARTIFACTS = [
  'main.js',
  'manifest.json',
  'versions.json',
  'styles.css',
];

let ok = true;
console.log('Distribution artifact check:');

for (const file of ARTIFACTS) {
  const path = resolve(pluginDir, file);
  if (!existsSync(path)) {
    console.error(`  ✗ MISSING : ${file}`);
    console.error(`    Run: cd obsidian-plugin && npm run build`);
    ok = false;
    continue;
  }
  const bytes = statSync(path).size;
  if (bytes === 0) {
    console.error(`  ✗ EMPTY   : ${file} (0 bytes)`);
    ok = false;
  } else {
    const display = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
    console.log(`  ✓ ${file.padEnd(16)} ${display}`);
  }
}

if (!ok) {
  console.error('\nDistribution check FAILED. Fix the issues above before releasing.');
  process.exit(1);
}
console.log('\nAll distribution artifacts present.');
