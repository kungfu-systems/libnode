const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const release = readJson(path.join(repoRoot, 'libnode.release.json'));
const packageJson = readJson(path.join(repoRoot, 'package.json'));
const interfacePath = path.join(repoRoot, '.buildchain', 'kfd-3', 'collaboration-interface.json');
const payloadRoot = path.resolve(
  repoRoot,
  process.argv[2] || process.env.BUILDCHAIN_RELEASE_CANDIDATE_PAYLOADS || '.buildchain/release-candidate/payloads',
);

const packageNames = {
  main: '@kungfu-tech/libnode',
  darwin: '@kungfu-tech/libnode-darwin-arm64',
  linuxX64: '@kungfu-tech/libnode-linux-x64',
  linuxArm64: '@kungfu-tech/libnode-linux-arm64',
  windows: '@kungfu-tech/libnode-win32-x64',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function packageFileName(name, version) {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

function findPackageTarball(name) {
  const expected = packageFileName(name, release.npmVersion);
  const matches = listFiles(payloadRoot).filter((file) => path.basename(file) === expected);
  if (matches.length !== 1) {
    fail(
      `Expected exactly one ${name} tarball named ${expected} under ${path.relative(repoRoot, payloadRoot) || payloadRoot}; found ${matches.length}`,
    );
  }
  return matches[0];
}

function listTarball(file) {
  const result = childProcess.spawnSync('tar', ['-tzf', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail(`Unable to inspect ${path.basename(file)}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function requireEntry(entries, label, predicate) {
  if (!entries.some(predicate)) {
    fail(`Missing ${label}`);
  }
}

function verifyMainPackage(file) {
  const entries = listTarball(file);
  requireEntry(entries, 'main package runtime entrypoint', (entry) => entry === 'package/src/js/index.js');
  requireEntry(entries, 'main package release manifest', (entry) => entry === 'package/libnode.release.json');
  return entries;
}

function verifyDarwinPackage(file) {
  const entries = listTarball(file);
  requireEntry(entries, 'darwin versioned libnode dylib', (entry) =>
    /^package\/dist\/node\/libnode\.\d+\.dylib$/.test(entry),
  );
  requireEntry(entries, 'darwin alias materializer', (entry) => entry === 'package/ensure-libnode-aliases.js');
  requireEntry(entries, 'darwin node.h', (entry) => entry === 'package/dist/node/include/node.h');
  requireEntry(entries, 'darwin node_api.h', (entry) => entry === 'package/dist/node/include/node_api.h');
  return entries;
}

function verifyLinuxPackage(file) {
  const entries = listTarball(file);
  requireEntry(entries, 'linux versioned libnode so', (entry) => /^package\/dist\/node\/libnode\.so\.\d+$/.test(entry));
  requireEntry(entries, 'linux alias materializer', (entry) => entry === 'package/ensure-libnode-aliases.js');
  requireEntry(entries, 'linux node.h', (entry) => entry === 'package/dist/node/include/node.h');
  requireEntry(entries, 'linux node_api.h', (entry) => entry === 'package/dist/node/include/node_api.h');
  return entries;
}

function verifyWindowsPackage(file) {
  const entries = listTarball(file);
  requireEntry(entries, 'windows libnode dll', (entry) => /^package\/dist\/node\/libnode.*\.dll$/i.test(entry));
  requireEntry(entries, 'windows import library', (entry) => /^package\/dist\/node\/libnode.*\.lib$/i.test(entry));
  requireEntry(entries, 'windows node.h', (entry) => entry === 'package/dist/node/include/node.h');
  requireEntry(entries, 'windows node_api.h', (entry) => entry === 'package/dist/node/include/node_api.h');
  return entries;
}

function surface(id, name, kind, sourcePath) {
  return {
    id,
    name,
    kind,
    availability: 'shipped',
    visibility: 'public',
    participantFacing: true,
    public: true,
    sourcePath,
  };
}

function main() {
  if (packageJson.version !== release.npmVersion) {
    fail(
      `package.json version ${packageJson.version} does not match libnode.release.json npmVersion ${release.npmVersion}`,
    );
  }

  const files = {
    main: findPackageTarball(packageNames.main),
    darwin: findPackageTarball(packageNames.darwin),
    linuxX64: findPackageTarball(packageNames.linuxX64),
    linuxArm64: findPackageTarball(packageNames.linuxArm64),
    windows: findPackageTarball(packageNames.windows),
  };

  verifyMainPackage(files.main);
  verifyDarwinPackage(files.darwin);
  verifyLinuxPackage(files.linuxX64);
  verifyLinuxPackage(files.linuxArm64);
  verifyWindowsPackage(files.windows);

  const digests = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, `sha256:${sha256File(file)}`]));
  const interfaceDigest = `sha256:${sha256File(interfacePath)}`;
  const packageSetDigest = `sha256:${sha256Text(JSON.stringify(digests, Object.keys(digests).sort()))}`;

  const witness = {
    schemaVersion: 1,
    contract: 'kungfu-buildchain-kfd-3-collaboration-interface-artifact-witness',
    id: 'libnode-release-interface',
    standard: 'kfd-3',
    sourceRegistry: {
      id: 'libnode-release-contract',
      path: 'libnode.release.json',
      version: release.npmVersion,
      digest: `sha256:${sha256File(path.join(repoRoot, 'libnode.release.json'))}`,
    },
    collaborationInterface: {
      digest: interfaceDigest,
    },
    artifact: {
      name: '@kungfu-tech/libnode npm package set',
      path: path.relative(repoRoot, payloadRoot).split(path.sep).join('/'),
      digest: packageSetDigest,
      packages: Object.fromEntries(
        Object.entries(files).map(([key, file]) => [
          key,
          {
            name: packageNames[key],
            file: path.relative(payloadRoot, file).split(path.sep).join('/'),
            digest: digests[key],
          },
        ]),
      ),
    },
    exposedSurfaces: [
      surface('npm:main-package', '@kungfu-tech/libnode main package', 'package-entrypoint', 'package.json'),
      surface(
        'npm:platform-darwin-arm64',
        '@kungfu-tech/libnode-darwin-arm64 package',
        'platform-package',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'npm:platform-linux-x64',
        '@kungfu-tech/libnode-linux-x64 package',
        'platform-package',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'npm:platform-linux-arm64',
        '@kungfu-tech/libnode-linux-arm64 package',
        'platform-package',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'npm:platform-win32-x64',
        '@kungfu-tech/libnode-win32-x64 package',
        'platform-package',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'layout:headers',
        'Node and Node-API headers in platform packages',
        'native-header-layout',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'layout:darwin-libnode-alias-policy',
        'macOS libnode.dylib alias materialization policy',
        'native-link-layout',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'layout:linux-libnode-alias-policy',
        'Linux libnode.so alias materialization policy',
        'native-link-layout',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'layout:windows-import-library',
        'Windows libnode import library',
        'native-link-layout',
        '.gyp/node-platform-package.js',
      ),
      surface(
        'release:node-version-anchor',
        'Node upstream version and commit anchor',
        'release-fact',
        'libnode.release.json',
      ),
      surface(
        'release:trusted-publishing',
        'npm trusted publishing release path',
        'release-control',
        '.github/workflows/release-new-version.yml',
      ),
    ],
    verifier: {
      name: 'libnode KFD-3 artifact verifier',
      command: 'node .gyp/libnode-kfd3-artifact-verify.js',
      result: 'passed',
    },
  };

  process.stdout.write(`${JSON.stringify(witness, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
