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

test('Linux ARM64 resolves the published platform package', () => {
  const loaded = loadEntrypoint('linux', 'arm64');

  assert.deepEqual(loaded.loadedPackages, ['@kungfu-tech/libnode-linux-arm64']);
  assert.equal(loaded.exports.platform, 'linux-arm64');
  assert.equal(loaded.exports.platformPackageName, '@kungfu-tech/libnode-linux-arm64');
});
