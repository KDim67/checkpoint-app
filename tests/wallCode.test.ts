import { describe, expect, it } from 'vitest'
import { highlightCode, isCodeLanguage, languageLabel, type CodeToken } from '../src/shared/wallCode'

const typed = (lines: CodeToken[][], type: string): string[] => lines.flat().filter(t => t.type === type).map(t => t.text)
const rejoin = (lines: CodeToken[][]): string => lines.map(line => line.map(t => t.text).join('')).join('\n')

describe('highlightCode', () => {
  it('colours TypeScript keywords, strings, numbers, comments, calls, types and literals, and loses no text', () => {
    const code = "const total: Count = sum(1.5, 'two') // done\nreturn null"
    const lines = highlightCode(code, 'typescript')

    expect(rejoin(lines)).toBe(code)
    expect(typed(lines, 'keyword')).toStrictEqual(['const', 'return'])
    expect(typed(lines, 'string')).toStrictEqual(["'two'"])
    expect(typed(lines, 'number')).toStrictEqual(['1.5'])
    expect(typed(lines, 'comment')).toStrictEqual(['// done'])
    expect(typed(lines, 'function')).toStrictEqual(['sum'])
    expect(typed(lines, 'type')).toStrictEqual(['Count'])
    expect(typed(lines, 'literal')).toStrictEqual(['null'])
  })

  it('keeps a block comment and a template string whole across lines, cut at each line end', () => {
    const lines = highlightCode('/* one\ntwo */ `a\nb`', 'typescript')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toStrictEqual([{ text: '/* one', type: 'comment' }])
    expect(lines[1]).toStrictEqual([{ text: 'two */', type: 'comment' }, { text: ' ' }, { text: '`a', type: 'string' }])
    expect(lines[2]).toStrictEqual([{ text: 'b`', type: 'string' }])
  })

  it('reads a name with digits in it as a name, not a number', () => {
    expect(typed(highlightCode('let x1 = 2', 'typescript'), 'number')).toStrictEqual(['2'])
  })

  it('reads Python triple quotes and hash comments', () => {
    const lines = highlightCode('def f():\n    """doc\n    string"""  # note', 'python')
    expect(typed(lines, 'keyword')).toStrictEqual(['def'])
    expect(typed(lines, 'string')).toStrictEqual(['"""doc', '    string"""'])
    expect(typed(lines, 'comment')).toStrictEqual(['# note'])
  })

  it('reads SQL keywords in any case, and JSON keys apart from their values', () => {
    const sql = highlightCode('SELECT name FROM users -- all', 'sql')
    expect(typed(sql, 'keyword')).toStrictEqual(['SELECT', 'FROM'])
    expect(typed(sql, 'comment')).toStrictEqual(['-- all'])

    const json = highlightCode('{"name": "Ada", "age": 36, "ok": true}', 'json')
    expect(typed(json, 'attr')).toStrictEqual(['"name"', '"age"', '"ok"'])
    expect(typed(json, 'string')).toStrictEqual(['"Ada"'])
    expect(typed(json, 'number')).toStrictEqual(['36'])
    expect(typed(json, 'literal')).toStrictEqual(['true'])
  })

  it('reads HTML tags, attributes, values and comments, with the words between left plain', () => {
    const code = '<a href="/x">Go</a><!-- c -->'
    const lines = highlightCode(code, 'html')
    expect(rejoin(lines)).toBe(code)
    expect(typed(lines, 'tag')).toStrictEqual(['<a', '>', '</a', '>'])
    expect(typed(lines, 'attr')).toStrictEqual(['href'])
    expect(typed(lines, 'string')).toStrictEqual(['"/x"'])
    expect(typed(lines, 'comment')).toStrictEqual(['<!-- c -->'])
  })

  it('reads CSS properties, colours, sizes with units and rules, and shell variables', () => {
    const css = highlightCode('.a { color: #fff; margin: 2px !important } @media', 'css')
    expect(typed(css, 'attr')).toStrictEqual(['color', 'margin'])
    expect(typed(css, 'number')).toStrictEqual(['#fff', '2px'])
    expect(typed(css, 'keyword')).toStrictEqual(['important', '@media'])

    const shell = highlightCode('echo "$HOME" $USER # hi', 'shell')
    expect(typed(shell, 'keyword')).toStrictEqual(['echo'])
    expect(typed(shell, 'string')).toStrictEqual(['"$HOME"'])
    expect(typed(shell, 'attr')).toStrictEqual(['$USER'])
    expect(typed(shell, 'comment')).toStrictEqual(['# hi'])
  })

  it('leaves plain text, or a language it doesn\'t know, as one piece a line', () => {
    expect(highlightCode('a < b')).toStrictEqual([[{ text: 'a < b' }]])
    expect(highlightCode('x\n', 'klingon')).toStrictEqual([[{ text: 'x' }], []])
  })
})

describe('code languages', () => {
  it('knows its languages by id and names them for people', () => {
    expect(isCodeLanguage('python')).toBe(true)
    expect(isCodeLanguage('Python')).toBe(false)
    expect(languageLabel('csharp')).toBe('C#')
    expect(languageLabel(undefined)).toBe('Plain text')
  })
})
