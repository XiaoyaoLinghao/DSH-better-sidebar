import { describe, expect, it, vi } from 'vitest'
import { fileMentionsFor } from '../src/client/sidechain/file-mentions.ts'

describe('fileMentionsFor', () => {
  it('resolves a token that equals a produced path exactly', () => {
    const openFile = vi.fn()
    const mentions = fileMentionsFor(['src/a.ts', 'README.md'], '/work/dsh-sidechain', openFile)
    const mention = mentions.resolve('src/a.ts')

    expect(mention).not.toBeUndefined()
    expect(mention!.label).toBe('a.ts')
    expect(mention!.title).toBe('/work/dsh-sidechain/src/a.ts')
    mention!.open()
    expect(openFile).toHaveBeenCalledWith('/work/dsh-sidechain/src/a.ts')
  })

  it('resolves a token equal to the produced path relative to the cwd', () => {
    const openFile = vi.fn()
    const mentions = fileMentionsFor(
      ['/work/dsh-sidechain/src/a.ts'],
      '/work/dsh-sidechain',
      openFile,
    )
    const mention = mentions.resolve('src/a.ts')

    expect(mention).not.toBeUndefined()
    expect(mention!.title).toBe('/work/dsh-sidechain/src/a.ts')
    mention!.open()
    expect(openFile).toHaveBeenCalledWith('/work/dsh-sidechain/src/a.ts')
  })

  it('resolves a unique basename from produced paths', () => {
    const mentions = fileMentionsFor(['/w/src/a.ts', '/w/src/b.ts'], undefined, () => {})

    expect(mentions.resolve('a.ts')?.title).toBe('/w/src/a.ts')
  })

  it('keeps ambiguous basenames and unknown tokens inert', () => {
    const mentions = fileMentionsFor(['/w/src/a.ts', '/w/tests/a.ts'], '/w', () => {})

    expect(mentions.resolve('a.ts')).toBeUndefined()
    expect(mentions.resolve('nope.ts')).toBeUndefined()
  })

  it('stays inert when a relative target has no cwd to resolve it', () => {
    const mentions = fileMentionsFor(['src/a.ts'], undefined, () => {})

    expect(mentions.resolve('src/a.ts')).toBeUndefined()
  })

  it('opens absolute paths verbatim without a cwd', () => {
    const openFile = vi.fn()
    const mentions = fileMentionsFor(['/abs/path/file.md'], undefined, openFile)

    mentions.resolve('file.md')!.open()
    expect(openFile).toHaveBeenCalledWith('/abs/path/file.md')
  })

  it('keeps Windows-style absolute paths absolute', () => {
    const openFile = vi.fn()
    const mentions = fileMentionsFor(['C:\\repo\\file.ts'], undefined, openFile)

    mentions.resolve('file.ts')!.open()
    expect(openFile).toHaveBeenCalledWith('C:\\repo\\file.ts')
  })
})
