const path = require('path');
const fs = require('fs');

const rootDir = path.dirname(path.dirname(__dirname));
const localDistDir = path.join(rootDir, 'dist', 'node');
const platformPackageNames = {
  'darwin-arm64': '@kungfu-tech/libnode-darwin-arm64',
  'linux-arm64': '@kungfu-tech/libnode-linux-arm64',
  'linux-x64': '@kungfu-tech/libnode-linux-x64',
  'win32-x64': '@kungfu-tech/libnode-win32-x64',
};

function hasLocalDist() {
  return fs.existsSync(path.join(localDistDir, 'include'));
}

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function loadPlatformPackage() {
  const key = platformKey();
  const packageName = platformPackageNames[key];

  if (!packageName) {
    throw new Error(`Unsupported libnode platform: ${key}`);
  }

  try {
    return require(packageName);
  } catch (error) {
    const message = [
      `Unable to load ${packageName}.`,
      'Install the matching optional dependency package or run the libnode build lifecycle locally.',
      `Original error: ${error.message}`,
    ].join(' ');

    const wrappedError = new Error(message);
    wrappedError.cause = error;
    throw wrappedError;
  }
}

const platformPackage = hasLocalDist()
  ? {
      include: path.join(localDistDir, 'include'),
      libpath: localDistDir,
    }
  : loadPlatformPackage();

exports.include = path.resolve(platformPackage.include);
exports.libpath = path.resolve(platformPackage.libpath);
exports.platform = platformKey();
exports.platformPackageName = platformPackageNames[exports.platform];
