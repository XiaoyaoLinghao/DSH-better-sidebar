# DSH Better Workbench branding and source-install design

## Context

The fork at `XiaoyaoLinghao/DSH-better-sidebar` now combines the original
service-oriented sidebar workbench with native Sidechain support. The existing
public name, `DSH-better-sidebar`, understates that scope, while changing the
package name, plugin id, service name, or persisted keys would break existing
profiles and extensions.

The fork will normally be installed from source after DSH or another automation
agent reads the repository. The current README still presents the upstream npm
package as the primary channel, and the existing installers only accept an npm
version. That is ambiguous: `dsh plugin ... add dsh-better-sidebar@latest`
installs the upstream package, not this fork.

## Goals

- Present the fork as **DSH Better Workbench**.
- Give the fork a distinct SemVer version, `0.15.0-xlh.1`.
- Preserve existing package, plugin, service, configuration, and persistence
  identities.
- Make a checked-out source tree installable into a DSH `web` profile with one
  Bash or PowerShell command.
- Make the README precise enough for a DSH/automation agent to install, update,
  verify, and diagnose the fork without inventing steps.
- Preserve upstream and `dsh-sidechain` attribution.

## Non-goals

- Renaming the GitHub repository.
- Publishing a new npm package or claiming the upstream npm namespace.
- Renaming `dsh-better-sidebar`, `dsh-external/dsh-better-sidebar`,
  `ctx.betterSidebar`, configuration keys, bundle ids, routes, or persisted
  state.
- Changing Sidechain behavior or any other workbench feature.
- Modifying DSH source code or automatically restarting DSH by default.

## Identity and versioning

The product-facing name is **DSH Better Workbench**. It is used in README
headings, current-release prose, manifest descriptions, and the settings-page
version badge.

The compatibility identities remain:

| Surface | Value | Reason |
| --- | --- | --- |
| npm/package name | `dsh-better-sidebar` | Keeps imports and profile dependencies valid |
| DSH plugin id | `dsh-external/dsh-better-sidebar` | Keeps registry/profile identity stable |
| service | `ctx.betterSidebar` | Keeps third-party integrations valid |
| config/persistence keys | unchanged | Avoids migration and state loss |

Both `package.json` and `dsh.plugin.json` use `0.15.0-xlh.1`. This is a
fork-specific prerelease greater than the current upstream `0.14.0`, while
remaining visibly distinct. Later source releases increment the `xlh` suffix;
a future stable release requires a separate decision.

`package.json.repository.url` and current fork-maintainer links point to
`https://github.com/XiaoyaoLinghao/DSH-better-sidebar`. Historical changelog
links keep their original upstream URLs and attribution.

## Source-install interface

The existing platform installers gain an explicit source mode:

```bash
bash scripts/install.sh --source --profile web
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```

The current npm/version mode remains available for compatibility, but the
fork README does not present it as the way to install this fork. Both source
interfaces retain the existing restart and dry-run switches.

### Source-mode data flow

1. Resolve the repository root from the installer location rather than the
   caller's current directory.
2. Read `package.json` and `dsh.plugin.json`; require the expected package name
   and identical versions before making profile changes.
3. Check Node.js, pnpm, and a usable DSH CLI. Require DSH `0.1.0-rc.8` for this
   release and report the observed version on mismatch.
4. Run `pnpm install --frozen-lockfile`, then `pnpm build`.
5. Create `.artifacts/` under the repository, run `pnpm pack` into it, and
   select the tarball for the manifest version. `.artifacts/` is gitignored and
   retained for diagnosis, reproduction, or rollback.
6. Idempotently update the selected DSH profile's `pnpm-workspace.yaml` to
   permit the four build-script packages required by the rc.8 lane:
   `node-pty`, `protobufjs`, `@deepseek-ai/dsh-subprocess-local`, and `koffi`.
7. Invoke the official CLI with an absolute file spec:
   `dsh plugin --profile <profile> add file:<absolute-tarball>`.
8. Verify the profile dependency resolves to the tarball/current version and
   that the plugin bundle is registered. A failed verification is an install
   failure even if the CLI returned zero.
9. Print hard-refresh guidance. Restart only when the existing explicit
   restart flag was supplied.

The installer never edits DSH source. It does not recursively delete build
outputs or user data. A subsequent source install overwrites only the
version-named tarball it owns and otherwise leaves `.artifacts/` available.

### Dry-run behavior

`--dry-run` / `-DryRun` performs validation that is read-only and prints the
exact repository, version, build, pack, profile, CLI, and verification actions.
It does not install dependencies, build, create `.artifacts/`, edit a profile,
invoke `plugin add`, or restart a process.

### Failure behavior

- A manifest mismatch, unsupported DSH version, missing tool, dependency
  install failure, build failure, or pack failure stops before `plugin add`.
- Profile workspace edits are idempotent and limited to required pnpm policy
  entries.
- A `plugin add` or post-install verification failure exits non-zero, retains
  the tarball, and prints the failed command/context for an automation agent.
- Paths containing spaces, non-ASCII characters, and Windows drive syntax are
  treated as data and passed without shell interpolation.
- Existing npm mode and `--repair` behavior remain backward compatible.

## README information architecture

The Chinese and English READMEs remain equivalent and use this order:

1. **Identity block:** DSH Better Workbench, fork repository, compatibility
   identities, DSH rc.8 requirement, and upstream/reference attribution.
2. **Capabilities:** workbench features with native `/side` and `/btw`
   Sidechain visible in the first-screen summary.
3. **Source install (recommended):** prerequisites plus the one Bash and one
   PowerShell command.
4. **Automation contract:** repository root, command, expected version,
   success checks, no implicit restart, and exact failure/rollback guidance.
5. **Update/uninstall:** `git pull` followed by source mode again; official DSH
   remove command for uninstall; retained tarball for rollback.
6. **Channel warning:** npm `dsh-better-sidebar@latest` is the upstream channel
   and does not install this fork.
7. **Current release:** `v0.15.0-xlh.1` with branding, native Sidechain, source
   installer, compatibility, and provenance notes.
8. Existing detailed usage, extension API, and upstream historical changelog.

Historical upstream PR links, release notes, MIT license references, and the
BSD-3-Clause `dsh-sidechain` notice remain intact. Text must not imply that the
fork authored upstream work.

## Components changed

- `package.json`: version, description, repository URL.
- `dsh.plugin.json`: version and description; id remains unchanged.
- Settings version badge source/tests: display name and manifest-derived
  version.
- `README.md` and `README_EN.md`: identity, source-first installation,
  automation contract, update/rollback, channel warning, and current release.
- `scripts/install.sh` and `scripts/install.ps1`: source mode and four-package
  build policy, while preserving npm and repair modes.
- `.gitignore`: `.artifacts/`.
- Focused tests for manifest identity, documentation contracts, and installer
  behavior.

## Verification

Automated tests must prove:

- package and plugin manifest versions are exactly `0.15.0-xlh.1` and equal;
- the compatibility package name and plugin id are unchanged;
- package manifests and the rendered settings badge expose the approved display
  name, fork URL, version, compatibility ids, and rc.8 baseline;
- the Bash and PowerShell command blocks marked for automation in both READMEs
  are extracted and successfully executed against isolated fake DSH profiles;
- Bash and PowerShell source dry-runs make no writes or child install/build
  calls;
- source mode uses the repository root even when invoked elsewhere;
- spaces and non-ASCII paths survive as one absolute `file:` argument;
- all four build-script approvals are idempotent;
- dependency/build/pack/plugin-add failures stop at the correct boundary;
- successful fake installs verify version and bundle registration;
- repeated source installs remain deterministic.

Human-facing channel warnings, attribution wording, and historical narrative
are reviewed as documentation rather than guarded by brittle exact-text tests.
The reviewer must still confirm Chinese/English semantic equivalence and that
the current fork path cannot be mistaken for the upstream npm channel.

Release gates are:

- focused installer/manifest/README tests;
- `pnpm typecheck`;
- `pnpm build`;
- full unit suite, with any environment-only baseline failure compared against
  the unchanged base;
- `pnpm check:consumer-types`;
- `pnpm pack --dry-run --json`, including both READMEs, manifests, installers,
  license, and third-party notice;
- an isolated real DSH `0.1.0-rc.8` mount using the source-produced tarball,
  proving plugin discovery, bundle registration, workbench rendering, and
  native Sidechain still work.

## Acceptance criteria

- A user or DSH automation agent can clone the fork and install it with one
  documented platform command.
- The installed settings UI identifies itself as DSH Better Workbench
  `v0.15.0-xlh.1`.
- Existing profiles, extension imports, service consumers, preferences, and
  session state continue to work without migration.
- No documentation path accidentally directs a fork user to install the
  upstream npm build as though it were this fork.
- The real rc.8 mount suite passes from a source-produced package.
