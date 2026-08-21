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

export interface ReadmeContract {
  headings: string[]
  githubLinks: string[]
}

export function readReadmeContract(path: string): ReadmeContract {
  const text = readFileSync(path, 'utf8')
  return { headings: headings(text), githubLinks: githubLinks(text) }
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
