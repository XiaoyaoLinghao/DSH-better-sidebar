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

## Commit status

Task 5 acceptance changes are ready to commit after the parent agent reviews
the documented Task 4 typecheck blocker and the environment-dependent mount
results.
