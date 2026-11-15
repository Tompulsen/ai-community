import { afterEach, describe, expect, it, vi } from 'vitest'
import { escapeMarkdownHtml, isPreviewableHtml, renderStudioMath, safeMarkdownUrl, sourceUrlKey } from './studio-markdown'

afterEach(() => vi.unstubAllGlobals())

describe('message URL boundaries', () => {
  it('rejects executable, SVG data, credential and empty URLs while allowing local assets', () => {
    vi.stubGlobal('window', { location: { href: 'https://www.zhangyuapi.com/studio' } })
    for (const url of ['', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://name:secret@example.com/image.png']) {
      expect(safeMarkdownUrl(url, true)).toBe('')
    }
    expect(safeMarkdownUrl('data:image/svg+xml;base64,PHN2Zz4=', true)).toBe('')
    expect(safeMarkdownUrl('/uploads/image.png', true)).toBe('/uploads/image.png')
    expect(safeMarkdownUrl('data:image/png;base64,aGVsbG8=', true)).toContain('data:image/png')
    expect(safeMarkdownUrl('data:audio/mpeg;base64,aGVsbG8=', 'audio')).toContain('data:audio/mpeg')
    expect(safeMarkdownUrl('data:video/mp4;base64,aGVsbG8=', 'video')).toContain('data:video/mp4')
    expect(safeMarkdownUrl('data:audio/mpeg;base64,aGVsbG8=', true)).toBe('')
  })
  it('normalizes source fragments but does not equate different pages', () => {
    expect(sourceUrlKey('https://example.com/path/#part')).toBe(sourceUrlKey('https://example.com/path'))
    expect(sourceUrlKey('https://example.com/path?a=1')).not.toBe(sourceUrlKey('https://example.com/path?a=2'))
    expect(sourceUrlKey('javascript:alert(1)')).toBe('')
    expect(sourceUrlKey('https://name:secret@example.com')).toBe('')
  })
})

describe('generated document and formula boundaries', () => {
  it('recognizes complete document and SVG fences without treating ordinary code as a preview', () => {
    expect(isPreviewableHtml('<svg viewBox="0 0 10 10"></svg>', 'text')).toBe(true)
    expect(isPreviewableHtml('<!DOCTYPE html><html></html>', 'text')).toBe(true)
    expect(isPreviewableHtml('<circle cx="1"/>', 'svg')).toBe(true)
    expect(isPreviewableHtml('const html = "<html>";', 'javascript')).toBe(false)
  })
  it('renders accessible MathML but disables trusted links and raw HTML commands', () => {
    const formula = renderStudioMath('\\frac{a}{b}', true)
    expect(formula).toContain('katex-display')
    expect(formula).toContain('<math')
    expect(formula).toContain('style=')
    expect(renderStudioMath('\\href{javascript:alert(1)}{click}', false)).not.toContain('href=')
    expect(renderStudioMath('\\htmlStyle{position:fixed}{x}', false)).not.toContain('style="position:fixed')
  })
  it('escapes source text before inserting it into generated HTML attributes', () => {
    expect(escapeMarkdownHtml('"><script>x</script>&')).toBe('&quot;&gt;&lt;script&gt;x&lt;/script&gt;&amp;')
  })
})
