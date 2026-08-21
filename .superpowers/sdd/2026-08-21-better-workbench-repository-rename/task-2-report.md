# Task 2 report: maintained-repository metadata and help links

## Scope

- Updated `package.json.repository` to the maintained repository URL:
  `https://github.com/XiaoyaoLinghao/DSH-better-workbench`.
- Updated `scripts/install.ps1` source-install help to clone
  `DSH-better-workbench`, enter that directory, and invoke
  `scripts/install.ps1`; the dry-run and repair examples now use the same
  in-repository script path.
- Updated the scoped source-install and Sidechain design/plan references to
  the maintained repository URL.
- Strengthened the manifest consistency contract to assert the complete
  `{ type: 'git', url }` repository object.
- Preserved `dsh-better-sidebar`, `dsh-external/dsh-better-sidebar`, service
  names, version `0.15.0-xlh.1`, tarball/package names, upstream
  `omdsh-dev/DSH-better-sidebar` attribution, and license references.

## TDD evidence

RED was captured immediately after changing the manifest expectation and
before changing `package.json`:

```text
pnpm exec vitest run tests/manifest-consistency.spec.ts
```

Result: 1 test failed (8 passed). The expected failure was the repository
object URL: the test required
`https://github.com/XiaoyaoLinghao/DSH-better-workbench`, while
`package.json` still contained the old maintained slug.

GREEN after the metadata and help-link changes:

```text
pnpm exec vitest run tests/manifest-consistency.spec.ts
```

Result: 1 test file passed; 9 tests passed; 0 failed.

## Verification

```text
pnpm exec vitest run tests/manifest-consistency.spec.ts tests/service.spec.ts tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-current-product.spec.ts tests/readme-source-install.spec.ts
```

Result: 6 test files passed; 126 tests passed; 0 failed.

```text
pnpm typecheck
bash -n scripts/install.sh scripts/e2e-mount.sh
powershell -NoProfile -Command "[void][ScriptBlock]::Create((Get-Content -Raw -Encoding UTF8 scripts/install.ps1))"
git diff --check
```

All four commands exited 0. `git diff --check` emitted only Git's normal
working-copy LF/CRLF conversion warnings and no whitespace errors.

Repository-link inventory:

```text
rg -n "XiaoyaoLinghao/DSH-better-sidebar" README.md README_EN.md package.json scripts docs tests
```

The remaining matches are confined to the repository-rename migration design
and plan: the source-to-target rename statement, the inventory example, and
the old-URL redirect verification. No current package metadata, installer
clone command, README, source-install design, or Sidechain design/plan uses
the old maintained slug. Upstream `omdsh-dev/DSH-better-sidebar` links are
unaffected because they intentionally do not match the Xiaoyao namespace.

## Self-review

- `package.json` keeps the package name, version, publish settings, exports,
  dependencies, and plugin-facing metadata unchanged apart from the
  repository URL.
- `tests/manifest-consistency.spec.ts` now checks repository type and URL as a
  complete object while retaining package/plugin/version assertions.
- PowerShell source install still validates DSH `0.1.0-rc.8`, builds and packs
  the same `dsh-better-sidebar-$VERSION.tgz`, and installs through the same
  absolute `file:` tarball path on both normal and dry-run flows.
- Historical upstream attribution and compatibility names remain intact; no
  source code service identifiers or persisted keys were modified.

## Concerns

- No blocking implementation concerns. Fresh external Task 2 review remains
  a handoff item for the parent task, as requested by the brief.
