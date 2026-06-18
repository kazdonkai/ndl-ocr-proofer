#!/usr/bin/env node
/**
 * Version consistency check for the Obsidian bridge plugin.
 *
 * Verifies:
 *   manifest.json version == package.json version
 *   manifest.json version exists as a key in versions.json
 *   CHANGELOG.md has a section header for this version
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = resolve(root, 'obsidian-plugin');

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`  ✗ FILE NOT FOUND: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const manifest = readJson(resolve(pluginDir, 'manifest.json'));
const pkg      = readJson(resolve(pluginDir, 'package.json'));
const versions = readJson(resolve(pluginDir, 'versions.json'));
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');

const manifestVer = manifest.version;
const pkgVer      = pkg.version;

let ok = true;

console.log('Plugin version check:');
console.log(`  manifest.json : ${manifestVer}`);
console.log(`  package.json  : ${pkgVer}`);

if (manifestVer !== pkgVer) {
  console.error(`  ✗ MISMATCH: manifest.json (${manifestVer}) !== package.json (${pkgVer})`);
  ok = false;
} else {
  console.log(`  ✓ manifest.json == package.json`);
}

if (Object.prototype.hasOwnProperty.call(versions, manifestVer)) {
  console.log(`  ✓ versions.json has entry for ${manifestVer} (minAppVersion: ${versions[manifestVer]})`);
} else {
  console.error(`  ✗ versions.json has no entry for "${manifestVer}"`);
  console.error(`    Add: "${manifestVer}": "1.5.7" to obsidian-plugin/versions.json`);
  ok = false;
}

// Accept both released [X.Y.Z] and unreleased [Unreleased] — X.Y.Z headers.
const escapedVer = manifestVer.replace(/\./g, '\\.');
const releasedRe   = new RegExp(`^## \\[${escapedVer}\\]`, 'm');
const unreleasedRe = new RegExp(`^## \\[Unreleased\\][^\\n]*${escapedVer}`, 'm');
if (releasedRe.test(changelog) || unreleasedRe.test(changelog)) {
  console.log(`  ✓ CHANGELOG.md has entry for ${manifestVer}`);
} else {
  console.error(`  ✗ CHANGELOG.md has no section for ${manifestVer}`);
  console.error(`    Expected: ## [${manifestVer}]  or  ## [Unreleased] — ${manifestVer}`);
  ok = false;
}

if (!ok) {
  console.error('\nVersion check FAILED. Fix the issues above before releasing.');
  process.exit(1);
}
console.log('\nAll version checks passed.');
