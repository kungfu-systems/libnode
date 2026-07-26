# Buildchain Release Notes

`libnode` uses Buildchain v3 for shared Kungfu GitHub Actions and for
repository-local lifecycle metadata.

## Version State

`buildchain.toml` declares `package.json#version` as the release version state.
For this repository the package version follows the upstream Node.js version
that the embedded `node` submodule builds, plus a libnode package revision, for
example `22.22.3-kf.0`.

This repository uses Buildchain v3 anchored/manual version semantics:

- `package.json#version` remains the npm package version.
- `libnode.release.json` is the anchor manifest for the upstream Node.js tag,
  commit, and libnode revision.
- Buildchain validates the configured version state and anchor manifest, but it
  does not derive the next libnode anchor automatically.
- Opening a future Node train, such as a `v24` line, is a manual source change:
  update `libnode.release.json`, `package.json#version`, and the `node`
  submodule/tag contract in one reviewed change.

The npm package is `@kungfu-tech/libnode` and is configured for public
publishing to the official npm registry.

## Lifecycle

The configured lifecycle keeps the existing libnode build dependency order:

1. install JavaScript build helpers with pnpm;
2. run the node-gyp build graph, whose `libnode` target builds the embedded
   Node.js shared library before the `link_node` addon and dist target;
3. package the platform-specific npm tarball under `build/stage/npm`;
4. check the final diff.

The full lifecycle is intentionally expensive. Release PRs should rely on the
GitHub matrix workflow for Linux, macOS arm64, and Windows verification.

The workflow invokes pnpm through Corepack so the runner does not rely on a
preinstalled global package manager binary.

The dist step strips local/debug symbols from macOS and Linux release shared
libraries before platform npm packages are staged. This keeps published
packages release-oriented while allowing diagnostics runs to opt out with
`KF_DISABLE_STRIP_LIBNODE=true` or to strip only debug sections with
`KF_STRIP_LIBNODE_MODE=debug`.

## No-build Preflight

The migration can be validated before running the expensive native build. The
published Buildchain v3 `validate-config` action checks that
`buildchain.toml` is present, that `package.json#version` is readable as version
state, that `libnode.release.json` is present as the anchor manifest, and that
the required `install`, `build`, and `verify` lifecycle stages are declared.

That preflight is intentionally structural. It does not run
`corepack pnpm make`, `corepack pnpm build`, or `corepack pnpm package`.

The repository runs this check through
`.github/workflows/buildchain-preflight.yml` on PRs into the development, alpha,
and release lines:

```yaml
uses: kungfu-systems/buildchain/actions/validate-config@v3
with:
  config-required: 'true'
  require-version-state: 'true'
  require-lifecycle-stages: 'install,build,verify'
```

The local preflight result for this adaptation is:

```text
configPath: buildchain.toml
versionStrategy: anchored
versionNext: manual
anchorManifest: libnode.release.json
versionFiles: package.json
lifecycleStages: install, build, verify, publish
```

## Release - New Version Workflow

PR-stage Build verification still builds platform artifacts in this repository
because libnode has platform-specific native outputs. Those artifacts are npm
tarballs: one package per supported platform, plus the main package tarball from
the Linux x64 release build.

The release chain does not publish native binaries to AWS/S3. GitHub Actions
artifacts are only the handoff between the Buildchain build job and the npm
publish job, and npm is the release distribution surface.

Actual npm publication is driven by reviewed Buildchain channel promotion, not
by ad hoc publish branches. A pull request into `alpha/vN/vN.M` or
`release/vN/vN.M` builds the native matrix once and uploads a
release-candidate passport. After that PR is merged, the release workflow uses
Buildchain `release-candidate-promote.yml@v3` to validate the PR-stage passport,
lock the corresponding `publish-gate/*` source ref, and publish without a second
native rebuild. A merge into `alpha/vN/vN.M` publishes the package set with npm
dist-tag `alpha`. A merge into `release/vN/vN.M` publishes the final package set
with npm dist-tag `latest`.

```text
alpha/v22/v22.22
release/v22/v22.22
```

The `Release - New Version` workflow calls Buildchain
`release-candidate-promote.yml@v3` against the merged channel branch tip. The
wrapper resolves the matching same-repository PR-stage `Build` run, downloads
its release-candidate passport and npm tarballs, verifies source/tree
equivalence, locks `publish-gate/*`, and then calls `promote-buildchain-ref@v3`
with `publish-transaction: true`. Npm publication and Buildchain ref/tag
promotion are one transaction with durable `buildchain/release-state/<version>`
state and `BUILDCHAIN_PUBLISH_EVIDENCE`.

Before touching npm, the publish job verifies that `package.json#version` and
`libnode.release.json` agree on the exact npm version. The branch name only
selects the Buildchain release line; it does not carry or override the package
version.

Alpha publication uses npm dist-tag `alpha` and should use an npm prerelease
version such as `22.22.3-kf.3-alpha.0`. Release publication uses dist-tag
`latest` and should use the corresponding final npm version such as
`22.22.3-kf.3`. Both paths use `publish-final-version` through Buildchain and
GitHub Trusted Publishing; same-version alpha-to-latest dist-tag promotion is a
manual recovery mode, not the normal release path.

The npm package set is published in platform-first/main-last order.
The main `@kungfu-tech/libnode` package is the last visible package so npm
optional dependency resolution can see the platform packages immediately.

The npm publish job uses npm GitHub Trusted Publishing. The job must keep
`permissions.id-token: write`, must not provide `NODE_AUTH_TOKEN`, and must run
on a GitHub-hosted runner so npm can exchange the GitHub OIDC token for a
short-lived publish credential. Native Buildchain build jobs may still use
self-hosted runners; only the npm publish job has this cloud-hosted runner
constraint.
