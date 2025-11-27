#!/usr/bin/env node
const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const candidates = [
  path.join(repoRoot, 'test', 'utils'),
  path.join(repoRoot, 'test', 'bridge'),
  path.join(repoRoot, 'test', 'utils', 'buildMerkleLarge.test.js'),
  path.join(repoRoot, 'test', 'utils', 'buildMerkle.test.js')
];

const existing = candidates.filter(p => existsSync(p));

if (existing.length === 0) {
  console.log('No merkle test files or directories found — skipping merkle tests.');
  process.exit(0);
}

const args = ['hardhat', 'test', ...existing.map(p => path.relative(process.cwd(), p))];
console.log('Running merkle tests:', args.join(' '));

const res = spawnSync('npx', args, { stdio: 'inherit' });
process.exit(res.status || 0);
