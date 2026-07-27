const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
let useGitBlobContent = false;

const paths = {
  packageJson: 'package.json',
  release: 'libnode.release.json',
  buildchain: 'buildchain.toml',
  platformPackage: '.gyp/node-platform-package.js',
  releaseVerify: '.gyp/libnode-release-verify.js',
  kfd3ArtifactVerify: '.gyp/libnode-kfd3-artifact-verify.js',
  releaseWorkflow: '.github/workflows/release-new-version.yml',
  kfd3Interface: '.buildchain/kfd-3/collaboration-interface.json',
  kfd3Prebuild: '.buildchain/kfd-3/collaboration-interface.prebuild.json',
  kfd1Witness: '.buildchain/kfd-1/libnode-contract-world.witness.json',
};

function readJson(relativePath) {
  return JSON.parse(fileText(relativePath));
}

function gitBlob(relativePath) {
  const result = childProcess.spawnSync('git', ['show', `HEAD:${relativePath}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(`git show HEAD:${relativePath} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout;
}

function fileBytes(relativePath) {
  return useGitBlobContent ? gitBlob(relativePath) : fs.readFileSync(path.join(repoRoot, relativePath));
}

function fileText(relativePath) {
  return fileBytes(relativePath).toString('utf8');
}

function sha256File(relativePath) {
  return crypto.createHash('sha256').update(fileBytes(relativePath)).digest('hex');
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeIfChanged(relativePath, text) {
  const filePath = path.join(repoRoot, relativePath);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text) return false;
  fs.writeFileSync(filePath, text);
  return true;
}

function generatedKfd3Prebuild() {
  const release = readJson(paths.release);
  const prebuild = readJson(paths.kfd3Prebuild);
  const collaborationInterface = readJson(paths.kfd3Interface);
  const interfaceDigest = `sha256:${sha256File(paths.kfd3Interface)}`;

  prebuild.sourceRegistry = {
    ...(prebuild.sourceRegistry || {}),
    version: release.npmVersion,
  };
  prebuild.collaborationInterfaceDigest = interfaceDigest;
  prebuild.collaborationInterface = {
    schemaVersion: collaborationInterface.schemaVersion,
    contract: collaborationInterface.contract,
    digest: interfaceDigest,
    product: collaborationInterface.product,
    participants: collaborationInterface.participants,
    surfaces: collaborationInterface.surfaces,
    closure: collaborationInterface.closure,
  };

  return prebuild;
}

function generatedKfd1Witness(kfd3PrebuildText) {
  const witness = readJson(paths.kfd1Witness);
  const releaseSha = sha256File(paths.release);
  const kfd3PrebuildSha = crypto.createHash('sha256').update(kfd3PrebuildText).digest('hex');
  const surfaceSha = {
    'package-manifest': sha256File(paths.packageJson),
    'release-manifest': releaseSha,
    'buildchain-config': sha256File(paths.buildchain),
    'package-builder': sha256File(paths.platformPackage),
    'release-verifier': sha256File(paths.releaseVerify),
    'kfd3-artifact-verifier': sha256File(paths.kfd3ArtifactVerify),
    'release-workflow': sha256File(paths.releaseWorkflow),
    'kfd3-collaboration-interface': sha256File(paths.kfd3Interface),
    'kfd3-prebuild-witness': kfd3PrebuildSha,
  };

  witness.contractWorld = {
    ...(witness.contractWorld || {}),
    digest: `sha256:${releaseSha}`,
  };
  witness.standardContract = {
    ...(witness.standardContract || {}),
    sha256: releaseSha,
  };
  witness.surfaces = (witness.surfaces || []).map((surface) => {
    const sha = surfaceSha[surface.name];
    if (!sha) {
      throw new Error(`Unknown KFD-1 surface: ${surface.name}`);
    }
    return {
      ...surface,
      sourceSha256: sha,
      expectedSha256: sha,
    };
  });

  return witness;
}

function buildExpectedTexts() {
  const kfd3PrebuildText = jsonText(generatedKfd3Prebuild());
  return {
    [paths.kfd3Prebuild]: kfd3PrebuildText,
    [paths.kfd1Witness]: jsonText(generatedKfd1Witness(kfd3PrebuildText)),
  };
}

function check() {
  const stale = [];
  for (const [relativePath, expected] of Object.entries(buildExpectedTexts())) {
    const current = fs.existsSync(path.join(repoRoot, relativePath))
      ? fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
      : '';
    if (current.replace(/\r\n/g, '\n') !== expected) stale.push(relativePath);
  }

  if (stale.length > 0) {
    throw new Error(`KFD witness files are stale: ${stale.join(', ')}. Run corepack pnpm sync-kfd-witnesses.`);
  }
  console.log('libnode KFD witnesses ok');
}

function write() {
  const changed = [];
  for (const [relativePath, expected] of Object.entries(buildExpectedTexts())) {
    if (writeIfChanged(relativePath, expected)) changed.push(relativePath);
  }
  console.log(
    changed.length ? `updated KFD witnesses: ${changed.join(', ')}` : 'libnode KFD witnesses already up to date',
  );
}

function main() {
  const command = process.argv[2] || 'check';
  useGitBlobContent = command === 'check' && process.env.GITHUB_ACTIONS === 'true';
  if (command === 'check') return check();
  if (command === 'write') return write();
  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
