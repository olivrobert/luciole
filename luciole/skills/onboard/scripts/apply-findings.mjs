#!/usr/bin/env node
// apply-findings — step 6. Carries a scope's findings into its candidates JSON.
//
// The reviewer judges, this script writes. Every `kind` maps to one fixed edit
// (references/findings-schema.md), so nothing here needs a model — and a model doing it
// did worse than nothing when it strayed: it silently swapped a `reason` the reviewer had
// chosen. A finding that can't be applied as written is refused, never adapted.
//
// All or nothing: one refused finding and the candidates JSON is left untouched, with every
// refusal listed — the admissible findings are still applied to a copy and checked, so the
// reviewer gets every problem in one pass. The result is checked
// with the same shape invariants as measure.mjs before it is written.
//
// Each applied round is archived under findings/rounds/{slug}.{n}.json. That is what makes
// the round limit hold across commands and interruptions: a rule already re-probed twice
// gets no third `reprobe`, the reviewer has to keep or discard it.
//
// Usage: node apply-findings.mjs --slug S
// Exit 0 when applied (or already applied), 1 when refused or unreadable.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANDIDATES_DIR, FINDINGS_DIR, REASONS, rules, saveCandidates } from './lib/candidates.mjs'
import { validateCandidates } from './lib/validate.mjs'

const ROUNDS_DIR = join(FINDINGS_DIR, 'rounds')
const KINDS = ['fix', 'keep', 'discard', 'reprobe']
const MAX_REPROBES = 2
// A `fix` never touches these: `rule` and `id` are the identity of what was measured
// (rewording or renumbering makes it another rule), `status` belongs to keep/discard,
// `measure` to keep or to the measurement, `probe` to reprobe — which also drops `measure`.
const UNFIXABLE = ['id', 'rule', 'status', 'measure', 'probe']

const argv = process.argv.slice(2)
const slug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
if (!slug) { console.log('apply-findings: --slug is required'); process.exit(1) }

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.log(`apply-findings: ${path} unreadable: ${error.message}`)
    process.exit(1)
  }
}

const candidatesPath = join(CANDIDATES_DIR, `${slug}.json`)
const findingsPath = join(FINDINGS_DIR, `${slug}.json`)
for (const path of [candidatesPath, findingsPath]) {
  if (!existsSync(path)) { console.log(`apply-findings: ${path} absent`); process.exit(1) }
}
const doc = readJson(candidatesPath)
const input = readJson(findingsPath)

const history = existsSync(ROUNDS_DIR)
  ? readdirSync(ROUNDS_DIR)
    .map((name) => name.match(new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.json$`)))
    .filter(Boolean)
    .map((m) => ({ round: Number(m[1]), findings: readJson(join(ROUNDS_DIR, m[0])) }))
    .sort((a, b) => a.round - b.round)
  : []
const round = history.length + 1

// Re-running the same findings is a no-op, not a new round: a second `reprobe` pass would
// strip measurements again and count against the limit for nothing.
const last = history.at(-1)
if (last && JSON.stringify(last.findings) === JSON.stringify(input)) {
  console.log(`apply-findings: findings of ${slug} already applied (round ${last.round}), nothing to do`)
  process.exit(0)
}

const reprobes = new Map()
for (const { findings } of history) {
  for (const f of findings.findings || []) {
    if (f.kind === 'reprobe') reprobes.set(f.id, (reprobes.get(f.id) || 0) + 1)
  }
}

const errors = []
const byId = new Map(rules(doc).map((r) => [r.id, r]))
const findings = Array.isArray(input.findings) ? input.findings : null
if (input.slug !== undefined && input.slug !== slug) errors.push(`findings slug "${input.slug}" ≠ ${slug}`)
if (!findings) errors.push('findings absent or non-array')

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const seen = new Set()
const refused = new Set()
for (const f of findings || []) {
  const F = (m) => { errors.push(`${f?.id || '(no id)'} — ${m}`); refused.add(f) }
  if (!isRecord(f)) { errors.push('finding is not an object'); refused.add(f); continue }
  if (!byId.has(f.id)) { F('no such rule in the candidates'); continue }
  if (seen.has(f.id)) F('several findings on the same rule — one judgment per rule')
  seen.add(f.id)
  if (!KINDS.includes(f.kind)) { F(`kind invalid: ${f.kind} (${KINDS})`); continue }
  if (typeof f.why !== 'string' || !f.why.trim()) F('why absent')
  const c = f.change
  if (!isRecord(c)) { F('change absent'); continue }

  if (f.kind === 'fix') {
    if (typeof c.field !== 'string' || !c.field) F('fix without change.field')
    else if (UNFIXABLE.includes(c.field.split('.')[0])) {
      F(`fix on ${c.field} refused — ${c.field.startsWith('probe') ? 'a new probe is a reprobe' : 'not a field a fix may change'}`)
    }
    if (c.value === undefined) F('fix without change.value (null removes the field)')
  }
  if (f.kind === 'keep') {
    const m = c.measure
    if (!isRecord(m) || typeof m.matched !== 'number' || typeof m.total !== 'number' || !m.verdict) {
      F('keep without a complete measure { matched, total, verdict }')
    }
  }
  if (f.kind === 'discard') {
    if (!REASONS.includes(c.reason)) F(`discard reason invalid: ${c.reason}`)
    if (typeof c.note !== 'string' || !c.note.trim()) F('discard without note')
  }
  if (f.kind === 'reprobe') {
    if (!isRecord(c.probe)) F('reprobe without change.probe')
    if ((reprobes.get(f.id) || 0) >= MAX_REPROBES) {
      F(`reprobe #${reprobes.get(f.id) + 1} refused — ${MAX_REPROBES} re-measurements are the limit, keep or discard it`)
    }
  }
}
for (const r of rules(doc)) {
  if (r.status === 'a-revoir' && !seen.has(r.id)) errors.push(`${r.id} — a-revoir without a finding: every one must be resolved`)
}

function setPath(target, path, value) {
  const keys = path.split('.')
  const leaf = keys.pop()
  let node = target
  for (const k of keys) {
    if (!isRecord(node[k])) node[k] = {}
    node = node[k]
  }
  if (value === null) delete node[leaf]
  else node[leaf] = value
}

const counts = { applied: 0, reprobe: 0 }
const unprobed = []
const draft = structuredClone(doc)
if (findings) {
  const draftById = new Map(rules(draft).map((r) => [r.id, r]))
  for (const f of findings) {
    if (refused.has(f)) continue
    const r = draftById.get(f.id)
    const c = f.change
    if (f.kind === 'fix') setPath(r, c.field, c.value)
    if (f.kind === 'keep') {
      r.status = 'retenu'
      r.check = 'semantic'
      r.measure = { ...c.measure, by: 'review' }
      delete r.reason
      if (!r.probe) unprobed.push(r)
    }
    if (f.kind === 'discard') {
      r.status = 'ecarte'
      r.reason = c.reason
      r.note = c.note
      if (c.automatable !== undefined) r.automatable = c.automatable
      // Already covered by tooling: neither a constraint nor a backlog line comes out of it.
      if (c.reason === 'outillage') delete r.automatable
    }
    if (f.kind === 'reprobe') {
      r.probe = c.probe
      delete r.measure
      counts.reprobe++
    }
    counts.applied++
  }
  for (const e of validateCandidates([{ name: `${slug}.json`, doc: draft }], 'remeasure')) errors.push(e)
}

if (errors.length > 0) {
  console.log(`apply-findings (round ${round}): ${errors.length} refusal(s), nothing was written — send them back to the reviewer`)
  for (const e of errors) console.log(`  ${e}`)
  process.exit(1)
}

saveCandidates(candidatesPath, draft)
mkdirSync(ROUNDS_DIR, { recursive: true })
writeFileSync(join(ROUNDS_DIR, `${slug}.${round}.json`), JSON.stringify(input, null, 2) + '\n')

const pending = rules(draft).filter((r) => r.status === 'a-revoir').length
console.log(`apply-findings (round ${round}): ${counts.applied} applied, ${counts.reprobe} reprobe, ${pending} a-revoir remaining`)
if (unprobed.length > 0) {
  console.log(`no probe: ${unprobed.map((r) => r.id).join(', ')}`)
  for (const r of unprobed) console.log(`  ${r.id}: ${r.rule}`)
}
