const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const activeSurfaces = [
  '.buildchain/kfd-2/public-release-trust.claim.json',
  '.buildchain/kfd-3/collaboration-interface.json',
  '.buildchain/kfd-3/collaboration-interface.prebuild.json',
  '.github/workflows/build.yml',
  '.github/workflows/release-new-version.yml',
  '.github/workflows/release-verify.yaml',
  '.gyp/libnode-kfd3-artifact-verify.js',
  '.gyp/node-platform-package.js',
  '.gyp/npm-publish-tarballs.js',
  'buildchain.toml',
  'libnode.release.json',
  'package.json',
  'src/js/index.js',
];
const retiredIdentity = /darwin[-/](?:x64|x86_64)|macos[-/](?:x64|x86_64)|macos-15-intel|libnode-darwin-x64/giu;

function inspectEntries(entries) {
  const violations = [];
  for (const entry of entries) {
    const lines = entry.content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const matches = [...lines[index].matchAll(retiredIdentity)].map((match) => match[0]);
      if (matches.length > 0) {
        violations.push({
          path: entry.path,
          line: index + 1,
          matches: [...new Set(matches)].sort(),
        });
      }
    }
  }
  return {
    schema: 'libnode.platform-retirement-policy/v1',
    status: violations.length === 0 ? 'pass' : 'fail',
    activeSurfaces: entries.map(({ path: entryPath }) => entryPath).sort(),
    violations,
  };
}

function inspectRepository(root = repoRoot) {
  return inspectEntries(
    activeSurfaces.map((relative) => ({
      path: relative,
      content: fs.readFileSync(path.join(root, relative), 'utf8'),
    })),
  );
}

function main() {
  const report = inspectRepository();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'pass') process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { activeSurfaces, inspectEntries, inspectRepository };
