#!/usr/bin/env node
// validate-candidates — SHAPE check of the candidates JSON, on demand.
//
// measure.mjs and render.mjs already run the same check as a precondition and refuse to
// write on a malformed file: this CLI is for inspecting a state by hand, or for a
// consumer that isn't one of them. The invariants and the phases live in lib/validate.mjs.
//
//   --phase pre        before measurement: no `check`, no `measure`, no `a-revoir`
//   --phase measured   after measurement: `a-revoir` expected, a kept rule is measured
//   --phase remeasure  input of a re-measurement: a rule a `reprobe` stripped is accepted
//   --phase post       after the substantive review: no `a-revoir` survives (default)
//
// Exit 0 if everything passes, 1 otherwise, with one line per error, 2 on a bad flag.
import { CANDIDATES_DIR, loadCandidates } from './lib/candidates.mjs'
import { PHASES, validateCandidates } from './lib/validate.mjs'

const argv = process.argv.slice(2)
const phase = argv.includes('--phase') ? argv[argv.indexOf('--phase') + 1] : 'post'
if (!PHASES.includes(phase)) {
  console.log(`validate-candidates: invalid --phase: ${phase} (expected ${PHASES.join(' | ')})`)
  process.exit(2)
}

const docs = loadCandidates()
if (docs.length === 0) {
  console.log(`NO .json in ${CANDIDATES_DIR}`)
  process.exit(1)
}

const errors = validateCandidates(docs, phase)
if (errors.length === 0) {
  console.log(`validate-candidates (${phase}): ${docs.length} file(s), OK`)
  process.exit(0)
}
console.log(`validate-candidates (${phase}): ${errors.length} error(s)`)
for (const e of errors) console.log(`  ${e}`)
process.exit(1)
