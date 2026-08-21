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
