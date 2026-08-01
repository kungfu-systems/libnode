const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('KFD-3 prebuild witness mirrors every authoritative public surface', () => {
  const collaborationInterface = readJson('.buildchain/kfd-3/collaboration-interface.json');
  const prebuild = readJson('.buildchain/kfd-3/collaboration-interface.prebuild.json');
  const authoritativeSurfaceIds = collaborationInterface.surfaces.map(({ id }) => id);
  const witnessedSurfaceIds = prebuild.collaborationInterface.surfaces.map(({ id }) => id);

  assert.deepEqual(witnessedSurfaceIds, authoritativeSurfaceIds);
  assert.ok(witnessedSurfaceIds.includes('npm:platform-linux-arm64'));
  assert.equal(prebuild.collaborationInterface.digest, prebuild.collaborationInterfaceDigest);
});

test('KFD-2 public release claim covers the four-platform package set', () => {
  const trustClaim = readJson('.buildchain/kfd-2/public-release-trust.claim.json');
  const artifactNames = trustClaim.artifacts.map(({ name }) => name);

  assert.match(trustClaim.claim, /four-platform package set/);
  assert.ok(artifactNames.includes('@kungfu-tech/libnode-linux-arm64'));
});
