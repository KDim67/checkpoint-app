/** Wall text lines into the editor and back: one paragraph a line, words as text nodes with their format and style, addresses as link nodes */

import {
  $createParagraphNode, $createTextNode, $getRoot, $isElementNode, $isLineBreakNode, $isTextNode, getStyleObjectFromCSS,
  IS_BOLD, IS_CODE, IS_ITALIC, IS_STRIKETHROUGH, IS_UNDERLINE, type ElementNode, type LexicalNode, type TextNode
} from 'lexical'
import { $createLinkNode, $isLinkNode } from '@lexical/link'
import { WALL_FONTS, type TextAlign, type WallFont } from '../../../../shared/wallModel'
import type { TextSpan, WallLine } from '../../../../shared/wallText'
import { fontCssFamily } from './wallButtons'

/** the wall's own name for a font rides beside the CSS that draws it, so it reads back exactly */
export const FONT_KEY = '--wall-font'

const FORMAT_BITS: [keyof TextSpan, number][] = [
  ['bold', IS_BOLD], ['italic', IS_ITALIC], ['strike', IS_STRIKETHROUGH], ['underline', IS_UNDERLINE], ['code', IS_CODE]
]

/** the inline CSS a styled word carries in the editor */
export function styleOf(run: Pick<TextSpan, 'color' | 'size' | 'font'>): string {
  return [
    run.color ? `color: ${run.color}` : '',
    run.size !== undefined ? `font-size: ${run.size}em` : '',
    run.font ? `font-family: ${fontCssFamily(run.font)}; ${FONT_KEY}: ${run.font}` : ''
  ].filter(Boolean).join('; ')
}

/** the colour, size and font a text node's style holds; anything else in it, such as pasted styling, is not the wall's */
export function readStyle(css: string): Pick<TextSpan, 'color' | 'size' | 'font'> {
  if (!css) return {}
  const style = getStyleObjectFromCSS(css)
  const out: Pick<TextSpan, 'color' | 'size' | 'font'> = {}
  const color = (style.color ?? '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(color)) out.color = color
  const size = /^(\d+(?:\.\d+)?)em$/.exec((style['font-size'] ?? '').trim())
  if (size && Number(size[1]) >= 0.25 && Number(size[1]) <= 8) out.size = Number(Number(size[1]).toFixed(2))
  const font = (style[FONT_KEY] ?? '').trim()
  if ((WALL_FONTS as readonly string[]).includes(font) && font !== 'sans') out.font = font as WallFont
  return out
}

function textNodeFor(run: TextSpan): TextNode {
  const node = $createTextNode(run.text)
  let format = 0
  for (const [key, bit] of FORMAT_BITS) if (run[key]) format |= bit
  if (format) node.setFormat(format)
  const style = styleOf(run)
  if (style) node.setStyle(style)
  return node
}

/** replaces whatever the editor holds with these lines; call inside an update */
export function $loadLines(lines: WallLine[]): void {
  const root = $getRoot()
  root.clear()
  for (const line of lines) {
    const paragraph = $createParagraphNode()
    if (line.align) paragraph.setFormat(line.align)
    let link: ElementNode | null = null
    let linkUrl: string | undefined
    for (const run of line.runs) {
      const node = textNodeFor(run)
      if (run.url) {
        if (!link || linkUrl !== run.url) {
          link = $createLinkNode(run.url)
          linkUrl = run.url
          paragraph.append(link)
        }
        link.append(node)
      } else {
        link = null
        linkUrl = undefined
        paragraph.append(node)
      }
    }
    root.append(paragraph)
  }
  if (root.getChildrenSize() === 0) root.append($createParagraphNode())
}

const alignOf = (element: ElementNode): TextAlign | undefined => {
  const type = element.getFormatType()
  return type === 'left' || type === 'center' || type === 'right' ? type : undefined
}

function runOf(node: TextNode, url?: string): TextSpan {
  const run: TextSpan = { text: node.getTextContent() }
  for (const [key, bit] of FORMAT_BITS) if (node.getFormat() & bit) (run as unknown as Record<string, boolean>)[key] = true
  Object.assign(run, readStyle(node.getStyle()))
  if (url) run.url = url
  return run
}

/** what the editor holds, as lines; a line break inside a paragraph, such as from a paste, starts a new line */
export function $readLines(): WallLine[] {
  const lines: WallLine[] = []
  for (const block of $getRoot().getChildren()) {
    const align = $isElementNode(block) ? alignOf(block) : undefined
    let current: WallLine = align ? { align, runs: [] } : { runs: [] }
    lines.push(current)
    const visit = (node: LexicalNode, url?: string): void => {
      if ($isLineBreakNode(node)) {
        current = align ? { align, runs: [] } : { runs: [] }
        lines.push(current)
      } else if ($isTextNode(node)) {
        current.runs.push(runOf(node, url))
      } else if ($isLinkNode(node)) {
        for (const child of node.getChildren()) visit(child, node.getURL())
      } else if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child, url)
      } else {
        const text = node.getTextContent()
        if (text) current.runs.push({ text })
      }
    }
    if ($isElementNode(block)) for (const child of block.getChildren()) visit(child)
    else visit(block)
  }
  return lines
}
