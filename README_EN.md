# DSH Better Workbench

> Maintained repository, release version, DSH rc.8 baseline, compatibility package/plugin/service names, and the source-first channel.

## Core capabilities

DSH Better Workbench is a session-isolated workbench for DeepSeek Harness. Its right sidebar and bottom panel provide a file tree, editing and preview, a real terminal, Git, browser, and background-task views. Layout, tabs, and panel state persist per session; built-in tabs and third-party extensions register through `ctx.betterSidebar`.

The maintained repository is [XiaoyaoLinghao/DSH-better-workbench](https://github.com/XiaoyaoLinghao/DSH-better-workbench), release `0.15.0-xlh.1`. For DSH ecosystem compatibility, the npm package name remains `dsh-better-sidebar`, the plugin id remains `dsh-better-sidebar`, and the service remains `ctx.betterSidebar`.

The source-install success conditions are installed version `0.15.0-xlh.1` and `dsh-better-sidebar` present in the profile bundle.

## Native Sidechain

Native Sidechain is a normal, localizable, disableable sidebar tab whose state persists per session:

- `/side <question>` creates a continuable child conversation that can be continued in the Sidechain tab.
- `/btw <question>` creates a one-shot, read-only child conversation.
- `/side list` lists direct children of the current parent; the Subagent tab remains responsible for the complete topology, background jobs, and cross-session navigation.

Both creation commands require a non-empty question. `fork` is the DSH subagent-provider semantic, not a Git fork. Host configuration uses nested YAML:

```yaml
config:
  sidechain:
    providerName: fork
    readOnlyTools: [read, grep, glob]
```

The Sidechain switch controls tab visibility and auto-open behavior; it does not unregister host commands. This module supports only DSH `0.1.0-rc.8`. Code adapted from the `dsh-sidechain` reference in `dsh-external/dsh-better-sidebar` keeps its provenance comments; the complete BSD-3-Clause copyright, conditions, and disclaimer are in [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES). Reference-project contributors do not endorse this project.

## Source installation

Prerequisites: DSH `0.1.0-rc.8` installed and able to start `dsh web`, Node.js ≥ 20, and pnpm ≥ 10. Clone the maintained repository and choose one platform command from its root:

```bash
git clone https://github.com/XiaoyaoLinghao/DSH-better-workbench.git
cd DSH-better-workbench
```

<!-- source-install:bash -->
```bash
bash scripts/install.sh --source --profile web
```

<!-- source-install:powershell -->
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```

The installer builds the current source tarball, installs that absolute-path tarball through the official DSH CLI, and coordinates `dsh.profile.bundles` automatically. After success, hard-refresh the browser (Cmd/Ctrl+Shift+R); the installer does not implicitly restart DSH.

## For DSH / automation agents

- Run one platform command above from the source repository root; do not run both.
- Success means installed version `0.15.0-xlh.1` and `dsh-better-sidebar` in the profile bundle.
- If the command fails, stop and report the failure; do not fall back to an npm install.
- The source channel does not modify DSH source. The plugin is always mounted as an independent profile package.

## Update, uninstall, and rollback

To update, pull the maintained repository and rerun the source command for your platform:

```bash
git pull
bash scripts/install.sh --source --profile web
```

PowerShell users should run `git pull`, then rerun the PowerShell command above.

Use the official DSH command to uninstall:

```bash
dsh plugin --profile web remove dsh-better-sidebar
```

After a source install, retain `.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz`. To roll back, use an absolute tarball path:

```bash
ARTIFACT="$(pwd)/.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz"
dsh plugin --profile web add "file:${ARTIFACT}"
```

```powershell
$artifact = Join-Path (Get-Location) '.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz'
dsh plugin --profile web add "file:$artifact"
```

If installation fails, do not automatically switch to `dsh-better-sidebar@latest`.

## Sidechain configuration

Provide Sidechain configuration through the profile's `cordis.patch.yml` and configuration mechanism. Do not modify official DSH source or copy plugin code into a DSH checkout. `providerName` defaults to `fork`; an unset `readOnlyTools` adds no allow-list restriction. Restart DSH after changing host configuration, then hard-refresh the page.

## Development and build

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm watch
```

This npm package provides both host and client halves: the host provides session-scoped file, Git, preview, and terminal routes; the client provides the workbench UI and service registry. Consumer plugins use `dsh-better-sidebar` as a peer dependency and extend the client half with `ctx.betterSidebar.registerTab` or `registerFileViewer`. Wrap registrations in `ctx.effect` so disposers handle HMR safely. See [`AGENTS.md`](./AGENTS.md) and [`docs/external-plugin-guide.md`](./docs/external-plugin-guide.md) for complete fields and lifecycle details.

## Security and limitations

- File writes are atomic; routes use the Host-header trust fence and are restricted to the current session cwd.
- HTML previews and browser content run in opaque-origin sandboxed iframes by default. Disabling the sandbox shows a warning and is intended only for fully trusted content.
- The address bar rejects `javascript:`, `data:`, `file:`, and local addresses; sites restricted by `X-Frame-Options` or `frame-ancestors` may not embed.
- The Git panel does not provide push/pull/fetch; there is no file watcher, so refresh manually. Office preview (`.docx` / `.xlsx` / `.pptx`) is provided by a recommended plugin.
- Narrow mobile viewports merge the bottom panel into the right sidebar; moving a terminal tab between panes remounts its shell.

## Platform support

Windows, Linux, and macOS are supported. Node.js ≥ 20, pnpm ≥ 10, and DSH `0.1.0-rc.8` are the source-install baseline. `node-pty` prefers prebuilt binaries; local compilation requires VS Build Tools on Windows, make, g++, and Python 3 on Linux, or Xcode Command Line Tools on macOS.

## Upstream source

This fork's upstream repository is [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar). `dsh-better-sidebar@latest` is the upstream npm channel, not this fork; use the source-install commands above for this fork. Full attribution and licensing for adapted Sidechain code are in [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES).
