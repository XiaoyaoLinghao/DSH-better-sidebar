# DSH Better Workbench repository rename and README reset

## Objective

Rename the maintained GitHub repository from
`XiaoyaoLinghao/DSH-better-sidebar` to
`XiaoyaoLinghao/DSH-better-workbench` and replace both READMEs with concise,
current-product documentation. A DSH automation agent should immediately see
the supported product, compatibility baseline, and source-install path without
having to interpret the upstream project's historical changelog.

## Compatibility boundary

The repository and visible product use **DSH Better Workbench**. Runtime and
package identities remain unchanged so existing installations continue to
resolve:

- npm/package name: `dsh-better-sidebar`
- plugin id: `dsh-external/dsh-better-sidebar`
- service: `ctx.betterSidebar`
- configuration, routes, bundle id, persisted layout keys, and source tarball
  name
- release version: `0.15.0-xlh.1`

The local checkout/worktree directory does not need to be renamed. GitHub's
redirect from the old repository URL is a migration aid, not a URL that new
documentation may continue to advertise.

## README information architecture

`README.md` and `README_EN.md` will be semantic translations with this order:

1. `DSH Better Workbench` identity and one-sentence positioning.
2. A compact machine-readable facts block: maintained repository, DSH
   `0.1.0-rc.8`, release `0.15.0-xlh.1`, compatibility package/plugin ids, and
   source-only distribution warning.
3. Current features, including native `/side`, `/btw`, and `/side list`.
4. Source-first installation with the existing exact command markers:
   `<!-- source-install:bash -->` and
   `<!-- source-install:powershell -->`.
5. A DSH/automation section stating cwd, success conditions, no npm fallback,
   refresh/restart behavior, and failure handling.
6. Update, uninstall, and rollback instructions.
7. A short configuration example for Sidechain.
8. Development/build, security, known limitations, and platform support.
9. One short **Upstream** section linking
   `omdsh-dev/DSH-better-sidebar` and `THIRD_PARTY_NOTICES`.

The following content is removed from both READMEs rather than archived
elsewhere:

- all v0.14.0-and-earlier changelog sections;
- upstream PR/issue-by-issue release history;
- old product evolution narratives and obsolete npm-install instructions;
- the friends/recommended-project list;
- duplicated or historical feature descriptions that do not help install or
  operate the current fork.

Current screenshots may remain only if they accurately depict Better
Workbench and do not link to an upstream project page. The README target is
roughly 100–130 lines per language, but semantic completeness takes precedence
over an exact line limit.

## Repository-link migration

All current-project references must use the new repository slug, including:

- `package.json` repository metadata;
- README clone/update links;
- Bash/PowerShell installer help and examples;
- current release/design/automation documentation and tests that identify the
  maintained repository.

Historical attribution is different from a current-project link. The only
intended `omdsh-dev/DSH-better-sidebar` occurrence in either README is the
explicit Upstream section. License text and `THIRD_PARTY_NOTICES` remain
unchanged.

The code/documentation commit is prepared and verified first. Then the GitHub
repository is renamed through GitHub, the local `fork` remote is updated to the
new URL, and the reviewed branch is pushed. The old URL should redirect, but
the new URL is verified directly before `main` is advanced.

## Installation behavior

The source commands remain:

```bash
bash scripts/install.sh --source --profile web
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```

The installers still build and pack `dsh-better-sidebar-0.15.0-xlh.1.tgz`,
install one absolute `file:` tarball through the official rc.8 CLI, and verify
the compatibility package/bundle identity. Renaming the repository must not
rename the tarball or runtime identity.

## Verification

Behavioral tests must continue extracting and executing the exact README
commands through isolated source-install fixtures. Additional checks cover:

- both READMEs identify `XiaoyaoLinghao/DSH-better-workbench` as current;
- neither README contains old version headings or upstream release-history
  links outside the explicit Upstream section;
- installer help uses the new clone URL;
- package inventory ships both concise READMEs and both installers, but not
  `.artifacts/`;
- manifest/package/plugin/service compatibility identities remain unchanged;
- build, typecheck, consumer declaration check, focused installer tests, and
  the pinned rc.8 mount remain green under their established acceptance rules.

Human Sol review owns prose quality, bilingual semantic parity, and the check
that the remaining upstream reference is clearly attribution rather than an
installation channel.

## External change safety and rollback

The GitHub rename is the only external mutation. Before it:

- confirm the reviewed feature branch is based on the current fork `main`;
- confirm the target slug is available;
- record the pre-rename repository URL and reviewed commit.

No force push is permitted. If code push or direct new-URL verification fails,
leave `main` unchanged and keep the feature branch/worktree. GitHub can rename
the repository back to `DSH-better-sidebar`; compatibility identities require
no code rollback. The old repository redirect is verified after success but is
not relied on by current documentation.

