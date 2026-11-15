// Adapted from octopus_chat/app/components/markdown.tsx (MIT).
import DOMPurify from 'dompurify'
import katex from 'katex'
import { Marked, type Tokens } from 'marked'
import type { StudioMessageSource } from './studio-message-types'

export interface StudioMarkdownCode {
  code: string
  language: string
}

export function escapeMarkdownHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

export function safeMarkdownUrl(value: string, media: boolean | 'audio' | 'video' = false): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (media === true && /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(trimmed)) return trimmed
  if (media === 'audio' && /^data:audio\/(?:mpeg|mp3|ogg|wav|webm|aac|mp4);base64,[a-z\d+/=\s]+$/i.test(trimmed)) return trimmed
  if (media === 'video' && /^data:video\/(?:mp4|webm|ogg);base64,[a-z\d+/=\s]+$/i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed, window.location.href)
    if (url.username || url.password) return ''
    if (['http:', 'https:', ...(media ? ['blob:'] : ['mailto:', 'tel:'])].includes(url.protocol)) return trimmed
  } catch { /* Invalid URLs are rendered as plain text. */ }
  return ''
}

export function renderStudioMath(text: string, displayMode: boolean): string {
  return katex.renderToString(text, {
    displayMode, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml',
  })
}

export function sourceUrlKey(value: string): string {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch { return '' }
}

export function renderStudioMarkdown(content: string, streaming: boolean, sources: StudioMessageSource[], marker: string) {
  const codes: StudioMarkdownCode[] = []
  const sourceKeys = sources.map(source => sourceUrlKey(source.url))
  const markdown = new Marked({ gfm: true, breaks: true })
  markdown.use({
    extensions: [
      {
        name: 'studioMathBlock', level: 'block',
        start: source => source.search(/(?:\$\$|\\\[)/),
        tokenizer(source) {
          const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/.exec(source)
          if (match) return { type: 'studioMathBlock', raw: match[0], text: match[1] ?? match[2] }
        },
        renderer: token => renderStudioMath(token.text as string, true),
      },
      {
        name: 'studioMathInline', level: 'inline',
        start: source => source.search(/\$|\\\(/),
        tokenizer(source) {
          const match = /^(?:\$(?!\$)([^\n$]+?)\$(?!\$)|\\\((.+?)\\\))/.exec(source)
          if (match) return { type: 'studioMathInline', raw: match[0], text: match[1] ?? match[2] }
        },
        renderer: token => renderStudioMath(token.text as string, false),
      },
    ],
    renderer: {
      html(token) {
        // Keep generated KaTeX styles, but do not permit raw model HTML to
        // position elements outside its message or impersonate interface controls.
        return DOMPurify.sanitize(token.text, {
          FORBID_ATTR: ['style', 'class', 'id', 'data-studio-code', 'data-studio-source', 'data-studio-image'],
          FORBID_TAGS: ['iframe', 'object', 'embed', 'script', 'style', 'form', 'button', 'input'],
        })
      },
      code(token: Tokens.Code) {
        const index = codes.push({ code: token.text, language: token.lang?.split(/\s/)[0] ?? 'text' }) - 1
        return `<div data-studio-code="${marker}:${index}"></div>`
      },
      link(token: Tokens.Link) {
        const url = safeMarkdownUrl(token.href)
        const text = this.parser.parseInline(token.tokens)
        if (!url) return text
        const sourceIndex = sourceKeys.indexOf(sourceUrlKey(url))
        if (sourceIndex >= 0 && sourceKeys[sourceIndex]) {
          return `<button type="button" class="studio-source-citation" data-studio-source="${sourceIndex}" title="${escapeMarkdownHtml(sources[sourceIndex]!.title)}">${sources[sourceIndex]!.number ?? sourceIndex + 1}</button>`
        }
        let pathname = ''
        try { pathname = new URL(url, window.location.href).pathname } catch { /* Validated above. */ }
        const escapedUrl = escapeMarkdownHtml(url)
        if (/\.(?:aac|mp3|opus|wav|ogg|m4a)$/i.test(pathname)) return `<audio controls preload="none" src="${escapedUrl}"></audio>`
        if (/\.(?:3gp|3g2|webm|ogv|mpeg|mp4|avi|mov)$/i.test(pathname)) return `<video controls preload="metadata" src="${escapedUrl}"></video>`
        return `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`
      },
      image(token: Tokens.Image) {
        const url = safeMarkdownUrl(token.href, true)
        if (!url) return escapeMarkdownHtml(token.text)
        return `<button type="button" class="studio-markdown-image" data-studio-image="${escapeMarkdownHtml(url)}" aria-label="放大图片"><img src="${escapeMarkdownHtml(url)}" alt="${escapeMarkdownHtml(token.text)}" loading="lazy"></button>`
      },
    },
  })
  // Whole documents belong in the sandbox rather than the conversation DOM.
  const input = /^\s*(?:<!doctype|<html\b|<svg\b|<\?xml)/i.test(content)
    ? `\`\`\`html\n${content}\n\`\`\``
    : content
  // Incomplete math has no matching tokenizer and stays ordinary text during streaming.
  const html = markdown.parse(input, { async: false }) as string
  const sanitized = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'data-studio-code', 'data-studio-source', 'data-studio-image'],
    FORBID_TAGS: ['iframe', 'object', 'embed', 'script', 'style', 'form'],
  })
  return { html: sanitized, codes, streaming }
}

export function isPreviewableHtml(code: string, language: string): boolean {
  return ['html', 'svg', 'xml'].includes(language.toLowerCase()) || /^\s*(?:<!doctype|<html\b|<svg\b|<\?xml)/i.test(code)
}
