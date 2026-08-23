#!/usr/bin/env node
/**
 * Fail a production extension build that would not be store-valid:
 * unsupported named `microphone` permission, loopback host_permissions,
 * missing `offscreen`, or missing USER_MEDIA offscreen reason in runtime code.
 *
 * Reads dist/manifest.json. Run `npm run build` first.
 * Does not inspect .env files or print secrets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateManifest } from './manifestPolicy.mjs';

function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distManifestPath = join(root, 'dist', 'manifest.json');

if (!existsSync(distManifestPath)) {
  console.error(
    'validate-manifest: dist/manifest.json is missing. Run npm run build first.',
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
const codeExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html']);
const searchFiles = [
  ...walkFiles(join(root, 'dist')),
  ...walkFiles(join(root, 'src')),
].filter((file) => codeExtensions.has(extname(file)));
const runtimeTexts = searchFiles.map((file) => readFileSync(file, 'utf8'));
const errors = evaluateManifest(manifest, runtimeTexts);

if (errors.length > 0) {
  console.error('validate-manifest: failed');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('validate-manifest: ok');
console.log('  dist/manifest.json has no named microphone permission');
console.log('  offscreen permission present');
console.log('  no loopback host_permissions');
console.log('  USER_MEDIA offscreen reason found in runtime code');
console.log(
  '  note: content_scripts still match http://*/* and https://*/* by design; Chrome will warn that the extension can read/change data on all websites',
);
