# Shared lib (so/dylib/dll) for Node.js

This project provides shared lib for [Node.js](https://nodejs.org).

## Usage

Install via npm or pnpm:

```
npm install @kungfu-tech/libnode
```

The main package resolves the matching platform package installed through npm
optional dependencies, such as `@kungfu-tech/libnode-darwin-arm64`,
`@kungfu-tech/libnode-linux-x64`, `@kungfu-tech/libnode-linux-arm64`, or
`@kungfu-tech/libnode-win32-x64`.

macOS x86_64 (`darwin-x64`) is explicitly unsupported and is not part of the
build, release-verification, or publication matrices.

### Compile and Link

Get the path for shared lib for compilers:

```
node -p "require('@kungfu-tech/libnode').libpath"
```

Get the headers path:

```
node -p "require('@kungfu-tech/libnode').include"
```

## Build with GitHub Actions

The `Build` workflow runs through Kungfu Buildchain and builds the Node.js version pinned by `libnode.release.json` and `.gitmodules`. Each runner packages its native output as an npm platform tarball under `build/stage/npm`.
Linux ARM64 is built on the native GitHub-hosted `ubuntu-24.04-arm` runner and
participates in the same source lock, artifact summary, and release passport as
the other supported platforms.

Npm publication is handled by Buildchain release-candidate promotion. Reviewed
channel PRs build the release candidate once and upload the platform package
artifacts, build summary, and release-candidate passport. After the channel
branch is updated, the reusable Buildchain promotion workflow reuses that
PR-stage evidence, locks the matching `publish-gate/<channel>/<line>/<version>`
ref to the channel commit, generates npm package-set requirements from the
downloaded tarballs, and publishes through the configured dist-tag. The exact
npm version is read from `package.json` and `libnode.release.json`; it is not
passed by hand through the workflow.

npm publication uses GitHub Trusted Publishing from the GitHub-hosted publish
job. The workflow does not use `NPM_PUSH_TOKEN` or npm dist-tag recovery tokens
for the normal path; package access is authorized by the trusted publisher
records on npm for this repository and workflow file.

For self-hosted runners, set `BUILDCHAIN_CHECKOUT_CACHE_MIRROR_URL_TEMPLATE`
to the Buildchain locked source checkout mirror template, such as
`http://192.168.100.222:8088/git-mirrors/{repo}.git`, so the release source
checkout can be resolved from the local network before falling back to GitHub.
Set `KF_NODE_GIT_URL` to a local Node.js Git mirror when available.
Use a smart Git endpoint such as `git://192.168.100.222/node.git` for this
value; the static HTTP mirror is only suitable for Buildchain source checkout
and does not support shallow tag fetches. `KF_NODE_REFERENCE` can also point at
a runner-local bare mirror to reduce repeated object transfer. If those
variables are not set, the prepare step falls back to the public Node.js GitHub
repository.

Compiler caching is enabled opportunistically with `KF_COMPILER_CACHE=auto` in `buildchain.toml`. Linux and macOS use `ccache` when it is installed on the runner. Windows uses Node.js `vcbuild.bat ccache <path>` mode when `ccache.exe` is available; set `KF_NODE_WIN_CCACHE_PATH` when the verified `ccache.exe`/`cl.exe` wrapper directory is not on `PATH`. Set `KF_DISABLE_COMPILER_CACHE=true` to force a clean uncached build. Unix builds default to `make -j <cpu count>`; set `KF_BUILD_JOBS=<n>` when a runner needs a lower or higher explicit job count.

Release dist output strips local/debug symbols on macOS and Linux before the platform npm tarball is built. Set `KF_DISABLE_STRIP_LIBNODE=true` to keep symbols for native diagnostics, or `KF_STRIP_LIBNODE_MODE=debug` to strip debug sections only.

Windows runners that do not have `python.exe` on `PATH` bootstrap a standalone Python from the LAN cache. Override `KF_WINDOWS_PYTHON_URL` and `KF_WINDOWS_PYTHON_SHA256` when refreshing that cached tool.
