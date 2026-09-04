import { describe, it, expect } from 'vitest'
import {
  isSkippedPath,
  stripFrontmatter,
  tagLine,
  baseTitle,
  planTitles,
  repointLinks,
  collectAttachmentTargets,
  rewriteAttachments,
  convertNote
} from '../src/shared/obsidianImport'

describe('what to skip in a vault', () => {
  it('leaves the vault’s own folders alone', () => {
    expect(isSkippedPath('.obsidian/workspace.json')).toBe(true)
    expect(isSkippedPath('.trash/Deleted.md')).toBe(true)
    expect(isSkippedPath('.git/config')).toBe(true)
  })

  it('reads ordinary notes, however deep', () => {
    expect(isSkippedPath('Notes/Projects/Checkpoint.md')).toBe(false)
    expect(isSkippedPath('Daily.md')).toBe(false)
  })

  it('checks every segment, not just the first', () => {
    expect(isSkippedPath('Notes/.obsidian/cache.json')).toBe(true)
  })
})

describe('frontmatter', () => {
  it('comes off, so it does not render as junk', () => {
    const { body } = stripFrontmatter('---\ntitle: Hello\n---\n# Real content\n')
    expect(body).toBe('# Real content\n')
  })

  it('keeps a block list of tags', () => {
    const { tags } = stripFrontmatter('---\ntags:\n  - work\n  - urgent\n---\nbody')
    expect(tags).toEqual(['work', 'urgent'])
  })

  it('keeps an inline array of tags', () => {
    const { tags } = stripFrontmatter('---\ntags: [work, urgent]\n---\nbody')
    expect(tags).toEqual(['work', 'urgent'])
  })

  it('keeps a bare comma-separated list, and strips quotes and hashes', () => {
    const { tags } = stripFrontmatter('---\ntags: "#work", urgent\n---\nbody')
    expect(tags).toEqual(['work', 'urgent'])
  })

  it('does not treat a list under another key as tags', () => {
    // Otherwise every alias would arrive as a tag.
    const { tags } = stripFrontmatter('---\naliases:\n  - Other name\ntags:\n  - real\n---\nbody')
    expect(tags).toEqual(['real'])
  })

  it('reports the keys it saw, so the caller can say what was dropped', () => {
    const { keys } = stripFrontmatter('---\naliases:\n  - X\ncssclass: wide\n---\nbody')
    expect(keys).toEqual(['aliases', 'cssclass'])
  })

  it('leaves a note with no block exactly as it was', () => {
    const note = 'Just a note.\n\n---\n\nWith a horizontal rule.'
    expect(stripFrontmatter(note).body).toBe(note)
  })

  it('does not eat a horizontal rule at the very top', () => {
    // A `---` on its own with no closing pair is a rule, not frontmatter.
    const note = '---\nnot closed'
    expect(stripFrontmatter(note).body).toBe(note)
  })
})

describe('turning frontmatter tags into Checkpoint tags', () => {
  it('writes them as #tags', () => {
    expect(tagLine(['work', 'urgent'])).toBe('#work #urgent')
  })

  it('flattens a nested tag rather than letting it truncate', () => {
    // Checkpoint's tag pattern stops at the slash, so "project/checkpoint"
    // and "project/website" would both silently become "#project".
    expect(tagLine(['project/checkpoint'])).toBe('#project-checkpoint')
  })

  it('joins a tag with a space in it', () => {
    expect(tagLine(['in progress'])).toBe('#in-progress')
  })

  it('is empty when there is nothing worth writing', () => {
    expect(tagLine([])).toBe('')
    expect(tagLine(['!!!'])).toBe('')
  })
})

describe('flattening a vault tree into note titles', () => {
  it('uses the file name when nothing collides', () => {
    const titles = planTitles(['Projects/Checkpoint.md', 'Daily.md'])
    expect(titles.get('Projects/Checkpoint.md')).toBe('Checkpoint')
    expect(titles.get('Daily.md')).toBe('Daily')
  })

  it('names a duplicate after the folder that distinguished it', () => {
    const titles = planTitles(['Work/Index.md', 'Home/Index.md'])
    const names = [...titles.values()]
    expect(new Set(names).size).toBe(2)
    expect(names).toContain('Index')
    expect(names.some(n => n === 'Index (Work)' || n === 'Index (Home)')).toBe(true)
  })

  it('falls back to a number when two folders share a name too', () => {
    const titles = planTitles(['a/Sub/Index.md', 'b/Sub/Index.md', 'Index.md'])
    expect(new Set(titles.values()).size).toBe(3)
  })

  it('is stable, so importing the same vault twice agrees with itself', () => {
    const paths = ['b/Index.md', 'a/Index.md', 'c/Note.md']
    expect([...planTitles(paths)]).toEqual([...planTitles([...paths].reverse())])
  })

  it('strips the extension only from the end', () => {
    expect(baseTitle('notes/README.md.md')).toBe('README.md')
  })
})

describe('links to notes that had to be renamed', () => {
  const renamed = new Map([['index', 'Index (Work)']])

  it('repoints a link to the new title', () => {
    expect(repointLinks('See [[Index]].', renamed)).toBe('See [[Index (Work)]].')
  })

  it('keeps the alias, so the link still reads the same', () => {
    expect(repointLinks('See [[Index|the list]].', renamed)).toBe('See [[Index (Work)|the list]].')
  })

  it('keeps a heading anchor', () => {
    expect(repointLinks('See [[Index#Today]].', renamed)).toBe('See [[Index (Work)#Today]].')
  })

  it('resolves a link written with a folder path', () => {
    expect(repointLinks('See [[Work/Index]].', renamed)).toBe('See [[Index (Work)]].')
  })

  it('leaves alone a link whose target kept its name', () => {
    expect(repointLinks('See [[Daily]].', renamed)).toBe('See [[Daily]].')
  })

  it('does nothing at all when nothing was renamed', () => {
    const note = 'See [[Index]] and [[Daily]].'
    expect(repointLinks(note, new Map())).toBe(note)
  })
})

describe('finding attachments', () => {
  it('finds an Obsidian embed', () => {
    expect(collectAttachmentTargets('![[diagram.png]]')).toEqual(['diagram.png'])
  })

  it('finds one with a size alias', () => {
    expect(collectAttachmentTargets('![[diagram.png|300]]')).toEqual(['diagram.png'])
  })

  it('finds a plain Markdown image', () => {
    expect(collectAttachmentTargets('![alt](assets/shot.png)')).toEqual(['assets/shot.png'])
  })

  it('decodes an escaped path', () => {
    expect(collectAttachmentTargets('![](assets/my%20shot.png)')).toEqual(['assets/my shot.png'])
  })

  it('ignores a link that already goes somewhere', () => {
    expect(collectAttachmentTargets('![](https://example.com/a.png)')).toEqual([])
    expect(collectAttachmentTargets('![](checkpoint-media://abc.png)')).toEqual([])
  })

  it('ignores an embedded note, which is not an attachment', () => {
    expect(collectAttachmentTargets('![[Some Note.md]]')).toEqual([])
  })
})

describe('rewriting attachments to the media folder', () => {
  const resolved = new Map([['diagram.png', 'uuid-1.png'], ['assets/shot.png', 'uuid-2.png']])

  it('rewrites an Obsidian embed', () => {
    expect(rewriteAttachments('![[diagram.png]]', resolved))
      .toBe('![diagram](checkpoint-media://uuid-1.png)')
  })

  it('drops a size alias, which Markdown cannot express, but keeps a real one', () => {
    expect(rewriteAttachments('![[diagram.png|300]]', resolved))
      .toBe('![diagram](checkpoint-media://uuid-1.png)')
    expect(rewriteAttachments('![[diagram.png|the shape of it]]', resolved))
      .toBe('![the shape of it](checkpoint-media://uuid-1.png)')
  })

  it('rewrites a Markdown image and keeps its alt text', () => {
    expect(rewriteAttachments('![a screenshot](assets/shot.png)', resolved))
      .toBe('![a screenshot](checkpoint-media://uuid-2.png)')
  })

  it('leaves an unresolved target alone rather than breaking the link', () => {
    const note = '![](missing.png)'
    expect(rewriteAttachments(note, resolved)).toBe(note)
  })

  it('leaves an external image alone', () => {
    const note = '![](https://example.com/a.png)'
    expect(rewriteAttachments(note, resolved)).toBe(note)
  })
})

describe('converting a whole note', () => {
  it('does all of it in one pass', () => {
    const note = [
      '---',
      'tags:',
      '  - project/checkpoint',
      'aliases:',
      '  - CP',
      '---',
      '# Checkpoint',
      '',
      'See [[Index]] and ![[diagram.png]].'
    ].join('\n')

    const { content, frontmatterKeys } = convertNote(
      note,
      new Map([['index', 'Index (Work)']]),
      new Map([['diagram.png', 'uuid-1.png']])
    )

    expect(content).toBe([
      '#project-checkpoint',
      '',
      '# Checkpoint',
      '',
      'See [[Index (Work)]] and ![diagram](checkpoint-media://uuid-1.png).'
    ].join('\n'))
    expect(frontmatterKeys).toEqual(['tags', 'aliases'])
  })

  it('leaves an ordinary note untouched', () => {
    const note = '# Notes\n\nNothing special here.\n'
    expect(convertNote(note, new Map(), new Map()).content).toBe(note)
  })
})
