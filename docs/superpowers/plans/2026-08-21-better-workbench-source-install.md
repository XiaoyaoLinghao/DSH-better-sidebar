# DSH Better Workbench Source Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the fork as DSH Better Workbench `0.15.0-xlh.1` while preserving all compatibility identities, and provide tested one-command Bash and PowerShell installation from a checked-out source tree.

**Architecture:** Keep `dsh-better-sidebar`, `dsh-external/dsh-better-sidebar`, `ctx.betterSidebar`, configuration, and persisted state unchanged. Add an explicit source branch to each existing installer: validate the two manifests, build and pack into `.artifacts/`, prepare the selected DSH profile, install the absolute tarball through the official DSH CLI, and verify both installed version and bundle registration. Tests use isolated fake profiles and fake `pnpm`/`dsh` executables; the existing rc.8 mount lane remains the final real-system proof.

**Tech Stack:** TypeScript 5.6, Vitest 4, Bash, Windows PowerShell 5.1+/pwsh, Node.js 20+, pnpm 10/11, DeepSeek Harness `0.1.0-rc.8`, React 18.

## Global Constraints

- Product-facing name is exactly `DSH Better Workbench`.
- Release version is exactly `0.15.0-xlh.1` in `package.json`, `dsh.plugin.json`, the service version, UI, and current-release docs.
- Keep npm/package name exactly `dsh-better-sidebar`.
- Keep DSH plugin id exactly `dsh-external/dsh-better-sidebar`.
- Do not rename `ctx.betterSidebar`, routes, bundle ids, config keys, preferences, or persisted metadata.
- Repository/current-maintainer URL is `https://github.com/XiaoyaoLinghao/DSH-better-sidebar`; historical upstream PR/release links remain attributed to `omdsh-dev`.
- Source install requires DSH `0.1.0-rc.8` and installs through `dsh plugin --profile <profile> add file:<absolute-tarball>`.
- Allow exactly the required build-script packages in the source workspace/profile: `node-pty`, `protobufjs`, `@deepseek-ai/dsh-subprocess-local`, and `koffi`.
- `.artifacts/` is retained and gitignored; installers must not recursively delete it or user data.
- Dry-run performs no dependency install, build, pack, profile write, plugin add, or restart.
- Default execution does not restart DSH; restart remains explicit.
- Chinese and English READMEs must carry equivalent identity, install, update, rollback, warning, and release information.
- Each task is implemented by a fresh `gpt-5.6-luna` worker and reviewed by `gpt-5.6-sol` before the next task. The final whole-branch review is also `gpt-5.6-sol`.

## File responsibility map

- `package.json`, `dsh.plugin.json`: compatibility identity, release version, description, fork repository metadata.
- `src/client/service.ts`: service-reported release version.
- `src/client/SideCardSection.tsx`: product-facing settings badge name.
- `scripts/install.sh`: Bash npm/repair/source modes and source install orchestration.
- `scripts/install.ps1`: PowerShell npm/repair/source modes and source install orchestration.
- `pnpm-workspace.yaml`: source checkout build-script approvals.
- `.gitignore`: retained `.artifacts/` output.
- `tests/helpers/source-install-fixture.ts`: isolated repo/profile and fake CLI contract shared by installer tests.
- `tests/source-install-bash.spec.ts`: Bash source/dry-run/failure/idempotency behavior.
- `tests/source-install-powershell.spec.ts`: PowerShell parity and Windows path behavior.
- `tests/manifest-consistency.spec.ts`, `tests/service.spec.ts`, `tests/side-card-section.spec.tsx`: identity and version guards.
- `tests/readme-source-install.spec.ts`: extracts marked README commands and executes them against isolated fake DSH profiles.
- `tests/sidechain-provenance.spec.ts`: packed artifact inventory and attribution guard.
- `README.md`, `README_EN.md`: product identity, source-first install contract, current release, history and attribution.

---

### Task 1: Lock the fork identity, version, and UI badge

**Files:**
- Modify: `package.json:2-9`
- Modify: `dsh.plugin.json:2-5`
- Modify: `src/client/service.ts:473`
- Modify: `src/client/SideCardSection.tsx:739-746`
- Modify: `tests/manifest-consistency.spec.ts:25-90`
- Modify: `tests/service.spec.ts:650-660`
- Modify: `tests/side-card-section.spec.tsx:60-90`

**Interfaces:**
- Consumes: existing `SIDEBAR_SERVICE_VERSION: string` and `SideCardSection` render contract.
- Produces: package/plugin/service version `0.15.0-xlh.1`; settings badge accessible text `DSH Better Workbench v0.15.0-xlh.1`; unchanged package name and plugin id.

- [ ] **Step 1: Add failing manifest and service identity assertions**

Extend `PackageJson` in `tests/manifest-consistency.spec.ts` and add a focused test:

```ts
interface PackageJson {
  name: string
  version: string
  description?: string
  repository?: { type?: string; url?: string }
  files?: string[]
}

it('identifies the compatible DSH Better Workbench fork', () => {
  expect(pkg.name).toBe('dsh-better-sidebar')
  expect(manifest.id).toBe('dsh-external/dsh-better-sidebar')
  expect(pkg.version).toBe('0.15.0-xlh.1')
  expect(manifest.version).toBe('0.15.0-xlh.1')
  expect(pkg.description).toContain('DSH Better Workbench')
  expect(manifest.description).toContain('DSH Better Workbench')
  expect(pkg.repository?.url).toBe('https://github.com/XiaoyaoLinghao/DSH-better-sidebar')
})
```

In `tests/service.spec.ts`, make the existing version test exact:

```ts
expect(SIDEBAR_SERVICE_VERSION).toBe('0.15.0-xlh.1')
expect(SIDEBAR_SERVICE_VERSION).toBe(pkg.version)
```

- [ ] **Step 2: Add the failing settings badge assertion**

Use the existing `renderSection()` helper in `tests/side-card-section.spec.tsx` and assert:

```ts
const container = renderSection()
expect(container.textContent).toContain('DSH Better Workbench')
expect(container.textContent).toContain('v0.15.0-xlh.1')
expect(container.textContent).not.toContain('DSH-better-sidebarv')
```

If the existing helper returns `{ container, ... }`, destructure its `container`; do not add a second renderer.

- [ ] **Step 3: Run the focused tests and confirm the old identity fails**

Run:

```bash
pnpm build
pnpm exec vitest run tests/manifest-consistency.spec.ts tests/service.spec.ts tests/side-card-section.spec.tsx
```

Expected: FAIL on `0.14.0`, the upstream repository URL, and `DSH-better-sidebar` badge text.

- [ ] **Step 4: Apply the minimal compatible identity changes**

Set:

```jsonc
// package.json fields
"name": "dsh-better-sidebar",
"version": "0.15.0-xlh.1",
"description": "DSH Better Workbench: a session-isolated web workbench with sidebar, editor, terminal, Git, browser, extensible tabs/viewers, and native Sidechain.",
"repository": {
  "type": "git",
  "url": "https://github.com/XiaoyaoLinghao/DSH-better-sidebar"
}
```

```jsonc
// dsh.plugin.json fields; keep id unchanged
"id": "dsh-external/dsh-better-sidebar",
"version": "0.15.0-xlh.1",
"description": "DSH Better Workbench：按会话隔离的侧边栏、编辑器、终端、Git、浏览器、扩展页面与原生 Sidechain 工作台"
```

Set `SIDEBAR_SERVICE_VERSION` to `0.15.0-xlh.1`, and replace only the
product-facing badge span with:

```tsx
<span className={css.versionBadgeName}>DSH Better Workbench</span>
```

- [ ] **Step 5: Rebuild and verify the identity slice**

Run:

```bash
pnpm build
pnpm exec vitest run tests/manifest-consistency.spec.ts tests/service.spec.ts tests/side-card-section.spec.tsx tests/api-surface.spec.ts
pnpm typecheck
git diff --check
```

Expected: all commands exit 0; built client ids remain the unchanged package/plugin ids.

- [ ] **Step 6: Commit Task 1**

```bash
git add package.json dsh.plugin.json src/client/service.ts src/client/SideCardSection.tsx tests/manifest-consistency.spec.ts tests/service.spec.ts tests/side-card-section.spec.tsx
git commit -m "feat: rebrand as DSH Better Workbench"
```

---

### Task 2: Add tested Bash source installation

**Files:**
- Modify: `.gitignore`
- Modify: `pnpm-workspace.yaml:1-12`
- Modify: `scripts/install.sh`
- Create: `tests/helpers/source-install-fixture.ts`
- Create: `tests/source-install-bash.spec.ts`

**Interfaces:**
- Consumes: package name `dsh-better-sidebar`, manifest version `0.15.0-xlh.1`, existing `--repair`, `--restart`, `--dry-run`, and `--profile` options.
- Produces: `bash scripts/install.sh --source --profile <name>`; retained `.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz`; absolute `file:` install spec.
- Produces for Task 3: `createSourceInstallFixture()` and `readSourceCalls()` from `tests/helpers/source-install-fixture.ts`.

- [ ] **Step 1: Create the shared isolated installer fixture**

Implement this exported contract in `tests/helpers/source-install-fixture.ts`:

```ts
export interface SourceCall {
  tool: 'pnpm' | 'dsh'
  argv: string[]
  cwd: string
}

export interface SourceInstallFixture {
  sandbox: string
  repo: string
  foreignCwd: string
  dshHome: string
  profileDir: string
  callsFile: string
  env: NodeJS.ProcessEnv
  cleanup(): void
}

export function createSourceInstallFixture(options?: {
  failPnpmCommand?: 'install' | 'build' | 'pack'
  dshVersion?: string
  registerBundle?: boolean
  installedVersion?: string
}): SourceInstallFixture

export function readSourceCalls(path: string): SourceCall[]
```

The fixture must:

- create its sandbox under `tmpdir()` with a repo directory named
  `源码 repo with spaces`;
- copy `scripts/install.sh`, `scripts/install.ps1`, `package.json`,
  `dsh.plugin.json`, and `pnpm-lock.yaml` into that repo;
- create `profiles/web/package.json`, `pnpm-workspace.yaml`, and
  `cordis.patch.yml` under an isolated `DSH_HOME`;
- prepend fake `pnpm` and `dsh` executables to `PATH`;
- record one JSON line per invocation in `callsFile`;
- make fake `pnpm pack --pack-destination <dir>` create
  `dsh-better-sidebar-0.15.0-xlh.1.tgz` in that directory;
- make fake `dsh --version` print the configured version (default
  `0.1.0-rc.8`);
- make fake `dsh plugin --profile web add file:<path>` create
  `profileDir/node_modules/dsh-better-sidebar/package.json` with the configured
  installed version and add `dsh-better-sidebar` to
  `dsh.profile.bundles` unless `registerBundle` is false;
- remove only its own `sandbox` in `cleanup()`.

Use fixed Node fake implementations plus platform wrappers (`pnpm`/`dsh` with
shebangs and `pnpm.cmd`/`dsh.cmd` forwarding to the same Node files) so Task 3
can reuse the fixture.

- [ ] **Step 2: Write failing Bash source-mode tests**

Create `tests/source-install-bash.spec.ts` with these named cases:

```ts
it('dry-run reports source actions and performs no writes or child calls')
it('builds from the script repository and installs one absolute file tarball')
it('adds all four build approvals idempotently')
it.each(['install', 'build', 'pack'] as const)('stops before plugin add when pnpm %s fails')
it('rejects a DSH version other than 0.1.0-rc.8 before profile writes')
it('fails when installed version or bundle registration cannot be verified')
```

The success test invokes Bash from `fixture.foreignCwd`, then asserts:

```ts
expect(readSourceCalls(fixture.callsFile)).toEqual([
  { tool: 'dsh', argv: ['--version'], cwd: fixture.repo },
  { tool: 'pnpm', argv: ['install', '--frozen-lockfile'], cwd: fixture.repo },
  { tool: 'pnpm', argv: ['build'], cwd: fixture.repo },
  { tool: 'pnpm', argv: ['pack', '--pack-destination', join(fixture.repo, '.artifacts')], cwd: fixture.repo },
  { tool: 'dsh', argv: ['plugin', '--profile', 'web', 'add', `file:${join(fixture.repo, '.artifacts', 'dsh-better-sidebar-0.15.0-xlh.1.tgz')}`], cwd: fixture.repo },
])
```

Normalize separators only for comparison; do not weaken equality to substring
checks. Assert the four YAML keys each occur exactly once after running source
mode twice.

- [ ] **Step 3: Run the Bash tests and verify `--source` is rejected**

Run:

```bash
pnpm exec vitest run tests/source-install-bash.spec.ts
```

Expected: FAIL because `scripts/install.sh` reports `未知参数: --source`.

- [ ] **Step 4: Implement Bash source mode**

Add `SOURCE=false`, recognize `--source`, and reject a positional npm version
when source mode is active. Resolve the repository independently of `$PWD`:

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ARTIFACT_DIR="$ROOT/.artifacts"
SOURCE_VERSION="$(node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "dsh.plugin.json"), "utf8"));
if (pkg.name !== "dsh-better-sidebar") throw new Error(`unexpected package name: ${pkg.name}`);
if (pkg.version !== manifest.version) throw new Error(`manifest version mismatch: ${pkg.version} != ${manifest.version}`);
process.stdout.write(pkg.version);
' "$ROOT")" || die "源码 manifest 校验失败。"
TARBALL="$ARTIFACT_DIR/dsh-better-sidebar-${SOURCE_VERSION}.tgz"
```

After successful manifest validation, source mode changes the installer
process directory with `cd "$ROOT"`. This makes every fake/real child call
deterministic without changing the caller's shell directory (the installer is
a separate process).

In source dry-run, print the resolved root/version/tarball and all five steps,
then exit before `ensure_workspace_settings`.

In live source mode:

```bash
OBSERVED_DSH_VERSION="$($CLI --version 2>&1 | tail -n 1)"
[ "$OBSERVED_DSH_VERSION" = "0.1.0-rc.8" ] || die "源码版要求 DSH 0.1.0-rc.8，当前为 ${OBSERVED_DSH_VERSION}。"
(cd "$ROOT" && pnpm install --frozen-lockfile)
(cd "$ROOT" && pnpm build)
mkdir -p "$ARTIFACT_DIR"
(cd "$ROOT" && pnpm pack --pack-destination "$ARTIFACT_DIR")
[ -f "$TARBALL" ] || die "pnpm pack 未生成预期 tarball：$TARBALL"
INSTALL_SPEC="file:$TARBALL"
```

Use `INSTALL_SPEC` in the existing plugin-add path. Extend
`ensure_workspace_settings` and the root `pnpm-workspace.yaml` to contain all
four approvals. After the existing bundle check, source mode must read
`$PROFILE_DIR/node_modules/dsh-better-sidebar/package.json` and require its
version to equal `$SOURCE_VERSION`.

Add `.artifacts/` to `.gitignore`; never call `rm -r`, `rm -rf`, or delete an
existing artifact directory.

- [ ] **Step 5: Verify Bash behavior and adjacent legacy modes**

Run:

```bash
bash -n scripts/install.sh
pnpm exec vitest run tests/source-install-bash.spec.ts tests/pty-deps.spec.ts tests/script-safety.spec.ts
pnpm typecheck
git diff --check
```

Expected: all new Bash tests pass; existing repair-command and script-safety
contracts have no new failure. If `tests/pty-deps.spec.ts` hits its documented
Windows base expectation, compare that exact case on base and record it rather
than changing source-mode assertions.

- [ ] **Step 6: Commit Task 2**

```bash
git add .gitignore pnpm-workspace.yaml scripts/install.sh tests/helpers/source-install-fixture.ts tests/source-install-bash.spec.ts
git commit -m "feat: install Better Workbench from source on bash"
```

---

### Task 3: Add PowerShell source-install parity

**Files:**
- Modify: `scripts/install.ps1`
- Modify: `tests/helpers/source-install-fixture.ts` only if a proven PowerShell wrapper defect requires it
- Create: `tests/source-install-powershell.spec.ts`

**Interfaces:**
- Consumes: Task 2 fixture exports and `.artifacts`/manifest/profile contract.
- Produces: `powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile <name>` with behavior equivalent to Bash.

- [ ] **Step 1: Write the failing PowerShell parity tests**

Create `tests/source-install-powershell.spec.ts`. Detect `pwsh` first, then
`powershell`; skip only when neither executable exists. Cover these exact cases:

```ts
it('has parseable PowerShell 5.1-compatible syntax')
it('source dry-run performs no writes or fake tool calls')
it('preserves the absolute non-ASCII tarball as one file argument')
it('keeps four build approvals idempotent across repeated installs')
it.each(['install', 'build', 'pack'] as const)('does not call dsh plugin add after pnpm %s failure')
it('rejects wrong DSH and failed version or bundle verification')
```

Use the Task 2 fixture and compare the same ordered `SourceCall[]`. For the
parse test run:

```powershell
[void][scriptblock]::Create((Get-Content -Raw scripts/install.ps1))
```

- [ ] **Step 2: Run the PowerShell tests and verify `-Source` fails**

Run:

```bash
pnpm exec vitest run tests/source-install-powershell.spec.ts
```

Expected: FAIL because `install.ps1` has no `Source` switch.

- [ ] **Step 3: Implement PowerShell source mode without string evaluation**

Add the parameter and resolve repository paths from `$PSScriptRoot`:

```powershell
param(
  [string]$Version = '',
  [switch]$Source,
  [switch]$Restart,
  [switch]$DryRun,
  [switch]$Repair,
  [string]$Profile = 'web'
)

$ROOT = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ARTIFACT_DIR = Join-Path $ROOT '.artifacts'
$sourcePackage = Get-Content -Raw (Join-Path $ROOT 'package.json') | ConvertFrom-Json
$sourceManifest = Get-Content -Raw (Join-Path $ROOT 'dsh.plugin.json') | ConvertFrom-Json
if ($sourcePackage.name -ne 'dsh-better-sidebar') { Die "源码包名异常：$($sourcePackage.name)" }
if ($sourcePackage.version -ne $sourceManifest.version) { Die '源码 manifest 版本不一致。' }
$SOURCE_VERSION = [string]$sourcePackage.version
$TARBALL = Join-Path $ARTIFACT_DIR "dsh-better-sidebar-$SOURCE_VERSION.tgz"
```

Reject `-Source` combined with `-Repair` or a non-empty `-Version`. In live
source mode invoke tools with PowerShell argument arrays, never
`Invoke-Expression` or a concatenated command string:

```powershell
& pnpm @('install', '--frozen-lockfile')
& pnpm @('build')
New-Item -ItemType Directory -Force -Path $ARTIFACT_DIR | Out-Null
& pnpm @('pack', '--pack-destination', $ARTIFACT_DIR)
$INSTALL_SPEC = "file:$TARBALL"
```

Use `Set-Location -LiteralPath $ROOT` after manifest validation so child-call
working directories match Bash. For the DSH version probe, preserve the
existing CLI selection explicitly: `& dsh --version` for the direct branch,
and `& npx @('-y', '--package', '@deepseek-ai/dsh', 'dsh', '--version')` for
the fallback branch. Require the final output line to equal `0.1.0-rc.8`.

Use the existing CLI branch (`dsh` versus `npx`) with `$INSTALL_SPEC` as one
array element. Extend `Ensure-WorkspaceSettings` to the same four approvals.
After bundle validation, require the installed package manifest version to
equal `$SOURCE_VERSION`. Dry-run exits before every call/write.

- [ ] **Step 4: Verify parity and syntax**

Run:

```bash
pnpm exec vitest run tests/source-install-powershell.spec.ts tests/source-install-bash.spec.ts tests/pty-deps.spec.ts
pnpm typecheck
powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content -Raw 'scripts/install.ps1'))"
git diff --check
```

Expected: Bash and PowerShell tests pass with identical ordered call shapes;
PowerShell parse exits 0.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/install.ps1 tests/helpers/source-install-fixture.ts tests/source-install-powershell.spec.ts
git commit -m "feat: install Better Workbench from source on PowerShell"
```

---

### Task 4: Make the bilingual README source-first and automation-readable

**Files:**
- Create: `tests/readme-source-install.spec.ts`
- Modify: `README.md:1-220`
- Modify: `README_EN.md:1-235`

**Interfaces:**
- Consumes: Task 2 and Task 3 command syntax and the Task 1 identity/version.
- Produces: equivalent Chinese/English identity, recommended source command, automation contract, channel warning, update/uninstall/rollback, and `v0.15.0-xlh.1` release notes.

- [ ] **Step 1: Write failing executable README-command tests**

Create `tests/readme-source-install.spec.ts`. Locate the fenced command that
immediately follows each machine-readable marker:

````markdown
<!-- source-install:bash -->
```bash
bash scripts/install.sh --source --profile web
```

<!-- source-install:powershell -->
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```
````

Export a local test helper with the exact signature:

```ts
function commandAfterMarker(readme: string, marker: 'bash' | 'powershell'): string
```

It must reject a missing marker, more than one marker, an absent adjacent code
fence, or a multiline command. For each README and each platform command:

1. create a fresh Task 2 `SourceInstallFixture`;
2. execute the extracted command with `cwd: fixture.repo`, `env: fixture.env`,
   and no shell interpolation beyond the command that the README itself tells
   an automation agent to run;
3. assert exit 0, the installed manifest version is `0.15.0-xlh.1`, the profile
   bundle contains `dsh-better-sidebar`, and the fake CLI call includes one
   absolute `file:` tarball argument;
4. clean only the fixture sandbox.

This test earns its assertions by executing the documented consumer path. It
must not assert headings, prose wording, repository URLs, or raw installer
source strings.

- [ ] **Step 2: Run the contract test and confirm the old source flow fails**

Run:

```bash
pnpm exec vitest run tests/readme-source-install.spec.ts
```

Expected: FAIL because the marked executable command blocks do not exist.

- [ ] **Step 3: Rewrite the Chinese current identity and install sections**

In `README.md`:

- change the H1 and hero/product references to `DSH Better Workbench`;
- add a concise compatibility notice immediately below the language switch:
  the product name changed, but package/id/service stay compatible;
- put native `/side` and `/btw` in the first-screen feature badges/list;
- add `### v0.15.0-xlh.1` before the upstream `v0.14.0` history, covering the
  fork identity, native Sidechain, source installer, rc.8 floor, and retained
  upstream/BSD attribution;
- replace the primary install block with prerequisites, clone command, and the
  two one-command platform alternatives, with the exact
  `<!-- source-install:bash -->` and `<!-- source-install:powershell -->`
  markers immediately before their single-line fenced commands;
- add an `供 DSH / 自动化代理读取` block that states: run from the cloned repo,
  select one platform command, success requires installed version plus bundle,
  no implicit restart, and failure must stop rather than fall back to npm;
- document update as `git pull` then rerun source mode;
- document uninstall with the exact official remove command and rollback using
  the retained `.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz`;
- state prominently that `dsh-better-sidebar@latest` is upstream npm and does
  not install this fork;
- remove the old manual `link:`/hand-written mount recipe from the primary
  source section because it bypasses official bundle coordination.

- [ ] **Step 4: Apply the equivalent English structure**

Mirror Step 3 in `README_EN.md` using the same commands, ids, version, order,
and success criteria. The channel warning must include the literal words
`upstream npm channel` and `does not install this fork`; the automation block
must be titled `For DSH / automation agents`.

- [ ] **Step 5: Verify docs, links-by-policy, and formatting**

Run:

```bash
pnpm exec vitest run tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts
rg -n "XiaoyaoLinghao|0.15.0-xlh.1|--source|upstream npm|上游 npm" README.md README_EN.md
git diff --check
```

Expected: the extracted commands execute successfully. The `rg` output is a
review aid, not a test gate: the Task 4 Sol reviewer inspects current fork
links, channel warnings, Chinese/English semantic parity, historical upstream
links, and `THIRD_PARTY_NOTICES` attribution.

- [ ] **Step 6: Commit Task 4**

```bash
git add README.md README_EN.md tests/readme-source-install.spec.ts
git commit -m "docs: make source install the primary fork channel"
```

---

### Task 5: Guard package inventory and run release acceptance

**Files:**
- Modify: `tests/sidechain-provenance.spec.ts`
- Modify: `tests/script-safety.spec.ts` only if an existing assertion contradicts the new behavior already proven by installer execution tests
- Modify: `docs/superpowers/plans/2026-08-21-better-workbench-source-install.md` only to check completed boxes during execution

**Interfaces:**
- Consumes: Tasks 1-4 complete tree.
- Produces: release-level proof that source installers and documentation ship, `.artifacts` does not, and the real rc.8 mount remains green.

- [x] **Step 1: Add the failing pack-inventory assertions**

Extend the existing `pnpm pack --dry-run --json` inventory test to require:

```ts
expect(files).toContain('README.md')
expect(files).toContain('README_EN.md')
expect(files).toContain('scripts/install.sh')
expect(files).toContain('scripts/install.ps1')
expect(files).toContain('THIRD_PARTY_NOTICES')
expect(files.some(path => path.startsWith('.artifacts/'))).toBe(false)
```

Do not add source-text assertions for installers. Task 2 and Task 3 must prove
the four approvals, dry-run zero writes, exact argv, failure boundaries, and
idempotency through executed behavior. If an existing `script-safety` test is
stale, replace it with an executed fixture assertion or remove only the
duplicated textual assertion after confirming equivalent behavioral coverage.

- [x] **Step 2: Run the release guards**

Run:

```bash
pnpm exec vitest run tests/sidechain-provenance.spec.ts tests/script-safety.spec.ts
```

Expected before final guard adjustments: FAIL if the inventory or four-package
source contract is not yet represented exactly; change only the assertions
made stale by the approved design, not unrelated safety guarantees.

- [ ] **Step 3: Run all focused feature tests**

Run:

```bash
pnpm build
pnpm exec vitest run tests/manifest-consistency.spec.ts tests/service.spec.ts tests/side-card-section.spec.tsx tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts tests/script-safety.spec.ts
pnpm typecheck
pnpm check:consumer-types
pnpm pack --dry-run --json
git diff --check
```

Expected: all commands exit 0. The pack manifest includes both installers and
READMEs and excludes `.artifacts/`.

- [ ] **Step 4: Run the full unit suite and classify only reproduced base failures**

Run:

```bash
pnpm test
```

Expected: no branch-introduced failure. If Windows reports the known PTY repair
command, CRLF discard, or missing Git author/committer cases, run those exact
test files/cases at base commit `36c60ea` in a separate clean worktree and
record equality. Do not call a non-zero suite green and do not weaken tests.

- [ ] **Step 5: Run the isolated real rc.8 source-package mount**

Run the existing non-destructive mount lane from the feature worktree:

```bash
pnpm test:mount
```

Expected: 7/7 Playwright mount tests pass against pinned DSH `0.1.0-rc.8`,
including plugin discovery, persisted settings, Sidechain commands/view, and
layout ownership. Preserve the runner's quarantine output for manual/OS
reclamation; do not delete it recursively.

- [ ] **Step 6: Commit Task 5 acceptance guards**

```bash
git add tests/sidechain-provenance.spec.ts tests/script-safety.spec.ts docs/superpowers/plans/2026-08-21-better-workbench-source-install.md
git commit -m "test: guard Better Workbench source release"
```

- [ ] **Step 7: Request final whole-branch Sol review**

Generate a fixed-base review package from design commit `8b02bcc` to final
HEAD. The reviewer must check identity compatibility, source installer safety,
Bash/PowerShell parity, README channel clarity, pack inventory, base-failure
classification, and the fresh rc.8 mount. Fix every Critical/Important finding
with one fresh Luna worker, then obtain one scoped Sol re-review before push.

## Completion handoff

After final approval and fresh verification:

1. Push `feat/better-workbench-source-install` to
   `https://github.com/XiaoyaoLinghao/DSH-better-sidebar`.
2. Fast-forward fork `main` only if it is still an ancestor and the user has
   authorized merging; never force-push.
3. Preserve the feature worktree when remote review/follow-up may continue.
4. Report the exact remote commit, source-install commands, validation results,
   and any reproduced base-only failures.
