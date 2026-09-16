#!/usr/bin/env node
// render-review — step 10. Announces to the human what was rendered and where to read it.
// Rule details live in the constraints files: we don't copy them here.

import { loadCandidates, rules, scopeLabel } from './lib/candidates.mjs'

const docs = loadCandidates()
const broken = docs.filter((entry) => entry.error)
if (broken.length > 0) {
  for (const entry of broken) console.log(`${entry.name} unreadable: ${entry.error}`)
  process.exit(1)
}
if (docs.length === 0) {
  console.log('render-review: no candidates to present')
  process.exit(1)
}

const unresolved = docs.flatMap(({ name, doc }) => rules(doc)
  .filter((rule) => rule.status === 'a-revoir')
  .map((rule) => `${name} :: ${rule.id || '(no id)'}`))
if (unresolved.length > 0) {
  console.log('render-review: review impossible, some rules remain a-revoir')
  for (const item of unresolved) console.log(`  ${item}`)
  process.exit(1)
}

let total = 0
const lines = []

for (const { doc } of docs) {
  const kept = rules(doc).filter((rule) => rule.status === 'retenu')
  if (kept.length === 0) continue

  total += kept.length
  const statics = kept.filter((rule) => rule.check === 'grep').length
  const semantics = kept.filter((rule) => rule.check === 'semantic').length
  const detail = [
    statics > 0 ? `${statics} static` : null,
    semantics > 0 ? `${semantics} semantic` : null,
  ].filter(Boolean).join(', ')

  lines.push(`- ${scopeLabel(doc.scope)} — ${kept.length} rule(s)${detail ? ` (${detail})` : ''}`)
  lines.push(`  .claude/quality/code/constraints/${doc.scope.slug}.md`)
}

if (total === 0) {
  console.log('No rule kept to validate.')
  process.exit(1)
}

console.log('# Final human review')
console.log('')
console.log(`${total} rule(s) kept, spread across:`)
console.log('')
for (const line of lines) console.log(line)
console.log('')
console.log('Read these constraints files before validating — they are the deliverable.')
console.log('Without explicit validation, the run stops here.')
