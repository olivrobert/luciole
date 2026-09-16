#!/usr/bin/env node
// verify-onboard — technical gate of the onboard skill (step 9), before human validation.
//
// It answers ONE question: "will what was just produced actually be enforced during
// review?" Three ways to miss that, all three silent:
//
//   1. the file deviates from the SPEC grammar → the matcher doesn't see the rule,
//      which remains perfectly readable to a human. `constraint-lint` is the judge here,
//      using the very library that will run the rules.
//   2. the rule was never measured → on a re-read, a convention verified against 66
//      files and a hunch drawn from 3 examples look exactly the same.
//   3. a rule stayed at `status: "a-revoir"` → the measurement sent it back to the
//      substantive review, which didn't settle it. It's rendered nowhere and discarded
//      by no one: it disappears without a decision. It's the only state whose being
//      forgotten erases step 5's work without leaving a trace.
//
// It does NOT judge the content of the rules (that's the substantive review, step 5) nor
// the shape of the project's skills (onboard no longer generates those).

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { runEngine } from './lib/engine.mjs'

const CONSTRAINTS_DIR = '.claude/quality/code/constraints'
const CANDIDATES_DIR = '.claude/quality/onboard/candidates'
const MEASURES_FILE = '.claude/quality/onboard/measures.json'

// A `## ` closes the semantic section, a `### ` stays inside it (SPEC §4).
const SEMANTIC_OPEN = /^##[ \t]+Semantic/
const SECTION_CLOSE = /^##[ \t]/
const SUBSECTION = /^###[ \t]/
// A bullet is only a rule if it matches this — everything else is ignored without a word.
const RULE_BULLET = /^[ \t]*-[ \t]+(MUST|SHOULD)/
const RATIO = /\(\d+\/\d+\)/
const RULES_OPEN = /^```rules$/
const FENCE_CLOSE = /^```$/

const errors = []
const warnings = []

function markdownFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...markdownFiles(full))
    else if (entry.isFile() && extname(entry.name) === '.md') out.push(full)
  }
  return out.sort()
}

// A file's semantic rules, in order, as the parser would see them.
function semanticRules(file) {
  const rules = []
  let inside = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (SEMANTIC_OPEN.test(line)) { inside = true; continue }
    if (inside && SECTION_CLOSE.test(line) && !SUBSECTION.test(line)) { inside = false; continue }
    if (inside && RULE_BULLET.test(line)) rules.push(line.trim())
  }
  return rules
}

// A file's static rules — `id | sense | regex | message | suffixes…`, one per line inside a
// ```rules fence. Same split as the engine's parseStaticRule (` | `); only the fields the
// join needs are kept.
function staticRules(file) {
  const out = []
  let inside = false
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (RULES_OPEN.test(line)) { inside = true; continue }
    if (inside && FENCE_CLOSE.test(line)) { inside = false; continue }
    if (!inside || line.trim() === '') continue
    const fields = line.split(' | ').map((f) => f.trim())
    const gate = fields.slice(4).find((f) => /^gate!?=/.test(f))
    out.push({ id: fields[0] || '', regex: fields[2] || '', gate: gate ? gate.replace(/^gate!?=/, '') : null })
  }
  return out
}

const files = markdownFiles(CONSTRAINTS_DIR)

// Onboard writes one `{slug}.md` per candidates JSON. Any other `.md` in the folder is
// hand-maintained (SPEC allows the two to coexist): it never went through measurement, so
// asking it for a ratio or a `measures.json` entry would block the run on a rule nobody
// can measure. It still passes `constraint-lint` — the matcher will read it like the others.
// Without any candidates JSON at all, every file is treated as onboarded, as before.
const slugs = new Set(existsSync(CANDIDATES_DIR)
  ? readdirSync(CANDIDATES_DIR).filter((f) => extname(f) === '.json').map((f) => basename(f, '.json'))
  : [])
const handMaintained = slugs.size > 0 ? files.filter((f) => !slugs.has(basename(f, '.md'))) : []
const onboarded = files.filter((f) => !handMaintained.includes(f))
if (handMaintained.length > 0) {
  warnings.push(`${handMaintained.length} hand-maintained file(s) — no candidates JSON, SPEC conformance checked only:\n  ${handMaintained.join('\n  ')}`)
}

// NO file is a case distinct from non-conformance: sending someone to fix a grammar on
// rules that don't exist would make them look for a defect where there is none.
if (files.length === 0) {
  errors.push(`NO .md file in ${CONSTRAINTS_DIR}/ — nothing was produced.`)
} else {
  let lint
  try { lint = runEngine('constraint-lint', [CONSTRAINTS_DIR, '--strict']) } catch (e) { lint = { error: e } }

  if (lint.error) {
    errors.push(`SPEC conformance could not be checked: ${lint.error.message}`)
  } else if (lint.status === 2) {
    // "nothing could be checked" != "no error": never render this as a format defect,
    // no one would find what to fix.
    errors.push(`constraint-lint inoperative (exit 2) — nothing could be checked.\n${(lint.stdout + lint.stderr).trim()}`)
  } else if (lint.status !== 0) {
    errors.push(`Constraint files not conformant to the SPEC:\n${(lint.stdout + lint.stderr).trim()}`)
  }
}

// Measurement: the trace that someone confronted these rules with the full population.
let measured = 0
let results = null
if (!existsSync(MEASURES_FILE)) {
  errors.push(`MISSING: ${MEASURES_FILE} — the rules were never measured.`)
} else {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(MEASURES_FILE, 'utf8'))
  } catch (e) {
    errors.push(`${MEASURES_FILE} unreadable: ${e.message}`)
  }
  results = Array.isArray(parsed?.results) ? parsed.results : []
  measured = results.length
  if (parsed && measured === 0) {
    // An empty file is a measurement that never happened, not a measurement with no candidates.
    errors.push(`${MEASURES_FILE} contains no result — the rules were never measured.`)
  }
}

// "measures.json has results" doesn't say THESE rules were measured: a report from another
// run, or a rule whose regex was edited after measurement, would pass. Each static rule is
// therefore joined to its result by `id`, and the regex (plus gate) must be the one that was
// measured — the render copies the probe as-is, so any drift means someone rewrote the rule
// without re-measuring. Semantic rules carry no id in the markdown; their ratio (below) is
// the only trace we can ask for.
const unmeasured = []
if (results && results.length > 0) {
  const byId = new Map(results.map((r) => [r.id, r]))
  for (const file of onboarded) {
    for (const rule of staticRules(file)) {
      const r = byId.get(rule.id)
      if (!r) { unmeasured.push(`${file} :: ${rule.id} — no result in ${MEASURES_FILE}`); continue }
      if (!r.probe || typeof r.probe.regex !== 'string') { unmeasured.push(`${file} :: ${rule.id} — result carries no probe`); continue }
      if (r.probe.regex !== rule.regex) unmeasured.push(`${file} :: ${rule.id} — regex differs from the measured one (${r.probe.regex})`)
      const gate = r.probe.gate?.regex ?? null
      if ((rule.gate ?? null) !== gate) unmeasured.push(`${file} :: ${rule.id} — gate differs from the measured one (${gate ?? 'none'})`)
    }
  }
}
if (unmeasured.length > 0) {
  errors.push(`${unmeasured.length} static rule(s) not backed by a measurement — re-run the measure (step 4) before rendering:\n  ${unmeasured.join('\n  ')}`)
}

// A semantic rule is measured by nothing at execution time: its ratio is the only trace
// that it was confronted with the population.
const noRatio = []
for (const file of onboarded) {
  for (const rule of semanticRules(file)) {
    if (!RATIO.test(rule)) noRatio.push(`${file} :: ${rule}`)
  }
}
if (noRatio.length > 0) {
  errors.push(`⚠ ${noRatio.length} semantic rule(s) without a ratio:\n  ${noRatio.join('\n  ')}`)
}

// `a-revoir` is a work-in-progress state set by the measurement and resolved by the
// substantive review. A single survivor is enough to silently leave the deliverable
// incomplete: nothing renders it, nothing discards it. Folder absent = project without
// candidates, that's not a defect.
const unresolved = []
if (existsSync(CANDIDATES_DIR)) {
  for (const name of readdirSync(CANDIDATES_DIR).filter((f) => extname(f) === '.json').sort()) {
    const path = join(CANDIDATES_DIR, name)
    let doc
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      errors.push(`${path} unreadable: ${e.message} — cannot attest that all rules were settled.`)
      continue
    }
    for (const rule of Array.isArray(doc?.rules) ? doc.rules : []) {
      if (rule?.status === 'a-revoir') unresolved.push(`${name} :: ${rule.id || '(no id)'} — ${rule.measure?.verdict || 'unknown verdict'}`)
    }
  }
}
if (unresolved.length > 0) {
  errors.push(`${unresolved.length} rule(s) still "a-revoir" — the substantive review (step 5) must keep or discard them:\n  ${unresolved.join('\n  ')}`)
}

const label = `${files.length} file(s), ${measured} rule(s) measured`
if (errors.length === 0) {
  console.log(`verify-onboard: ${label}, gate OK`)
  for (const w of warnings) console.log(w)
  process.exit(0)
}

console.log(`verify-onboard: ${label}, ${errors.length} blocker(s)`)
for (const e of errors) console.log(`\n${e}`)
for (const w of warnings) console.log(`\n${w}`)
process.exit(1)
