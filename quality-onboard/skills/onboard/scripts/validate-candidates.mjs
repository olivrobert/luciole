#!/usr/bin/env node
// validate-candidates — SHAPE check of the candidates JSON (steps 3, 6bis).
//
// It judges no rule: it checks the invariants listed at the end of
// references/candidate-schema.md, the ones a structure guarantees and that an agent
// therefore doesn't need to recheck by hand. Anything that involves judgment lives
// elsewhere — criteria.md for substance, measure-candidates for the ratio.
//
// Three phases, because the same fields are forbidden then required depending on the moment:
//   --phase pre       before measurement: no `check`, no `measure`, no `a-revoir`
//   --phase measured  after measurement: `a-revoir` expected, a kept rule is measured
//   --phase post      after the substantive review: no `a-revoir` survives
//
// Exit 0 if everything passes, 1 otherwise, with one line per error.
import {
  CANDIDATES_DIR, NATURES, REASONS, STATUSES, STRENGTHS,
  loadCandidates, rules,
} from './lib/candidates.mjs'
import { expandScope, repositoryFiles, scopePopulation } from './lib/globs.mjs'

const PHASES = ['pre', 'measured', 'post']
const argv = process.argv.slice(2)
const phase = argv.includes('--phase') ? argv[argv.indexOf('--phase') + 1] : 'post'
if (!PHASES.includes(phase)) {
  console.log(`validate-candidates: invalid --phase: ${phase} (expected ${PHASES.join(' | ')})`)
  process.exit(2)
}

const errors = []
const docs = loadCandidates()
if (docs.length === 0) {
  console.log(`NO .json in ${CANDIDATES_DIR}`)
  process.exit(1)
}

// The population is `glob - exclude` over the repository (or, on a pre-4.2 JSON, the
// enumerated `files` list). Every file a rule cites must belong to it, in every phase — so
// the walk happens whenever a document has no `files` to fall back on.
const allFiles = phase === 'pre' || docs.some(({ doc }) => !Array.isArray(doc?.scope?.files)) ? repositoryFiles() : []

function checkScopePopulation(sc, E) {
  if (typeof sc.glob !== 'string') return
  const exclude = sc.exclude === undefined ? [] : [].concat(sc.exclude)
  if (exclude.length === 0 && sc.exclude !== undefined) E('scope.exclude empty')
  if (!exclude.every((value) => typeof value === 'string' && value.length > 0)) {
    E('scope.exclude must be a non-empty glob or a list of non-empty globs')
    return
  }
  const expanded = expandScope(sc.glob, exclude, allFiles)
  if (Array.isArray(sc.files)) {
    const matched = new Set(expanded)
    const declared = new Set(sc.files)
    for (const file of expanded.filter((file) => !declared.has(file)).sort()) {
      E(`scope glob - exclude contains a file missing from scope.files: ${file}`)
    }
    for (const file of [...declared].filter((file) => !matched.has(file)).sort()) {
      E(`scope.files contains a file missing from glob - exclude: ${file}`)
    }
  } else if (!Number.isInteger(sc.population) || sc.population < 1) {
    E(`scope.population "${sc.population}" must be a positive integer`)
  } else if (sc.population !== expanded.length) {
    E(`scope.population ${sc.population} ≠ ${expanded.length} file(s) matched by glob - exclude`)
  }
}

// `sample` is what the generator READ, the population is what the measurement WALKS.
// Confusing the two is the segmentation trap: a `sample` that overflows the population
// produces out-of-scope `evidence`, and a `sample` equal to the population brings the
// generator back to reading 52 files — exactly what the cap exists to prevent.
const SAMPLE_MAX = 15

function checkScopeSample(sc, population, E) {
  if (!Array.isArray(sc.sample)) { if (sc.sample !== undefined) E('scope.sample non-array'); return }
  if (sc.sample.length === 0) { E('scope.sample empty'); return }
  if (sc.sample.length > SAMPLE_MAX) E(`scope.sample has ${sc.sample.length} files > ${SAMPLE_MAX}`)
  if (new Set(sc.sample).size !== sc.sample.length) E('scope.sample contains a duplicate')
  for (const file of sc.sample.filter((f) => !population.has(f)).sort()) {
    E(`scope.sample contains a file outside the population: ${file}`)
  }
}

// A probe is executed line by line by JS's RegExp engine, and becomes verbatim the
// pattern of the constraints file if the verdict is STATIC. These checks are the ones
// `constraint-lint` will apply later: doing them here avoids discovering at step 9 that
// a rule measured from the start was unexecutable.
function checkRegex(regex, label, R) {
  if (typeof regex !== 'string') { R(`${label}.regex absent`); return }
  if (regex.includes(' | ')) R(`${label}.regex contains the sequence " | "`)
  if (regex.includes('\n')) R(`${label}.regex contains a line break`)
  if (regex.includes('(?>')) R(`${label}.regex contains an atomic group (?>`)
  if (/[^\\]\+\+|[^\\]\*\+/.test(regex)) R(`${label}.regex contains a possessive quantifier`)
  // \A and \z are rejected by the engine, but `\\Application` is a literal backslash:
  // we track backslash parity instead of looking for the substring.
  for (let i = 0; i < regex.length; i++) {
    if (regex[i] !== '\\') continue
    const next = regex[i + 1]
    if (next === 'A' || next === 'z') { R(`${label}.regex contains \\${next}`); break }
    i++
  }
  if (regex !== regex.trim()) R(`${label}.regex not trimmed`)
  try { new RegExp(regex) } catch (e) { R(`${label}.regex does not compile: ${e.message}`) }
}

// A rule can have NO probe at all (criterion 9: inexpressible as regex): it will come out
// UNMEASURED at measurement time, and the substantive review will settle it. A probe that
// is present, though, must be complete and executable.
function checkProbe(probe, R) {
  if (probe === undefined) return
  if (!probe || typeof probe.regex !== 'string') { R('probe.regex absent'); return }
  checkRegex(probe.regex, 'probe', R)
  if (!['present', 'absent'].includes(probe.sense)) R(`probe.sense invalid: ${probe.sense}`)
  if (probe.gate !== undefined) {
    if (!probe.gate || typeof probe.gate !== 'object') { R('probe.gate is not an object'); return }
    checkRegex(probe.gate.regex, 'probe.gate', R)
    if (!['present', 'absent'].includes(probe.gate.sense)) R(`probe.gate.sense invalid: ${probe.gate.sense}`)
  }
}

// The fields the agent writes, required as soon as a rule is alive — kept or to review.
// A to-review rule that lost them could no longer be re-examined or re-measured.
function checkAuthored(r, R) {
  if (!STRENGTHS.includes(r.strength)) R(`strength invalid: ${r.strength}`)
  const distinct = new Set((r.evidence || []).map((e) => e.file))
  if (distinct.size < 2) R(`evidence < 2 distinct files (${distinct.size})`)
  if (!['invariant', 'coherence'].includes(r.rationale)) R(`rationale invalid: ${r.rationale}`)
  if (r.rationale === 'invariant' && !r.why) R('rationale invariant without why')
  if (!r.trigger) R('trigger absent')
  if (!r.anchor) R('anchor absent')
  if (!Array.isArray(r.counterExamples)) R('counterExamples absent (empty expected if none)')
  checkProbe(r.probe, R)
  if (r.automatable && r.via) R('automatable and via coexist')
  if (r.automatable) {
    if (!r.automatable.tool) R('automatable without tool')
    if (!NATURES.includes(r.automatable.nature)) {
      R(`automatable.nature "${r.automatable.nature}" invalid (${NATURES})`)
    } else if (r.automatable.nature !== 'rejette') {
      R('automatable on a live rule: nature must be "rejette" — a tool that rewrites makes the rule pointless (reason fixer)')
    }
  }
}

function checkMeasure(r, R) {
  const m = r.measure
  if (!m || typeof m.total !== 'number' || !m.verdict) { R('measure absent or incomplete — rule never measured'); return }
  // `matched` is missing on an UNMEASURED: the probe couldn't count anything. Elsewhere it's required.
  if (m.verdict !== 'UNMEASURED' && typeof m.matched !== 'number') R('measure.matched absent')
  if (m.by !== undefined && !['probe', 'review'].includes(m.by)) R(`measure.by invalid: ${m.by}`)
}

for (const { name, doc, error } of docs) {
  const E = (m) => errors.push(`${name} :: ${m}`)
  if (error) { E(`unreadable JSON: ${error}`); continue }

  const sc = doc.scope
  if (!sc) { E('scope absent'); continue }
  for (const k of ['slug', 'prefix', 'glob', 'marker', 'sample']) if (!sc[k]) E(`scope.${k} absent`)
  if (!Array.isArray(sc.files) && sc.population === undefined) E('scope.population absent')
  if (Array.isArray(sc.files) && sc.files.length === 0) E('scope.files empty')
  if (sc.prefix && !/^[A-Z]{2,5}$/.test(sc.prefix)) E(`scope.prefix "${sc.prefix}" does not match ^[A-Z]{2,5}$`)
  if (sc.slug && name !== `${sc.slug}.json`) E(`basename != scope.slug (${sc.slug})`)
  const inScope = new Set(scopePopulation(sc, allFiles))
  checkScopeSample(sc, inScope, E)
  if (phase === 'pre') checkScopePopulation(sc, E)

  if (!Array.isArray(doc.rules)) { E('rules absent or non-array'); continue }
  const ids = new Set()
  for (const r of rules(doc)) {
    const R = (m) => E(`${r.id || '(no id)'} — ${m}`)
    if (!r.id) R('id absent')
    else {
      if (!new RegExp(`^${sc.prefix}-[0-9]{3}$`).test(r.id)) R(`id does not match ^${sc.prefix}-[0-9]{3}$`)
      if (ids.has(r.id)) R('duplicate id')
      ids.add(r.id)
    }
    if (!STATUSES.includes(r.status)) R(`status invalid: ${r.status}`)
    if (typeof r.rule !== 'string' || !r.rule.trim()) R('rule absent')
    if (!Array.isArray(r.evidence)) R('evidence absent or non-array')

    for (const ev of [...(r.evidence || []), ...(r.counterExamples || [])]) {
      if (typeof ev !== 'object' || !ev || !ev.file) { R('evidence/counterExamples entry without file'); continue }
      if (!inScope.has(ev.file)) R(`file outside the scope population: ${ev.file}`)
    }

    if (r.status === 'retenu') {
      checkAuthored(r, R)
      if (phase === 'pre') {
        if (r.check || r.measure) R('check/measure set before measurement (step 4)')
      } else {
        if (!['grep', 'semantic'].includes(r.check)) R(`check absent or invalid: ${r.check} — rule never measured`)
        checkMeasure(r, R)
        // A `grep` is a mechanically executed pattern: it only exists at ratio 1, on a
        // blocking rule. Any other combination is a contradiction, not an edge case.
        if (r.check === 'grep') {
          if (!r.probe) R('check grep without probe — a grep is an executed pattern, it needs one')
          if (r.measure?.verdict !== 'STATIC') R('check grep without STATIC verdict')
          if (!['MUST', 'MUST NOT'].includes(r.strength)) R(`check grep with strength ${r.strength}`)
          if ((r.counterExamples || []).length > 0) R('check grep with non-empty counterExamples')
        }
      }
    }

    if (r.status === 'a-revoir') {
      if (phase === 'pre') R('status a-revoir before measurement — only step 4 sets it')
      // The rule survives the review entirely: that's what makes re-examination and
      // re-measurement possible. A truncated a-revoir is a lost rule.
      else if (phase === 'post') R('still a-revoir — the substantive review (step 5) must keep or discard it')
      else {
        checkAuthored(r, R)
        checkMeasure(r, R)
        if (r.check) R('check set on an a-revoir — its nature is not yet decided')
      }
    }

    if (r.status === 'ecarte') {
      if (!REASONS.includes(r.reason)) R(`reason invalid: ${r.reason}`)
      if (!r.note) R('note absent')
      if (['fixer', 'sans-sonde'].includes(r.reason)) {
        if (!r.automatable?.tool) R(`reason ${r.reason} without automatable.tool`)
        else if (!NATURES.includes(r.automatable.nature)) {
          R(`automatable.nature "${r.automatable.nature}" invalid (${NATURES})`)
        } else if (r.reason === 'fixer' && r.automatable.nature !== 'reecrit') {
          R('reason fixer: nature must be "reecrit" — a tool that rejects leaves the rule in the constraints (retenu + automatable)')
        }
      }
      if (r.reason === 'outillage' && r.automatable) R('reason outillage with automatable — nothing left to implement')
    }
  }
}

if (errors.length === 0) {
  console.log(`validate-candidates (${phase}): ${docs.length} file(s), OK`)
  process.exit(0)
}
console.log(`validate-candidates (${phase}): ${errors.length} error(s)`)
for (const e of errors) console.log(`  ${e}`)
process.exit(1)
