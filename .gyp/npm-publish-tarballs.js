const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');
const { exitOnError, run } = require('./node-lib.js');

const args = process.argv.slice(2);
const mainPackageName = '@kungfu-tech/libnode';
const platformPackageRequirements = {
  '@kungfu-tech/libnode-darwin-arm64': {
    binaries: [/^package\/dist\/node\/libnode\.\d+\.dylib$/],
    aliases: [{ target: 'package/dist/node/libnode.dylib', helper: 'package/ensure-libnode-aliases.js' }],
  },
  '@kungfu-tech/libnode-darwin-x64': {
    binaries: [/^package\/dist\/node\/libnode\.\d+\.dylib$/],
    aliases: [{ target: 'package/dist/node/libnode.dylib', helper: 'package/ensure-libnode-aliases.js' }],
  },
  '@kungfu-tech/libnode-linux-x64': {
    binaries: [/^package\/dist\/node\/libnode\.so\.\d+$/],
    aliases: [{ target: 'package/dist/node/libnode.so', helper: 'package/ensure-libnode-aliases.js' }],
  },
  '@kungfu-tech/libnode-linux-arm64': {
    binaries: [/^package\/dist\/node\/libnode\.so\.\d+$/],
    aliases: [{ target: 'package/dist/node/libnode.so', helper: 'package/ensure-libnode-aliases.js' }],
  },
  '@kungfu-tech/libnode-win32-x64': {
    binaries: [/^package\/dist\/node\/libnode.*\.dll$/i, /^package\/dist\/node\/libnode.*\.lib$/i],
  },
};

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const requiredArtifactsPath = readOption('--write-buildchain-required-artifacts');
const roots = args.filter((arg, index) => {
  if (arg === '--write-buildchain-required-artifacts') return false;
  if (index > 0 && args[index - 1] === '--write-buildchain-required-artifacts') return false;
  return true;
});

function collectTarballs(root, output) {
  const stat = fs.statSync(root);

  if (stat.isFile()) {
    if (root.endsWith('.tgz')) output.push(path.resolve(root));
    return;
  }

  for (const entry of fs.readdirSync(root)) {
    collectTarballs(path.join(root, entry), output);
  }
}

function runCapture(cmd, args, opts = {}) {
  const result = childProcess.spawnSync(cmd, args, {
    cwd: opts.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return result;
}

function readPackageJsonFromTarball(file) {
  const result = runCapture('tar', ['-xOf', file, 'package/package.json']);
  if (result.status !== 0) {
    throw new Error(`Unable to read package/package.json from ${file}: ${(result.stderr || '').trim()}`);
  }
  return JSON.parse(result.stdout);
}

function listTarballEntries(file) {
  const result = runCapture('tar', ['-tzf', file]);
  if (result.status !== 0) {
    throw new Error(`Unable to list ${file}: ${(result.stderr || '').trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function listTarballDetails(file) {
  const result = runCapture('tar', ['-tvf', file]);
  if (result.status !== 0) {
    throw new Error(`Unable to inspect ${file}: ${(result.stderr || '').trim()}`);
  }

  const details = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const entryStart = line.indexOf('package/');
    if (entryStart === -1) continue;

    let entry = line.slice(entryStart).trim();
    for (const separator of [' -> ', ' link to ']) {
      const linkTarget = entry.indexOf(separator);
      if (linkTarget !== -1) {
        entry = entry.slice(0, linkTarget);
        break;
      }
    }
    details.set(entry, { type: line[0] });
  }
  return details;
}

function verifyPlatformTarballPayload(pkg) {
  const requirements = platformPackageRequirements[pkg.name];
  if (!requirements) return;

  const entries = listTarballEntries(pkg.file);
  const details = listTarballDetails(pkg.file);
  const scripts = pkg.packageJson.scripts || {};
  for (const pattern of requirements.binaries) {
    if (!entries.some((entry) => pattern.test(entry))) {
      throw new Error(`${packageKey(pkg)} is missing required binary matching ${pattern}`);
    }
  }

  for (const alias of requirements.aliases || []) {
    if (!entries.includes(alias.helper)) {
      throw new Error(`${packageKey(pkg)} is missing alias helper ${alias.helper}`);
    }

    if (scripts.postinstall !== 'node ensure-libnode-aliases.js') {
      throw new Error(`${packageKey(pkg)} must reconstruct libnode aliases from postinstall`);
    }

    const target = details.get(alias.target);
    if (target) {
      throw new Error(
        `${packageKey(pkg)} must not package ${alias.target}; npm install must materialize it from ${alias.helper}`,
      );
    }
  }

  for (const header of ['package/dist/node/include/node.h', 'package/dist/node/include/node_api.h']) {
    if (!entries.includes(header)) {
      throw new Error(`${packageKey(pkg)} is missing required header ${header}`);
    }
  }
}

function tarballIntegrity(file) {
  const data = fs.readFileSync(file);
  return `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`;
}

function buildchainArtifact(pkg) {
  return {
    group: 'libnode',
    kind: 'npm',
    name: pkg.name,
    ref: pkg.version,
    digest: pkg.integrity,
    role: isMainPackage(pkg) ? 'main' : 'platform',
    required: true,
  };
}

function packageKey(pkg) {
  return `${pkg.name}@${pkg.version}`;
}

function isMainPackage(pkg) {
  return pkg.name === mainPackageName;
}

function expectedVersion() {
  return String(process.env.KF_NPM_EXPECTED_VERSION || '').trim();
}

function packageFromTarball(file) {
  const packageJson = readPackageJsonFromTarball(file);
  const name = String(packageJson.name || '').trim();
  const version = String(packageJson.version || '').trim();

  if (!name || !version) {
    throw new Error(`Tarball ${file} must contain package name and version`);
  }

  const expected = expectedVersion();
  if (expected && version !== expected) {
    throw new Error(`${name} has version ${version}, expected ${expected}`);
  }

  const pkg = {
    file,
    name,
    version,
    packageJson,
    integrity: tarballIntegrity(file),
    main: name === mainPackageName,
    optionalDependencies: packageJson.optionalDependencies || {},
  };
  verifyPlatformTarballPayload(pkg);
  return pkg;
}

function verifyPackageSet(packages) {
  const mainPackage = packages.find(isMainPackage);
  if (!mainPackage) {
    throw new Error(`Package set must include the main package ${mainPackageName}`);
  }

  for (const [name, version] of Object.entries(mainPackage.optionalDependencies)) {
    const found = packages.some((pkg) => pkg.name === name && pkg.version === version);
    if (!found) {
      throw new Error(`Package set is missing optional dependency ${name}@${version}`);
    }
  }
}

function npmViewIntegrity(pkg) {
  const result = runCapture('npm', ['view', packageKey(pkg), 'dist.integrity', '--json']);
  if (result.status !== 0) {
    const stderr = result.stderr || '';
    if (/E404|404 Not Found|No match found/i.test(stderr)) return '';
    throw new Error(`npm view ${packageKey(pkg)} failed: ${stderr.trim()}`);
  }
  const output = (result.stdout || '').trim();
  if (!output) return '';
  return JSON.parse(output);
}

function verifyExistingPackage(pkg, existingIntegrity) {
  if (!existingIntegrity) return false;
  if (existingIntegrity !== pkg.integrity) {
    throw new Error(
      `Existing ${packageKey(pkg)} integrity mismatch: registry ${existingIntegrity}, tarball ${pkg.integrity}`,
    );
  }
  console.log(`accept existing ${packageKey(pkg)} (${existingIntegrity})`);
  return true;
}

function publishMode() {
  return process.env.BUILDCHAIN_PUBLISH_MODE || 'publish-final-version';
}

function publishTarball(pkg, distTag) {
  const args = ['publish', pkg.file, '--access', 'public', '--tag', distTag];

  if (process.env.KF_NPM_PUBLISH_DRY_RUN === 'true') {
    args.push('--dry-run');
  }

  run('npm', args);
}

function addDistTag(pkg, distTag) {
  if (process.env.KF_NPM_PUBLISH_DRY_RUN === 'true') {
    console.log(`[dry-run] npm dist-tag add ${packageKey(pkg)} ${distTag}`);
    return;
  }

  run('npm', ['dist-tag', 'add', packageKey(pkg), distTag]);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBuildchainPublishEvidence(packages) {
  const evidencePath = process.env.BUILDCHAIN_PUBLISH_EVIDENCE;
  if (!evidencePath) return;

  const evidence = {
    schema: 1,
    version: process.env.BUILDCHAIN_VERSION || expectedVersion() || packages[0].version,
    channel: process.env.BUILDCHAIN_CHANNEL || (process.env.KF_NPM_DIST_TAG === 'latest' ? 'release' : 'alpha'),
    source_sha: process.env.BUILDCHAIN_SOURCE_SHA || process.env.GITHUB_SHA || '',
    release_sha:
      process.env.BUILDCHAIN_RELEASE_SHA || process.env.BUILDCHAIN_SOURCE_SHA || process.env.GITHUB_SHA || '',
    target_ref: process.env.BUILDCHAIN_TARGET_REF || '',
    release_material_sha: process.env.BUILDCHAIN_RELEASE_MATERIAL_SHA || process.env.BUILDCHAIN_RELEASE_SHA || '',
    publish_tooling_sha: process.env.BUILDCHAIN_PUBLISH_TOOLING_SHA || process.env.BUILDCHAIN_RELEASE_SHA || '',
    artifacts: packages.map(buildchainArtifact),
  };

  writeJson(evidencePath, evidence);
  console.log(`wrote buildchain publish evidence: ${evidencePath}`);
}

async function main() {
  if (roots.length === 0) {
    throw new Error('Usage: node .gyp/npm-publish-tarballs.js <artifact-dir> [...]');
  }

  const tarballs = [];
  for (const root of roots) {
    collectTarballs(root, tarballs);
  }

  const uniqueByPackage = new Map();
  for (const file of tarballs) {
    const pkg = packageFromTarball(file);
    const key = packageKey(pkg);
    if (!uniqueByPackage.has(key)) {
      uniqueByPackage.set(key, pkg);
    }
  }

  const packages = [...uniqueByPackage.values()].sort((left, right) => {
    if (left.main === right.main) return left.name.localeCompare(right.name);
    return left.main ? 1 : -1;
  });

  if (packages.length === 0) {
    throw new Error(`No npm tarballs found under: ${roots.join(', ')}`);
  }

  verifyPackageSet(packages);

  if (requiredArtifactsPath) {
    writeJson(requiredArtifactsPath, packages.map(buildchainArtifact));
    console.log(`wrote buildchain required artifacts: ${requiredArtifactsPath}`);
    return;
  }

  const distTag = process.env.BUILDCHAIN_NPM_DIST_TAG || process.env.KF_NPM_DIST_TAG || 'latest';
  const mode = publishMode();
  if (!['publish-final-version', 'promote-existing-version'].includes(mode)) {
    throw new Error(`Unsupported Buildchain publish mode: ${mode}`);
  }
  const existing = new Set();

  for (const pkg of packages) {
    const existingIntegrity = npmViewIntegrity(pkg);
    if (verifyExistingPackage(pkg, existingIntegrity)) {
      existing.add(packageKey(pkg));
      continue;
    }

    if (mode === 'promote-existing-version') {
      throw new Error(`Existing-version promotion requires registry package before dist-tag move: ${packageKey(pkg)}`);
    }

    publishTarball(pkg, distTag);
  }

  if (mode === 'promote-existing-version') {
    for (const pkg of packages) {
      addDistTag(pkg, distTag);
    }
  }

  writeBuildchainPublishEvidence(packages);
}

if (require.main === module) main().catch(exitOnError);
