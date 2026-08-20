/**
 * Headless-render mount lane: prove the npm-packed plugin mounts into a real
 * `dsh web` instance and renders without crashing the shell.
 *
 * The server is NOT started here — `scripts/e2e-mount.sh` boots `dsh web`
 * (with the plugin mounted through the official `dsh plugin add` channel) and
 * injects the base URL via `DSH_E2E_URL`. This spec:
 *
 *  1. seeds one workspace + one session through the host's own RPC surface
 *     (the same `workspace.create` / `session.create` calls the UI makes),
 *     so the sidebar has a real session to render;
 *  2. loads the page in headless Chromium and asserts the shell and the
 *     plugin's `[data-dsh-better-sidebar]` host mount;
 *  3. asserts the plugin's crash markers never appear (no RenderBoundary /
 *     fail() strips, no `pageerror`, no plugin-prefixed console errors);
 *  4. expands the collapsed panel (openByDefault defaults off), sweeps every
 *     built-in tab (Files / Source Control / Tasks / Terminal / Browser) —
 *     including the lazily-fetched terminal chunk — and then opens seeded
 *     files through the Files window's tree (separate mode: each file opens
 *     its own new tab, the seeded home "Files" tab stays the explorer),
 *     while response waits armed before goto prove the lazily-fetched editor
 *     chunk (client-editor.js) and the mermaid chunk (client-mermaid.js,
 *     rendered SVG diagram + zoom modal) loaded.
 *
 * Deterministic by construction: every wait is on a DOM/network marker, the
 * suite is serial (one server instance), and any crash trips the very next
 * assertion.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errors, test, expect, request, type APIRequestContext, type Page } from '@playwright/test'

const BASE_URL = process.env.DSH_E2E_URL
if (!BASE_URL) {
  throw new Error('DSH_E2E_URL is not set — boot a DSH web instance with the plugin mounted and point this lane at it (see scripts/e2e-mount.sh)')
}

/** Workspace the sidebar renders against (created by the lane's seeding). */
const WORKSPACE_PATH = process.env.DSH_E2E_WORKSPACE ?? join(tmpdir(), 'dsh-e2e-workspace')

/** A file seeded into the workspace, opened through the Files window's tree to
 *  exercise the file-open path (editor chunk = client-editor.js). */
const SEEDED_FILE = 'hello.txt'

/** A markdown file with a mermaid fence, opened through the Files window's
 *  tree to force the lazily-packed mermaid chunk (client-mermaid.js) to load
 *  and render a sanitized SVG diagram. */
const SEEDED_MD_FILE = 'diagram.md'

/**
 * The plugin's crash markers. The client mounts inside an error boundary that
 * renders a strip whose text starts with these prefixes instead of crashing
 * (see src/client/index.tsx `fail()` and src/client/RenderBoundary.tsx).
 */
const CRASH_STRIP_PATTERNS = [/^dsh-better-sidebar:/, /^\[dsh-better-sidebar\]/]

/** Built-in tab titles the sweep drives (en-US copy; follows DSH locale). */
const BUILTIN_TABS = ['Files', 'Source Control', 'Tasks', 'Terminal', 'Browser', 'Sidechain']

// The mount runner sets this explicitly from the resolved CLI mode. The
// default pinned rc.8 path is keyless and must expose a provider/onboarding
// takeover; an explicit DSH_CMD keeps the short optional compatibility path.
const EXPECT_ONBOARDING_TAKEOVER = process.env.DSH_E2E_EXPECT_ONBOARDING === '1'
const ONBOARDING_SHELL_WAIT_MS = 10_000
const ONBOARDING_TAKEOVER_GRACE_MS = 2_000
const ONBOARDING_EXPECTED_WAIT_MS = 60_000
const ONBOARDING_TAKEOVER_BUTTON_RE = /^(Continue|Configure later|继续|稍后配置)$/
const ONBOARDING_TAKEOVER_BUTTON_NAMES = ['Continue', 'Configure later', '继续', '稍后配置'] as const

let api: APIRequestContext

/** Seed one workspace + one session (plus files for the editor/mermaid-chunk
 *  probes) through the host's unary RPC surface. */
async function seedSession(): Promise<void> {
  mkdirSync(WORKSPACE_PATH, { recursive: true })
  writeFileSync(join(WORKSPACE_PATH, SEEDED_FILE), 'hello from the mount lane\n')
  // The mermaid-chunk probe file: a markdown doc whose preview must fetch
  // client-mermaid.js and render the fence into an SVG diagram. The
  // reference-style link's definition sits AFTER the fence: it only
  // resolves when the preview is one single markdown parse (the mermaid
  // path must not split the document into independent MarkdownText blocks).
  writeFileSync(join(WORKSPACE_PATH, SEEDED_MD_FILE), [
    '# Diagram',
    '',
    '[before][shared]',
    '',
    '```mermaid',
    'graph TD',
    '  A[Hello] --> B[World]',
    '```',
    '',
    '[shared]: https://example.com',
    '',
    'tail text',
    '',
  ].join('\n'))
  const workspace = await api.post(`${BASE_URL}/api/workspace.create`, {
    data: { type: 'client-request', rpcId: 'e2e-workspace', method: 'workspace.create', payload: { path: WORKSPACE_PATH } },
  })
  expect(workspace.ok(), `workspace.create: ${workspace.status()} ${await workspace.text()}`).toBe(true)
  const workspaceBody = (await workspace.json()) as {
    result: { ok: true; value: { workspace: { workspaceId: string } } } | { ok: false; error: unknown }
  }
  expect(workspaceBody.result.ok).toBe(true)
  const workspaceId = (workspaceBody.result as { value: { workspace: { workspaceId: string } } }).value.workspace.workspaceId

  const session = await api.post(`${BASE_URL}/api/session.create`, {
    data: { type: 'client-request', rpcId: 'e2e-session', method: 'session.create', payload: { workspaceId } },
  })
  expect(session.ok(), `session.create: ${session.status()} ${await session.text()}`).toBe(true)
}

/** Open the real DSH Settings dialog and select this plugin's Side card. */
async function openSideCard(page: Page): Promise<ReturnType<Page['locator']>> {
  const settingsButton = page.locator(
    'button:has([data-slot="settings.trigger"])',
  )
  await expect(settingsButton, 'the DSH shell must expose its Settings entry').toHaveCount(1, { timeout: 30_000 })
  await settingsButton.click()
  const dialog = page.getByRole('dialog').last()
  const sideCard = dialog.locator('[data-dsh-better-sidebar-settings-nav]')
  await expect(sideCard, 'the plugin must register a Side card settings section').toHaveCount(1, { timeout: 30_000 })
  await sideCard.click()
  const sidechainCard = dialog.locator('button[aria-pressed][title="sidechain"]')
  await expect(sidechainCard, 'the Side card must render the Sidechain enable card').toHaveCount(1, { timeout: 30_000 })
  return sidechainCard
}

/** Dismiss keyless DSH onboarding takeovers; the provider dialog reappears
 * after every reload while no credential is configured. */
async function dismissOnboarding(page: Page): Promise<void> {
  const takeover = page.getByRole('button', { name: ONBOARDING_TAKEOVER_BUTTON_RE })
  const shellReady = page.locator('button:has([data-slot="settings.trigger"])')
  if (EXPECT_ONBOARDING_TAKEOVER) {
    // In the default rc.8 keyless lane, absence is a real failure rather than
    // an optional condition. Poll the actual takeover seam so delayed provider
    // initialization cannot leak a modal into the next shell interaction.
    await expect
      .poll(async () => takeover.count(), { timeout: ONBOARDING_EXPECTED_WAIT_MS })
      .toBeGreaterThan(0)
  } else {
    const waitStarted = Date.now()
    let shellReadySeen = false
    while (Date.now() - waitStarted < ONBOARDING_SHELL_WAIT_MS) {
      if ((await takeover.count()) > 0) break
      shellReadySeen = (await shellReady.count()) > 0
      if (shellReadySeen) {
        const graceStarted = Date.now()
        while (Date.now() - graceStarted < ONBOARDING_TAKEOVER_GRACE_MS && (await takeover.count()) === 0) {
          await page.waitForTimeout(100)
        }
        break
      }
      await page.waitForTimeout(100)
    }
    if (!shellReadySeen && (await takeover.count()) === 0) {
      throw new Error(`DSH shell did not expose Settings or onboarding within ${ONBOARDING_SHELL_WAIT_MS}ms`)
    }
    if ((await takeover.count()) === 0) {
      console.warn('[e2e] no onboarding takeover appeared; proceeding without dismissal')
    }
  }
  let lastClickError: unknown
  for (let round = 0; round < 8; round++) {
    let foundCandidate = false
    let dismissed = false
    for (const name of ONBOARDING_TAKEOVER_BUTTON_NAMES) {
      const button = page.getByRole('button', { name, exact: true }).first()
      if ((await button.count()) === 0) continue
      foundCandidate = true
      try {
        await button.click({ timeout: 4_000 })
        dismissed = true
        await page.waitForTimeout(1_000)
      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error
        lastClickError = error
        // Masked by the takeover stacked above it; the next round retries.
      }
    }
    if (!foundCandidate) break
    if (!dismissed && round === 7) {
      throw lastClickError ?? new Error('onboarding takeover remained but could not be dismissed')
    }
  }
  await expect(takeover, 'all keyless onboarding takeovers must be dismissed before shell interaction').toHaveCount(0, { timeout: 10_000 })
}

/** Close the native Settings dialog after exercising its real controls. */
async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL })
  await seedSession()
})

test.afterAll(async () => {
  await api?.dispose()
})

test('plugin mounts into the DSH shell and survives a built-in tab sweep', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  // Load the shell. The app renders into #root; the plugin appends its own
  // [data-dsh-better-sidebar] host once its client half activates.
  //
  // The editor chunk (client-editor.js) loads as soon as ANY files-window tab
  // renders — the seeded home tab mounts the moment the panel expands, long
  // before the tree click below — so the response wait must be armed BEFORE
  // goto, or it misses the fetch and times out.
  const editorChunk = page.waitForResponse(
    (response) => response.url().includes('/sidebar/bundle/editor.js'),
    { timeout: 120_000 },
  )
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#root > *')).not.toHaveCount(0, { timeout: 90_000 })
  const sidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(sidebar).toBeAttached({ timeout: 90_000 })
  // The unified panel host: the fixed containing block every panel lives in
  // (data-dsh-panel-host). Its presence is part of the injection contract.
  await expect(page.locator('[data-dsh-panel-host]')).toBeAttached({ timeout: 90_000 })

  // A keyless boot stacks onboarding takeovers that mask the whole shell.
  await dismissOnboarding(page)

  // The seeded session must give the sidebar a session scope: without it the
  // shell renders a disabled toggle cluster and the tab sweep is impossible.
  const tabBar = sidebar.locator('[title]')
  await expect(tabBar.first()).toBeAttached({ timeout: 90_000 })

  // openByDefault defaults OFF: a fresh session's panel starts collapsed.
  // Expand it through the toggle cluster before the layout push can apply.
  const expandButton = sidebar.getByRole('button', { name: 'Expand sidebar' })
  await expect(expandButton, 'the collapsed toggle cluster must offer the expand button').toHaveCount(1)
  await expandButton.click()

  // The skinning contract is token-driven (AGENTS.md §8): the panels consume
  // `--dsw-alias-bg-layer-1`, so switching a skin re-skins the sidebar with
  // no per-skin code. The layout push variable must be live once the panel
  // mounts (its absence would mean the panel never opened with the session).
  await expect
    .poll(async () => (
      await page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-sidebar-width'))
    ), { timeout: 90_000 })
    .not.toBe('')

  // Sidechain is a normal tab surface. Exactly one plugin root and no legacy
  // header/floating-panel ownership are part of the native integration seam.
  await expect(sidebar).toHaveCount(1)
  await expect(sidebar.locator('[data-sidechain-session-header-toggle]')).toHaveCount(0)
  await expect(sidebar.locator('aside')).toHaveCount(0)
  // Legacy sidechain owned a separately labelled header and complementary
  // panel. Assert those real page-level accessibility seams are absent too;
  // data markers alone could disappear without the old UI actually leaving.
  await expect(page.locator('[aria-label="Sidechain: /side & /btw subagents"]')).toHaveCount(0)
  await expect(page.locator('[role="complementary"][aria-label="Sidechain"]')).toHaveCount(0)

  // Crash-marker assertions shared by every step.
  const assertNoCrash = async (): Promise<void> => {
    await expect
      .poll(async () => pageErrors, { timeout: 5_000 })
      .toEqual([])
    // Fail with the actual strip text so a regression is diagnosable from
    // the test report alone (a strip renders the client fail() message).
    const stripTexts = await sidebar.locator('div').evaluateAll(
      (nodes, patterns) => nodes.filter((node) => {
        const text = (node.textContent ?? '').trim()
        return patterns.some((pattern) => pattern.test(text))
      }).map((node) => (node.textContent ?? '').trim()),
      CRASH_STRIP_PATTERNS,
    )
    expect(stripTexts, 'a dsh-better-sidebar error strip is present in the sidebar').toEqual([])
  }

  // Sweep every built-in tab through the "+" menu (the sidebar's own open-tab
  // affordance, reachable from any pane state). Each open may fetch a lazy
  // chunk (/sidebar/bundle/client-terminal.js / client-editor.js) and mount a
  // real viewer — the highest-risk crash surfaces. The pinned plugin must
  // offer every listed built-in: a missing or renamed descriptor is a real
  // regression and fails the lane loudly instead of silently narrowing the
  // sweep. A failure anywhere surfaces as a pageerror or a console error,
  // both of which the next assertion sees.
  const newTabButton = sidebar.getByRole('button', { name: 'New tab' }).first()
  for (const title of BUILTIN_TABS) {
    await newTabButton.click()
    const item = page.getByRole('menuitem', { name: title }).first()
    await expect(item, `built-in tab "${title}" is not offered by the + menu — descriptor removed or its label changed`).toHaveCount(1)
    await item.click()
    // Let the activation commit (including any lazy-chunk fetch) before the
    // crash assertions run.
    await page.waitForTimeout(1_500)
    await assertNoCrash()
    if (title === 'Sidechain') {
      await expect(sidebar.locator('[data-sidechain-view]'), 'selecting Sidechain from + must mount its real view').toBeVisible()
    }
  }

  // The Side card's real enable switch gates the + inventory but does not
  // remove an already-open tab. Toggle it off in the native Settings UI and
  // verify the menu follows live, then reload to prove the setting persisted.
  const disabledSidechainCard = await openSideCard(page)
  await disabledSidechainCard.click()
  await expect(disabledSidechainCard).toHaveAttribute('aria-pressed', 'false')
  await closeSettings(page)
  const liveDisabledNewTab = sidebar.getByRole('button', { name: 'New tab' }).first()
  await liveDisabledNewTab.click()
  await expect(page.getByRole('menuitem', { name: 'Sidechain' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await expect(page.locator('[data-dsh-better-sidebar]')).toHaveCount(1, { timeout: 90_000 })
  const disabledNewTab = page.locator('[data-dsh-better-sidebar]').getByRole('button', { name: 'New tab' }).first()
  await disabledNewTab.click()
  await expect(page.getByRole('menuitem', { name: 'Sidechain' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Re-enable through the same real card, then verify both live and persisted
  // availability in the add-tab menu.
  const restoredSidechainCard = await openSideCard(page)
  await restoredSidechainCard.click()
  await expect(restoredSidechainCard).toHaveAttribute('aria-pressed', 'true')
  await closeSettings(page)
  const liveRestoredNewTab = page.locator('[data-dsh-better-sidebar]').getByRole('button', { name: 'New tab' }).first()
  await liveRestoredNewTab.click()
  await expect(page.getByRole('menuitem', { name: 'Sidechain' })).toHaveCount(1)
  await page.keyboard.press('Escape')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  const restoredSidebar = page.locator('[data-dsh-better-sidebar]')
  await expect(restoredSidebar).toHaveCount(1, { timeout: 90_000 })
  const restoredNewTab = restoredSidebar.getByRole('button', { name: 'New tab' }).first()
  await restoredNewTab.click()
  await expect(page.getByRole('menuitem', { name: 'Sidechain' })).toHaveCount(1)
  await page.keyboard.press('Escape')

  // Exercise the persisted tab-meta contract without needing a model-backed
  // child: inject the canonical v1 metadata into the real session state,
  // reload, and require hydration to recover safely to the list view.
  const persisted = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith('dsh-sidebar:v1:'))
    if (key === undefined) throw new Error('mount lane could not find the session sidebar state')
    const state = JSON.parse(localStorage.getItem(key) ?? 'null') as { splits?: unknown; bottomSplits?: unknown }
    const sidechainTabs: Array<Record<string, unknown>> = []
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const record = node as { kind?: unknown; tabs?: unknown; children?: unknown }
      if (record.kind === 'leaf' && Array.isArray(record.tabs)) {
        const tabs = record.tabs as Array<Record<string, unknown>>
        for (const tab of tabs) if (tab.type === 'sidechain') sidechainTabs.push(tab)
      }
      if (Array.isArray(record.children)) for (const child of record.children) visit(child)
    }
    visit(state.splits)
    visit(state.bottomSplits)
    if (sidechainTabs.length !== 1) throw new Error(`expected exactly one Sidechain tab, found ${sidechainTabs.length}`)
    sidechainTabs[0]!.meta = { version: 1, selectedChildId: 'mount-missing-child' }
    localStorage.setItem(key, JSON.stringify(state))
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as typeof state
    const storedSidechainTabs: Array<Record<string, unknown>> = []
    const collect = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return
      const record = node as { kind?: unknown; tabs?: unknown; children?: unknown }
      if (record.kind === 'leaf' && Array.isArray(record.tabs)) {
        for (const tab of record.tabs as Array<Record<string, unknown>>) {
          if (tab.type === 'sidechain') storedSidechainTabs.push(tab)
        }
      }
      if (Array.isArray(record.children)) for (const child of record.children) collect(child)
    }
    collect(stored.splits)
    collect(stored.bottomSplits)
    return { count: storedSidechainTabs.length, meta: storedSidechainTabs[0]?.meta }
  })
  expect(persisted.count, 'session persistence must contain exactly one Sidechain tab').toBe(1)
  expect(persisted.meta, 'Sidechain persistence must contain only the canonical v1 metadata').toEqual({
    version: 1,
    selectedChildId: 'mount-missing-child',
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await dismissOnboarding(page)
  await expect(page.locator('[data-dsh-better-sidebar]')).toHaveCount(1, { timeout: 90_000 })
  await expect(page.locator('[data-sidechain-view]')).toHaveCount(1, { timeout: 90_000 })
  await assertNoCrash()

  // The editor chunk (client-editor.js) only loads when a files-window tab
  // renders. Exercise the file-open path explicitly through the Files window's
  // own tree: the seeded home tab ("Files") is already open with its tree
  // panel pinned — activate it from the tab strip, open the seeded file, and
  // require the chunk round-trip (armed before goto), so a missing/corrupt
  // editor chunk fails the lane.
  // Tab-strip tabs carry `draggable="true"`; the always-mounted (hidden)
  // bottom panel's empty-pane welcome cards repeat the + menu labels with
  // `title="Files"`, so a bare `[title="Files"]` match is ambiguous.
  const filesTab = sidebar.locator('[title="Files"][draggable="true"]').first()
  await expect(filesTab, 'the seeded files-window home tab must be in the tab strip').toHaveCount(1)
  await filesTab.click()
  // Inactive tabs stay mounted (display:none); only the ACTIVE files
  // window's tree is visible — match the visible row.
  const fileRow = sidebar.locator(`[role="button"][title$="${SEEDED_FILE}"]:visible`)
  await expect(fileRow, `the seeded "${SEEDED_FILE}" file must appear in the files window's tree`).toHaveCount(1, { timeout: 30_000 })
  // Click near the row's LEFT edge: hovering reveals an @-reference button at
  // the row's right end, and a center click on a narrow dock lands on it
  // (referencing the file into the composer instead of opening it).
  await fileRow.click({ position: { x: 8, y: 8 } })
  await editorChunk
  // Separate-mode default (editorExplorer off): the tree click OPENS A NEW
  // file tab (openSidebarFile, id `editor:<path>`) instead of rewriting the
  // home tab in place. The seeded "Files" home tab stays put — it is the
  // standalone explorer now, not a file window.
  await expect(
    sidebar.locator(`[title="${SEEDED_FILE}"][draggable="true"]`),
    'separate mode opens a new file tab for the tree click',
  ).toHaveCount(1)
  // The seeded home tab survives (separate mode never rewrites it). The
  // sweep's + menu opened a SECOND path-less Files window (each is its own
  // explorer in separate mode), so assert presence, not an exact count.
  await expect(
    sidebar.locator('[title="Files"][draggable="true"]').first(),
    'the seeded files-window home tab must survive the file open',
  ).toHaveCount(1)
  const pathInput = sidebar.locator('input[placeholder^="File path"]:visible')
  await expect(pathInput, 'the file tab header path input shows the opened file').toHaveValue(new RegExp(`${SEEDED_FILE}$`))
  await page.waitForTimeout(1_500)
  await assertNoCrash()

  // The mermaid chunk (client-mermaid.js) only loads when a previewed
  // markdown file contains a mermaid fence. Open the seeded diagram file
  // from the files window's tree and require the full round-trip: chunk
  // fetch + sanitized SVG diagram in the preview, so a missing/corrupt
  // mermaid chunk or a broken render fails the lane. In separate mode the
  // tree click above activated the hello.txt tab, so switch back to the
  // Files explorer first (its tree is the only one visible while active).
  const mermaidChunk = page.waitForResponse(
    (response) => response.url().includes('/sidebar/bundle/mermaid.js'),
    { timeout: 30_000 },
  )
  await sidebar.locator('[title="Files"][draggable="true"]').first().click()
  const mdRow = sidebar.locator(`[role="button"][title$="${SEEDED_MD_FILE}"]:visible`)
  await expect(mdRow, `the seeded "${SEEDED_MD_FILE}" file must appear in the files window's tree`).toHaveCount(1, { timeout: 30_000 })
  await mdRow.click({ position: { x: 8, y: 8 } })
  // Separate mode: the md file opens its own tab (like hello.txt above).
  await expect(
    sidebar.locator(`[title="${SEEDED_MD_FILE}"][draggable="true"]`),
    'separate mode opens a new tab for the markdown file',
  ).toHaveCount(1, { timeout: 30_000 })
  // The markdown PREVIEW must render before the mermaid chunk can be
  // requested — this assertion separates a preview/render regression from a
  // chunk-loading one. (sidebar is already scoped to [data-dsh-better-sidebar].)
  await expect(
    sidebar.getByText('tail text'),
    'the markdown preview must render the seeded document',
  ).toHaveCount(1, { timeout: 30_000 })
  await mermaidChunk
  await expect(
    sidebar.locator('[data-mermaid-diagram] svg'),
    'the mermaid fence must render into an SVG diagram in the markdown preview',
  ).toHaveCount(1, { timeout: 30_000 })
  // Labels must survive as real SVG <text> (htmlLabels stays off so the
  // sanitizer's foreignObject strip cannot eat the node text).
  await expect(
    sidebar.locator('[data-mermaid-diagram]').first(),
    'the diagram node labels must render inside the SVG',
  ).toContainText('Hello', { timeout: 30_000 })
  // Cross-fence semantics: the reference-style link [before][shared] must
  // resolve to the definition that sits AFTER the fence — proof that the
  // preview is a single markdown parse and not per-fence fragments.
  await expect(
    sidebar.locator('a[href="https://example.com"]').first(),
    'reference-style links with definitions across a mermaid fence must resolve',
  ).toContainText('before', { timeout: 30_000 })
  // Click-to-enlarge: clicking the diagram opens the zoom modal (portalled
  // to document.body), Esc closes it again.
  const modal = page.locator('[data-mermaid-modal]')
  await sidebar.locator('[data-mermaid-diagram] svg').first().click()
  await expect(modal, 'clicking the diagram must open the zoom modal').toHaveCount(1, { timeout: 10_000 })
  await page.keyboard.press('Escape')
  await expect(modal, 'Esc must close the zoom modal').toHaveCount(0, { timeout: 10_000 })
  // The preview/edit toggle is mutually exclusive: in preview mode the
  // CodeMirror surface must be hidden (regression guard — a stale css copy
  // in the page made the editor stay visible under the preview, breaking
  // the toggle semantics).
  await expect(
    sidebar.locator('.cm-editor').first(),
    'preview mode must hide the CodeMirror editor (mutually exclusive toggle)',
  ).toBeHidden()
  await assertNoCrash()

  // The plugin's own console prefix must never appear in errors, and no
  // unhandled rejection may escape the sweep.
  const pluginErrors = consoleErrors.filter((text) => /dsh-better-sidebar|Unhandled/.test(text))
  expect(pluginErrors, 'plugin-prefixed or unhandled console errors during the sweep').toEqual([])
  expect(pageErrors, 'pageerrors during the sweep').toEqual([])

  // Final screenshot: the rendered panel with a session is the lane's proof.
  await page.screenshot({ path: 'test-results/mount-final.png' })
})

test('desktop shell stamps auto-enable the win32 title-bar compatibility mode', async ({ page }) => {
  // The official DSH Desktop shell stamps every render URL with
  // dsh-desktop-mode / dsh-desktop-platform (and exposes a preload marker).
  // The win32 advanced shell reserves a 32px overlay for the window
  // controls where the toggle cluster sits — the sidebar must auto-drop
  // below it (body[data-dsh-title-bar-compat]) without any manual pref.
  await page.goto(`${BASE_URL}?dsh-desktop-mode=advanced&dsh-desktop-platform=win32`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-dsh-better-sidebar]')).toBeAttached({ timeout: 90_000 })
  await expect(
    page.locator('body[data-dsh-title-bar-compat]'),
    'win32 advanced shell must auto-enable title-bar compatibility',
  ).toBeAttached({ timeout: 90_000 })
  // The strip variable must be sized to the shell's 32px overlay.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--dsh-title-bar-strip')))
    .toBe('32px')
})
