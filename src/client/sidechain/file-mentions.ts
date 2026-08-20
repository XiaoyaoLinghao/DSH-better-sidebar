/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Resolve inline-code file mentions against the files produced by one
 * side-conversation child. This module stays framework-free; callers provide
 * the absolute-path opener appropriate for their surface.
 */

import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'

/** Return the final path segment for either POSIX or Windows spelling. */
function basenameOf(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

/** Resolve a relative path against cwd without using node:path in the client. */
function resolveAgainstCwd(cwd: string | undefined, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\')) return path
  if (cwd === undefined || cwd === '') return path
  const base = cwd.replace(/[/\\]+$/, '')
  const relative = path.replace(/^[/\\]+/, '')
  return `${base}/${relative}`
}

/** Return the only produced path with this basename, or undefined if ambiguous. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basenameOf(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Build the file-mention resolver for one child transcript.
 *
 * A token may equal a produced path, its cwd-relative spelling, or the
 * basename of exactly one produced path. Relative targets are inert until a
 * cwd is available, so the opener always receives an absolute path.
 */
export function fileMentionsFor(
  produced: readonly string[],
  cwd: string | undefined,
  openFile: (absolutePath: string) => void,
): MarkdownFileMentions {
  const byAbsolute = new Set(produced)
  const byCwdRelative = new Set(
    produced
      .map(path => relativeTo(cwd, path))
      .filter((path): path is string => path !== undefined),
  )

  return {
    resolve(value) {
      const path = byAbsolute.has(value)
        ? value
        : byCwdRelative.has(value)
          ? value
          : onlyPathWithBasename(produced, value)
      if (path === undefined) return undefined

      const target = resolveAgainstCwd(cwd, path)
      // A missing cwd must not send an unresolved relative path to the host.
      if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(target)) return undefined
      return {
        open: () => { openFile(target) },
        label: basenameOf(path),
        title: target,
      }
    },
  }
}

/** Return a produced path relative to cwd when it is contained by cwd. */
function relativeTo(cwd: string | undefined, path: string): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const base = cwd.replace(/[/\\]+$/, '') + '/'
  if (!path.startsWith(base)) return undefined
  return path.slice(base.length)
}
