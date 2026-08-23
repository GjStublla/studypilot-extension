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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distManifestPath = join(root, 'dist', 'manifest.json');
const errors = [];

function fail(message) {
  errors.push(message);
}

function hostnameFromMatchPattern(pattern) {
  if (typeof pattern !== 'string') return '';
  const match = /^([a-z*]+):\/\/([^/]+)/i.exec(pattern.trim());
  if (!match) return '';
  let host = match[2];
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return (end === -1 ? host.slice(1) : host.slice(1, end)).toLowerCase();
  }
  host = host.replace(/^\*\./, '');
  return host.split(':')[0].toLowerCase();
}

function isLoopbackHostname(hostname) {
  if (!hostname || hostname === '*') return false;
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1') {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

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

if (!existsSync(distManifestPath)) {
  console.error('validate-manifest: dist/manifest.json is missing. Run npm run build first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(distManifestPath, 'utf8'));
const permissions = [
  ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
  ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : []),
];
const hostPermissions = [
  ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ...(Array.isArray(manifest.optional_host_permissions)
    ? manifest.optional_host_permissions
    : []),
];

if (permissions.includes('microphone')) {
  fail(
    'named permission "microphone" is not a valid MV3 permission; capture mic via offscreen getUserMedia with USER_MEDIA',
  );
}

if (!permissions.includes('offscreen')) {
  fail('missing "offscreen" permission required for getUserMedia in an offscreen document');
}

for (const pattern of hostPermissions) {
  const hostname = hostnameFromMatchPattern(pattern);
  if (isLoopbackHostname(hostname)) {
    fail(`loopback production host permission is not allowed: ${pattern}`);
  }
}

const codeExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html']);
const searchFiles = [
  ...walkFiles(join(root, 'dist')),
  ...walkFiles(join(root, 'src')),
].filter((file) => codeExtensions.has(extname(file)));

const hasUserMedia = searchFiles.some((file) => {
  const text = readFileSync(file, 'utf8');
  return text.includes('USER_MEDIA');
});

if (!hasUserMedia) {
  fail('USER_MEDIA offscreen reason is missing from runtime code');
}

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
