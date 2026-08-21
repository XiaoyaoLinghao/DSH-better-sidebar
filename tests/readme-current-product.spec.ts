import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const CURRENT_REPO = 'https://github.com/XiaoyaoLinghao/DSH-better-workbench'
const UPSTREAM_REPO = 'https://github.com/omdsh-dev/DSH-better-sidebar'
const REQUIRED_FACTS = {
  'Maintained repository': CURRENT_REPO,
  Release: '0.15.0-xlh.1',
  'DSH baseline': '0.1.0-rc.8',
  'npm package': 'dsh-better-sidebar',
  'Plugin id': 'dsh-external/dsh-better-sidebar',
  Service: 'ctx.betterSidebar',
} as const

const SECTION_HEADINGS = {
  'README.md': ['DSH Better Workbench', '核心能力', '原生 Sidechain', '源码安装', '供 DSH / 自动化代理读取', '更新、卸载与回滚', 'Sidechain 配置', '开发与构建', '安全与限制', '平台支持', '上游来源'],
  'README_EN.md': ['DSH Better Workbench', 'Core capabilities', 'Native Sidechain', 'Source installation', 'For DSH / automation agents', 'Update, uninstall, and rollback', 'Sidechain configuration', 'Development and build', 'Security and limitations', 'Platform support', 'Upstream source'],
} as const

function headings(markdown: string): string[] {
  return markdown.split(/\r?\n/u)
    .map(line => /^(#{1,6})\s+(.+)$/u.exec(line)?.[2]?.trim())
    .filter((value): value is string => value !== undefined)
}

function normalizeGithubUrl(url: string): string {
  return url.replace(/[)\],.;:!?`\u3002\uFF0C\uFF01\uFF1F\uFF1B\uFF1A\uFF09]+$/u, '')
}

/** Find GitHub URLs regardless of Markdown, raw, autolink, or HTML syntax. */
function githubLinks(markdown: string): string[] {
  return [...markdown.matchAll(/https:\/\/github\.com\/[^\s<>"'`\u3002\uFF0C\uFF01\uFF1F\uFF1B\uFF1A\uFF09]+/gu)]
    .map(match => normalizeGithubUrl(match[0]!))
}

function parseFacts(markdown: string): Record<string, string> {
  const facts: Record<string, string> = {}
  for (const line of markdown.split(/\r?\n/u)) {
    if (!/^\|/u.test(line) || !/\|$/u.test(line)) continue
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
    if (cells.length !== 2 || cells[0] === 'Fact' || /^[-:\s]+$/u.test(cells[0]!)) continue
    const [label, value] = cells
    if (label !== undefined && value !== undefined) facts[label] = value
  }
  return facts
}

function sectionBodies(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = []
  let current: { heading: string; body: string } | undefined
  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line)?.[2]?.trim()
    if (heading !== undefined) {
      current = { heading, body: '' }
      sections.push(current)
    } else if (current !== undefined) {
      current.body += `${line}\n`
    }
  }
  return sections
}

export interface ReadmeContract {
  headings: string[]
  githubLinks: string[]
  facts: Record<string, string>
  sections: Array<{ heading: string; body: string }>
}

export function readReadmeContract(path: string): ReadmeContract {
  const text = readFileSync(path, 'utf8')
  return {
    headings: headings(text),
    githubLinks: githubLinks(text),
    facts: parseFacts(text),
    sections: sectionBodies(text),
  }
}

it('normalizes GitHub URLs from Markdown, raw, autolink, and HTML forms', () => {
  const markdown = [
    `[link](${CURRENT_REPO}).`,
    `raw ${CURRENT_REPO},`,
    `<${CURRENT_REPO}>!`,
    `<a href="${CURRENT_REPO}">repo</a>`,
  ].join('\n')
  expect(githubLinks(markdown)).toEqual([CURRENT_REPO, CURRENT_REPO, CURRENT_REPO, CURRENT_REPO])
})

for (const file of ['README.md', 'README_EN.md'] as const) {
  describe(file, () => {
    const contract = readReadmeContract(join(ROOT, file))

    it('exposes the current product contract in a labelled facts table', () => {
      for (const [label, expected] of Object.entries(REQUIRED_FACTS)) {
        expect(contract.facts[label], label).toContain(expected)
      }
      expect(contract.facts.Distribution).toMatch(/source[- ]only|源码优先/u)
      expect(contract.facts['Upstream npm']).toMatch(/dsh-better-sidebar@latest/u)
      expect(contract.facts['Source success']).toContain('dsh-better-sidebar')
      expect(contract.facts['Source success']).toContain('0.15.0-xlh.1')
    })

    it('keeps the required section order and no version-history headings', () => {
      expect(contract.headings).toEqual(SECTION_HEADINGS[file])
      expect(contract.headings.some(title => /^v\d/iu.test(title))).toBe(false)
    })

    it('keeps current and upstream repository links scoped and unambiguous', () => {
      expect(contract.githubLinks.filter(link => link === CURRENT_REPO)).toHaveLength(1)
      expect(contract.githubLinks.filter(link => link === UPSTREAM_REPO)).toHaveLength(1)

      const upstreamHeading = file === 'README.md' ? '上游来源' : 'Upstream source'
      const upstream = contract.sections.find(section => section.heading === upstreamHeading)
      expect(upstream).toBeDefined()
      expect(githubLinks(upstream?.body ?? '')).toEqual([UPSTREAM_REPO])
      expect(contract.sections
        .filter(section => section.heading !== upstreamHeading)
        .flatMap(section => githubLinks(section.body)))
        .not.toContain(UPSTREAM_REPO)

      expect(contract.githubLinks.some(link => link.startsWith(`${UPSTREAM_REPO}/pull/`))).toBe(false)
      expect(contract.githubLinks.some(link => link.startsWith(`${UPSTREAM_REPO}/issues/`))).toBe(false)
    })
  })
}
