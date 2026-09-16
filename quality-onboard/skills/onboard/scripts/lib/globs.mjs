// Glob expansion and repository walk, shared by the scripts that must establish a scope:
// `validate-scopes` (step 1) and `validate-candidates` (steps 3, 6bis).
//
// Same exhaustive grammar as `quality-constraints` SPEC §2. The two scripts remain
// independent: they must detect a wrong scope before an agent starts working on it.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export function globToRegex(glob) {
  let out = ''
  for (let i = 0; i < glob.length;) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { out += '(?:.*\\/)?'; i += 3 } else { out += '.*'; i += 2 }
      } else { out += '[^/]*'; i++ }
    } else if (c === '?') { out += '[^/]'; i++ }
    else if (c === '{') {
      let depth = 0
      let end = -1
      for (let j = i; j < glob.length; j++) {
        if (glob[j] === '{') depth++
        else if (glob[j] === '}' && --depth === 0) { end = j; break }
      }
      if (end === -1) { out += '\\{'; i++ }
      else {
        const parts = []
        let part = ''
        depth = 0
        for (const char of glob.slice(i + 1, end)) {
          if (char === '{') depth++
          if (char === '}') depth--
          if (char === ',' && depth === 0) { parts.push(part); part = '' } else part += char
        }
        parts.push(part)
        out += `(?:${parts.map(globToRegex).join('|')})`
        i = end + 1
      }
    } else { out += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&'); i++ }
  }
  return out
}

export function globMatcher(glob) {
  return new RegExp(`^${globToRegex(glob.replace(/^\.\//, ''))}$`)
}

const SKIP_DIR = /^(\.git|node_modules|vendor|var|build|dist|\.idea|\.vscode|__pycache__)$/
export function repositoryFiles(dir = '.', prefix = '') {
  const out = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIP_DIR.test(entry.name)) out.push(...repositoryFiles(join(dir, entry.name), relative))
    } else if (entry.isFile()) out.push(relative)
  }
  return out
}

/** `glob - exclude` expanded over the repository. `exclude` accepts a glob, a list, or nothing. */
export function expandScope(glob, exclude, allFiles) {
  const excluders = [].concat(exclude ?? []).map(globMatcher)
  const matcher = globMatcher(glob)
  return allFiles.filter((file) => matcher.test(file) && !excluders.some((re) => re.test(file)))
}

/**
 * The population of a scope. `glob - exclude` expanded over the repository — or, on a
 * `scopes.json` written before 4.2, the enumerated `files` list it still carries. The list
 * was dropped from the contract because it cost its size three times over (written by the
 * orchestrator, re-emitted into every generator prompt, copied into each candidates JSON)
 * for a set the scripts recompute in milliseconds.
 */
export function scopePopulation(sc, allFiles) {
  if (Array.isArray(sc.files)) return sc.files
  if (typeof sc.glob !== 'string') return []
  return expandScope(sc.glob, sc.exclude, allFiles)
}
