import { describe, expect, it } from 'vitest'
import { getSidechainLabels, attachLocale, zh, en } from '../src/client/locales.ts'
import { loadPrefs, type SidebarSettingsClient } from '../src/client/prefs.ts'

const wire = (value: unknown): SidebarSettingsClient => ({
  settingsGet: async () => ({ value, revision: 1 }),
  settingsUpdate: async () => ({ value, revision: 2 }),
})

const sidechainKeys = [
  'sidechain',
  'sidechainDescription',
  'autoOpenSidechain',
  'autoOpenSidechainDesc',
  'sidechainEmpty',
  'sidechainLoading',
  'sidechainError',
  'sidechainRetry',
  'sidechainBack',
  'sidechainRunning',
  'sidechainInactive',
  'sidechainOneShot',
  'sidechainContinuable',
  'sidechainReadOnly',
  'sidechainPromptPlaceholder',
  'sidechainSend',
  'sidechainSending',
  'sidechainPromptFailed',
  'sidechainOpenFile',
  'sidechainToolDetails',
  'sidechainToolFailed',
  'sidechainReasoning',
  'sidechainContext',
  'sidechainRecall',
  'sidechainDiagnosticCorrupt',
  'sidechainDiagnosticUnsupported',
  'sidechainDiagnosticUnavailable',
  'copy',
  'copied',
] as const

describe('sidechain preference and localization surface', () => {
  it('defaults autoOpenSidechain to true for old preference documents', async () => {
    expect((await loadPrefs(wire({ openByDefault: false }))).autoOpenSidechain).toBe(true)
    expect((await loadPrefs(wire({ autoOpenSidechain: false }))).autoOpenSidechain).toBe(false)
  })

  it('returns the complete fixed Chinese sidechain label surface', () => {
    attachLocale({ getSnapshot: () => ({ active: 'zh-CN' }) })
    const labels = getSidechainLabels()
    expect(Object.keys(labels).sort()).toEqual([...sidechainKeys].sort())
    for (const key of sidechainKeys) {
      expect(labels[key]).toBe(zh[key])
      expect(labels[key]).not.toBe('')
    }
    expect(labels.copy).toBe(zh.copy)
    expect(labels.copied).toBe(zh.copied)
  })

  it('returns non-empty English values distinct from Chinese values', () => {
    attachLocale({ getSnapshot: () => ({ active: 'en-US' }) })
    const labels = getSidechainLabels()
    expect(Object.keys(labels).sort()).toEqual([...sidechainKeys].sort())
    for (const key of sidechainKeys) {
      expect(labels[key]).toBe(en[key])
      expect(labels[key]).not.toBe('')
      expect(labels[key]).not.toBe(zh[key])
    }
  })
})
