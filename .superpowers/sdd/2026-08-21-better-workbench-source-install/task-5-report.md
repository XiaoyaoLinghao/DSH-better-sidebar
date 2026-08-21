# Task 5 report — package guard and release acceptance

Date: 2026-08-21
Base: `36c60ea11ada44ab653b2b972a35a3b586a6c637`

## Acceptance guard change

`tests/sidechain-provenance.spec.ts` now parses one `pnpm pack --dry-run --json`
inventory and requires `README.md`, `README_EN.md`, both source installers, and
`THIRD_PARTY_NOTICES`; it also rejects every `.artifacts/` entry. No installer
source-text assertions were added or removed. `tests/script-safety.spec.ts`
was unchanged.

The guard was TDD-checked with a temporary impossible inventory assertion: the
test failed because `__task5_red__` was absent. After replacing it with the
approved inventory assertions, the release guard passed.

## Verification

- `pnpm exec vitest run tests/sidechain-provenance.spec.ts tests/script-safety.spec.ts`: **18 passed**.
- `pnpm build`: **passed** (tsdown emitted existing deprecation warnings).
- Focused feature suite (manifest, service, side-card, Bash/PowerShell source install, README execution, provenance, safety): **8 files, 144 passed**.
- `pnpm exec vitest run tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts --testTimeout=30000`: **3 files, 33 passed**.
- `pnpm check:consumer-types`: **passed**; only the documented upstream Cordis declaration note was reported; scratch was quarantined at `C:\Users\ZhangYang\AppData\Local\Temp\.dsh-consumer-types.quarantine-8db4e8979a051658-60725ea2b5874a8a`.
- `pnpm pack --dry-run --json`: **passed**; inventory contains both READMEs, both installers, and `THIRD_PARTY_NOTICES`, and contains no `.artifacts/` path.
- `git diff --check`: **passed**.

`pnpm typecheck` initially reported three existing type errors in the Task 4
README behavior test. A focused follow-up repaired those errors without
changing the behavioral design: regex captures, the command executable,
spawn output, and the tarball call/path are explicitly narrowed. The
follow-up verification passed:

```text
pnpm exec vitest run tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts: 2 files, 7 passed
pnpm typecheck: passed
git diff --check: passed
```

## Full unit suite and base comparison

Feature worktree `pnpm test`: **880 passed, 9 skipped, 12 failed**, with one
ConPTY worker error. The four known base failures were reproduced in a fresh
clean worktree at `36c60ea` using `pnpm test`: **848 passed, 9 skipped, 4
failed**, plus two ConPTY worker errors. The four equal base-only failures are:

1. `tests/pty-deps.spec.ts`: Windows PTY repair-command expectation.
2. `tests/smoke.spec.ts`: CRLF normalization in discard.
3. `tests/smoke.spec.ts`: missing Git author identity for revert.
4. `tests/smoke.spec.ts`: missing Git committer identity for cherry-pick.

The additional feature-suite failures were test timeouts under full Vitest
parallel load; the source-install tests pass when run with their intended
30-second timeout (33/33 above). No production or safety assertion was
weakened.

## Real rc.8 mount

Feature worktree `pnpm test:mount` used the pinned `@deepseek-ai/dsh@0.1.0-rc.8`
default lane and completed **6/7**: four drag-layout tests, the main mount
test, and the desktop title-bar test passed; one deep-center-column drag test
timed out. Its non-destructive quarantine is preserved at:

`C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-992169537a902bf7-c1fe60ea17de8182`

The same deep-center-column test passed when run alone against the clean base
tarball. A full base mount run completed **4/7** and reproduced environment /
onboarding timing failures (two drag-layout tests and the mount sweep), with
its quarantine preserved at:

`C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-3f3dfbaecd7548e3-fc3781b61315a6fc`

No quarantine directory was recursively deleted.

## Follow-up debugging from `164d38b`

The parent Task 4 type narrowing commit was present during this follow-up.
`pnpm typecheck` and `git diff --check` both pass. No production installer,
mount behavior, timeout threshold, or acceptance test was changed.

The current-head default full unit run was **879 passed, 9 skipped, 13 failed**
(56.73s). The source-install timeouts reproduced only under the full suite:

- `source-install-bash.spec.ts`: `builds from the script repository and installs one absolute file tarball` (13.64s, default 5s); `adds all four build approvals idempotently` (16.20s, default 15s).
- `source-install-powershell.spec.ts`: `preserves the absolute non-ASCII tarball as one file argument` (10.87s), `uses the PATH dsh executable for direct source probe and install` (7.55s), `uses the npx fallback executable with its fixed dsh prefix when dsh is absent` (8.02s), and `uses a custom DSH_CMD executable for both source probe and install` (6.21s); each exceeded the default 5s timeout.

Vitest has no project `testTimeout` override in `vitest.config.ts`; file
parallelism and fork workers remain enabled. The single hypothesis was that
parallel child-process/PTY/filesystem load causes startup and cleanup jitter,
not a source installer logic regression. Two minimal controls confirmed it:

```text
pnpm exec vitest run tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts --no-file-parallelism: 33 passed, 41.55s
pnpm exec vitest run tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts --maxWorkers=1: 33 passed, 41.59s
```

The prior full mount lane remains **6/7** at current head (issue #248 was the
only failure), quarantined non-destructively at:

`C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-d50cc8a6ae0638cf-ae71e4cc7ffa6f33`

A fresh real pinned rc.8 mount run of that failing test alone was **1/1
passed** in 5.7s. Its preserved quarantine is:

`C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-b2b4c2e00cabeb8c-6a64c76f93271065`

The temporary diagnostic observer saw the replacement column connected and,
in the passing run, the panel and replacement column converged to identical
geometry. This supports nondeterministic full-lane resource/layout timing;
there is no proven product or test-harness defect to fix within Task 5 scope.
All quarantines remain intact.

## Commit status

Task 5 acceptance changes and this follow-up report are ready to commit. The
overall acceptance gate remains open: the full unit run has known base and
resource-contention failures, and the full rc.8 mount lane is 6/7 despite the
isolated issue #248 rerun passing. No acceptance-complete claim is made here.

## Per-test timeout hardening follow-up

To remove the proven full-suite resource-contention failure mode without
changing production behavior or Vitest global concurrency, every Bash and
PowerShell source-installer test that invokes `runSource` now uses the named
`INTEGRATION_TIMEOUT = 30_000` budget. This includes parameterized cases and
replaces the previous 15-second idempotency budget. Parser-only and
platform-file checks retain the default timeout.

Verification after the hardening:

- `pnpm exec vitest run tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts`:
  **33 passed** with normal file parallelism and no CLI timeout/concurrency
  override.
- `pnpm typecheck`: **passed**.
- Exact `pnpm test`: **887 passed, 9 skipped, 5 failed**, with one unhandled
  ConPTY error (55.60s). There were no source-install or README behavior test
  failures.

The five remaining failed tests are classified as follows:

1. `tests/pty-deps.spec.ts`: Windows PTY repair-command expectation — the
   known base failure.
2. `tests/smoke.spec.ts`: CRLF normalization in discard — the known base
   failure.
3. `tests/smoke.spec.ts`: missing Git author identity for revert — the known
   base failure.
4. `tests/smoke.spec.ts`: missing Git committer identity for cherry-pick — the
   known base failure.
5. `tests/smoke.spec.ts`: PTY manager quota/respawn test exceeded the default
   5-second test budget — a Windows ConPTY/resource-contention failure, not a
   branch-specific source-install failure.

Vitest also reported one unhandled `Signals not supported on windows` error
from `tests/agent-pty.spec.ts`, which is the known ConPTY/environment category.
The prior clean-base comparison recorded the same four assertion failures plus
ConPTY worker errors. No assertions were weakened and no mount threshold was
changed.

## Final fresh rc.8 mount from `1598eae`

With no other heavy test running, the complete real pinned rc.8 lane passed
**7/7** in **45.6s**:

1. width drag tracks the shell 1:1 — **6.2s**
2. fast width drag commits the dragged position — **3.4s**
3. interrupted fast drag keeps the dragged width — **3.4s**
4. capture-lost drag keeps the last applied width — **3.4s**
5. deep center-column replacement relocates the bottom panel — **2.8s**
6. plugin mount survives the built-in tab sweep — **22.9s**
7. desktop title-bar compatibility mode — **1.1s**

The run used DSH `0.1.0-rc.8`, exited 0, and preserved its non-destructive
quarantine at:

`C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-c56ac6f87570eae6-bdd97e8c43ef2856`

No production or test threshold changes were made for this run.

## Credential-isolation follow-up

The mount runner now creates an owned keyless `$DSH_HOME/.credentials.yaml`
containing `{}` immediately after the scratch directories are created and
before profile installation or web launch. This prevents rc.8 credential
migration from copying a configured key from the user's real DSH home into the
scratch profile. The file is created under `umask 077` and receives a portable
`chmod 600` best effort; the runner never reads, copies, or removes the real
home credential file.

TDD evidence for the regression is behavioral: the test-only positional probe
invokes both the pinned default runner and an explicit `DSH_CMD` fake runner.
Each fake runner verifies the scratch document is exactly `{}` plus one LF,
the hostile real-home document remains unchanged, and the two paths are
distinct before the probe exits without profile installation or web/network
activity. The pre-fix probe failed with `ENOENT` for the scratch credential
file; after the runner change it passed for both lanes.

Follow-up verification:

- `pnpm exec vitest run tests/script-safety.spec.ts -t "empty scratch credential"`: **1 passed**.
- `bash -n scripts/e2e-mount.sh`: **passed**.
- A fresh real pinned rc.8 mount lane remains **7/7**; its non-destructive
  quarantine is preserved at
  `C:\Users\ZhangYang\AppData\Local\Temp\.dsh-e2e-mount.quarantine-4dfe08c761753d89-fa27f31648049302`.

## Final Sol review fix wave

The final review identified five Important installer/README issues. The Luna
fix wave added behavioral regressions first, observed the expected RED state,
then repaired the implementation:

1. PowerShell now reads BOMless UTF-8 `package.json`, `dsh.plugin.json`, the
   profile manifest, and the installed manifest with explicit `-Encoding UTF8`.
   The README test executes the literal documented `powershell` executable;
   it skips only the behavioral PowerShell README cases when that executable
   is unavailable, without substituting `pwsh`. Windows PowerShell coverage
   includes a literal `powershell` BOMless-manifest install case.
2. Bash no longer expands a scalar CLI string. The direct custom executable
   and the npx fallback pass the executable and fixed prefix as quoted command
   arguments, with a regression for a custom executable path containing spaces
   and exact call/tarball assertions.
3. PowerShell installed package `name` and `version` use ordinal exact
   equality; a case-mismatched installed version is required to fail.
4. Captured pnpm install/build/pack and official plugin-add output is emitted
   before contextual errors, with common credential fields redacted. Tests
   assert both representative pnpm diagnostics and plugin-add diagnostics.
5. The PowerShell installer header/help is source-first for the current
   `https://github.com/XiaoyaoLinghao/DSH-better-sidebar` fork and contains no
   active upstream `omdsh-dev` install example.

Fix-wave verification:

- `pnpm exec vitest run tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts --no-file-parallelism`: **38 passed**.
- `pnpm exec vitest run tests/script-safety.spec.ts tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-source-install.spec.ts --no-file-parallelism`: **55 passed**.
- Literal Windows PowerShell parse check, `bash -n scripts/install.sh`, and
  `git diff --check`: **passed**.
- `pnpm typecheck` and `pnpm build`: **passed**.
- Fresh normal `pnpm test`: **891 passed, 9 skipped, 7 failed**. The four
  assertion failures remain the known base failures (PTY repair command,
  CRLF discard, missing Git author, missing Git committer); the two PTY quota
  timeouts and the credential-isolation test timeout are Windows
  ConPTY/resource-contention failures under the full parallel run. No source
  installer or README test failed in this run.

## Scoped-review regression fix wave

The scoped follow-up found two Important regressions and was handled with
behavior-first RED/GREEN tests:

- PowerShell diagnostics now redact only deterministic credential-shaped
  fields: `Authorization: Bearer`, minified JSON token/password/API-key/secret
  fields, and npm `:_authToken=` values. Ordinary compiler/package/CLI error
  context remains visible. The regression supplies distinct secret values and
  asserts each is absent from failure output without embedding secrets in
  assertion snapshots.
- Bash resolves the CLI before dry-run output. A user-supplied `DSH_CMD` must
  be executable; otherwise PATH `dsh` or the npx fallback must exist. The
  resolved mode and label are reused for dry-run and execution. A fake PATH
  retaining only Bash/Node proves the dsh+npx-missing dry-run fails before
  writes or child calls.

Verification for this wave:

- RED: both new regression tests failed against `740c0c3` (credential values
  leaked; missing CLI produced no validation message).
- GREEN: combined installer/README/safety suite: **59 passed**.
- `pnpm typecheck`, literal PowerShell parse, `bash -n scripts/install.sh`,
  and `git diff --check`: **passed**.

## Final full-suite timeout fix

The exact full-suite run at `91b03d9` showed the new credential-isolation
probe taking 6.364 seconds under external-process contention, exceeding the
default 5-second Vitest budget. The test itself passed in the focused safety
suite. The fix only applies the existing named `INTEGRATION_TIMEOUT = 30_000`
budget to that one test; assertions, probe behavior, global configuration,
and product/scripts are unchanged.

Verification:

- Pre-fix RED: exact full `pnpm test` reported only the credential-isolation
  test as the branch-introduced timeout; focused safety remained green.
- Post-fix focused `tests/script-safety.spec.ts`: **17 passed**.
- Post-fix exact `pnpm test`: **896 passed, 9 skipped, 6 failed, 1 unhandled
  error**. The credential-isolation test and all source-install tests passed.
  Remaining failures are the four known base assertions (PTY repair command,
  CRLF discard, missing Git author, missing Git committer), two Windows
  ConPTY PTY-manager timeout tests, and one Windows ConPTY unhandled
  `Signals not supported on windows` error.
