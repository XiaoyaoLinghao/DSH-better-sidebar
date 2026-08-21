# Native Sidechain Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rc.8-native `/side` and `/btw` side conversations to the single DSH-better-sidebar package as a normal built-in Sidechain Tab.

**Architecture:** Host behavior lives under `src/sidechain-host/`; client behavior lives under `src/client/sidechain/`. The feature registers through the existing `BetterSidebarService`, preserves the existing Subagent Tab contract, and uses a deterministic coordinator so a live side command wins auto-open focus without creating a second panel owner.

**Tech Stack:** TypeScript 5.6+, React 18, Cordis, DeepSeek Harness `0.1.0-rc.8`, Schemastery, Vitest, Testing Library/jsdom, tsdown, Playwright.

## Global Constraints

- Target DeepSeek Harness `0.1.0-rc.8` only; do not preserve rc.5, rc.6, or rc.7 compatibility.
- Work only in `XiaoyaoLinghao/DSH-better-workbench`; do not modify any DSH source checkout or the sibling reference repository.
- Deliver one plugin/package and one client bundle identity; do not add a Git submodule, Git runtime dependency, or second Cordis plugin row.
- Sidechain is a built-in descriptor with `id: 'sidechain'`, `order: 35`, `single: true`, and preference `autoOpenSidechain: true` by default.
- Keep the existing Subagent Tab's whole-tree/navigation/jobs behavior unchanged.
- `/btw` is one-shot/read-only; `/side` is continuable; both are non-blocking and require a non-empty initial question.
- A live `/side` or `/btw` creation claim wins focus over generic Subagent auto-open only when the Sidechain descriptor and `autoOpenSidechain` are enabled.
- Persist only `{ version: 1, selectedChildId?: string }` in tab metadata; never persist transcripts, drafts, timers, or request state.
- `TabComponentProps.visible` gates every catalog observation and polling loop.
- Produced-file mentions open through `BetterSidebarService.openFile()`.
- Do not introduce a fixed sidechain panel, independent panel store/width, header toggle, resize/expand control, z-index owner, or `Ctrl/Cmd+Shift+E` shortcut.
- All visible copy is bilingual and token-driven; `MarkdownText` receives localized copy labels.
- Preserve BSD-3-Clause attribution in shipped `THIRD_PARTY_NOTICES` and provenance comments on substantially adapted files.
- Use strict TDD for behavior: write one failing test, observe the expected failure, implement the minimum, re-run the focused test, then refactor while green.
- A fresh 5.6-luna implementer owns each task; implementation tasks are sequential, never parallel. A 5.6-sol reviewer gates every task and the final branch.
- Do not push until the full branch has passed task reviews, final 5.6-sol review, and fresh verification.

---

### Task 1: rc.8 dependency and license foundation

**Files:**
- Create: `THIRD_PARTY_NOTICES`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `dsh.plugin.json`
- Modify: `tests/manifest-consistency.spec.ts`

**Interfaces:**
- Produces the rc.8 command/subagent/client type surface used by all later tasks.
- Adds `THIRD_PARTY_NOTICES` to the published `files` list.
- Declares the plugin manifest's DSH engine as exactly `0.1.0-rc.8`.

- [ ] **Step 1: Add the exact new package surfaces**

First extend `tests/manifest-consistency.spec.ts` to require `engines.dsh === '0.1.0-rc.8'` and the shipped notice; run it once and observe the expected failure. Then add the package entries and update `dsh.plugin.json`.

Add rc.8 peer/dev entries for the newly consumed packages:

```json
{
  "@deepseek-ai/dsh-commands": "^0.1.0-rc.8",
  "@deepseek-ai/dsh-subagent": "^0.1.0-rc.8",
  "@deepseek-ai/dsh-host-apiproxy": "^0.1.0-rc.8",
  "@deepseek-ai/dsh-client-connection": "^0.1.0-rc.8"
}
```

Follow the repository convention: peers use `^0.1.0-rc.8`; dev dependencies use exact `0.1.0-rc.8`. Do not add rc.7-only client packages.

- [ ] **Step 2: Add the shipped BSD notice**

Copy the complete BSD-3-Clause notice from `../dsh-sidechain/LICENSE` into `THIRD_PARTY_NOTICES` under a heading naming `dsh-sidechain`, and add the filename to `package.json.files`.

- [ ] **Step 3: Regenerate and verify the lockfile**

Run: `pnpm install`

Expected: exit 0; lockfile resolves the added packages at `0.1.0-rc.8`.

- [ ] **Step 4: Run manifest guards**

Run: `pnpm exec vitest run tests/manifest-consistency.spec.ts tests/api-surface.spec.ts && pnpm pack --dry-run --json`

Expected: all selected tests pass, and the pack inventory contains `THIRD_PARTY_NOTICES`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml dsh.plugin.json THIRD_PARTY_NOTICES tests/manifest-consistency.spec.ts
git commit -m "chore: add sidechain rc8 dependencies"
```

### Task 2: Fork prompt and start primitives

**Files:**
- Create: `src/sidechain-host/prompts.ts`
- Create: `src/sidechain-host/side.ts`
- Create: `tests/sidechain-side.spec.ts`

**Interfaces:**
- Produces `SideMode`, `SideDeps`, `SubagentsLike`, `sidePrompt`, `askSideOneShot`, `startSideConversation`, `truncateLabel`, and `formatSideList`.
- Consumed by Task 3 commands.

- [ ] **Step 1: Write failing behavioral tests**

Cover literal mode boundaries, provider requests, labels, empty/direct child listing, and the 48-code-point cap. Use rc.8-complete request fixtures.

```ts
expect(sidePrompt(' inspect this ', 'btw')).toEqual({
  type: 'text',
  text: expect.stringContaining('Mode: BTW'),
})
expect(truncateLabel('x'.repeat(49))).toBe(`${'x'.repeat(48)}…`)
expect(startContinuable).toHaveBeenCalledWith(expect.objectContaining({
  provider: 'fork',
  label: 'Inspect events',
}))
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-side.spec.ts`

Expected: FAIL because `src/sidechain-host/side.ts` and exports do not exist.

- [ ] **Step 3: Implement the minimum pure host primitives**

Adapt behavior from `../dsh-sidechain/src/prompts.ts` and `../dsh-sidechain/src/side.ts`, update imports to rc.8 package exports, and retain a provenance header.

```ts
export interface SubagentsLike {
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
  startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>
  getProvider(name: string): { readonly name: string } | undefined
}
```

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-side.spec.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sidechain-host/prompts.ts src/sidechain-host/side.ts tests/sidechain-side.spec.ts
git commit -m "feat: add sidechain fork primitives"
```

### Task 3: `/side` and `/btw` command definitions

**Files:**
- Create: `src/sidechain-host/commands.ts`
- Create: `tests/sidechain-commands.spec.ts`

**Interfaces:**
- Consumes Task 2 `SubagentsLike` and `SideDeps`, plus the fixed seam `SettlementSilenceLike = { noteChild(childId: string): void }`.
- Produces `createSidechainCommands(subagents, deps, settlementSilence)`.
- Success markers remain exactly `Side conversation started: <uuid>.` and `BTW question started: <uuid>.` for the client observer.

- [ ] **Step 1: Write failing command tests**

Test missing/empty inputs, `list`/`ls`, provider absence, non-blocking start, one-shot background disposal, settlement registration, and rc.8 `attachments: []` fixtures.

```ts
const invocation = {
  commandId: 'cmd' as CommandId,
  agent,
  rawInput: 'question',
  signal: new AbortController().signal,
  attachments: [],
}
expect(outcome).toEqual({ kind: 'success', text: `BTW question started: ${childId}.` })
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-commands.spec.ts`

Expected: FAIL because the command factory is missing.

- [ ] **Step 3: Implement command definitions**

Adapt `../dsh-sidechain/src/commands.ts`; keep `recordInput: false`, return immediately after start, and dispose one-shot runs only after `run.result` settles.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-commands.spec.ts tests/sidechain-side.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sidechain-host/commands.ts tests/sidechain-commands.spec.ts
git commit -m "feat: register sidechain commands"
```

### Task 4: Parent settlement isolation

**Files:**
- Create: `src/sidechain-host/settlement-silence.ts`
- Create: `tests/sidechain-settlement-silence.spec.ts`

**Interfaces:**
- Produces `createSettlementSilenceRuntime(ctx)` returning `{ noteChild(childId: string): void; dispose(): void }`.
- This increment is process-local; restart persistence belongs only to Task 5.

- [ ] **Step 1: Write failing isolation tests**

Exercise exact-child filtering for `subagent-report` and `subagent-settled`, unrelated source passthrough, already-live agents, future `agent/created`, and descriptor restoration.

```ts
parent.followup({
  role: 'user', content: [],
  source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: sideId },
})
expect(originalFollowup).not.toHaveBeenCalled()
```

Also cover `{ kind: 'subagent-report', form: 'relay', senderSessionId: sideId }` and prove the same source forms from an unrecorded child still pass through.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-settlement-silence.spec.ts`

Expected: FAIL because the isolation module is missing.

- [ ] **Step 3: Implement exact-child wrappers**

Wrap the three parent admission methods used by rc.8, install wrappers for live and future agents, and restore the exact original property descriptors during disposal.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-settlement-silence.spec.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sidechain-host/settlement-silence.ts tests/sidechain-settlement-silence.spec.ts
git commit -m "feat: isolate sidechain settlements"
```

### Task 5: Settlement registry persistence

**Files:**
- Modify: `src/sidechain-host/settlement-silence.ts`
- Create: `tests/sidechain-settlement-registry.spec.ts`

**Interfaces:**
- Produces `createSettlementSilence(ctx, { registryPath })` returning `{ noteChild(childId: string): void; dispose(): void }`, compatible with Task 3 `SettlementSilenceLike`.
- Loads recorded child IDs before installing the runtime wrappers and persists every newly admitted child with synchronous sibling-temp-file plus rename before `noteChild` returns.

- [ ] **Step 1: Write failing persistence tests**

Cover restart restoration immediately after `noteChild` returns, malformed/missing registry recovery, successive sibling temporary-file plus rename writes, failed writes, and best-effort temporary-file cleanup. Prove `noteChild` records the child in memory first, never throws for a disk failure, logs the persistence failure, and continues suppressing that child's settlement so the already-started command remains successful.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-settlement-registry.spec.ts`

Expected: FAIL because the persistent factory is missing.

- [ ] **Step 3: Add the persistent factory**

Compose the Task 4 runtime instead of duplicating wrappers. Call its `noteChild`, then perform the best-effort atomic write synchronously; contain and report persistence errors instead of propagating them to commands. Do not add an async queue or ambiguous flush contract. Keep filesystem injection test-only and keep the production API fixed to `{ registryPath }`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-settlement-registry.spec.ts tests/sidechain-settlement-silence.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sidechain-host/settlement-silence.ts tests/sidechain-settlement-registry.spec.ts
git commit -m "feat: persist sidechain settlement registry"
```

### Task 6: Sidechain host configuration

**Files:**
- Modify: `src/config.ts`
- Create: `tests/sidechain-config.spec.ts`

**Interfaces:**
- Produces `SidechainConfig` and resolved `sidechain: { providerName; persona; readOnlyTools? }` inside `ResolvedSidebarConfig`.
- Defaults: provider `fork`, built-in persona, no tool allow-list.

- [ ] **Step 1: Write failing schema/default tests**

```ts
expect(resolveSidebarConfig(undefined).sidechain.providerName).toBe('fork')
expect(resolveSidebarConfig({ sidechain: { persona: '', readOnlyTools: ['read'] } }).sidechain)
  .toEqual({ providerName: 'fork', persona: '', readOnlyTools: ['read'] })
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-config.spec.ts`

Expected: FAIL because the nested config is absent.

- [ ] **Step 3: Add nested Schemastery and resolver types**

Use the shared built-in persona constant from `src/sidechain-host/prompts.ts`; do not duplicate persona text.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-config.spec.ts tests/prefs.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/sidechain-config.spec.ts
git commit -m "feat: configure native sidechain"
```

### Task 7: Host feature activation

**Files:**
- Create: `src/sidechain-host/index.ts`
- Modify: `src/index.ts`
- Create: `tests/sidechain-host-activation.spec.ts`

**Interfaces:**
- Produces `registerSidechainHost(ctx, config): void`; Cordis fibers/effects own all cleanup.
- Uses nested `ctx.inject(['agents', 'subagents'], ...)` and then optional `commands`; missing services do not block sidebar routes.
- Converts `readOnlyTools` to the rc.8 restriction shape `{ allow: readOnlyTools }` and passes no restriction when the option is absent.
- Resolves the production registry path with `const configured = process.env.DSH_HOME; const home = configured !== undefined && configured.trim() !== '' ? configured : join(homedir(), '.dsh')`, then `join(home, 'sidechain-children.json')`, and passes it to Task 5.

- [ ] **Step 1: Write failing activation tests**

Test command registration with all services, harmless absence of commands/subagents, exact `{ allow: [...] }` ToolRestriction conversion, explicit/non-empty `DSH_HOME`, blank/unset home fallback, exact `sidechain-children.json` path, and Cordis disposal of command/isolation effects.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-host-activation.spec.ts`

Expected: FAIL because activation is not wired.

- [ ] **Step 3: Implement and wire host activation**

Call the feature once from the host `apply()` after resolving config. Do not add `agents`, `subagents`, or `commands` to the plugin's top-level required `inject` list.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-host-activation.spec.ts tests/smoke.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sidechain-host/index.ts src/index.ts tests/sidechain-host-activation.spec.ts
git commit -m "feat: activate sidechain host feature"
```

### Task 8: Transcript row folding

**Files:**
- Create: `src/client/sidechain/transcript.ts`
- Create: `tests/sidechain-transcript.spec.ts`

**Interfaces:**
- Produces `TranscriptRow`, `ToolDetail`, `blockText`, `transcriptRows`, and `producedPaths`.
- Consumed by Tasks 10, 11, 12, and 15.

- [ ] **Step 1: Write failing literal-fixture tests**

Cover last seed boundary, boundary-prompt omission, user/context provenance, text/reasoning chunk accumulation, settled-message replacement, tool call/result pairing, orphan failures, and produced path uniqueness.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-transcript.spec.ts`

Expected: FAIL because the transcript module is missing.

- [ ] **Step 3: Implement the pure fold**

Adapt only pure mapping behavior from `../dsh-sidechain/src/client/sidechain-view.ts`. No fetching, timers, React, or global cache belongs in this file.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-transcript.spec.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/transcript.ts tests/sidechain-transcript.spec.ts
git commit -m "feat: fold sidechain transcripts"
```

### Task 9: Browser-safe rc.8 context surface

**Files:**
- Modify: `src/context-types.ts`
- Modify: `tests/api-surface.spec.ts`
- Modify: `tests/consumer-types.ts`

**Interfaces:**
- Extends the existing structural context types with only the rc.8 surfaces needed by the browser bundle.
- Keeps runtime imports from `@deepseek-ai/agent-harness` out of client code.

- [ ] **Step 1: Write consumer-facing type tests**

Cover the nested `subagents.history` response, required-signal `subagents.prompt` request, command `attachments`, fork callbacks, tab metadata, and the visible-gated feature context consumed by Sidechain.

- [ ] **Step 2: Run the focused checks and confirm RED**

Run: `pnpm exec vitest run tests/api-surface.spec.ts && pnpm check:consumer-types`

Expected: FAIL because the existing browser-safe surface lacks the rc.8 Sidechain members.

- [ ] **Step 3: Add the minimal structural types**

Use `import type` only where the dependency is erased. Do not export internal host controllers or make the client depend on Node-only harness modules.

- [ ] **Step 4: Run focused checks and confirm GREEN**

Run: `pnpm exec vitest run tests/api-surface.spec.ts && pnpm check:consumer-types`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/context-types.ts tests/api-surface.spec.ts tests/consumer-types.ts
git commit -m "refactor: expose browser-safe sidechain context"
```

### Task 10: Running-child activity summaries

**Files:**
- Create: `src/client/sidechain/activity.ts`
- Create: `tests/sidechain-activity.spec.ts`

**Interfaces:**
- Produces `salientToolArg`, `lastActivity`, and `readActivityRound` over Task 8 `TranscriptRow`.

- [ ] **Step 1: Write failing summary tests**

Use hand-derived literals for assistant precedence, tool argument selection, malformed JSON, failed-call exclusion, truncation, and sibling request failure containment.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-activity.spec.ts`

Expected: FAIL because activity helpers are missing.

- [ ] **Step 3: Implement pure activity helpers**

Adapt `../dsh-sidechain/src/client/sidechain-activity.ts` with provenance header.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-activity.spec.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/activity.ts tests/sidechain-activity.spec.ts
git commit -m "feat: summarize sidechain activity"
```

### Task 11: Transcript history reader and cache

**Files:**
- Create: `src/client/sidechain/history.ts`
- Create: `tests/sidechain-history.spec.ts`

**Interfaces:**
- Exports `SidechainApi = Pick<Context['connection']['api']['subagents'], 'history' | 'prompt'>`, `SidechainContinuableAddress = SidebarSubagentAddress & { mode: 'continuable' }`, and:

```ts
interface SidechainTranscriptSnapshot {
  rows: readonly TranscriptRow[]
  produced: readonly string[]
  streaming: boolean
  hasMore: boolean
}

interface SidechainHistory {
  fetchTranscript(address: SidebarSubagentAddress, signal?: AbortSignal): Promise<SidechainTranscriptSnapshot>
  fetchActivity(address: SidebarSubagentAddress, signal?: AbortSignal): Promise<string | null>
  sendPrompt(address: SidechainContinuableAddress, text: string, signal: AbortSignal): Promise<boolean>
  dispose(): void
}

createSidechainHistory(api: SidechainApi): SidechainHistory
```

- Consumes Task 8 `transcriptRows`/`producedPaths` and Task 10 `lastActivity`; Tasks 16, 19, 20, 21, and 22 share one activation-scoped instance.

- [ ] **Step 1: Write failing pagination/cache tests**

Cover tail pagination, inherited-seed page walk, per-child merge by event sequence, produced-path propagation, request failure containment, activity page cap, continuable prompt address, and activation-scoped cache reset.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-history.spec.ts`

Expected: FAIL because history functions do not exist.

- [ ] **Step 3: Implement the reader**

Adapt the non-React history/cache portion of the reference `sidechain-view.ts`, but use the rc.8 `connection.api.subagents.history` and `connection.api.subagents.prompt` surfaces rather than the reference plugin's rc.7 `sessions.history` workaround. Implement only the fixed factory above; do not use a permanent module-global cache. `sendPrompt` must forward its required `AbortSignal`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-history.spec.ts tests/sidechain-transcript.spec.ts tests/sidechain-activity.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/history.ts tests/sidechain-history.spec.ts
git commit -m "feat: read sidechain history"
```

### Task 12: Produced-file mention routing

**Files:**
- Create: `src/client/sidechain/file-mentions.ts`
- Create: `tests/sidechain-file-mentions.spec.ts`

**Interfaces:**
- Produces `fileMentionsFor(produced, cwd, openFile)`.
- The callback contract is `(absolutePath: string) => void`; Task 21 binds it to `service.openFile(scope, path)`.

- [ ] **Step 1: Write failing path tests**

Cover exact absolute path, cwd-relative path, unique basename, ambiguous basename, Windows paths, and missing cwd.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-file-mentions.spec.ts`

Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement resolver**

Adapt the reference file resolver without calling `workspaces.openPath`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-file-mentions.spec.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/file-mentions.ts tests/sidechain-file-mentions.spec.ts
git commit -m "feat: route sidechain file mentions"
```

### Task 13: Preference and localization surface

**Files:**
- Modify: `src/prefs-shared.ts`
- Modify: `src/config.ts`
- Modify: `src/client/locales.ts`
- Create: `tests/sidechain-locales-prefs.spec.ts`

**Interfaces:**
- Adds `SidebarPrefs.autoOpenSidechain: boolean`, default/schema `true`.
- Adds these exact dictionary keys: `sidechain`, `sidechainDescription`, `autoOpenSidechain`, `autoOpenSidechainDesc`, `sidechainEmpty`, `sidechainLoading`, `sidechainError`, `sidechainRetry`, `sidechainBack`, `sidechainRunning`, `sidechainInactive`, `sidechainOneShot`, `sidechainContinuable`, `sidechainReadOnly`, `sidechainPromptPlaceholder`, `sidechainSend`, `sidechainSending`, `sidechainPromptFailed`, `sidechainOpenFile`, `sidechainToolDetails`, `sidechainToolFailed`, `sidechainReasoning`, `sidechainContext`, `sidechainRecall`, `sidechainDiagnosticCorrupt`, `sidechainDiagnosticUnsupported`, and `sidechainDiagnosticUnavailable`.
- Exports `SidechainLabels` with those keys plus `copy` and `copied`, which reuse the existing dictionary entries, and `getSidechainLabels(): SidechainLabels`; later UI tasks consume this function rather than inventing local copy.

- [ ] **Step 1: Write failing preference/locale tests**

Assert old preference documents resolve `autoOpenSidechain` to true, `getSidechainLabels()` returns the complete fixed key set, and every required key returns non-empty, distinct zh/en values.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-locales-prefs.spec.ts`

Expected: FAIL because the preference and dictionary keys are absent.

- [ ] **Step 3: Add schema/defaults and dictionaries**

Do not add a second locale registry; extend better-sidebar's existing namespace.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-locales-prefs.spec.ts tests/locales.spec.ts tests/prefs.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/prefs-shared.ts src/config.ts src/client/locales.ts tests/sidechain-locales-prefs.spec.ts
git commit -m "feat: localize sidechain preferences"
```

### Task 14: Tab metadata and reveal controller

**Files:**
- Create: `src/client/sidechain/controller.ts`
- Create: `tests/sidechain-controller.spec.ts`

**Interfaces:**
- Exports `SidechainTabMetaV1`, `parseSidechainMeta`, `SidechainController`, and the sole factory `createSidechainController(service: BetterSidebarService, store: SidebarStore): SidechainController`, whose interface is:

```ts
selectChild(sessionId: string, childId?: string): void
clearStaleSelection(sessionId: string, liveChildIds: readonly string[]): void
claimSideChild(sessionId: string, childId: string): boolean
deferGenericCandidate(sessionId: string, childId: string, open: () => void): void
resetSession(sessionId: string): void
dispose(): void
```

- Controller receives `BetterSidebarService` and `SidebarStore`; it does not access React.
- Claims are keyed by the exact `(sessionId, childId)`. `deferGenericCandidate` schedules one microtask: a matching side claim suppresses that generic open regardless of arrival order; a different child ID is never consumed.

- [ ] **Step 1: Write failing state tests**

```ts
expect(parseSidechainMeta({ version: 1, selectedChildId: 'c1' }))
  .toEqual({ version: 1, selectedChildId: 'c1' })
expect(parseSidechainMeta({ version: 2, selectedChildId: 'c1' }))
  .toEqual({ version: 1 })
```

Also test per-session selection, stale clear, side-first and generic-first arrival, different child IDs, idempotent claims, disabled descriptor, `autoOpenSidechain: false`, session reset, and disposal. `claimSideChild` must explicitly reveal/focus the Sidechain tab when it returns true.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-controller.spec.ts`

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement the controller**

Use stable tab ID `sidechain`; persist only version/child ID. Claims expire only when the matching deferred generic candidate consumes them, or on session reset/disposal; never use a wall-clock timeout.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-controller.spec.ts tests/service.spec.ts`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/controller.ts tests/sidechain-controller.spec.ts
git commit -m "feat: coordinate sidechain selection"
```

### Task 15: Transcript row presentation

**Files:**
- Create: `src/client/sidechain/TranscriptRows.tsx`
- Create: `src/client/sidechain/SidechainView.module.css`
- Create: `tests/sidechain-transcript-rows.spec.tsx`

**Interfaces:**
- Produces `TranscriptRows({ rows, streaming, fileMentions, labels })`.
- Consumes Task 8 `TranscriptRow` and Task 13 locale labels; contains no fetching or timers.

- [ ] **Step 1: Write failing real-component tests**

Render user, context, recall-context, reasoning, assistant Markdown, expandable tool detail/failure, streaming marker, copy/copied state, and file mention behavior using Task 13 `SidechainLabels`. Assert roles/text/buttons, not mock elements or hard-coded fallback copy. Do not add catalog diagnostics to the transcript union.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-transcript-rows.spec.tsx`

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement token-driven rows**

Extract presentational behavior from the reference panel. Use CSS Modules and DSH tokens only; pass localized `codeLabels` to every `MarkdownText`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-transcript-rows.spec.tsx`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/TranscriptRows.tsx src/client/sidechain/SidechainView.module.css tests/sidechain-transcript-rows.spec.tsx
git commit -m "feat: render sidechain transcript rows"
```

### Task 16: Visible-gated Sidechain list shell

**Files:**
- Create: `src/client/sidechain/SidechainView.tsx`
- Modify: `src/client/sidechain/SidechainView.module.css`
- Create: `tests/sidechain-view.spec.tsx`

**Interfaces:**
- Produces the first increment of `SidechainView({ ctx, service, scope, tab, visible, controller, history })`.
- This increment owns only catalog/list states, selection/back navigation, and visible-gated observation/activity.

- [ ] **Step 1: Write failing list-state tests**

Cover empty/loading/error list, direct children only, corrupt/unsupported/unavailable catalog diagnostic rows using the three Task 13 diagnostic labels, selection/back, stale selection, hidden observation shutdown, activity polling only for running rows, and refresh.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx`

Expected: FAIL because `SidechainView` is missing.

- [ ] **Step 3: Implement the visible-gated list shell**

Use `useSyncExternalStore` for session list snapshots, observe only the current parent catalog while visible, and clean every activity interval/request epoch in effect disposers. A selected row may render a temporary loading detail placeholder; transcript rendering and composer behavior belong to Tasks 21 and 22.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx tests/sidechain-transcript-rows.spec.tsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/SidechainView.tsx src/client/sidechain/SidechainView.module.css tests/sidechain-view.spec.tsx
git commit -m "feat: add sidechain list view"
```

### Task 17: Sidechain descriptor factory

**Files:**
- Create: `src/client/sidechain/register.tsx`
- Create: `tests/sidechain-descriptor.spec.tsx`

**Interfaces:**
- Exports `SidechainTabOptions = { controller: SidechainController; history: SidechainHistory }` and `createSidechainTab(options: SidechainTabOptions): TabDescriptor`.
- Does not call `service.registerTab`; descriptor ownership remains exclusively with `registerBuiltins` in Task 19.

- [ ] **Step 1: Write failing descriptor tests**

Assert ID/order/single/icon/badge/setting, component prop forwarding, current-scope direct-running badge count, and the fixed metadata contract.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-descriptor.spec.tsx`

Expected: FAIL because the descriptor factory is missing.

- [ ] **Step 3: Implement only the descriptor factory**

Keep construction in `register.tsx`. Accept the shared Task 14 controller and Task 11 history instance; do not construct either dependency and do not register the descriptor here.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-descriptor.spec.tsx tests/sidechain-view.spec.tsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/register.tsx tests/sidechain-descriptor.spec.tsx
git commit -m "feat: define sidechain tab descriptor"
```

### Task 18: Sidechain command-card contribution

**Files:**
- Create: `src/client/sidechain/SideCommandCard.tsx`
- Create: `tests/sidechain-command-card.spec.tsx`

**Interfaces:**
- Exports `SidechainCommandCardContribution = { key: 'side' | 'btw'; component: typeof SideCommandCard }` and `createSidechainCommandCards(): readonly SidechainCommandCardContribution[]` with exactly two entries.
- Cards render command status/result only; they do not construct a controller, register slots, or own panel markup.

- [ ] **Step 1: Write failing real-component tests**

Render pending, success, and failure command states for both keys. Assert accessible status copy and prove there is no session-header toggle or fixed-panel host.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-command-card.spec.tsx`

Expected: FAIL because the command-card contribution is absent.

- [ ] **Step 3: Implement the two card contributions**

Use the Task 13 locale surface. Keep success-marker parsing out of these presentational cards; Task 20 observer owns it.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-command-card.spec.tsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/SideCommandCard.tsx tests/sidechain-command-card.spec.tsx
git commit -m "feat: add sidechain command cards"
```

### Task 19: Client runtime and built-in wiring

**Files:**
- Create: `src/client/sidechain/index.tsx`
- Modify: `src/client/builtins/tabs.tsx`
- Modify: `src/client/builtins/index.ts`
- Modify: `src/client/index.tsx`
- Modify: `tests/builtins.spec.ts`
- Create: `tests/sidechain-client-activation.spec.tsx`

**Interfaces:**
- Produces `createSidechainClientRuntime(ctx, service, store): { tab: SidechainTabOptions; controller: SidechainController; history: SidechainHistory; dispose(): void }`.
- The runtime constructs exactly one Task 14 controller and one Task 11 history instance. `src/client/index.tsx` creates it before `registerBuiltins`, then passes `runtime.tab` as `BuiltinTabOptions.sidechain`.
- Only `registerBuiltins` calls `service.registerTab(createSidechainTab(...))`; the runtime registers Task 18 command contributions and owns dependency disposal, never descriptor registration.

- [ ] **Step 1: Write failing lifecycle and built-in tests**

Assert exactly one Sidechain descriptor, shared controller/history identity in component props, two command-card registrations, descriptor disposal through builtins, runtime disposal, clean reactivation without duplicates, and cards registering successfully when `conversation.chat.commandview` is declared after the plugin activates.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-client-activation.spec.tsx tests/builtins.spec.ts`

Expected: FAIL because the runtime and built-in option are absent.

- [ ] **Step 3: Implement the single-owner lifecycle**

Create the runtime immediately after service/store creation and pass its tab dependencies into the one existing `registerBuiltins` effect. Register each Task 18 card only through `ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(...))`, so declaration order cannot race. Do not register the Task 20 observer yet.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-client-activation.spec.tsx tests/sidebar-crash.spec.tsx tests/builtins.spec.ts tests/sidechain-descriptor.spec.tsx tests/sidechain-command-card.spec.tsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/index.tsx src/client/builtins/tabs.tsx src/client/builtins/index.ts src/client/index.tsx tests/builtins.spec.ts tests/sidechain-client-activation.spec.tsx
git commit -m "feat: wire sidechain client runtime"
```

### Task 20: Command observer and auto-open arbitration

**Files:**
- Create: `src/client/sidechain/observer.tsx`
- Modify: `src/client/sidechain/index.tsx`
- Modify: `src/client/subagent-detect.ts`
- Modify: `src/client/Sidebar.tsx`
- Modify: `src/client/index.tsx`
- Create: `tests/sidechain-observer.spec.tsx`
- Modify: `tests/subagent-detect.spec.ts`
- Create: `tests/sidechain-auto-open-integration.spec.tsx`

**Interfaces:**
- Produces `resolveChildSessionId`, `observeCreatedChildren`, and `SidechainCommandObserver`.
- Changes generic detection to return exact newly appeared direct child IDs. `Sidebar.tsx` and the observer receive `runtime.controller`; no second controller is constructed.

- [ ] **Step 1: Write failing observer/arbitration tests**

Cover replay baseline, pending-to-settled, already-settled live command, duplicate snapshot, session reset, exact UUID marker, disabled auto-open, and observer registration when `conversation.input.dock` is declared after plugin activation. The integration test covers generic-first/side-later, side-first/generic-later, different child IDs, Sidechain disabled, auto-open off, reset/dispose, and exact newly appeared child IDs rather than a 0→N boolean.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run tests/sidechain-observer.spec.tsx tests/subagent-detect.spec.ts tests/sidechain-auto-open-integration.spec.tsx`

Expected: FAIL because the observer and exact-ID generic path are absent.

- [ ] **Step 3: Implement deterministic observation**

Adapt the reference command observation pure fold. Register one nonvisual observer only through `ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(...))` and pass the same Task 14 controller into `Sidebar`. Replace its current first-child boolean effect with exact-ID candidates passed to `deferGenericCandidate`; no fixed panel or visible dock markup is allowed.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run tests/sidechain-observer.spec.tsx tests/subagent-detect.spec.ts tests/sidechain-auto-open-integration.spec.tsx tests/sidechain-client-activation.spec.tsx`

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/observer.tsx src/client/sidechain/index.tsx src/client/subagent-detect.ts src/client/Sidebar.tsx src/client/index.tsx tests/sidechain-observer.spec.tsx tests/subagent-detect.spec.ts tests/sidechain-auto-open-integration.spec.tsx
git commit -m "feat: arbitrate sidechain auto open"
```

### Task 21: Selected transcript rendering and polling

**Files:**
- Modify: `src/client/sidechain/SidechainView.tsx`
- Modify: `src/client/sidechain/SidechainView.module.css`
- Modify: `tests/sidechain-view.spec.tsx`

**Interfaces:**
- Renders the selected child through the pure transcript-row presenter from Task 15.
- Polls only while the panel is visible and the selected child is still running.

- [ ] **Step 1: Add transcript lifecycle tests**

Cover one read for an inactive child, repeated reads for a running child, no reads while hidden, abort/reset when selection changes, retry after an error, streaming rows, and produced-file clicks routed through `service.openFile`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx`

Expected: FAIL because the selected transcript is still a placeholder.

- [ ] **Step 3: Implement transcript rendering and cancellable polling**

Keep the polling timer local to the selected child lifecycle. Render explicit loading, empty, error, and retry states; never poll merely because the tab exists.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/SidechainView.tsx src/client/sidechain/SidechainView.module.css tests/sidechain-view.spec.tsx
git commit -m "feat: render selected sidechain transcript"
```

### Task 22: `/side` composer and `/btw` read-only footer

**Files:**
- Modify: `src/client/sidechain/SidechainView.tsx`
- Modify: `src/client/sidechain/SidechainView.module.css`
- Modify: `tests/sidechain-view.spec.tsx`

**Interfaces:**
- Shows a composer only for continuable `/side` children.
- Shows an explicit read-only explanation for one-shot `/btw` children.

- [ ] **Step 1: Add composer behavior tests**

Cover read-only one-shot children, trimmed-empty rejection, single-flight submission, preserving the draft after failure, clearing only after admission succeeds, transcript refresh after success, and aborting stale work when selection changes.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx`

Expected: FAIL because the detail footer does not exist.

- [ ] **Step 3: Implement the minimal footer**

Call the established continue callback directly. Do not add a client-side queue or optimistic transcript rows; the harness remains the source of truth.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm exec vitest run tests/sidechain-view.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/SidechainView.tsx src/client/sidechain/SidechainView.module.css tests/sidechain-view.spec.tsx
git commit -m "feat: add sidechain continuation composer"
```

### Task 23: Theme and accessibility guard

**Files:**
- Modify: `src/client/sidechain/SidechainView.module.css`
- Modify: `tests/theme.spec.ts`
- Create: `tests/sidechain-theme.spec.tsx`

**Interfaces:**
- Uses the sidebar's existing theme tokens and responsive tab geometry.
- Keeps every interactive control named and keyboard reachable.

- [ ] **Step 1: Add behavior-level theme and accessibility tests**

Render the real Sidechain view in light and dark theme fixtures. Assert accessible names for selection, back, retry, submit, and file links; assert no fixed aside, fixed width, or independent z-index layer is introduced.

- [ ] **Step 2: Run the focused guard**

Run: `pnpm exec vitest run tests/sidechain-theme.spec.tsx tests/theme.spec.ts`

Expected: the new guard may already PASS because earlier tasks own accessible names and tokens. If it fails, record the exact unmet contract before changing CSS or markup; never manufacture a failure.

- [ ] **Step 3: Complete token-based styles and names**

Use existing CSS variables and sidebar layout primitives. Keep the assertions tied to rendered behavior and computed classes, not brittle source-text snapshots.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `pnpm exec vitest run tests/sidechain-theme.spec.tsx tests/theme.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/sidechain/SidechainView.module.css tests/theme.spec.ts tests/sidechain-theme.spec.tsx
git commit -m "test: guard sidechain theme and accessibility"
```

### Task 24: Documentation, mount smoke, and full integration verification

**Files:**
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `AGENTS.md`
- Modify: `tests/e2e/mount.e2e.ts`
- Create: `tests/sidechain-provenance.spec.ts`

**Interfaces:**
- Documents command semantics, nested host config, Sidechain/Subagent distinction, rc.8 baseline, and BSD attribution.
- Extends the existing real-mount lane without requiring a model API key.

- [ ] **Step 1: Add final acceptance guards**

Extend the mount test to assert that the add-tab menu opens Sidechain, the view mounts without page errors, exactly one better-sidebar root exists, and no legacy sidechain header toggle/fixed panel exists. In the Side card, disable then re-enable Sidechain and verify availability follows the setting. Persist an open Sidechain tab with `{ version: 1, selectedChildId }`, reload, and verify hydration does not crash.

Add `tests/sidechain-provenance.spec.ts` to require provenance comments on substantially adapted source files, the complete BSD notice, and `THIRD_PARTY_NOTICES` in the `pnpm pack --dry-run --json` inventory.

- [ ] **Step 2: Run the acceptance guards before documentation changes**

Run: `pnpm exec vitest run tests/sidechain-provenance.spec.ts && pnpm test:mount`

Expected: these are final regression guards and may be GREEN immediately. Any real failure is fixed at its owning integration seam; environmental inability to launch DSH is a blocker to report, not a reason to weaken assertions.

- [ ] **Step 3: Complete docs and mount integration**

Document:

```yaml
config:
  sidechain:
    providerName: fork
    readOnlyTools: [read, grep, glob]
```

State clearly that `fork` means a child conversation snapshot, not Git fork, and that `/btw` is read-only while `/side` continues.

- [ ] **Step 4: Run fresh full verification**

Run in order:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm check:consumer-types
pnpm test:mount
pnpm pack --dry-run --json
git diff --check main...HEAD
```

Expected: every command exits 0; Vitest and Playwright report zero failures.

- [ ] **Step 5: Commit**

```bash
git add README.md README_EN.md AGENTS.md tests/e2e/mount.e2e.ts tests/sidechain-provenance.spec.ts
git commit -m "docs: document native sidechain"
```

## Final review and delivery gate

After Task 24:

1. Generate one whole-branch review package from `main...HEAD`.
2. Dispatch a fresh `gpt-5.6-sol` reviewer against this plan, the approved design, the SDD ledger, and the review package.
3. Send all final findings in one fix wave to a fresh implementer; run one scoped re-review.
4. Run the complete verification block again after any final fix.
5. Only when review and verification are clean, push `feat/sidechain-native` to the `fork` remote and report the branch/commit to the user.
