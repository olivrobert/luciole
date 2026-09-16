// Paths to and access for the candidates JSON, shared by the skill's deterministic scripts.
//
// The paths are constants relative to cwd, never parameters: they are fixed by the format
// (see references/), and a script that accepted an arbitrary folder would allow producing
// constraints that the review would never look for.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CANDIDATES_DIR = '.claude/quality/onboard/candidates'
export const CONSTRAINTS_DIR = '.claude/quality/code/constraints'
export const BACKLOG_FILE = '.claude/quality/code/lint-backlog.md'
export const MEASURE_INPUT = '.claude/quality/onboard/measure-input.json'
export const MEASURES_FILE = '.claude/quality/onboard/measures.json'
// Minimal proof that a human validated the exact version of the rendered constraints.
// The hash it contains becomes stale as soon as a constraints file changes.
export const APPROVAL_FILE = '.claude/quality/onboard/approval.json'
// The scope contract, fixed once at step 1 and re-read by every subsequent command.
// Without it, each command would rediscover the scope — and two discoveries don't
// yield the same `sample`, nor the same `population` if the tree moved.
export const SCOPES_FILE = '.claude/quality/onboard/scopes.json'
// The reviewer's findings (step 5). They pass through disk, never through the
// orchestrator's context: that's what makes the run splittable into commands.
export const FINDINGS_DIR = '.claude/quality/onboard/findings'

export const STATUSES = ['retenu', 'a-revoir', 'ecarte']
export const STRENGTHS = ['MUST', 'MUST NOT', 'SHOULD', 'SHOULD NOT']
export const REASONS = [
  'outillage', 'fixer', 'sans-sonde', 'maker', 'une-seule-facon',
  'occurrence-unique', 'absence', 'incoherent', 'hors-perimetre',
]
// Nature of a tool referenced by `automatable`: `rejette` (blocking analyzer — the rule
// stays written, otherwise the generator stops applying it) or `reecrit` (formatter/fixer —
// the convention restores itself, the rule doesn't need to exist). The tool name itself is
// free-form: it's whatever the project uses, not a list maintained here.
export const NATURES = ['rejette', 'reecrit']

/** The candidates documents, sorted by filename. Empty if the folder doesn't exist. */
export function loadCandidates() {
  if (!existsSync(CANDIDATES_DIR)) return []
  const out = []
  for (const name of readdirSync(CANDIDATES_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(CANDIDATES_DIR, name)
    try {
      out.push({ name, path, doc: JSON.parse(readFileSync(path, 'utf8')) })
    } catch (e) {
      out.push({ name, path, error: e.message })
    }
  }
  return out
}

/** The `scope` contracts from step 1. Returns `[]` if the file is absent. */
export function loadScopes() {
  if (!existsSync(SCOPES_FILE)) return []
  const doc = JSON.parse(readFileSync(SCOPES_FILE, 'utf8'))
  return Array.isArray(doc?.scopes) ? doc.scopes : []
}

export function saveCandidates(path, doc) {
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n')
}

export function rules(doc) {
  return Array.isArray(doc?.rules) ? doc.rules : []
}

/** The human title of a scope: `scope.label` if it exists, otherwise the slug as-is. */
export function scopeLabel(scope) {
  return scope?.label || scope?.slug || '(no slug)'
}
