const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { inspectEntries, inspectRepository } = require('./libnode-platform-policy');

const repoRoot = path.resolve(__dirname, '..');

test('all active package and release surfaces exclude retired Intel macOS identities', () => {
  const report = inspectRepository();
  assert.equal(report.status, 'pass', JSON.stringify(report.violations));
  assert.deepEqual(report.violations, []);
});

test('an active Intel macOS package identity fails closed', () => {
  const report = inspectEntries([
    {
      path: 'package.json',
      content: JSON.stringify({ optionalDependencies: { '@kungfu-tech/libnode-darwin-x64': '*' } }),
    },
  ]);
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.violations, [{ path: 'package.json', line: 1, matches: ['libnode-darwin-x64'] }]);
});

test('public documentation and the main entrypoint keep an explicit negative contract', () => {
  const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  assert.match(read('README.md'), /macOS x86_64 \(`darwin-x64`\) is explicitly unsupported/u);
  assert.match(read('.gyp/libnode-entrypoint.test.js'), /Unsupported libnode platform: darwin-x64/u);
});
