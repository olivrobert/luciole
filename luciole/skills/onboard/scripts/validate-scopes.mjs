#!/usr/bin/env node
// validate-scopes — FORM check of the scope contract (step 1).
//
// It runs BEFORE any agent is launched. That's its whole point: a wrong `glob` discovered
// at step 3 has already cost N generators, and a duplicated `slug` has already
// overwritten a candidates file.
//
// It doesn't judge the split — "should there be a `handler` scope?" isn't a question for
// a script. It checks that what's declared is consistent with the repository.
//
// Exit 0 if everything passes, 1 otherwise, with one line per error.
import { existsSync, readFileSync } from 'node:fs'
import { SCOPES_FILE } from './lib/candidates.mjs'
import { expandScope, repositoryFiles, scopePopulation } from './lib/globs.mjs'
import { engineErrors } from './lib/engine.mjs'

// The engine is needed at step 4 (measure) and step 9 (gate). Discovering that there is
// what costs the most: N generators have already run. So the first script of the run
// checks it, before anything else — a wrong PATH is fixed in ten seconds now, not after.
const missing = engineErrors()
if (missing.length > 0) {
  for (const m of missing) console.log(m)
  process.exit(1)
}

const SAMPLE_MAX = 15
const MIN_FILES = 5

if (!existsSync(SCOPES_FILE)) {
  console.log(`${SCOPES_FILE} missing — step 1 didn't write it`)
  process.exit(1)
}

let doc
try { doc = JSON.parse(readFileSync(SCOPES_FILE, 'utf8')) } catch (e) {
  console.log(`${SCOPES_FILE} unreadable: ${e.message}`)
  process.exit(1)
}

const scopes = Array.isArray(doc?.scopes) ? doc.scopes : null
if (!scopes) { console.log(`${SCOPES_FILE}: "scopes" field missing or not an array`); process.exit(1) }
if (scopes.length === 0) { console.log(`${SCOPES_FILE}: no scope`); process.exit(1) }

const errors = []
const allFiles = repositoryFiles()
const slugs = new Set()
const prefixes = new Set()
const sizes = new Map()

for (const [index, sc] of scopes.entries()) {
  const label = sc?.slug || `scopes[${index}]`
  const E = (m) => errors.push(`${label} :: ${m}`)

  for (const k of ['slug', 'prefix', 'glob', 'marker', 'sample', 'model']) {
    if (!sc?.[k]) E(`${k} absent`)
  }
  if (!sc) continue
  // `population` is the size of `glob - exclude`, counted by the orchestrator at step 1. The
  // enumerated `files` list is the pre-4.2 form of the same contract: still accepted, never
  // written anymore — a 500-file scope cost 6k tokens per copy, and it was copied three times.
  const legacy = Array.isArray(sc.files)
  if (!legacy && sc.population === undefined) E('population absent')

  if (sc.slug && !/^[a-z][a-z0-9-]*$/.test(sc.slug)) E(`slug "${sc.slug}" doesn't match ^[a-z][a-z0-9-]*$`)
  if (sc.slug && slugs.has(sc.slug)) E(`slug "${sc.slug}" duplicated — the second would overwrite the first's JSON`)
  if (sc.slug) slugs.add(sc.slug)

  if (sc.prefix && !/^[A-Z]{2,5}$/.test(sc.prefix)) E(`prefix "${sc.prefix}" doesn't match ^[A-Z]{2,5}$`)
  // Two scopes sharing a prefix produce ambiguous IDs: `measure` indexes them by id alone,
  // an ENT-001 from two different files would overwrite each other.
  if (sc.prefix && prefixes.has(sc.prefix)) E(`prefix "${sc.prefix}" already used by another scope`)
  if (sc.prefix) prefixes.add(sc.prefix)

  if (sc.exclude !== undefined) {
    const exclude = [].concat(sc.exclude)
    if (exclude.length === 0) E('exclude empty')
    if (!exclude.every((v) => typeof v === 'string' && v.length > 0)) {
      E('exclude must be a non-empty glob or a list of non-empty globs')
    }
  }

  const expanded = typeof sc.glob === 'string' ? expandScope(sc.glob, sc.exclude, allFiles) : []
  const population = new Set(scopePopulation(sc, allFiles))
  if (typeof sc.glob === 'string') {
    if (expanded.length < MIN_FILES) E(`${expanded.length} file(s) < ${MIN_FILES} — out of onboard scope`)
    if (legacy) {
      for (const file of expanded.filter((f) => !population.has(f)).sort()) {
        E(`glob - exclude contains a file missing from files: ${file}`)
      }
      const matched = new Set(expanded)
      for (const file of [...population].filter((f) => !matched.has(f)).sort()) {
        E(`files contains a file missing from glob - exclude: ${file}`)
      }
    } else if (sc.population !== undefined) {
      // The count came from the orchestrator's own glob at step 1. A mismatch means the
      // written `glob`/`exclude` is not the one it looked at — the same wrong-scope signal
      // the enumerated list used to give, at the price of one integer.
      if (!Number.isInteger(sc.population) || sc.population < 1) {
        E(`population "${sc.population}" must be a positive integer`)
      } else if (sc.population !== expanded.length) {
        E(`population ${sc.population} ≠ ${expanded.length} file(s) matched by glob - exclude`)
      }
    }
  }

  if (Array.isArray(sc.sample)) {
    if (sc.sample.length === 0) E('sample empty')
    if (sc.sample.length > SAMPLE_MAX) E(`sample has ${sc.sample.length} files > ${SAMPLE_MAX}`)
    if (new Set(sc.sample).size !== sc.sample.length) E('sample contains a duplicate')
    for (const file of sc.sample.filter((f) => !population.has(f)).sort()) {
      E(`sample contains a file outside the population: ${file}`)
    }
  } else if (sc.sample !== undefined) E('sample not an array')

  // A model out of scope would show a shape that the scope's constraints don't govern.
  if (sc.model !== undefined) {
    if (typeof sc.model !== 'string' || sc.model.length === 0) {
      E('model must be a non-empty path')
    } else if (!population.has(sc.model)) {
      E(`model "${sc.model}" outside the population`)
    } else if (Array.isArray(sc.sample) && !sc.sample.includes(sc.model)) {
      // The model is what a human designated as the reference shape: the generator must
      // have read it, otherwise the rules describe a shape the skill doesn't show.
      E(`model "${sc.model}" missing from sample — the generator won't read it`)
    }
  }

  // The population floor is settled here, once, and not recalculated off the top of one's
  // head at every measurement: two runs applying two different floors aren't comparable.
  if (sc.minPopulation !== undefined) {
    if (!Number.isInteger(sc.minPopulation) || sc.minPopulation < 2) {
      E(`minPopulation "${sc.minPopulation}" must be an integer >= 2`)
    } else if (population.size > 0 && sc.minPopulation > population.size) {
      E(`minPopulation ${sc.minPopulation} > ${population.size} files — no rule can pass`)
    }
  }
  sizes.set(sc.slug, population.size)
}

for (const e of errors) console.log(e)
if (errors.length > 0) { console.log(`\n${errors.length} error(s) in ${SCOPES_FILE}`); process.exit(1) }
console.log(`validate-scopes: ${scopes.length} scope(s) — ${scopes.map((s) => `${s.slug} (${s.sample.length}/${sizes.get(s.slug)})`).join(', ')}`)
