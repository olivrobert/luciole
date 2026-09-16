#!/usr/bin/env node
'use strict'
// match-constraints — matches changed files against constraint globs, runs the static
// rules, and precomputes the dispatch groups for semantic rules.
//
// Usage:
//   match-constraints                    # git diff (default)
//   match-constraints file1.php file2    # explicit files
//   match-constraints src/Fournisseur/   # directory
//   match-constraints src/ tests/       # several directories, or a mix of both
//   match-constraints --sweep            # glob vitality across the WHOLE repo (no rule runs)
//
// JSON output:
// {
//   "constraints": { name: { static_violations: [...], static_rules: [...],
//                            semantic_rules: [...], files: [...] } },
//   "sweep": {...},              // --sweep mode ONLY
//   "run_ts": "20260726-141530", "branch": "feat/x",
//   "diffs": { "path/file.php": "<hunks git diff HEAD>" },   // git mode, {} otherwise
//   "agent_groups": [...], "advisory": {...}, "diffs_truncated": [...], "feedback": [...]
// }
//
// A single process, a single language: the old chain was bash (matching) + python3
// (grouping) + jq (diff escaping), with two degraded modes that changed the SHAPE of
// the output depending on which binaries were present. Here everything is done in node:
// `JSON.stringify` escapes, the regexes are compiled by the engine, and there is no more
// degraded mode.
//
// A static violation carries `{id, file, line, message}`, plus `{lines, lines_total}` when
// several lines are at fault. `line` is **null** on a `present` rule: the default there is
// the ABSENCE of the pattern, no line carries it.
//
// "static_rules" lists EVERY static rule evaluated, violated or not, with the size of the
// scope it ran on. Violations alone have no denominator: a rule that never triggers is
// indistinguishable from a rule whose glob matches nothing. Feeds rule-stats.
//
// --sweep answers a different question: is each glob still alive against the whole repo?
// A "0 files" at the scale of a single run only means the run didn't touch that file type
// — that's NOT a dead glob. Only a count of 0 across the whole repo proves it (typically
// a glob shrunk by enumeration). In sweep mode no rule is run, "constraints" stays empty,
// only "sweep" is filled in:
//   "sweep": { name: [ {"glob": "src/**/Controller/**/*.php", "files": 111}, ... ] }
// The "sweep" key exists ONLY in sweep mode: it's what distinguishes the two outputs. If
// emitted empty in run mode, `rule-stats dead-globs` would read an empty object and answer
// "no dead glob" for an input that measured nothing. An empty tracked tree is NOT a
// no_files case in sweep mode — all globs at 0 is precisely the finding.
//
// Rules delegated to another tool are IGNORED here but stay in the constraint file, because
// that file is also injected as-is into the scaffolding skill generation prompts — removing
// the rule would keep the generator from knowing the convention.
// Marking:
//   static   : ID | present|absent | regex | message | via=phpstan:<identifier>
//   semantic : - MUST [via=phpstan]: rule text     (also via=deptrac, via=rector…)
// Constraint files sharing a basename (e.g. conventions/x.md + decisions/x.md) are MERGED
// under a single key — paths and rules concatenated.
// "diffs" provides the hunks per file so the caller doesn't have to re-derive EITHER the
// scope OR the diff — the "files" lists and these hunks are the whole scope.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { compileRule, globMatcher, parseConstraintFile, parseStaticRule, regexError, semanticIdentityText } = require('../../../lib/parse-constraints.js')

const CONSTRAINTS_DIR = '.claude/quality/code/constraints'
const VIOLATION_MAX_LINES = 20 // line numbers listed per violation (`lines_total` keeps the real count)

// Grouping (formerly group-constraints.py)
const MAX_GROUPS = 5
const OVERLAP = 0.30 // ratio against the smaller set
const INLINE_MAX_FILES = 2
const INLINE_MAX_MUST = 2
const DIFF_MAX_LINES = 400
const FORCED = [['command', 'handler'], ['test', 'unit-test', 'functional-test']]

// --------------------------------------------------------------------------- git

function git(args, { allowFail = true } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (e) {
    if (allowFail) return ''
    throw e
  }
}

function lines(out) {
  return out.split('\n').filter((l) => l !== '')
}

// stdin: one `<loc>\t<regex>` line per regex. stdout: one `<loc>\t<message>` line per rejected
// regex. This mode stays public for existing integrations; the lint now calls the same
// function directly, without a subprocess.
function checkRegexMode() {
  let input = ''
  try {
    input = fs.readFileSync(0, 'utf8')
  } catch { /* no stdin: probe */ }
  let bad = 0
  for (const line of input.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    const loc = tab === -1 ? '' : line.slice(0, tab)
    const err = regexError(tab === -1 ? line : line.slice(tab + 1))
    if (err !== null) {
      process.stdout.write(`${loc}\t${err}\n`)
      bad += 1
    }
  }
  return bad > 0 ? 1 : 0
}

// Numbers (1-indexed) of the lines that match — the unit is the LINE, not the occurrence.
// `limit` stops the scan as soon as it knows enough: a `present` rule only needs to know
// whether there is at least one.
function matchingLines(content, re, limit = Infinity) {
  const hits = []
  const src = content.split('\n')
  for (let i = 0; i < src.length; i++) {
    if (re.test(src[i])) {
      hits.push(i + 1)
      if (hits.length >= limit) break
    }
  }
  return hits
}

function listConstraintFiles(dir) {
  const out = []
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}

// The project's extensions aren't declared: they're DERIVED from the constraints' `paths:`.
// A constraint targeting `src/**/*Handler.php` already says the project is in PHP — the
// engine has no list of languages to maintain, and the format doesn't carry one either.
//
// Extension of a glob = what follows the FIRST dot of the last segment, hence the compound
// extensions: `templates/**/*.html.twig` gives `html.twig`, not `twig`.
//
// Returns null to mean "no filter". Three cases, all intentional:
//   - a glob with no extension (`src/**/Controller/**`): filtering it on the OTHER globs'
//     extensions would silently mute it;
//   - an extension that's itself globbed (`*.php*`): it can't be bounded;
//   - no constraint, or no `paths:`: filtering would empty `targetFiles` and the run would
//     answer `no_files` ("nothing to check") instead of "no rule matches".
// This filter is only an upstream narrowing: the real matching (globMatcher, below) discards
// out-of-scope files anyway. It only exists to avoid READING files that can't violate
// anything, and to keep the early `no_files` output meaningful.
// `a{b,c}d{e,f}` → `abde abdf acde acdf`. Nested braces aren't in the grammar; an unbalanced
// `{` is returned as-is and rejected downstream as a globbed extension.
function expandBraces(segment) {
  const m = /\{([^{}]*)\}/.exec(segment)
  if (!m) return [segment]
  const out = []
  for (const alt of m[1].split(',')) {
    out.push(...expandBraces(segment.slice(0, m.index) + alt + segment.slice(m.index + m[0].length)))
  }
  return out
}

function codeExtensionFilter(dir) {
  const exts = new Set()
  for (const cf of listConstraintFiles(dir)) {
    let text
    try {
      text = fs.readFileSync(cf, 'utf8')
    } catch {
      continue
    }
    for (const glob of parseConstraintFile(text).paths) {
      // `{a,b}` is part of the glob grammar (SPEC §2): `*.{ts,js}` declares BOTH `ts` and
      // `js`. Taken literally, the extension would be `{ts,js}` — no file carries it, and
      // every diff or directory run would answer `no_files` while a file passed explicitly
      // still gets checked. Each alternative is therefore filtered on its own.
      for (const seg of expandBraces(glob.slice(glob.lastIndexOf('/') + 1))) {
        const dot = seg.indexOf('.')
        if (dot === -1) return null
        const ext = seg.slice(dot + 1).toLowerCase()
        if (ext === '' || /[*?[\]{}]/.test(ext)) return null
        exts.add(ext)
      }
    }
  }
  if (exts.size === 0) return null
  const alt = [...exts].sort().map((e) => e.replace(/\./g, '\\.')).join('|')
  return new RegExp(`\\.(${alt})$`, 'i')
}

function walkCode(dir, codeExt) {
  const out = []
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile() && (!codeExt || codeExt.test(e.name))) out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}

// ------------------------------------------------------------------- grouping

// "Type" of a file, in the only sense grouping needs: the last dot-separated segment of its
// NAME, or the whole name if it has no dot (`Dockerfile`, `console`). A compound extension
// therefore reduces to its head — `page.html.twig` and `mail.txt.twig` are both `twig`, and
// that's intentional: two templates of the same engine.
//
// The name, not the path: `bin/console` and `tools/console` must give the same type. Without
// splitting on `/`, a file with no dot would yield its full path, so it would never be
// compatible with a same-named file in another folder.
//
// There used to be a special case here for `.html.twig` → `twig`. It was dead: `split('.').pop()`
// already gives `twig`. Nothing replaces it — grouping needs no knowledge of languages.
function exts(files) {
  return new Set(files.map((f) => f.slice(f.lastIndexOf('/') + 1).split('.').pop()))
}

function intersects(a, b) {
  for (const x of a) if (b.has(x)) return true
  return false
}

// "never merge fundamentally different file types": a group goes into ONE agent prompt, and
// mixing classes and templates makes the rules inapplicable there. The criterion is therefore
// the intersection of types, with no list of known languages.
function compatible(a, b) {
  return intersects(exts(a.files), exts(b.files))
}

function mergeGroups(a, b) {
  return {
    names: a.names.concat(b.names),
    files: [...new Set([...a.files, ...b.files])].sort(),
    rules: { ...a.rules, ...b.rules },
  }
}

function mergePass(groups, cond) {
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (cond(groups[i], groups[j])) {
          const merged = mergeGroups(groups[i], groups[j])
          groups = groups.filter((_, k) => k !== i && k !== j)
          groups.push(merged)
          changed = true
          break outer
        }
      }
    }
  }
  return groups
}

function forcedCond(a, b) {
  if (!intersects(new Set(a.files), new Set(b.files))) return false
  return FORCED.some((f) => a.names.some((n) => f.includes(n)) && b.names.some((n) => f.includes(n)))
}

function overlapCond(a, b) {
  if (!compatible(a, b)) return false
  const bf = new Set(b.files)
  const inter = a.files.filter((f) => bf.has(f)).length
  return inter / Math.min(a.files.length, b.files.length) >= OVERLAP
}

/**
 * Stable identity of a rule that has no ID of its own.
 *
 * Derived from the text: rewording a rule mints a new id — and that's the point, the
 * reworded rule has no antecedents and must rebuild its own. The `#` (static, authored ID)
 * and `~` (semantic, derived) sigils keep the two namespaces from colliding.
 *
 * The final measurement ratio `(m/t)` is excluded from the hash (`semanticIdentityText`):
 * it's a measurement trace, not the rule — updating it on re-measurement must not reset the
 * history to zero.
 */
function semanticId(constraint, text) {
  const h = crypto.createHash('sha1').update(semanticIdentityText(text), 'utf8').digest('hex').slice(0, 8)
  return `${constraint}~${h}`
}

/**
 * One row per rule checked during this run — the denominator the reports were missing.
 * These rows ARE the `rules` array of the report's `json:constraints-run` block: the
 * orchestrator copies them and fills in `verdict` (and `hits`) on the semantic ones, which
 * the script cannot resolve. Static rows arrive already verdicted.
 *
 * Excluded: constraints with no MUST rule at all (`advisory`). They're listed as a warning
 * and never dispatched, so nothing checks them and a hit count would be fiction.
 *
 * Deduplicated on the rule id. Two constraint files sharing a basename (conventions/x.md +
 * decisions/x.md) merge under one key, so text repeated in both — or a static ID declared in
 * both — produces the same id twice. Left as-is, the duplicate is a phantom measurement, and
 * the orchestrator would be asked for a verdict it already gave.
 */
function buildFeedback(constraints, advisory, groups) {
  const rows = []
  const seen = new Set()
  const dispatched = new Set(groups.flatMap((g) => g.names))
  for (const name of Object.keys(constraints).sort()) {
    const c = constraints[name]
    const files = c.files || []
    if (files.length === 0) continue
    for (const r of c.static_rules || []) {
      const rid = `${name}#${r.id}`
      if (seen.has(rid)) continue
      seen.add(rid)
      const hits = r.hits === undefined ? 0 : r.hits
      rows.push({
        rule: rid,
        constraint: name,
        kind: r.kind || 'static',
        files: r.files === undefined ? files.length : r.files,
        verdict: hits > 0 ? 'fail' : 'pass',
        hits,
        text: r.text || '',
        ...(r.via ? { via: r.via } : {}),
      })
    }
    if (advisory[name] || !dispatched.has(name)) continue
    for (const text of c.semantic_rules || []) {
      const rid = semanticId(name, text)
      if (seen.has(rid)) continue
      seen.add(rid)
      rows.push({
        rule: rid,
        constraint: name,
        kind: 'semantic',
        files: files.length,
        verdict: null, // filled in by the orchestrator from the agent/inline results
        hits: null,
        text,
      })
    }
  }
  return rows
}

function countLines(s) {
  if (s === '') return 0
  return s.replace(/\n$/, '').split('\n').length
}

function postProcess(data) {
  const constraints = data.constraints || {}

  const advisory = {}
  let groups = []
  for (const name of Object.keys(constraints).sort()) {
    const rules = constraints[name].semantic_rules || []
    const files = constraints[name].files || []
    if (rules.length === 0 || files.length === 0) continue // static only: already resolved above
    if (!rules.some((r) => r.startsWith('MUST'))) {
      advisory[name] = rules
      continue
    }
    groups.push({ names: [name], files: [...files].sort(), rules: { [name]: rules } })
  }

  groups = mergePass(groups, forcedCond)
  groups = mergePass(groups, overlapCond)

  // ceiling: repeatedly merge the two smallest compatible groups
  while (groups.length > MAX_GROUPS) {
    groups.sort((a, b) => a.files.length - b.files.length)
    let hit = false
    for (let i = 0; i < groups.length && !hit; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (compatible(groups[i], groups[j])) {
          const merged = mergeGroups(groups[i], groups[j])
          groups = groups.filter((_, k) => k !== i && k !== j)
          groups.push(merged)
          hit = true
          break
        }
      }
    }
    if (!hit) break // no more compatible pair
  }

  const agentGroups = []
  const sortedGroups = [...groups].sort((a, b) =>
    [...a.names].sort().join('+') < [...b.names].sort().join('+') ? -1 : 1)
  for (const g of sortedGroups) {
    const ruleLines = []
    let n = 0
    let must = 0
    for (const name of Object.keys(g.rules).sort()) {
      for (const r of g.rules[name]) {
        n += 1
        if (r.startsWith('MUST')) must += 1
        ruleLines.push(`#${n} [${name}] ${r}`)
      }
    }
    agentGroups.push({
      constraints: [...g.names].sort(),
      files: g.files,
      rules: ruleLines,
      must_count: must,
      inline_eligible: g.files.length <= INLINE_MAX_FILES && must <= INLINE_MAX_MUST,
    })
  }

  const truncated = []
  const diffs = data.diffs || {}
  for (const f of Object.keys(diffs).sort()) {
    if (countLines(diffs[f]) > DIFF_MAX_LINES) {
      delete diffs[f]
      truncated.push(f)
    }
  }

  data.agent_groups = agentGroups
  data.advisory = advisory
  data.diffs_truncated = truncated
  data.feedback = buildFeedback(constraints, advisory, groups)
  return data
}

// ----------------------------------------------------------------------- main

function main(argv) {
  // Before any repo access: constraint-lint calls this mode from anywhere.
  if (argv[0] === '--check-regex') return checkRegexMode()

  const root = git(['rev-parse', '--show-toplevel']).trim() || process.cwd()
  process.chdir(root)

  let sweep = false
  if (argv[0] === '--sweep') {
    sweep = true
    argv = argv.slice(1)
  }

  // After the chdir: CONSTRAINTS_DIR is relative to the repo root.
  const codeExt = codeExtensionFilter(CONSTRAINTS_DIR)

  let gitMode = false
  let targetFiles
  if (sweep) {
    // Whole tracked tree — git ls-files already excludes vendor/, var/ and node_modules
    // (gitignored), so the scope is indeed the project's sources.
    targetFiles = lines(git(['ls-files'])).filter((f) => !codeExt || codeExt.test(f)).sort()
  } else if (argv.length > 0) {
    // EVERY argument is resolved, directory or file, in the order received. Processing only
    // the first would turn `src/ tests/` into a run on src/ alone: tests/'s constraints would
    // never be evaluated, and nothing would say so. A silently amputated scope reads like a
    // clean scope.
    const seen = new Set()
    targetFiles = []
    for (const arg of argv) {
      if (!fs.existsSync(arg)) {
        // An explicit missing path is reported, not swallowed: the shell version kept it in
        // the scope, where it counted 0 matches and therefore made every `present` rule fail.
        process.stderr.write(`match-constraints: file not found, skipped — ${arg}\n`)
        continue
      }
      const resolved = fs.statSync(arg).isDirectory() ? walkCode(arg, codeExt) : [arg]
      for (const file of resolved) {
        // Two overlapping arguments (`src/ src/Acme/Foo.php`) must not count the file twice:
        // it would violate the same rule twice.
        if (seen.has(file)) continue
        seen.add(file)
        targetFiles.push(file)
      }
    }
  } else {
    gitMode = true
    targetFiles = [...new Set([
      ...lines(git(['diff', '--name-only', 'HEAD'])),
      ...lines(git(['ls-files', '--others', '--exclude-standard'])),
    ])].filter((f) => !codeExt || codeExt.test(f)).sort()
    // A DELETED file appears in the diff but can't violate any code rule: leaving it in would
    // make every `present` rule fail (0 matches on an unreadable file).
    targetFiles = targetFiles.filter((f) => fs.existsSync(f))
  }

  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  const runTs = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()

  // In sweep mode, an empty tree is NOT a "nothing to check" case: it's the case where all
  // globs are dead, exactly what the measurement is looking for. Exiting early would deprive
  // `dead-globs` of the `sweep` key and make it conclude the opposite.
  if (targetFiles.length === 0 && !sweep) {
    process.stdout.write('{"error":"no_files","constraints":{}}\n')
    return 0
  }

  // Grouping of constraint files by basename. The walk covers all levels, including the
  // constraints/ root.
  const groupFiles = new Map()
  for (const cf of listConstraintFiles(CONSTRAINTS_DIR)) {
    const name = path.basename(cf, '.md')
    if (!groupFiles.has(name)) groupFiles.set(name, [])
    groupFiles.get(name).push(cf)
  }

  const out = { constraints: {} }
  const sweepOut = {}
  const allMatched = new Set()

  for (const constraintName of [...groupFiles.keys()].sort()) {
    const paths = []
    const excludes = []
    const staticRules = []
    const semanticRules = []
    for (const cf of groupFiles.get(constraintName)) {
      let text
      try {
        text = fs.readFileSync(cf, 'utf8')
      } catch {
        continue
      }
      const parsed = parseConstraintFile(text)
      paths.push(...parsed.paths)
      excludes.push(...parsed.exclude)
      staticRules.push(...parsed.staticRules)
      semanticRules.push(...parsed.semanticRules)
    }
    // `exclude:` is subtracted AFTER the union of `paths:`. Two populations sharing a folder —
    // command messages and their handlers, entities and embeddables — can't be separated
    // either by narrowing (same prefix) or in the pattern (the grammar forbids `!`). The
    // subtraction stays per-path: it doesn't make the globs themselves harder to read, and an
    // excluded file is excluded for EVERY rule in the group, never just one.
    const excluded = (f) => excludes.some((p) => globMatcher(p).test(f))

    // --- Sweep mode: population PER GLOB across the whole tree, then next constraint ---
    // Reported per glob and not per constraint: the interesting failure is a three-glob
    // constraint where one — usually the one shrunk by enumeration during onboarding — has
    // dropped to zero while the others make the constraint look alive.
    if (sweep) {
      const entries = []
      const seenGlob = new Set()
      for (const pattern of paths) {
        // conventions/x.md and decisions/x.md merge under one key and often repeat the same
        // glob — counted once, otherwise the report reads like two distinct globs.
        if (seenGlob.has(pattern)) continue
        seenGlob.add(pattern)
        const re = globMatcher(pattern)
        entries.push({ glob: pattern, files: targetFiles.filter((f) => re.test(f) && !excluded(f)).length })
      }
      sweepOut[constraintName] = entries
      continue
    }

    // Matching of files against globs (union of the group's paths)
    const matchedFiles = targetFiles.filter((f) => paths.some((p) => globMatcher(p).test(f)) && !excluded(f))
    if (matchedFiles.length === 0) continue
    for (const f of matchedFiles) allMatched.add(f)

    // --- Static rule execution ---
    const staticViolations = []
    const staticChecked = []
    const contents = new Map()
    const readFile = (f) => {
      if (!contents.has(f)) {
        try {
          contents.set(f, fs.readFileSync(f, 'utf8'))
        } catch {
          contents.set(f, null)
        }
      }
      return contents.get(f)
    }

    for (const raw of staticRules) {
      const rule = parseStaticRule(raw)

      // A `via=` marker means another tool (phpstan, deptrac, rector…) already applies this
      // rule in bin/check. The rule STAYS in the constraint file — it's injected as-is into
      // the scaffolding skill generation prompts — but re-checking it here would double the
      // verdict and burn a fixer round-trip on a violation the build already blocks. Still
      // logged as `delegated`: the store then proves the marker is alive rather than pointing
      // at a tool rule that was never recorded.
      if (rule.via) {
        staticChecked.push({
          id: rule.id,
          kind: 'delegated',
          via: rule.via,
          files: matchedFiles.length,
          hits: 0,
          text: rule.message,
        })
        continue
      }

      const re = compileRule(rule.regex)
      if (re === null) {
        process.stderr.write(`match-constraints: invalid regex, rule not evaluated — ${constraintName}#${rule.id}: ${rule.regex}\n`)
        staticChecked.push({
          id: rule.id,
          kind: 'invalid',
          files: matchedFiles.length,
          hits: 0,
          text: rule.message,
        })
        continue
      }

      // `gate` — a TRIGGER probe, not a conformance one. It SELECTS the files the rule
      // concerns. Many true rules don't target their whole scope: "the owning side of a
      // ManyToMany names its join table" says nothing about entities that have no ManyToMany.
      // Without a gate, these off-topic files come out as violations, the fixer goes off to
      // correct code that's already correct, and the store ends up classifying the rule as a
      // false positive — and so has it removed. It's the same gate as at measurement time
      // (onboard step 4): a rule's `static` verdict was established on the population it
      // carves out, running it on a wider population isn't stricter, it's wrong.
      let population = matchedFiles
      if (rule.gate !== null) {
        const gateRe = compileRule(rule.gate.regex)
        if (gateRe === null) {
          process.stderr.write(`match-constraints: invalid gate, rule not evaluated — ${constraintName}#${rule.id}: ${rule.gate.regex}\n`)
          staticChecked.push({
            id: rule.id,
            kind: 'invalid',
            files: matchedFiles.length,
            hits: 0,
            text: rule.message,
          })
          continue
        }
        population = matchedFiles.filter((file) => {
          const content = readFile(file)
          // Unreadable file: out of population. Counting it as triggered would produce a
          // violation nobody can verify the cause of.
          if (content === null) return false
          const triggered = matchingLines(content, gateRe, 1).length > 0
          return rule.gate.sense === 'present' ? triggered : !triggered
        })
      }

      let hits = 0
      for (const file of population) {
        const content = readFile(file)
        // `present`: a single line is enough to conclude. `absent`: it needs the numbers of
        // ALL the faulty lines, that's what the fixer has to correct.
        const found = content === null ? [] : matchingLines(content, re, rule.type === 'present' ? 1 : Infinity)
        const violation = (rule.type === 'present' && found.length === 0) || (rule.type === 'absent' && found.length > 0)
        if (!violation) continue
        hits += 1
        // `line: null` on a `present` rule: the default is the ABSENCE of the pattern, no
        // line carries it. Inventing a number (1, or the class declaration's) would send the
        // fixer to look at a line that did nothing wrong.
        staticViolations.push({
          id: rule.id,
          file,
          line: found.length > 0 ? found[0] : null,
          // All the faulty lines, capped — but `lines_total` always says how many there
          // really were: a silent truncation would read as "a single occurrence".
          ...(found.length > 1 ? { lines: found.slice(0, VIOLATION_MAX_LINES), lines_total: found.length } : {}),
          message: rule.message,
        })
      }
      // hits = number of files IN VIOLATION (not grep matches) — same unit for present and
      // absent, so "N runs at hits=0 across a large number of files" is comparable.
      // `files` = the TRIGGERED population, not the whole glob: same unit as onboard's
      // `measure.total`, otherwise a gated rule keeps an inflated denominator and the
      // violation rate rule-stats reads no longer means anything.
      staticChecked.push({
        id: rule.id,
        kind: 'static',
        files: population.length,
        hits,
        text: rule.message,
      })
    }

    out.constraints[constraintName] = {
      static_violations: staticViolations,
      static_rules: staticChecked,
      semantic_rules: semanticRules,
      files: matchedFiles,
    }
  }

  // The key is only emitted in sweep mode: it's what distinguishes the two outputs.
  if (sweep) out.sweep = sweepOut

  out.run_ts = runTs
  out.branch = branch

  // Diff hunks per file (git mode only) — provided here so the orchestrator doesn't have to
  // EITHER re-read whole files OR re-run git diff.
  out.diffs = {}
  if (gitMode) {
    for (const f of [...allMatched].sort()) {
      const hunks = git(['diff', 'HEAD', '--', f])
      if (hunks !== '') out.diffs[f] = hunks
    }
  }

  postProcess(out)

  process.stdout.write(JSON.stringify(out, null, 1) + '\n')
  return 0
}

process.exitCode = main(process.argv.slice(2))
