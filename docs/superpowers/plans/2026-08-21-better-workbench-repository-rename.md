# DSH Better Workbench Repository Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the maintained GitHub repository to `XiaoyaoLinghao/DSH-better-workbench` and replace both READMEs with concise, current-product, source-install-first documentation.

**Architecture:** Keep every runtime/package compatibility identity unchanged and treat the GitHub slug plus human-facing documentation as the only renamed surfaces. Prepare and review all repository changes on an isolated feature branch, then perform the GitHub rename as a final external transaction, update the local remote, push the reviewed branch, and fast-forward `main` without force.

**Tech Stack:** Markdown, TypeScript/Vitest, Bash, Windows PowerShell 5.1+, pnpm, Git, GitHub CLI.

## Global Constraints

- Visible product and GitHub repository: `DSH Better Workbench` / `XiaoyaoLinghao/DSH-better-workbench`.
- Keep npm/package name exactly `dsh-better-sidebar`.
- Keep plugin id exactly `dsh-external/dsh-better-sidebar`.
- Keep `ctx.betterSidebar`, configuration, routes, bundle id, persisted keys, tarball name, and release version `0.15.0-xlh.1` unchanged.
- Support DSH exactly at the established baseline `0.1.0-rc.8`; rc.7 and earlier remain unsupported.
- README distribution remains source-first; `dsh-better-sidebar@latest` must be identified only as the upstream npm channel, never as this fork.
- Preserve the two exact source command markers and single-line commands used by behavioral tests.
- Remove v0.14.0-and-earlier history, old PR/issue narratives, obsolete installation prose, and friends lists from both READMEs; do not archive them into another agent-facing document.
- Preserve license files and `THIRD_PARTY_NOTICES`; the only upstream repository link in either README belongs to the explicit Upstream section.
- Do not rename local checkout directories, packages, plugin ids, runtime services, or persistence.
- Use fresh gpt-5.6-luna workers for implementation and fresh gpt-5.6-sol reviewers for task and whole-branch review.
- Never force-push or recursively delete verification scratch/quarantine directories.

---

## File map

- `README.md`: concise Chinese current-product and source-install guide.
- `README_EN.md`: semantic English translation of `README.md`.
- `tests/readme-current-product.spec.ts`: structural identity/upstream/history contract for both READMEs.
- `tests/readme-source-install.spec.ts`: existing behavioral extraction and execution of documented source commands; unchanged unless the rewritten Markdown exposes a real parser defect.
- `package.json`: current repository metadata only; package name/version remain compatible.
- `scripts/install.ps1`: source-first clone/help URL.
- `tests/manifest-consistency.spec.ts`: repository URL plus unchanged package/plugin/version assertions.
- `docs/superpowers/specs/2026-08-21-better-workbench-source-install-design.md`: current fork URL migration.
- `docs/superpowers/specs/2026-08-20-sidechain-native-design.md`: current fork URL migration where present.
- `docs/superpowers/plans/2026-08-21-better-workbench-source-install.md`: current fork URL migration.
- `docs/superpowers/plans/2026-08-20-sidechain-native.md`: current fork URL migration.
- `docs/superpowers/specs/2026-08-21-better-workbench-repository-rename-design.md`: final design record; old slug remains only where describing the migration source.
- `docs/superpowers/plans/2026-08-21-better-workbench-repository-rename.md`: this execution record.

---

### Task 1: Replace both READMEs with the current Better Workbench contract

**Files:**
- Create: `tests/readme-current-product.spec.ts`
- Modify: `README.md`
- Modify: `README_EN.md`
- Test: `tests/readme-current-product.spec.ts`
- Test: `tests/readme-source-install.spec.ts`

**Interfaces:**
- Consumes: exact compatibility names and source command markers from the global constraints.
- Produces: two concise semantic translations and `readReadmeContract(path: string): ReadmeContract` test evidence that later tasks use to distinguish current and upstream links.

- [ ] **Step 1: Add the failing structural README contract test**

Create `tests/readme-current-product.spec.ts` with a small Markdown parser that reads headings and GitHub links rather than matching arbitrary prose:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const CURRENT_REPO = 'https://github.com/XiaoyaoLinghao/DSH-better-workbench'
const UPSTREAM_REPO = 'https://github.com/omdsh-dev/DSH-better-sidebar'

function headings(markdown: string): string[] {
  return markdown.split(/\r?\n/u)
    .map(line => /^(#{1,6})\s+(.+)$/u.exec(line)?.[2]?.trim())
    .filter((value): value is string => value !== undefined)
}

function githubLinks(markdown: string): string[] {
  return [...markdown.matchAll(/\]\((https:\/\/github\.com\/[^)]+)\)/gu)]
    .map(match => match[1]!)
}

for (const file of ['README.md', 'README_EN.md']) {
  describe(file, () => {
    const text = readFileSync(join(ROOT, file), 'utf8')

    it('identifies the maintained repository and current compatibility facts', () => {
      expect(text).toContain(CURRENT_REPO)
      expect(text).toContain('0.15.0-xlh.1')
      expect(text).toContain('0.1.0-rc.8')
      expect(text).toContain('dsh-external/dsh-better-sidebar')
      expect(text).toContain('ctx.betterSidebar')
    })

    it('contains no legacy release-history headings', () => {
      expect(headings(text).some(title => /^v0\.(?:14|13|12)(?:\.|$)/u.test(title))).toBe(false)
    })

    it('contains one explicit upstream repository link and no upstream PR or issue links', () => {
      const links = githubLinks(text)
      expect(links.filter(link => link === UPSTREAM_REPO)).toHaveLength(1)
      expect(links.some(link => link.startsWith(`${UPSTREAM_REPO}/pull/`))).toBe(false)
      expect(links.some(link => link.startsWith(`${UPSTREAM_REPO}/issues/`))).toBe(false)
    })
  })
}
```

- [ ] **Step 2: Run the new contract and record RED**

Run:

```bash
pnpm exec vitest run tests/readme-current-product.spec.ts
```

Expected: FAIL because the new repository URL is absent and legacy version headings/upstream history links remain.

- [ ] **Step 3: Rewrite `README.md` as a concise current-product guide**

Write only these sections, in order:

````markdown
# DSH Better Workbench

> 当前维护仓库、版本、DSH rc.8 基线、兼容包名/插件 id/服务、源码优先通道。

## 核心能力
## 原生 Sidechain
## 源码安装
<!-- source-install:bash -->
```bash
bash scripts/install.sh --source --profile web
```
<!-- source-install:powershell -->
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```
## 供 DSH / 自动化代理读取
## 更新、卸载与回滚
## Sidechain 配置
## 开发与构建
## 安全与限制
## 平台支持
## 上游来源
````

The facts block must link `XiaoyaoLinghao/DSH-better-workbench`, state that
`dsh-better-sidebar@latest` is upstream and not this fork, and expose exact
success conditions: installed version `0.15.0-xlh.1` plus profile bundle
`dsh-better-sidebar`. Remove screenshots/videos unless they are essential to a
current feature; do not retain the historical changelog or friends section.

- [ ] **Step 4: Rewrite `README_EN.md` as a semantic translation**

Use the same section order and commands. Translate meaning rather than line
shape; keep exact identifiers, repository URLs, versions, commands, YAML, and
warnings byte-for-byte where they are machine inputs.

- [ ] **Step 5: Run README behavioral and structural tests**

Run:

```bash
pnpm exec vitest run tests/readme-current-product.spec.ts tests/readme-source-install.spec.ts tests/sidechain-provenance.spec.ts
```

Expected: all tests pass; all four README commands execute through fresh
`SourceInstallFixture` profiles and install one absolute source tarball.

- [ ] **Step 6: Review bilingual semantics and commit Task 1**

Manually compare section headings, facts, warnings, commands, update/uninstall
flow, Sidechain semantics, and Upstream attribution. Then run:

```bash
git add README.md README_EN.md tests/readme-current-product.spec.ts
git commit -m "docs: reset Better Workbench readmes"
```

- [ ] **Step 7: Request fresh Sol Task 1 review**

The reviewer must verify concise current-product focus, bilingual semantic
parity, source commands as first-class install instructions, exact compatibility
facts, absence of legacy history, and exactly one clearly labelled upstream
repository link. Fix every Critical/Important finding with a scoped Luna wave
and obtain a scoped Sol re-review.

---

### Task 2: Migrate maintained-repository metadata and help links

**Files:**
- Modify: `package.json`
- Modify: `scripts/install.ps1`
- Modify: `tests/manifest-consistency.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-21-better-workbench-source-install-design.md`
- Modify: `docs/superpowers/specs/2026-08-20-sidechain-native-design.md`
- Modify: `docs/superpowers/plans/2026-08-21-better-workbench-source-install.md`
- Modify: `docs/superpowers/plans/2026-08-20-sidechain-native.md`

**Interfaces:**
- Consumes: current repository URL `https://github.com/XiaoyaoLinghao/DSH-better-workbench` from Task 1.
- Produces: consistent machine metadata and installation help for the renamed repository while preserving package/plugin/service identities.

- [ ] **Step 1: Change the manifest test expectation and record RED**

In `tests/manifest-consistency.spec.ts`, require:

```ts
expect(pkg.repository).toEqual({
  type: 'git',
  url: 'https://github.com/XiaoyaoLinghao/DSH-better-workbench',
})
expect(pkg.name).toBe('dsh-better-sidebar')
expect(plugin.id).toBe('dsh-external/dsh-better-sidebar')
expect(pkg.version).toBe('0.15.0-xlh.1')
expect(plugin.version).toBe('0.15.0-xlh.1')
```

Run:

```bash
pnpm exec vitest run tests/manifest-consistency.spec.ts
```

Expected: FAIL because `package.json` still points at the old slug.

- [ ] **Step 2: Update current-project URLs without changing upstream attribution**

Set `package.json.repository.url` to the new URL. Change the PowerShell help
clone command to:

```powershell
git clone https://github.com/XiaoyaoLinghao/DSH-better-workbench.git
cd DSH-better-workbench
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```

Update the listed current design/plan links from
`XiaoyaoLinghao/DSH-better-sidebar` to
`XiaoyaoLinghao/DSH-better-workbench`. Do not replace
`omdsh-dev/DSH-better-sidebar`, license attribution, compatibility package
names, tarball names, plugin ids, or source code service names.

- [ ] **Step 3: Run a repository-link inventory**

Run:

```bash
rg -n "XiaoyaoLinghao/DSH-better-sidebar" README.md README_EN.md package.json scripts docs tests
```

Expected: the old maintained slug appears only in the repository-rename design
where it names the migration source. Review every match manually; current
clone/install/repository metadata must use the new slug.

- [ ] **Step 4: Run compatibility and installer tests**

Run:

```bash
pnpm exec vitest run tests/manifest-consistency.spec.ts tests/service.spec.ts tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/readme-current-product.spec.ts tests/readme-source-install.spec.ts
pnpm typecheck
bash -n scripts/install.sh scripts/e2e-mount.sh
powershell -NoProfile -Command "[void][ScriptBlock]::Create((Get-Content -Raw -Encoding UTF8 scripts/install.ps1))"
git diff --check
```

Expected: all commands exit 0; package/plugin/service identities and installer
behavior remain compatible.

- [ ] **Step 5: Commit Task 2**

```bash
git add package.json scripts/install.ps1 tests/manifest-consistency.spec.ts docs/superpowers/specs/2026-08-21-better-workbench-source-install-design.md docs/superpowers/specs/2026-08-20-sidechain-native-design.md docs/superpowers/plans/2026-08-21-better-workbench-source-install.md docs/superpowers/plans/2026-08-20-sidechain-native.md
git commit -m "docs: migrate Better Workbench repository links"
```

- [ ] **Step 6: Request fresh Sol Task 2 review**

The reviewer must distinguish maintained-repository links from upstream
attribution, check that no compatibility identity changed, and verify both
installer platforms still use exact source tarball behavior. Fix
Critical/Important findings before Task 3.

---

### Task 3: Run release acceptance and whole-branch review

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-better-workbench-repository-rename.md` only to check completed boxes.
- Create: `.superpowers/sdd/2026-08-21-better-workbench-repository-rename/task-3-report.md` as ignored execution evidence.

**Interfaces:**
- Consumes: Tasks 1–2 reviewed tree.
- Produces: a fixed reviewed commit that is safe to expose under the new GitHub slug.

- [ ] **Step 1: Run focused release gates**

Run:

```bash
pnpm build
pnpm exec vitest run tests/readme-current-product.spec.ts tests/readme-source-install.spec.ts tests/manifest-consistency.spec.ts tests/service.spec.ts tests/side-card-section.spec.tsx tests/source-install-bash.spec.ts tests/source-install-powershell.spec.ts tests/sidechain-provenance.spec.ts tests/script-safety.spec.ts
pnpm typecheck
pnpm check:consumer-types
pnpm pack --dry-run --json
git diff --check
```

Expected: build/typecheck/consumer checks pass; focused tests pass; package
inventory contains both READMEs/installers/`THIRD_PARTY_NOTICES`, excludes
`.artifacts/`, and reports package `dsh-better-sidebar@0.15.0-xlh.1`.

- [ ] **Step 2: Run the complete unit suite and classify failures honestly**

Run:

```bash
pnpm test
```

Expected: no rename/README/installer test failure. On Windows, report the full
suite as non-green if the already reproduced PTY repair-command, CRLF, Git
identity, or ConPTY failures recur; do not weaken them or call non-zero green.

- [ ] **Step 3: Run the real pinned rc.8 mount**

Run:

```bash
pnpm test:mount
```

Expected: 7/7 against `@deepseek-ai/dsh@0.1.0-rc.8`; preserve and report the
non-destructive quarantine path.

- [ ] **Step 4: Request final fresh whole-branch Sol review**

Generate a fixed diff from `bed087d` to final HEAD. The reviewer must cover
README focus, bilingual parity, identity compatibility, URL migration,
installer behavior, package inventory, base-failure classification, mount
evidence, and the external rename transaction below. Fix all
Critical/Important findings with Luna and obtain scoped Sol approval.

- [ ] **Step 5: Commit acceptance records**

```bash
git add docs/superpowers/plans/2026-08-21-better-workbench-repository-rename.md
git commit -m "test: accept Better Workbench repository rename"
```

---

### Task 4: Rename the GitHub repository and advance fork main

**Files:**
- Local Git remote configuration only; no source file edits.

**Interfaces:**
- Consumes: Sol-approved Task 3 HEAD and authenticated GitHub CLI account `XiaoyaoLinghao`.
- Produces: GitHub repository `XiaoyaoLinghao/DSH-better-workbench`, reviewed feature branch, and fast-forwarded `main` at the same commit.

- [ ] **Step 1: Verify the external preconditions**

Run:

```bash
gh auth status
gh repo view XiaoyaoLinghao/DSH-better-workbench --json nameWithOwner,url
git fetch fork main
git merge-base --is-ancestor fork/main HEAD
git status --short
```

Expected: authentication is active; the target repository lookup reports not
found before the rename; current fork `main` is an ancestor of the reviewed
HEAD; worktree is clean. Stop if the target exists or ancestry changed.

- [ ] **Step 2: Rename the repository through GitHub**

Run exactly:

```bash
gh api --method PATCH repos/XiaoyaoLinghao/DSH-better-sidebar -f name=DSH-better-workbench
```

Expected: response identifies
`XiaoyaoLinghao/DSH-better-workbench`. Do not retry with a different target on
an ambiguous response.

- [ ] **Step 3: Point the local fork remote at the new canonical URL**

Run:

```bash
git remote set-url fork https://github.com/XiaoyaoLinghao/DSH-better-workbench.git
git remote get-url fork
gh repo view XiaoyaoLinghao/DSH-better-workbench --json nameWithOwner,url,defaultBranchRef
```

Expected: all commands identify the new repository and default branch `main`.

- [ ] **Step 4: Push the reviewed feature branch without force**

Run:

```bash
git push -u fork feat/better-workbench-repository-rename
git ls-remote fork refs/heads/feat/better-workbench-repository-rename
```

Expected: remote branch equals the reviewed HEAD.

- [ ] **Step 5: Fast-forward fork main without checking out the dirty main worktree**

Re-fetch and recheck ancestry immediately, then push the exact reviewed commit:

```bash
git fetch fork main
git merge-base --is-ancestor fork/main HEAD
git push fork HEAD:refs/heads/main
git ls-remote fork refs/heads/main
```

Expected: remote `main` equals reviewed HEAD. Never use `--force`; do not
checkout or alter the existing dirty local main workspace.

- [ ] **Step 6: Verify direct and redirected repository URLs**

Run:

```bash
gh repo view XiaoyaoLinghao/DSH-better-workbench --json nameWithOwner,url,defaultBranchRef
git ls-remote https://github.com/XiaoyaoLinghao/DSH-better-workbench.git refs/heads/main
git ls-remote https://github.com/XiaoyaoLinghao/DSH-better-sidebar.git refs/heads/main
```

Expected: the canonical and redirected old URL both resolve to the same reviewed
`main` commit. Keep the feature worktree and branch for follow-up; do not delete
them.

## Completion handoff

Report the new canonical repository URL, exact remote `main` commit, unchanged
compatibility identities, source-install commands, focused/build/typecheck/
consumer/pack/mount evidence, honest full-suite status, and the one explicit
upstream attribution link. Preserve all verification quarantines for manual or
OS reclamation.
