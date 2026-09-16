#!/usr/bin/env node
// measure — step 4. Projects the live candidates into the input format of
// `measure-candidates`, runs the measurement, reports the verdicts back into the JSON.
//
// No judgment here, and above all no deletion: a verdict CLASSIFIES a rule, it does not
// decide its existence. The three negative verdicts send it back to `a-revoir`, for the
// substantive review (step 5) — the only place able to tell a false rule apart from a rule
// the measurement framed badly. A ratio can't make that distinction.
//
// Usage: node measure.mjs [--threshold R] [--min-population N] [--slug S]
//
// `--slug` restricts the measurement to one scope. That's what keeps the 6→4 loop workable
// once the run is split into commands: `/onboard:review entity` re-measures entity, and
// doesn't touch the JSON of other slugs — which another command may be fixing at the same time.
//
// `--min-population` with no explicit value is read per scope from `scopes.json`
// (`scope.minPopulation`). A small scope needs a proportional floor, and that floor must be
// FIXED, not recomputed from memory at every measurement: two runs under two different
// floors aren't comparable. The flag, if passed, wins everywhere.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { runEngine } from './lib/engine.mjs'
import { CANDIDATES_DIR, MEASURE_INPUT, MEASURES_FILE, loadCandidates, loadScopes, rules, saveCandidates } from './lib/candidates.mjs'

const argv = process.argv.slice(2)
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null)
const threshold = opt('--threshold')
const minPopulation = opt('--min-population')
const onlySlug = opt('--slug')

const minBySlug = new Map(loadScopes().filter((s) => s.minPopulation).map((s) => [s.slug, String(s.minPopulation)]))

const docs = loadCandidates().filter(({ doc }) => !onlySlug || doc?.scope?.slug === onlySlug)
const broken = docs.filter((d) => d.error)
if (broken.length > 0) {
  for (const d of broken) console.log(`${d.name} unreadable: ${d.error}`)
  process.exit(1)
}
if (docs.length === 0) {
  console.log(onlySlug ? `NO candidates/${onlySlug}.json` : `NO .json in ${CANDIDATES_DIR}`)
  process.exit(1)
}

// `retenu` AND `a-revoir`: the latter are the ones the review re-framed (a `gate` added,
// a probe fixed) and that must go through measurement again. A measurement recorded
// manually (`by: review`), on the other hand, is final: the probe must never overwrite it.
// To deliberately re-measure it after a change, the orchestrator first removes the
// `measure` field.
const MEASURABLE = ['retenu', 'a-revoir']
const shouldMeasure = (r) => MEASURABLE.includes(r.status) && r.measure?.by !== 'review'
const candidates = []
for (const { doc } of docs) {
  for (const r of rules(doc)) {
    if (!shouldMeasure(r)) continue
    const c = { id: r.id, slug: doc.scope.slug, text: `${r.strength}: ${r.rule}`, glob: doc.scope.glob, probe: r.probe }
    if (doc.scope.exclude) c.exclude = doc.scope.exclude
    candidates.push(c)
  }
}
if (candidates.length === 0) { console.log('measure: no candidate to measure'); process.exit(0) }

// A floor per scope means one call per distinct floor: `measure-candidates` takes
// `--min-population` as a global option. The reports are then merged back together — since
// an `id` belongs to only one scope, no collision is possible.
const groups = new Map()
for (const c of candidates) {
  const floor = minPopulation ?? minBySlug.get(c.slug) ?? null
  if (!groups.has(floor)) groups.set(floor, [])
  groups.get(floor).push(c)
}

console.log(`measure: ${candidates.length} candidate(s)${onlySlug ? ` for scope ${onlySlug}` : ''} in ${groups.size} pass(es)`)

const results = []
const passes = []
for (const [floor, group] of groups) {
  writeFileSync(MEASURE_INPUT, JSON.stringify({ root: '.', candidates: group }, null, 2))
  const args = [MEASURE_INPUT]
  if (threshold !== null) args.push('--threshold', threshold)
  if (floor !== null) args.push('--min-population', floor)
  let run
  try { run = runEngine('measure-candidates', args, { maxBuffer: 64 * 1024 * 1024 }) } catch (e) { console.log(e.message); process.exit(1) }
  if (run.error) { console.log(`measure-candidates failed to start: ${run.error.message}`); process.exit(1) }
  let out
  try { out = JSON.parse(run.stdout) } catch (e) {
    console.log(`unreadable measure-candidates output: ${e.message}\n${(run.stdout + run.stderr).slice(0, 2000)}`)
    process.exit(1)
  }
  results.push(...out.results)
  passes.push({ minPopulation: floor ?? out.options?.minPopulation ?? null, threshold: out.options?.threshold ?? null, slugs: [...new Set(group.map((c) => c.slug))], root: out.root, scanned: out.scanned })
}

// The input file is a buffer for one pass, not a deliverable: it only carries the last
// measured group and no one would ever re-read it. It's only removed here, once all
// passes succeeded — the error paths above leave it in place for diagnosis.
rmSync(MEASURE_INPUT, { force: true })

const counts = {}
for (const r of results) counts[r.verdict] = (counts[r.verdict] || 0) + 1
const report = { root: passes[0].root, scanned: passes[0].scanned, passes, counts, results }

// A measurement scoped to one slug must not erase the others: the report is merged with
// the existing one, line by line, otherwise Gate 2 would see a truncated report.
if (onlySlug) {
  try {
    const previous = JSON.parse(readFileSync(MEASURES_FILE, 'utf8'))
    const fresh = new Set(results.map((r) => r.id))
    report.results = [...(previous.results || []).filter((r) => !fresh.has(r.id)), ...results]
    report.counts = {}
    for (const r of report.results) report.counts[r.verdict] = (report.counts[r.verdict] || 0) + 1
    const keptPasses = (previous.passes || []).filter((p) => !p.slugs?.includes(onlySlug))
    report.passes = [...keptPasses, ...passes]
  } catch { /* no previous report: this one is authoritative */ }
}

writeFileSync(MEASURES_FILE, JSON.stringify(report, null, 2))

// The three verdicts that go back to review. They carry no `reason`: a `reason` is a
// rejection motive, and nothing is rejected here.
const TO_REVIEW = ['REFORMULATE', 'INSUFFICIENT', 'UNMEASURED']
const byId = new Map(report.results.map((r) => [r.id, r]))
const tally = {}

for (const { path, doc } of docs) {
  let touched = false
  for (const r of rules(doc)) {
    if (!shouldMeasure(r)) continue
    const m = byId.get(r.id)
    if (!m) { console.log(`  ⚠ ${r.id} missing from the measurement report`); continue }
    tally[m.verdict] = (tally[m.verdict] || 0) + 1
    touched = true

    // A kept rule that already carries a measurement AND `check: semantic` was demoted by the
    // review (findings-schema, "Demoting a static candidate"): the probe matched everything
    // but doesn't decide the statement. Same probe, same population → same STATIC verdict,
    // and re-deriving `check` from it would silently undo that decision on every `--slug`
    // pass of the 6→4 loop. A `reprobe` removes `measure`, so a new probe is re-derived.
    const demoted = r.status === 'retenu' && r.check === 'semantic' && r.measure !== undefined

    r.measure = { matched: m.conform, total: m.triggered ?? m.files, verdict: m.verdict }
    if (typeof m.files === 'number' && m.files !== r.measure.total) r.measure.population = m.files
    if (m.verdict === 'UNMEASURED') delete r.measure.matched

    if (TO_REVIEW.includes(m.verdict)) {
      r.status = 'a-revoir'
      // A re-measured rule can fall back to a-revoir after having been kept: its `check`
      // is no longer meaningful, and a `reason` inherited from a previous round would lie.
      delete r.check
      delete r.reason
      delete r.note
    } else {
      r.status = 'retenu'
      delete r.reason
      delete r.note
      // MUST/MUST NOT + STATIC → grep proposal; the review can downgrade it to semantic.
      // The matcher counts violations, not suggestions: a SHOULD is never executed.
      const soft = r.strength === 'SHOULD' || r.strength === 'SHOULD NOT'
      r.check = (m.verdict === 'STATIC' && !soft && !demoted) ? 'grep' : 'semantic'
    }

    // A note written by hand on a counter-example survives re-measurement: it's often the
    // only trace of the reason for the deviation (accepted exception vs debt to pay down).
    const AUTO = 'deviation found by the probe on the population'
    const kept = new Map((r.counterExamples || []).map((c) => [c.file, c.note]))
    r.counterExamples = (m.counterexamples || []).map((file) => ({
      file,
      note: kept.get(file) && kept.get(file) !== AUTO ? kept.get(file) : AUTO,
    }))
    if (r.check === 'grep') r.counterExamples = []
  }
  if (touched) saveCandidates(path, doc)
}

const review = TO_REVIEW.reduce((n, v) => n + (tally[v] || 0), 0)
console.log(`measure: threshold ${threshold ?? '0.9 (default)'}, floors ${passes.map((p) => `${p.slugs.join('+')}=${p.minPopulation ?? 'default'}`).join(' ')}`)
console.log(`measure: verdicts ${JSON.stringify(tally)} — report in ${MEASURES_FILE}`)
if (review > 0) console.log(`measure: ${review} rule(s) a-revoir — to be settled in the substantive review (step 5), none is discarded`)
