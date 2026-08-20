# Task 24 verification report

Fresh verification was run on 2026-08-21 from `feat/sidechain-native` at the
Task 24 worktree. The mount lane is intentionally keyless; no model API key was
provided or required by the acceptance assertions.

| Command | Result | Evidence |
|---|---|---|
| `pnpm exec vitest run tests/sidechain-provenance.spec.ts` | PASS | 1 file, 2 tests passed; provenance comments, BSD notice, and pack inventory passed. |
| `pnpm typecheck` | PASS | `tsc --noEmit` exited 0. |
| `pnpm build` | PASS | TypeScript and all core/terminal/editor/Mermaid bundles completed. |
| `pnpm test` | ENVIRONMENT / BASELINE FAILURES | 79 files passed (835 tests); existing Windows ConPTY `AttachConsole failed`, missing git identity/CRLF expectations, one `pty-deps` expectation, and one pre-existing settings expectation failed. No assertion was weakened. |
| `pnpm check:consumer-types` | ENVIRONMENT BLOCKED | Windows bash cannot create the temporary symlink: `ln: .../node_modules/dsh-better-sidebar: Function not implemented`. |
| `pnpm test:mount` | ENVIRONMENT BLOCKED | Windows bash reports `scripts/e2e-mount.sh: line 1: syntax error: bad substitution`; then reports no `dsh` on PATH and no tarball. |
| `pnpm pack --dry-run --json` | PASS | Exit 0; final inventory includes `THIRD_PARTY_NOTICES`. |
| `git diff --check main...HEAD` | PASS | Exit 0; no whitespace errors. |

The mount lane now covers the Sidechain add-tab entry, one native sidebar root,
absence of legacy header/fixed-panel markers, keyless Sidechain view mounting,
Side card disable/re-enable availability, and hydration of persisted
`{ version: 1, selectedChildId }` metadata after reload.
