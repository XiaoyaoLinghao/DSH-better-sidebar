/**
 * Serializable configuration and defaults for the sidebar host half. Loader
 * schema validation normally fills defaults; {@link resolveSidebarConfig}
 * applies the same defaults for direct callers that bypass the Loader.
 * @module dsh-better-sidebar/config
 */

import z from 'schemastery'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TITLE_BAR_STRIP_DEFAULT,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from './prefs-shared.ts'
import { SIDE_PERSONA } from './sidechain-host/prompts.ts'

export {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TITLE_BAR_STRIP_DEFAULT,
  TITLE_BAR_STRIP_MAX,
  TITLE_BAR_STRIP_MIN,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from './prefs-shared.ts'

/** Native /side and /btw host configuration (every field optional; defaults fill in). */
export interface SidechainConfig {
  /** Provider name registered on the subagent service. */
  providerName?: string
  /** Persona shadowing the deployment persona in a side-conversation child. */
  persona?: string
  /** Optional allow-list of read-only tools available to side-conversation children. */
  readOnlyTools?: string[]
}

/** Tunable sidebar host limits (every field optional; defaults fill in). */
export interface SidebarConfig {
  /** Read cap of one text file (bytes); larger files return truncated. */
  readLimit?: number
  /** Media route cap (bytes); larger binaries are refused. */
  mediaLimit?: number
  /** Explorer row bound of one level. */
  listLimit?: number
  /** Terminals per session. */
  terminalsPerSession?: number
  /** How long a disconnected terminal process survives awaiting a reconnect. */
  reconnectGraceMs?: number
  /**
   * Terminal shell (absolute path or bare executable name) for BOTH the UI
   * terminal tabs and the model-facing `terminal_*` tools. Empty = auto:
   * POSIX follows `$SHELL` then the account login shell; Windows follows
   * `DSH_SIDEBAR_SHELL`, then probes for `pwsh.exe`, then falls back to the
   * inbox `powershell.exe` (5.1). Set it from `cordis.patch.yml` / profile
   * plugin config, e.g. `config: { shell: /bin/zsh }`.
   */
  shell?: string
  /**
   * Optional arguments passed to the shell executable. When non-empty these
   * REPLACE the automatic platform defaults (POSIX `-l` / Windows none), so
   * the deployment has full control over how the shell starts. When omitted
   * the existing default behavior is kept.
   */
  shellArgs?: string[]
  /** Native /side and /btw host configuration. */
  sidechain?: SidechainConfig
}

/** Schemastery schema for the plugin configuration. */
export const Config: z<SidebarConfig> = z.object({
  readLimit: z.number().step(1).min(1).default(512 * 1024),
  mediaLimit: z.number().step(1).min(1).default(20 * 1024 * 1024),
  listLimit: z.number().step(1).min(1).default(1000),
  terminalsPerSession: z.number().step(1).min(1).default(3),
  reconnectGraceMs: z.number().step(1).min(0).default(30_000),
  shell: z.string().default(''),
  shellArgs: z.array(z.string()).default([]),
  sidechain: z.object({
    providerName: z.string().default('fork'),
    persona: z.string().default(SIDE_PERSONA),
    // Schemastery's array schema otherwise defaults an omitted value to [],
    // while an absent allow-list must remain unset for the host resolver.
    readOnlyTools: z.union([z.array(z.string()), z.const(undefined)]),
    // Keep this new section absent in legacy Loader output; the direct-call
    // resolver below supplies its effective defaults without reshaping old
    // configuration documents.
  }).default(undefined as never),
})

/** Fully defaulted sidebar host settings. */
export interface ResolvedSidebarConfig {
  readLimit: number
  mediaLimit: number
  listLimit: number
  terminalsPerSession: number
  reconnectGraceMs: number
  /** The configured terminal shell; empty means the host auto-resolves it. */
  shell: string
  /** Explicit shell arguments; empty means use the platform defaults. */
  shellArgs: string[]
  /** Resolved native /side and /btw host configuration. */
  sidechain: {
    providerName: string
    persona: string
    readOnlyTools?: string[]
  }
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided sidebar host settings.
 * @returns Complete settings consumed by the host half.
 */
export function resolveSidebarConfig(config: SidebarConfig | undefined): ResolvedSidebarConfig {
  return {
    readLimit: config?.readLimit ?? 512 * 1024,
    mediaLimit: config?.mediaLimit ?? 20 * 1024 * 1024,
    listLimit: config?.listLimit ?? 1000,
    terminalsPerSession: config?.terminalsPerSession ?? 3,
    reconnectGraceMs: config?.reconnectGraceMs ?? 30_000,
    shell: config?.shell?.trim() ?? '',
    shellArgs: config?.shellArgs ?? [],
    sidechain: {
      providerName: config?.sidechain?.providerName ?? 'fork',
      persona: config?.sidechain?.persona ?? SIDE_PERSONA,
      ...(config?.sidechain?.readOnlyTools === undefined
        ? {}
        : { readOnlyTools: config.sidechain.readOnlyTools }),
    },
  }
}

// ── User-facing "Side card" preferences ─────────────────────────────────────

/** Schemastery schema for the user-facing preferences (validated by the settings service). */
export const PrefsSchema: z<SidebarPrefs> = z.object({
  openByDefault: z.boolean().default(false),
  defaultWidthPercent: z.number().step(1).min(WIDTH_PERCENT_MIN).max(WIDTH_PERCENT_MAX).default(WIDTH_PERCENT_DEFAULT),
  autoOpenSubagent: z.boolean().default(true),
  autoOpenJobs: z.boolean().default(true),
  autoOpenSidechain: z.boolean().default(true),
  agentTerminalTools: z.boolean().default(false),
  bottomPanelAutoTerminal: z.boolean().default(true),
  terminalFontFamily: z.string().default(''),
  terminalFontSize: z.number().step(1).min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX).default(TERMINAL_FONT_SIZE_DEFAULT),
  interceptOpenPath: z.boolean().default(true),
  editorExplorer: z.boolean().default(false),
  terminalShell: z.string().default(''),
  terminalShellArgs: z.string().default(''),
  titleBarCompat: z.boolean().default(false),
  titleBarStripPx: z.number().step(1).min(TITLE_BAR_STRIP_MIN).max(TITLE_BAR_STRIP_MAX).default(TITLE_BAR_STRIP_DEFAULT),
  htmlViewerNoSandbox: z.boolean().default(false),
  htmlViewerDefaultUnsafe: z.boolean().default(false),
  browserNoSandbox: z.boolean().default(false),
  browserInterceptLinks: z.boolean().default(true),
  browserInterceptHttp: z.boolean().default(true),
  browserInterceptHttps: z.boolean().default(false),
  // Per-feature enable switches are OPEN maps (any tab/viewer id, built-in or
  // external): an absent key means enabled, so old documents resolve to {}
  // (everything on) with no migration. Non-boolean values fail validation.
  tabsEnabled: z.dict(z.boolean()).default({}),
  viewersEnabled: z.dict(z.boolean()).default({}),
  // Plugin-owned settings blobs (v0.12.0+) are an OPEN nested map: any
  // descriptor id may carry any JSON-serializable values. This is the
  // "settings seam" opening — without it the seam would drop third-party
  // keys as unknown schema fields.
  pluginSettings: z.dict(z.dict(z.any())).default({}),
})
