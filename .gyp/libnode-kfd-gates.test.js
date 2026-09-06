const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { verifyGates } = require('./libnode-kfd-gates.js');
const cwd = path.resolve(__dirname, '..');
const runtimeRoot = process.env.BUILDCHAIN_KFD_RUNTIME_ROOT;
const runtimeSha = process.env.BUILDCHAIN_KFD_RUNTIME_SHA;
const read = (file) => JSON.parse(fs.readFileSync(path.join(cwd, file)));
const prebuild = read('.buildchain/kfd-3/collaboration-interface.prebuild.json');
const contractWitness = read('.buildchain/kfd-1/libnode-contract-world.witness.json');
// Synthetic evidence exercises gate decisions; it does not qualify native package bytes.
const artifactWitness = {
  schemaVersion: 1,
  contract: 'kungfu-buildchain-kfd-3-collaboration-interface-artifact-witness',
  id: prebuild.id,
  standard: 'kfd-3',
  sourceRegistry: prebuild.sourceRegistry,
  collaborationInterface: { digest: prebuild.collaborationInterfaceDigest },
  artifact: { name: 'test fixture only', path: 'fixture.tgz', digest: `sha256:${'a'.repeat(64)}` },
  exposedSurfaces: prebuild.collaborationInterface.surfaces.filter((entry) => entry.availability === 'shipped'),
  verifier: { name: 'fixture verifier', result: 'passed' },
};
const options = { cwd, runtimeRoot, runtimeSha, artifactWitness };
test('matching declared and exposed surfaces pass both KFD gates', async () => {
  const result = await verifyGates(options);
  assert.equal(result.kfd1.status, 'passed');
  assert.equal(result.kfd3.status, 'passed');
});
test('source digest drift fails the release gate', async () => {
  const witness = structuredClone(contractWitness);
  witness.surfaces[0].sourceSha256 = '0'.repeat(64);
  await assert.rejects(verifyGates({ ...options, contractWitness: witness }), /KFD release gates failed/);
});
test('a missing public artifact surface fails the release gate', async () => {
  const witness = structuredClone(artifactWitness);
  witness.exposedSurfaces.shift();
  await assert.rejects(verifyGates({ ...options, artifactWitness: witness }), /KFD release gates failed/);
});
test('a different verifier runtime fails before loading the gate', async () => {
  await assert.rejects(verifyGates({ ...options, runtimeSha: '0'.repeat(40) }), /runtime SHA mismatch/);
});
