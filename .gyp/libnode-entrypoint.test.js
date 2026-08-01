const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const entrypointPath = path.resolve(__dirname, '..', 'src', 'js', 'index.js');
const entrypointSource = fs.readFileSync(entrypointPath, 'utf8');

function loadEntrypoint(platform, arch) {
  const exports = {};
  const loadedPackages = [];
  const sandbox = {
    __dirname: path.dirname(entrypointPath),
    exports,
    process: { platform, arch },
    require(packageName) {
      if (packageName === 'path') return path;
      if (packageName === 'fs') return { existsSync: () => false };
      loadedPackages.push(packageName);
      return {
        include: `/packages/${packageName}/include`,
        libpath: `/packages/${packageName}/lib`,
      };
    },
  };

  vm.runInNewContext(entrypointSource, sandbox, { filename: entrypointPath });
  return { exports, loadedPackages };
}

for (const [platform, arch, identity, packageName] of [
  ['darwin', 'arm64', 'darwin-arm64', '@kungfu-tech/libnode-darwin-arm64'],
  ['linux', 'arm64', 'linux-arm64', '@kungfu-tech/libnode-linux-arm64'],
  ['linux', 'x64', 'linux-x64', '@kungfu-tech/libnode-linux-x64'],
  ['win32', 'x64', 'win32-x64', '@kungfu-tech/libnode-win32-x64'],
]) {
  test(`${identity} resolves the published platform package`, () => {
    const loaded = loadEntrypoint(platform, arch);

    assert.deepEqual(loaded.loadedPackages, [packageName]);
    assert.equal(loaded.exports.platform, identity);
    assert.equal(loaded.exports.platformPackageName, packageName);
  });
}

test('macOS x64 remains explicitly unsupported', () => {
  assert.throws(() => loadEntrypoint('darwin', 'x64'), /Unsupported libnode platform: darwin-x64/);
});
