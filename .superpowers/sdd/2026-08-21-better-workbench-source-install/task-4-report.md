# Task 4 report: bilingual README source-first install contract

## Scope

- Added `tests/readme-source-install.spec.ts` with the exported
  `commandAfterMarker(readme, marker)` helper.
- Updated `README.md` and `README_EN.md` with the DSH Better Workbench
  identity, native `/side` / `/btw` references, source-first installation,
  automation contract, channel warning, update/uninstall/rollback guidance,
  and the `v0.15.0-xlh.1` release note.
- Preserved historical `omdsh-dev` upstream links and BSD attribution through
  `THIRD_PARTY_NOTICES`.
- No installer, production, plan, design, or ledger files were changed.

## RED evidence

Before the README markers were added, ran:

```text
pnpm exec vitest run tests/readme-source-install.spec.ts
```

Result: 4 executable README/platform cases failed because each README had
zero `source-install:bash` / `source-install:powershell` markers; the helper
validation test passed. This confirmed the test was exercising the missing
documented consumer path rather than matching installer source text.

## GREEN evidence

After the README changes, ran:

```text
pnpm exec vitest run tests/readme-source-install.spec.ts
```

Result: 1 test file passed, 5 tests passed. Both README command blocks were
executed against fresh isolated source-install fixtures; assertions verified
exit status, installed version `0.15.0-xlh.1`, profile bundle registration,
and one absolute `file:` tarball argument.

Final required verification:

```text
pnpm exec vitest run tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts
```

Result: 2 test files passed, 7 tests passed. `git diff --check` passed. The
test run emitted existing tsdown deprecation warnings for `external` and
`noExternal`; these are unrelated to Task 4 and were not changed.

## Self-review and commit

- Chinese and English current sections use the same commands, marker order,
  version, success criteria, channel warning, update flow, remove command,
  and retained artifact path.
- The executable test uses argument-array process execution with
  `shell: false`; it does not assert headings, prose, URLs, or raw installer
  source strings.
- Implementation commit: `de6409a6bc9fdd2eacb1bf3343c491bf1a908066`
- This report is committed separately as required by Task 4.

## Concerns

None. No push was performed.
