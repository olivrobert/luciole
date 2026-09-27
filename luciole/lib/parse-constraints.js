'use strict'

// Executable grammar for constraint files. The matcher and the linter both go through here:
// a rule accepted by one can no longer silently become inert in the other.

function parseConstraintFile(text) {
  const lines = text.split('\n')
  const frontmatter = parseFrontmatter(lines)
  const staticBlocks = parseStaticBlocks(lines)
  const semanticSections = parseSemanticSections(lines)

  return {
    lines,
    frontmatter,
    staticBlocks,
    semanticSections,
    paths: frontmatter.paths.map((entry) => entry.value),
    exclude: frontmatter.exclude.map((entry) => entry.value),
    staticRules: staticBlocks.flatMap((block) => block.rules.map((rule) => rule.raw)),
    semanticRules: semanticSections
      .flatMap((section) => section.rules)
      .filter((rule) => !rule.delegated)
      .map((rule) => rule.text),
  }
}

function parseFrontmatter(lines) {
  const frontmatter = { openAt: null, closeAt: null, pathsAt: null, paths: [], excludeAt: null, exclude: [] }
  // The frontmatter is a leading block: a `---` further down the document is not a
  // frontmatter the matcher could consume. The `trim` remains essential: a `---\r`
  // (CRLF) or a trailing space would otherwise leave the constraint mute on the matcher side —
  // zero paths, no message, exactly the failure mode this parser exists to eliminate.
  if (lines[0] === undefined || lines[0].trim() !== '---') return frontmatter

  frontmatter.openAt = 1
  // `paths:` and `exclude:` share the same list grammar; `current` says which of the two
  // receives the `- glob` entries that follow. Any other key closes the current list, otherwise
  // an unknown key would let its items fall into the previous list.
  let current = null
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') {
      frontmatter.closeAt = i + 1
      break
    }
    if (/^paths:/.test(line)) {
      frontmatter.pathsAt = i + 1
      current = frontmatter.paths
      continue
    }
    if (/^exclude:/.test(line)) {
      frontmatter.excludeAt = i + 1
      current = frontmatter.exclude
      continue
    }
    if (current === null) continue
    const quoted = line.match(/^[ \t]*-[ \t]*"(.+)"/)
    const bare = line.match(/^[ \t]*-[ \t]*(.+)/)
    if (quoted) current.push({ value: quoted[1], line: i + 1 })
    else if (bare) current.push({ value: bare[1], line: i + 1 })
    else current = null
  }
  return frontmatter
}

function parseStaticBlocks(lines) {
  const blocks = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (current === null) {
      if (line === '```rules') current = { openAt: i + 1, closeAt: null, rules: [], lineNumbers: new Set() }
      continue
    }
    if (line === '```') {
      current.closeAt = i + 1
      blocks.push(current)
      current = null
      continue
    }
    current.lineNumbers.add(i + 1)
    const raw = line.replace(/^[ \t]*/, '')
    if (raw !== '') current.rules.push({ raw, line: i + 1 })
  }
  if (current !== null) blocks.push(current)
  return blocks
}

function parseSemanticSections(lines) {
  const sections = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^##[ \t]+Semantic/.test(line)) {
      if (current !== null) current.endAt = i + 1
      current = { openAt: i + 1, endAt: lines.length + 1, rules: [] }
      sections.push(current)
      continue
    }
    if (current === null) continue
    if (/^##[ \t]/.test(line) && !/^###[ \t]/.test(line)) {
      current.endAt = i + 1
      current = null
      continue
    }
    if (!/^[ \t]*-[ \t]+(MUST|SHOULD)/.test(line)) continue
    current.rules.push({
      line: i + 1,
      raw: line,
      // Same trimming as the historical matcher: the text is the semantic identity.
      text: line.replace(/^[ \t]*- /, ''),
      delegated: line.includes('[via='),
    })
  }
  return sections
}

// Splits `ID | present|absent | regex | message [| gate[!]=<regex>] [| via=<tool>[:<id>]]`.
// Split on " | " (space-pipe-space) so that alternations inside the regex (e.g. `(a|b)`)
// survive. Fields beyond the message are NAMED SUFFIXES, recognized by their prefix
// rather than their position: the order between `gate=` and `via=` is therefore irrelevant.
// Anything carrying no known prefix goes into `unknown` — this is almost always a regex that
// contains ` | ` instead of collapsing its alternation, and the linter needs to be able to say so.
function parseStaticRule(rule) {
  const fields = rule.split(' | ').map((field) => field.trim())
  const suffixes = fields.slice(4)
  const gate = suffixes.find((suffix) => /^gate!?=/.test(suffix)) || ''
  return {
    fields,
    id: fields[0] || '',
    type: fields[1] || '',
    regex: fields[2] || '',
    message: fields[3] || '',
    via: suffixes.find((suffix) => suffix.startsWith('via=')) || '',
    // `gate!=` carries the inverse meaning: the file is concerned when the pattern is MISSING.
    gate: gate === '' ? null : {
      sense: gate.startsWith('gate!=') ? 'absent' : 'present',
      regex: gate.replace(/^gate!?=/, ''),
    },
    unknown: suffixes.filter((suffix) => !/^(via|gate!?)=/.test(suffix)),
  }
}

// The text that carries the IDENTITY of a semantic rule (store, ghost duplicate):
// the bullet text, MINUS the trailing measurement ratio `(m/t)` that the onboard render
// updates on every re-measurement. Hashing the ratio would mint a new identity every time
// the population shifts (14 → 15 files): the whole rule-stats history for semantics
// would reset to zero on every re-onboard. Rewording the rule remains a deliberate reset
// (SPEC §5); re-measuring is not one.
function semanticIdentityText(text) {
  return text.replace(/\s*\(\d+\/\d+\)\s*$/, '')
}

function isInSemanticSection(document, line) {
  return document.semanticSections.some((section) => line > section.openAt && line < section.endAt)
}

function isInStaticBlock(document, line) {
  return document.staticBlocks.some((block) => block.lineNumbers.has(line))
}

// Converts a frontmatter glob into a regex. Single source for the matcher and the `--sweep`
// measurement: a glob cannot be alive in one place and dead in the other.
function globToRegex(glob) {
  let out = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*\\/)?'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
      } else {
        out += '[^/]*'
        i += 1
      }
    } else if (c === '?') {
      out += '[^/]'
      i += 1
    } else if (c === '{') {
      const end = closingBrace(glob, i)
      if (end === -1) {
        out += '\\{'
        i += 1
      } else {
        out += '(?:' + splitTopLevel(glob.slice(i + 1, end)).map(globToRegex).join('|') + ')'
        i = end + 1
      }
    } else {
      out += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&')
      i += 1
    }
  }
  return out
}

function closingBrace(s, start) {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of s) {
    if (char === '{') depth++
    if (char === '}') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

const globCache = new Map()
function globMatcher(glob) {
  let regex = globCache.get(glob)
  if (!regex) {
    regex = new RegExp('^' + globToRegex(glob) + '$')
    globCache.set(glob, regex)
  }
  return regex
}

// POSIX classes were accepted by grep -P before the matcher moved to JavaScript.
// They stay translated here to preserve rules already produced.
const POSIX_CLASSES = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  space: '\\s',
  upper: 'A-Z',
  lower: 'a-z',
  punct: '!-\\/:-@\\[-`{-~',
  word: '\\w',
  xdigit: '0-9a-fA-F',
  blank: ' \\t',
  cntrl: '\\x00-\\x1f\\x7f',
  print: '\\x20-\\x7e',
  graph: '\\x21-\\x7e',
}

function normalizedRegex(src) {
  return src.replace(/\[:(\w+):\]/g, (match, key) => POSIX_CLASSES[key] || match)
}

function compileRule(src) {
  try {
    return new RegExp(normalizedRegex(src))
  } catch {
    return null
  }
}

function regexError(src) {
  try {
    new RegExp(normalizedRegex(src))
    return null
  } catch (error) {
    return error.message.replace(/\n/g, ' ')
  }
}

module.exports = {
  compileRule,
  globMatcher,
  globToRegex,
  isInSemanticSection,
  isInStaticBlock,
  parseConstraintFile,
  parseStaticRule,
  regexError,
  semanticIdentityText,
}
