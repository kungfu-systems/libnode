const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

async function verifyGates({
  runtimeRoot,
  runtimeSha,
  cwd = path.resolve(__dirname, '..'),
  artifactWitness,
  contractWitness = JSON.parse(
    fs.readFileSync(path.join(cwd, '.buildchain/kfd-1/libnode-contract-world.witness.json')),
  ),
  prebuildWitness = JSON.parse(
    fs.readFileSync(path.join(cwd, '.buildchain/kfd-3/collaboration-interface.prebuild.json')),
  ),
}) {
  if (!/^[0-9a-f]{40}$/.test(runtimeSha || '')) throw new Error('An exact Buildchain runtime SHA is required');
  const observed = execFileSync('git', ['-C', runtimeRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (observed !== runtimeSha) throw new Error('Buildchain KFD runtime SHA mismatch');
  execFileSync('git', ['-C', runtimeRoot, 'diff', '--quiet', 'HEAD'], { stdio: 'pipe' });
  const gates = await import(pathToFileURL(path.join(runtimeRoot, 'packages/core/kfd-gate.js')).href);
  const kfd1 = gates.createKfd1ReleaseGateEvidence({
    cwd,
    artifactRoot: cwd,
    witnesses: [contractWitness],
  }).passportSection;
  const kfd3 = gates.createKfd3CollaborationInterfaceReleaseGateEvidence({
    prebuildWitnesses: [prebuildWitness],
    artifactWitnesses: [artifactWitness],
  }).passportSection;
  const issues = [
    ...gates.validateKfd1ReleaseGateEvidence(kfd1),
    ...gates.validateKfd3CollaborationInterfaceReleaseGateEvidence(kfd3),
  ];
  if (kfd1.status !== 'passed' || kfd3.status !== 'passed' || issues.some((entry) => entry.level === 'error')) {
    throw new Error(`KFD release gates failed: ${JSON.stringify({ kfd1: kfd1.status, kfd3: kfd3.status, issues })}`);
  }
  return { schema: 'libnode-kfd-release-gates/v1', runtimeSha, kfd1, kfd3 };
}

module.exports = { verifyGates };
if (require.main === module) {
  const [runtimeRoot, runtimeSha, artifactPath] = process.argv.slice(2);
  Promise.resolve()
    .then(() =>
      verifyGates({
        runtimeRoot: path.resolve(runtimeRoot),
        runtimeSha,
        artifactWitness: JSON.parse(fs.readFileSync(artifactPath)),
      }),
    )
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
