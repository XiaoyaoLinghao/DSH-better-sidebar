# Native Sidechain Module Design

**Date:** 2026-08-20

**Status:** Approved direction; pending written-spec review

**Target repository:** `XiaoyaoLinghao/DSH-better-sidebar`

**Compatibility baseline:** DeepSeek Harness `0.1.0-rc.8` only

## Objective

Add `/side` and `/btw` side-conversation support directly to DSH-better-sidebar so users install and maintain one plugin. The implementation will use `dsh-sidechain` as a behavioral reference while adopting better-sidebar's existing tab registry, session-scoped persistence, responsive layout, localization, styling, and lifecycle conventions.

The result is one package, one plugin row, one browser bundle identity, and one release workflow. Sidechain remains a distinct internal feature rather than becoming miscellaneous logic inside the sidebar shell.

## User-facing semantics

A side conversation uses the DSH `fork` subagent provider. Here, `fork` means creating a child session from the current parent session's completed conversation history; it is unrelated to Git forks.

- The child can reference completed parent turns that precede the fork boundary.
- The child owns an independent event log, model execution, tool activity, and follow-up history.
- Child messages and results do not become ordinary parent conversation turns.
- The parent turn that is still running when the command is issued is not copied into the child.
- `/btw <question>` starts one non-blocking, one-shot child. Its transcript is read-only.
- `/side <question>` starts one non-blocking, continuable child. Its transcript includes a composer for follow-up prompts.
- `/side list` lists the current session's direct children.
- Both commands require a non-empty initial question.

## Chosen ownership boundary

The sidechain feature will be implemented inside the better-sidebar package. It will not be a Git submodule, runtime Git dependency, separately mounted Cordis plugin, or second client bundle.

The internal boundaries are:

```text
src/sidechain-host/
  commands.ts            /side, /btw, and /side list command definitions
  prompts.ts             fork boundary and side-conversation persona
  side.ts                start and continue subagent operations
  settlement-silence.ts  parent-inbox isolation for side children
  index.ts               host feature activation and configuration

src/client/sidechain/
  register.tsx           built-in Tab descriptor and feature lifecycle
  observer.tsx           nonvisual command-settlement observer
  controller.ts          selection and reveal coordination
  SidechainView.tsx      list, transcript, and composer orchestration
  transcript.ts          durable-log to display-row mapping
  activity.ts            running-child activity summaries
  file-mentions.ts       produced-file link resolution
  locales.ts             Chinese and English strings
  SidechainView.module.css

tests/sidechain-*.spec.ts[x]
```

These are the implementation boundaries. Host behavior, client data mapping, view orchestration, and reveal coordination remain independently testable even when their public entry points are wired together by `index.ts` and `register.tsx`.

The client feature will register itself through `BetterSidebarService.registerTab()`, the same path used by existing built-in tabs. `Sidebar.tsx` must not gain sidechain-specific rendering branches.

## Sidebar Tab contract

The new descriptor has the following contract:

- `id`: `sidechain`
- localized title: `Sidechain` / `侧会话`
- order: `35`, between Subagent (`30`) and Terminal (`40`)
- `single: true`
- appears in the existing Side card tab inventory and may be disabled there
- badge: running direct-child count; ordinary sidebar badge rendering handles display capping
- setting: `autoOpenSidechain`, default `true`

Durable UI selection is stored in tab metadata:

```ts
interface SidechainTabMetaV1 {
  version: 1
  selectedChildId?: string
}
```

Only the selected child identity is persisted. Transcript rows, loading state, activity summaries, produced paths, request epochs, drafts, and single-flight flags remain component-local.

On hydration, malformed metadata is treated as an empty selection. A selected ID that is no longer a direct child returns the view to the list and is removed from metadata on the next safe state update.

## Relationship to the existing Subagent Tab

The two tabs deliberately keep different interaction contracts:

- **Subagent:** whole-tree topology, background jobs, and navigation into another DSH session.
- **Sidechain:** the current parent session's direct children, inline transcript reading, and continuable follow-up without changing the active main conversation.

The first release will not merge Sidechain into `SubagentView` and will not change existing Subagent row click behavior. This avoids coupling topology, jobs, transcript rendering, and sidechain command semantics in one component. A later design may unify the presentations after usage evidence exists.

The Sidechain list continues to show all direct children, matching the reference plugin's current `/side list` behavior. DSH does not expose a stable provenance field that distinguishes every child created by these commands without adding a new registry/API contract.

## Client data flow

```text
/side or /btw command settles successfully
  -> success marker carries child session ID
  -> nonvisual command observer detects a new live command
  -> reveal coordinator claims the child creation
  -> Sidechain tab metadata selects the child
  -> Sidechain tab is created or activated
  -> owning better-sidebar panel is revealed
  -> visible SidechainView observes the direct-child catalog
  -> transcript history is polled and folded after the fork seed boundary
  -> continuable children may receive follow-up prompts
```

The observer remains mounted through a lightweight `conversation.input.dock` contribution because blank sessions may not render chat rows and fast commands may settle before their command card mounts. It renders no visible panel or layout surface.

Historical commands loaded during hydration establish the observer baseline and never auto-open the tab. Repeated snapshots are idempotent by command ID. Switching the parent session resets the baseline for that session.

## Auto-open arbitration

The first `/side` or `/btw` child also satisfies better-sidebar's generic first-subagent detection. Allowing both effects to race would make final focus timing-dependent.

The required policy is:

> A live `/side` or `/btw` command creation claim takes priority over generic Subagent auto-open.

One internal reveal coordinator records claimed child IDs for the current detection cycle. The generic Subagent detector checks this claim before focusing its tab. The policy must be deterministic and covered by tests; event arrival order is not an acceptable arbitration mechanism.

When `autoOpenSidechain` is disabled, commands still run and their children remain visible when the user manually opens Sidechain or Subagent. The sidechain claim must not suppress generic Subagent auto-open when the Sidechain tab is disabled or its auto-open setting is off.

## Sidechain view behavior

The view has two states:

1. A direct-child list showing mode, label, run state, and a compact live activity line.
2. A selected-child transcript showing user messages, context, reasoning, tool calls/results, assistant output, and produced-file links.

One-shot children display a read-only footer. Continuable children display a follow-up composer. Sending is single-flight, ignores empty input, preserves the draft on failure, and refreshes the transcript after successful admission.

Transcript history is read without activating or navigating into the child session. The inherited parent seed is removed at the last `session/end-seed` marker, and the internal side-conversation boundary prompt is omitted. Streaming chunk rows are accumulated until the assembled assistant message supersedes them.

Produced-file mentions open through `BetterSidebarService.openFile()` so files stay inside the integrated editor.

All catalog observation and polling are gated by `TabComponentProps.visible`. Hidden tabs release catalog observation and stop timers. HMR disposal removes listeners, styles, observers, and the descriptor.

## Removed legacy panel behavior

The reference sidechain floating panel is not copied. The integrated feature must not introduce:

- a fixed right-edge `<aside>`
- a second panel open/close store
- independent width persistence
- resize or expand controls
- a session-header panel toggle
- `Ctrl/Cmd+Shift+E`
- an independent z-index or panel surface
- a visible composer-dock panel host

Better-sidebar remains the only owner of panel geometry, resizing, mobile behavior, tab splitting, persistence, theme surfaces, and stacking.

## Host activation and configuration

The better-sidebar host configuration gains a nested optional section:

```ts
interface SidechainConfig {
  providerName?: string
  persona?: string
  readOnlyTools?: string[]
}

interface Config {
  // existing fields remain unchanged
  sidechain?: SidechainConfig
}
```

Resolved defaults are:

- `providerName: "fork"`
- `persona`: the built-in side-conversation persona
- `readOnlyTools`: unset, meaning no additional allow-list restriction

This host configuration controls command execution only. The existing Side card descriptor switch controls Sidechain Tab visibility and auto-open behavior; disabling the Tab does not unregister `/side` or `/btw`.

Host activation uses a nested `ctx.inject(['agents', 'subagents'], ...)` scope. Missing subagent services disable only the sidechain command surface; they must not prevent better-sidebar itself from mounting. Command registration remains nested on the optional `commands` service.

A missing configured provider produces an explicit command error telling the user to mount the fork provider or change `providerName`.

## Parent-history isolation

Side children must not deliver `subagent-report` or `subagent-settled` messages into the parent inbox. The reference implementation's settlement-silence behavior will be adapted with these invariants:

- suppress only the exact child IDs registered by this feature
- leave ordinary messages and unrelated subagents unchanged
- protect already-live, newly created, and resumed parent agents
- restore original `followup`, `steer`, and `inject` property descriptors on disposal
- persist registered child IDs under `DSH_HOME` so restarts preserve isolation
- treat persistence failure as nonfatal while keeping in-process protection

This wrapper is the highest-risk host component and requires focused rc.8 tests. Registry persistence uses a sibling temporary file followed by rename, matching better-sidebar's existing atomic-write pattern. Loading rejects malformed or non-array JSON without affecting command availability, and a failed write leaves in-process protection active.

## DSH rc.8 requirements

The feature supports DSH `0.1.0-rc.8` only.

- All consumed `@deepseek-ai/*` peer and dev dependencies align to `^0.1.0-rc.8` or the repository's existing exact dev pin convention.
- `cordis` follows the repository's rc.8-compatible version.
- Command tests provide the rc.8-required `attachments` field in `CommandInvocation` fixtures.
- Removed rc.7 client modules such as `dsh-client-web-react` and `dsh-client-schema-form` are not introduced.
- The feature reuses better-sidebar's rc.8 client module system and bundle wrapper.
- Any future lazy chunk resolves externals through `ctx.modules`; it must not depend on `window.__DSH_MODULES__`.
- CI and real-mount smoke tests pin `@deepseek-ai/dsh@0.1.0-rc.8`.
- No DSH source checkout is modified.

## Localization and theme

All visible copy is supplied in Chinese and English through better-sidebar's locale attachment. The view consumes DSH/better-sidebar design tokens and CSS Modules. It must not copy the reference panel's hardcoded surface colors or inline fixed-panel styles.

`MarkdownText` receives localized copy/copy-success code labels. File links, tool details, error states, loading states, read-only text, and composer accessibility labels are localized.

## Licensing

DSH-better-sidebar is MIT and dsh-sidechain is BSD-3-Clause. BSD-3-Clause permits adaptation, but the source and binary distribution obligations remain.

The implementation will:

- retain provenance comments on substantially adapted source files
- add a shipped `THIRD_PARTY_NOTICES` containing the sidechain BSD-3-Clause copyright, conditions, and disclaimer
- include that notice in `package.json.files`
- avoid representing upstream sidechain contributors as endorsing the fork

## Testing strategy

### Unit and component tests

- side prompt construction and label truncation
- `/side`, `/btw`, and `/side list` command validation and start requests
- one-shot disposal after settlement
- missing-provider errors
- settlement-silence exact-child filtering, rc.8 settlement/report vocabulary, future-agent protection, and descriptor restoration
- transcript seed-boundary removal, chunk folding, tool pairing, failures, and produced paths
- activity summaries and file-mention resolution
- descriptor ID, order, singleton behavior, badge, settings, and lifecycle disposal
- tab metadata validation and per-session selection persistence
- stale selection recovery
- hidden-tab observation and polling shutdown
- `/btw` read-only rendering and `/side` follow-up admission
- command observer replay baseline, fast settlement, idempotence, and session switching
- deterministic Sidechain-versus-Subagent auto-open arbitration
- HMR activation without duplicate registrations or listeners
- existing manifest, consumer-type, purity, built-in inventory, state, and theme guards

### Real mount smoke

The existing pack-to-scratch-profile rc.8 Playwright lane will additionally verify:

- one better-sidebar root and no legacy sidechain fixed panel/header toggle
- Sidechain appears in the add-tab menu and mounts without page errors
- disabling and re-enabling the Sidechain descriptor behaves like other built-ins
- reload and persisted-tab hydration do not crash

Keyless CI cannot reliably create a real model-backed child. Command-to-reveal behavior is therefore deterministic component/service coverage. A keyful manual or future nightly lane may cover a real fork, streaming transcript, follow-up, and parent-history isolation.

## Release and repository workflow

Development occurs on `feat/sidechain-native` in the local clone. The local `fork` remote points to `XiaoyaoLinghao/DSH-better-sidebar`; `origin` remains the upstream repository.

Implementation changes are committed to the feature branch, reviewed task by task, and pushed to the fork only after:

1. all planned tasks are implemented by 5.6-luna workers;
2. 5.6-sol completes per-task and whole-branch reviews;
3. the full verification suite passes freshly;
4. no Critical or Important review finding remains open.

Publishing is out of scope. The upstream release workflow and npm OIDC metadata target `omdsh-dev`; they will not be changed or invoked as part of this feature unless separately requested.

## Non-goals

- modifying DeepSeek Harness source
- preserving rc.5, rc.6, or rc.7 compatibility
- retaining the standalone sidechain floating panel
- publishing or mounting `@dsh-external/dsh-sidechain`
- using a Git submodule or runtime Git dependency
- merging Sidechain into the existing Subagent Tab in the first release
- adding empty `/side` threads before DSH supports them
- including the parent's currently running turn in the fork seed

## Acceptance criteria

The feature is acceptable when:

1. one better-sidebar installation provides working `/side`, `/btw`, and `/side list` command surfaces on DSH rc.8;
2. side children use independent forked logs and do not insert settlement/report messages into the parent history;
3. Sidechain is a normal, localizable, disableable, session-persisted better-sidebar Tab;
4. a new live side command selects and reveals its child without racing the generic Subagent auto-open;
5. `/btw` is read-only and `/side` accepts follow-up prompts inline without switching the main session;
6. hidden Sidechain tabs stop polling and observation;
7. produced-file mentions open in the better-sidebar editor;
8. no legacy fixed panel, header toggle, independent width state, or duplicate layout owner remains;
9. BSD-3-Clause attribution ships with the package;
10. typecheck, unit/component tests, build, consumer-type checks, and rc.8 mount smoke pass.
