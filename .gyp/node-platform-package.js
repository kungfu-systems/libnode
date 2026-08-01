const childProcess = require('child_process');
const fs = require('fs-extra');
const { globSync } = require('glob');
const path = require('path');
const sywac = require('sywac');
const { exitOnError } = require('./node-lib.js');

const rootDir = path.dirname(__dirname);
const distDir = path.join(rootDir, 'dist', 'node');
const stageDir = path.resolve(rootDir, process.env.KF_PACKAGE_STAGE_DIR || path.join('build', 'stage', 'npm'));
const packageBuildDir = path.join(rootDir, 'build', 'npm');

const platformPackages = [
  {
    key: 'darwin-arm64',
    name: '@kungfu-tech/libnode-darwin-arm64',
    os: ['darwin'],
    cpu: ['arm64'],
    binaries: ['libnode*.dylib'],
    aliases: [{ source: 'libnode.*.dylib', match: '^libnode\\.\\d+\\.dylib$', target: 'libnode.dylib' }],
  },
  {
    key: 'linux-x64',
    name: '@kungfu-tech/libnode-linux-x64',
    os: ['linux'],
    cpu: ['x64'],
    binaries: ['libnode.so*'],
    aliases: [{ source: 'libnode.so.*', match: '^libnode\\.so\\.\\d+$', target: 'libnode.so' }],
  },
  {
    key: 'linux-arm64',
    name: '@kungfu-tech/libnode-linux-arm64',
    os: ['linux'],
    cpu: ['arm64'],
    binaries: ['libnode.so*'],
    aliases: [{ source: 'libnode.so.*', match: '^libnode\\.so\\.\\d+$', target: 'libnode.so' }],
  },
  {
    key: 'win32-x64',
    name: '@kungfu-tech/libnode-win32-x64',
    os: ['win32'],
    cpu: ['x64'],
    binaries: ['libnode*.dll', 'libnode*.lib'],
  },
];

function readJson(file) {
  return fs.readJsonSync(path.join(rootDir, file));
}

function writeJson(file, value) {
  fs.writeJsonSync(file, value, { spaces: 2 });
  fs.appendFileSync(file, '\n');
}

function rootPackageJson() {
  return readJson('package.json');
}

function packageDirName(packageName) {
  return packageName.replace(/^@/, '').replace('/', '-');
}

function currentPlatformPackage() {
  const key = `${process.platform}-${process.arch}`;
  const descriptor = platformPackages.find((item) => item.key === key);

  if (!descriptor) {
    throw new Error(`Unsupported libnode platform package target: ${key}`);
  }

  return descriptor;
}

function copyIfExists(source, target) {
  if (fs.existsSync(source)) {
    fs.copySync(source, target, { dereference: false });
  }
}

function relativePackagePath(file) {
  return path.relative(rootDir, file).split(path.sep).join('/');
}

function listDistFiles(pattern) {
  return listFiles(distDir, pattern);
}

function listFiles(root, pattern) {
  return globSync(path.join(root, pattern), {
    nodir: true,
    windowsPathsNoEscape: true,
  });
}

function requireDistFiles(label, pattern) {
  const files = listDistFiles(pattern);
  if (files.length === 0) {
    throw new Error(`Missing ${label}: expected ${relativePackagePath(path.join(distDir, pattern))}`);
  }
  return files;
}

function verifyPlatformDist(descriptor) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Missing ${path.relative(rootDir, distDir)}. Run the build lifecycle before packaging.`);
  }

  for (const pattern of descriptor.binaries) {
    requireDistFiles(`${descriptor.key} binary`, pattern);
  }

  const headers = [
    ...requireDistFiles(`${descriptor.key} node headers`, path.join('include', 'node.h')),
    ...requireDistFiles(`${descriptor.key} Node-API headers`, path.join('include', 'node_api.h')),
  ];

  return {
    binaries: descriptor.binaries.flatMap((pattern) => listDistFiles(pattern)).map(relativePackagePath),
    headers: headers.map(relativePackagePath),
  };
}

function ensurePackageAliasesAreMaterializable(packageDistDir, descriptor) {
  for (const alias of descriptor.aliases || []) {
    const source = listFiles(packageDistDir, alias.source)
      .filter((file) => path.basename(file) !== alias.target)
      .sort()
      .reverse()[0];

    if (!source) {
      throw new Error(`Missing ${descriptor.key} alias source: expected ${alias.source}`);
    }

    const target = path.join(packageDistDir, alias.target);
    fs.removeSync(target);
    // npm pack drops symlink entries and the public npm registry rejects
    // hardlinks. Platform packages therefore reconstruct aliases at install
    // time via ensure-libnode-aliases.js instead of shipping link entries.
  }
}

function basePackageJson(sourcePackageJson, name, description) {
  return {
    name,
    version: sourcePackageJson.version,
    description,
    license: sourcePackageJson.license,
    author: sourcePackageJson.author,
    repository: sourcePackageJson.repository,
    publishConfig: sourcePackageJson.publishConfig,
  };
}

function optionalDependencyMap(version) {
  return Object.fromEntries(platformPackages.map((item) => [item.name, version]));
}

function writePackageReadme(packageRoot, packageName, description) {
  fs.writeFileSync(path.join(packageRoot, 'README.md'), `# ${packageName}\n\n${description}\n`);
}

function writePlatformAliasScript(packageRoot, descriptor) {
  const aliases = (descriptor.aliases || []).map((alias) => ({
    match: alias.match,
    target: alias.target,
  }));

  fs.writeFileSync(
    path.join(packageRoot, 'ensure-libnode-aliases.js'),
    [
      "const fs = require('fs');",
      "const path = require('path');",
      '',
      `const aliases = ${JSON.stringify(aliases, null, 2)};`,
      "const distDir = path.join(__dirname, 'dist', 'node');",
      '',
      'function findAliasSource(match, target) {',
      '  const pattern = new RegExp(match);',
      '  return fs.readdirSync(distDir).find((entry) => entry !== target && pattern.test(entry));',
      '}',
      '',
      'function ensureAlias(alias) {',
      '  const sourceName = findAliasSource(alias.match, alias.target);',
      '  if (!sourceName) {',
      '    throw new Error(`Unable to create ${alias.target}: no source matching ${alias.match}`);',
      '  }',
      '',
      '  const target = path.join(distDir, alias.target);',
      '  const source = path.join(distDir, sourceName);',
      '',
      '  try {',
      '    if (fs.lstatSync(target).isSymbolicLink() && fs.readlinkSync(target) === sourceName) return;',
      '    fs.rmSync(target, { force: true });',
      '  } catch (error) {',
      "    if (error.code !== 'ENOENT') throw error;",
      '  }',
      '',
      '  try {',
      "    fs.symlinkSync(sourceName, target, 'file');",
      '  } catch (error) {',
      '    fs.copyFileSync(source, target);',
      '  }',
      '}',
      '',
      'function ensureLibnodeAliases() {',
      '  for (const alias of aliases) ensureAlias(alias);',
      '}',
      '',
      'module.exports = { ensureLibnodeAliases };',
      '',
      'if (require.main === module) ensureLibnodeAliases();',
      '',
    ].join('\n'),
  );
}

function writePlatformIndex(packageRoot) {
  fs.writeFileSync(
    path.join(packageRoot, 'index.js'),
    [
      "const path = require('path');",
      "const { ensureLibnodeAliases } = require('./ensure-libnode-aliases.js');",
      '',
      "const distDir = path.join(__dirname, 'dist', 'node');",
      'ensureLibnodeAliases();',
      "exports.include = path.join(distDir, 'include');",
      'exports.libpath = distDir;',
      '',
    ].join('\n'),
  );
}

function prepareMainPackage() {
  const sourcePackageJson = rootPackageJson();
  const packageRoot = path.join(packageBuildDir, 'libnode');
  fs.emptyDirSync(packageRoot);

  const packageJson = {
    ...basePackageJson(
      sourcePackageJson,
      sourcePackageJson.name,
      'libnode entrypoint package with platform-specific optional dependencies',
    ),
    main: sourcePackageJson.main,
    files: ['src/js/', 'libnode.release.json', 'LICENSE', 'README.md'],
    optionalDependencies: optionalDependencyMap(sourcePackageJson.version),
  };

  writeJson(path.join(packageRoot, 'package.json'), packageJson);
  fs.copySync(path.join(rootDir, 'src', 'js'), path.join(packageRoot, 'src', 'js'));
  copyIfExists(path.join(rootDir, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
  copyIfExists(path.join(rootDir, 'libnode.release.json'), path.join(packageRoot, 'libnode.release.json'));
  writePackageReadme(
    packageRoot,
    sourcePackageJson.name,
    'This package resolves the matching libnode platform package at runtime.',
  );

  return packageRoot;
}

function preparePlatformPackage(descriptor) {
  const verified = verifyPlatformDist(descriptor);

  const sourcePackageJson = rootPackageJson();
  const packageRoot = path.join(packageBuildDir, packageDirName(descriptor.name));
  fs.emptyDirSync(packageRoot);

  const packageJson = {
    ...basePackageJson(sourcePackageJson, descriptor.name, `libnode binaries for ${descriptor.key}`),
    main: 'index.js',
    files: ['index.js', 'ensure-libnode-aliases.js', 'dist/', 'libnode.release.json', 'LICENSE', 'README.md'],
    os: descriptor.os,
    cpu: descriptor.cpu,
  };

  if (descriptor.aliases?.length) {
    packageJson.scripts = {
      postinstall: 'node ensure-libnode-aliases.js',
    };
  }

  writeJson(path.join(packageRoot, 'package.json'), packageJson);
  const packageDistDir = path.join(packageRoot, 'dist', 'node');
  fs.copySync(distDir, packageDistDir, {
    dereference: false,
  });
  ensurePackageAliasesAreMaterializable(packageDistDir, descriptor);
  copyIfExists(path.join(rootDir, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
  copyIfExists(path.join(rootDir, 'libnode.release.json'), path.join(packageRoot, 'libnode.release.json'));
  writePackageReadme(packageRoot, descriptor.name, `This package contains libnode binaries for ${descriptor.key}.`);
  writePlatformAliasScript(packageRoot, descriptor);
  writePlatformIndex(packageRoot);
  console.log(
    `verified ${descriptor.key} package payload: ${verified.binaries.join(', ')}; headers: ${verified.headers.join(', ')}`,
  );

  return packageRoot;
}

function npmPack(packageRoot) {
  fs.ensureDirSync(stageDir);
  const { command, args } = npmCommand('pack', '--pack-destination', stageDir);
  const result = childProcess.spawnSync(command, args, {
    cwd: packageRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    const error = result.error ? `: ${result.error.message}` : '';
    throw new Error(`npm pack failed for ${packageRoot}${error}`);
  }
}

function npmCommand(...args) {
  const nodeDir = path.dirname(process.execPath);
  const candidates =
    process.platform === 'win32'
      ? [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      : [path.join(path.dirname(nodeDir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];

  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) {
    return {
      command: process.execPath,
      args: [npmCli, ...args],
    };
  }

  return {
    command: 'npm',
    args,
  };
}

function shouldPackMain() {
  if (process.env.KF_PACK_MAIN_PACKAGE === 'true') return true;
  if (process.env.KF_PACK_MAIN_PACKAGE === 'false') return false;
  return process.platform === 'linux' && process.arch === 'x64';
}

async function packMain() {
  npmPack(prepareMainPackage());
}

async function packPlatform() {
  npmPack(preparePlatformPackage(currentPlatformPackage()));
}

async function pack() {
  await packPlatform();

  if (shouldPackMain()) {
    await packMain();
  }
}

async function verifySource() {
  const sourcePackageJson = rootPackageJson();
  const scripts = sourcePackageJson.scripts || {};

  if (sourcePackageJson.binary) {
    throw new Error('package.json must not define a node-pre-gyp binary block');
  }

  if (sourcePackageJson.dependencies?.['@mapbox/node-pre-gyp']) {
    throw new Error('package.json must not depend on @mapbox/node-pre-gyp');
  }

  for (const scriptName of ['preinstall', 'prebuild']) {
    if (scripts[scriptName]) {
      throw new Error(`package.json must not define ${scriptName}`);
    }
  }

  if (scripts.install !== 'node .gyp/noop-install.js') {
    throw new Error('package.json install script must be the libnode no-op install guard');
  }

  for (const descriptor of platformPackages) {
    if (!descriptor.name.startsWith(`${sourcePackageJson.name}-`)) {
      throw new Error(`Unexpected platform package name: ${descriptor.name}`);
    }
  }
}

async function main() {
  await sywac
    .command('pack', {
      desc: 'Pack the current platform package and, on linux-x64, the main package',
      run: pack,
    })
    .command('pack-main', {
      desc: 'Pack the main package with optional platform dependencies',
      run: packMain,
    })
    .command('pack-platform', {
      desc: 'Pack the current platform package',
      run: packPlatform,
    })
    .command('verify-source', {
      desc: 'Verify that source package metadata no longer uses node-pre-gyp',
      run: verifySource,
    })
    .help('-h, --help')
    .version('-v, --version')
    .parseAndExit();
}

if (require.main === module) main().catch(exitOnError);
