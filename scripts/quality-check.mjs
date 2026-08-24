#!/usr/bin/env node

/**
 * Local quality gate for the canonical extension package.
 *
 * The check is self-contained: it validates source, tests, the production
 * bundle, and the generated manifest without contacting a hosted service.
 */

import { spawnSync } from 'node:child_process';

const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmPrefixArgs = npmExecPath ? [npmExecPath] : [];

function run(label, args, options = {}) {
  console.log(`quality: ${label}`);
  const result = spawnSync(npmCommand, [...npmPrefixArgs, ...args], {
    env: process.env,
    stdio: 'inherit',
    shell: !npmExecPath && process.platform === 'win32',
    ...options,
  });

  const code = result.status ?? 1;
  if (code !== 0) {
    console.error(`quality: ${label} failed (exit ${code})`);
    process.exit(code);
  }
}

run('format check', ['run', 'format:check']);
run('lint', ['run', 'lint']);
run('typecheck', ['run', 'typecheck']);
run('unit tests', ['test', '--', '--run']);
run('production build', ['run', 'build']);
run('manifest validation', ['run', 'validate:manifest']);

console.log('quality: extension checks passed; hosted checks remain outside this command.');
