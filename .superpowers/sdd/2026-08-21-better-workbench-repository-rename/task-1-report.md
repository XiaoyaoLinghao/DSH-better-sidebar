# Task 1 report: Better Workbench README reset

## Scope

- Replaced `README.md` and `README_EN.md` with concise current-product guides.
- Added `tests/readme-current-product.spec.ts` with the structural `readReadmeContract(path: string): ReadmeContract` evidence parser.
- Preserved both source-install markers and their exact bash/PowerShell commands.
- Removed legacy release-history headings, PR/issue history, screenshots/videos, and the Friends section.
- Documented the current repository, compatibility names, DSH baseline, native Sidechain semantics/configuration, source install success conditions, update/uninstall/rollback flow, development, security, platform support, and upstream attribution.

## TDD evidence

RED was captured before rewriting either README:

```text
pnpm exec vitest run tests/readme-current-product.spec.ts
```

Result: 1 test file failed; 6 tests failed (three contract assertions for each README). The expected failures were the absent maintained repository URL, legacy version headings/history links, and the resulting upstream-link contract mismatch.

GREEN/focused verification after the rewrite:

```text
pnpm exec vitest run tests/readme-current-product.spec.ts tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts
```

Result: 3 test files passed; 15 tests passed; 0 failed. Both README source commands executed through fresh source-install fixtures, installing one absolute source tarball and validating version `0.15.0-xlh.1` plus the `dsh-better-sidebar` profile bundle entry. The run emitted existing tsdown deprecation warnings for `external` and `noExternal` options while the fixture prepared the package; no test warning or failure was introduced.

## Contract counts and review

- Each README has 11 Markdown headings including the title, with the ten required product sections in the specified order.
- Each README has exactly one maintained-repository link and exactly one explicit upstream repository link.
- No README has upstream `/pull/` or `/issues/` links.
- Both READMEs contain `0.15.0-xlh.1`, DSH `0.1.0-rc.8`, `dsh-external/dsh-better-sidebar`, `ctx.betterSidebar`, and the exact source command markers.
- The Chinese and English documents carry the same facts, warnings, YAML, command blocks, update/uninstall/rollback flow, Sidechain semantics, and upstream attribution; prose is translated semantically rather than line-for-line.
- Upstream attribution identifies `omdsh-dev/DSH-better-sidebar` and explicitly states that `dsh-better-sidebar@latest` is upstream and does not install this fork.

## Concerns

- No blocking concerns. The focused test run has only the pre-existing tsdown deprecation warnings noted above.
