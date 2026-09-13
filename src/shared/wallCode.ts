/** code blocks on the wall: the languages they can be, and their text cut into coloured pieces */

export type CodeLanguage =
  | 'typescript' | 'python' | 'csharp' | 'cpp' | 'java' | 'go' | 'rust' | 'json' | 'css' | 'html' | 'sql' | 'shell'

export const CODE_LANGUAGES: readonly { id: CodeLanguage; label: string }[] = [
  { id: 'typescript', label: 'JavaScript / TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'csharp', label: 'C#' },
  { id: 'cpp', label: 'C / C++' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'json', label: 'JSON' },
  { id: 'css', label: 'CSS' },
  { id: 'html', label: 'HTML' },
  { id: 'sql', label: 'SQL' },
  { id: 'shell', label: 'Shell' }
]

export const isCodeLanguage = (value: unknown): value is CodeLanguage => CODE_LANGUAGES.some(l => l.id === value)

export const languageLabel = (language?: string): string => CODE_LANGUAGES.find(l => l.id === language)?.label ?? 'Plain text'

export type CodeTokenType = 'keyword' | 'string' | 'comment' | 'number' | 'literal' | 'function' | 'type' | 'attr' | 'tag'

export interface CodeToken {
  text: string
  type?: CodeTokenType
}

interface Grammar {
  lineComments: string[]
  blockComments: [string, string][]
  quotes: string[]
  /** quotes whose strings may run past the end of a line */
  multiline: string[]
  keywords: Set<string>
  literals: Set<string>
  /** SQL writes its keywords in either case */
  caseless?: boolean
  /** a capitalised name reads as a type */
  capitalTypes?: boolean
  /** a name or string before a colon is a key */
  keysBeforeColon?: boolean
  /** $NAME is a variable */
  dollarVariables?: boolean
  /** #fff colours, @media rules and units after numbers */
  css?: boolean
}

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean))

const C_COMMENTS: Pick<Grammar, 'lineComments' | 'blockComments'> = { lineComments: ['//'], blockComments: [['/*', '*/']] }

const GRAMMARS: Record<Exclude<CodeLanguage, 'html'>, Grammar> = {
  typescript: {
    ...C_COMMENTS,
    quotes: ['"', "'", '`'],
    multiline: ['`'],
    keywords: words('break case catch class const continue debugger default delete do else enum export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of as from type interface implements private protected public readonly static abstract declare namespace keyof satisfies'),
    literals: words('true false null undefined NaN Infinity'),
    capitalTypes: true
  },
  python: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    multiline: ['"""', "'''"],
    keywords: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self'),
    literals: words('True False None'),
    capitalTypes: true
  },
  csharp: {
    ...C_COMMENTS,
    quotes: ['"', "'"],
    multiline: [],
    keywords: words('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await get set yield record partial'),
    literals: words('true false null'),
    capitalTypes: true
  },
  cpp: {
    ...C_COMMENTS,
    quotes: ['"', "'"],
    multiline: [],
    keywords: words('auto break case char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long mutable namespace new noexcept operator private protected public return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while bool include define ifdef ifndef endif pragma'),
    literals: words('true false NULL nullptr'),
    capitalTypes: true
  },
  java: {
    ...C_COMMENTS,
    quotes: ['"', "'"],
    multiline: [],
    keywords: words('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try var void volatile while record'),
    literals: words('true false null'),
    capitalTypes: true
  },
  go: {
    ...C_COMMENTS,
    quotes: ['"', "'", '`'],
    multiline: ['`'],
    keywords: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
    literals: words('true false nil iota'),
    capitalTypes: true
  },
  rust: {
    ...C_COMMENTS,
    quotes: ['"'],
    multiline: ['"'],
    keywords: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
    literals: words('true false None Some Ok Err'),
    capitalTypes: true
  },
  json: {
    lineComments: [],
    blockComments: [],
    quotes: ['"'],
    multiline: [],
    keywords: new Set(),
    literals: words('true false null'),
    keysBeforeColon: true
  },
  css: {
    lineComments: [],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'"],
    multiline: [],
    keywords: words('important'),
    literals: new Set(),
    keysBeforeColon: true,
    css: true
  },
  sql: {
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    quotes: ["'", '"'],
    multiline: ["'"],
    keywords: words('select from where and or not insert into values update set delete create table drop alter add join left right inner outer full cross on group by order having limit offset as distinct union all exists in is like between case when then else end primary key foreign references index view default begin commit rollback returning with asc desc'),
    literals: words('true false null'),
    caseless: true
  },
  shell: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    multiline: ['"', "'"],
    keywords: words('if then else elif fi for while until do done case esac function in return local export echo exit set unset source alias cd sudo'),
    literals: words('true false'),
    dollarVariables: true
  }
}

const NAME = /[A-Za-z_$][\w$]*/y
const NUMBER = /0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+/y
const UNIT = /[A-Za-z%]+/y
const VARIABLE = /\$(?:\{[^}\n]*\}|[\w@#?*!]+)/y
const HEX = /#[\da-fA-F]{3,8}\b/y
const AT_RULE = /@[\w-]+/y

/** sticky patterns read from a position, null when they don't match there */
function matchAt(pattern: RegExp, code: string, at: number): string | null {
  pattern.lastIndex = at
  const m = pattern.exec(code)
  return m && m[0] ? m[0] : null
}

class Tokens {
  readonly list: CodeToken[] = []

  push(text: string, type?: CodeTokenType): void {
    if (!text) return
    const last = this.list[this.list.length - 1]
    // plain runs join up, fewer nodes to draw
    if (!type && last && !last.type) last.text += text
    else this.list.push(type ? { text, type } : { text })
  }
}

function scan(code: string, g: Grammar): CodeToken[] {
  const out = new Tokens()
  const nextIsColon = (from: number): boolean => /^[ \t]*:(?!:)/.test(code.slice(from, from + 40))
  let i = 0

  while (i < code.length) {
    const block = g.blockComments.find(([open]) => code.startsWith(open, i))
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length)
      const stop = end === -1 ? code.length : end + block[1].length
      out.push(code.slice(i, stop), 'comment')
      i = stop
      continue
    }
    if (g.lineComments.some(marker => code.startsWith(marker, i))) {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? code.length : end
      out.push(code.slice(i, stop), 'comment')
      i = stop
      continue
    }

    const ch = code[i]
    const triple = g.multiline.find(q => q.length === 3 && code.startsWith(q, i))
    if (triple) {
      const end = code.indexOf(triple, i + 3)
      const stop = end === -1 ? code.length : end + 3
      out.push(code.slice(i, stop), 'string')
      i = stop
      continue
    }
    if (g.quotes.includes(ch)) {
      const runsOn = g.multiline.includes(ch)
      let j = i + 1
      while (j < code.length && code[j] !== ch && (runsOn || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1
      const stop = Math.min(code.length, code[j] === ch ? j + 1 : j)
      out.push(code.slice(i, stop), g.keysBeforeColon && nextIsColon(stop) ? 'attr' : 'string')
      i = stop
      continue
    }

    const variable = g.dollarVariables && ch === '$' ? matchAt(VARIABLE, code, i) : null
    if (variable) {
      out.push(variable, 'attr')
      i += variable.length
      continue
    }
    const special = g.css ? (ch === '#' ? matchAt(HEX, code, i) : ch === '@' ? matchAt(AT_RULE, code, i) : null) : null
    if (special) {
      out.push(special, ch === '#' ? 'number' : 'keyword')
      i += special.length
      continue
    }

    // a digit inside a name belongs to the name, the name branch takes it
    const number = /[\d.]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? '') ? matchAt(NUMBER, code, i) : null
    if (number) {
      const unit = g.css ? matchAt(UNIT, code, i + number.length) ?? '' : ''
      out.push(number + unit, 'number')
      i += number.length + unit.length
      continue
    }

    const name = /[A-Za-z_$]/.test(ch) && !(g.dollarVariables && ch === '$') ? matchAt(NAME, code, i) : null
    if (name) {
      const key = g.caseless ? name.toLowerCase() : name
      const after = i + name.length
      const type: CodeTokenType | undefined =
        g.keywords.has(key) ? 'keyword'
          : g.literals.has(key) ? 'literal'
          : g.keysBeforeColon && nextIsColon(after) ? 'attr'
          : /^[ \t]*\(/.test(code.slice(after, after + 20)) ? 'function'
          : g.capitalTypes && /^[A-Z]/.test(name) ? 'type'
          : undefined
      out.push(name, type)
      i = after
      continue
    }

    out.push(ch)
    i += 1
  }
  return out.list
}

const TAG_NAME = /<\/?[A-Za-z!][\w:-]*/y
const ATTRIBUTE = /[^\s=>/"']+/y

/** tags, their attributes and quoted values; the words between are plain */
function scanHtml(code: string): CodeToken[] {
  const out = new Tokens()
  let i = 0

  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4)
      const stop = end === -1 ? code.length : end + 3
      out.push(code.slice(i, stop), 'comment')
      i = stop
      continue
    }

    const open = code[i] === '<' ? matchAt(TAG_NAME, code, i) : null
    if (!open) {
      const next = code.indexOf('<', i + 1)
      const stop = next === -1 ? code.length : next
      out.push(code.slice(i, stop))
      i = stop
      continue
    }

    out.push(open, 'tag')
    i += open.length
    while (i < code.length) {
      const ch = code[i]
      if (ch === '>' || code.startsWith('/>', i)) {
        const close = ch === '>' ? '>' : '/>'
        out.push(close, 'tag')
        i += close.length
        break
      }
      if (ch === '"' || ch === "'") {
        const end = code.indexOf(ch, i + 1)
        const stop = end === -1 ? code.length : end + 1
        out.push(code.slice(i, stop), 'string')
        i = stop
        continue
      }
      const attribute = /\s|=/.test(ch) ? null : matchAt(ATTRIBUTE, code, i)
      if (attribute) {
        out.push(attribute, 'attr')
        i += attribute.length
        continue
      }
      out.push(ch)
      i += 1
    }
  }
  return out.list
}

/** a line at a time, since a comment or string can run across several; plain text is one piece a line */
export function highlightCode(code: string, language?: string): CodeToken[][] {
  const tokens = !isCodeLanguage(language)
    ? [{ text: code }]
    : language === 'html' ? scanHtml(code) : scan(code, GRAMMARS[language])

  const lines: CodeToken[][] = [[]]
  for (const token of tokens) {
    token.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push(token.type ? { text: part, type: token.type } : { text: part })
    })
  }
  return lines
}
