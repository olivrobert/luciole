#!/usr/bin/env node
// render-constraints — step 7. Generates `constraints/{slug}.md` from each candidates JSON,
// following references/constraint-format.md.
//
// The markdown is never edited by hand: it gets regenerated. That's also why the rendering
// doesn't decide anything — it projects, and flatly refuses to project unfinished work.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANDIDATES_DIR, CONSTRAINTS_DIR, loadCandidates, rules, scopeLabel } from './lib/candidates.mjs'

const docs = loadCandidates()
const broken = docs.filter((d) => d.error)
if (broken.length > 0) {
  for (const d of broken) console.log(`${d.name} unreadable: ${d.error}`)
  process.exit(1)
}
if (docs.length === 0) { console.log(`NO .json files in ${CANDIDATES_DIR}`); process.exit(1) }

// A rule still `a-revoir` at step 7 is not a rendering case: it's the in-depth review that
// didn't decide it. Rendering it would decide in its place, ignoring it would make it
// disappear without a decision. We refuse the whole run, before writing anything.
const unresolved = []
for (const { name, doc } of docs) {
  for (const r of rules(doc)) {
    if (r.status === 'a-revoir') unresolved.push(`${name} :: ${r.id} — ${r.measure?.verdict || 'unknown verdict'}`)
  }
}
if (unresolved.length > 0) {
  console.log(`render-constraints: ${unresolved.length} rule(s) still a-revoir — step 5 must decide them, nothing was written`)
  for (const u of unresolved) console.log(`  ${u}`)
  process.exit(1)
}

mkdirSync(CONSTRAINTS_DIR, { recursive: true })

for (const { doc } of docs) {
  const sc = doc.scope
  const kept = rules(doc).filter((r) => r.status === 'retenu')
  const statics = kept.filter((r) => r.check === 'grep')
  const semantics = kept.filter((r) => r.check === 'semantic')

  // A scope with no kept rule doesn't produce a file: an empty constraint isn't a
  // constraint, and `constraint-lint --strict` would have nothing to check there.
  // A file rendered by a PREVIOUS run is removed along the way: leaving it would keep a
  // rule the review just discarded enforceable, while the JSON says it isn't. Only the
  // flat `{slug}.md` this script owns is touched — hand-written constraints live in
  // subfolders (SPEC §1) and never share that name.
  if (kept.length === 0) {
    const stale = join(CONSTRAINTS_DIR, `${sc.slug}.md`)
    if (existsSync(stale)) {
      rmSync(stale)
      console.log(`${sc.slug}.md — no rule kept, stale file removed`)
    } else {
      console.log(`${sc.slug}.md — no rule kept, file not produced`)
    }
    continue
  }

  const L = ['---', 'paths:', `  - "${sc.glob}"`]
  if (sc.exclude) {
    L.push('exclude:')
    for (const e of [].concat(sc.exclude)) L.push(`  - "${e}"`)
  }
  L.push('---', '')
  L.push(`# Constraints — ${scopeLabel(sc)}`)
  L.push('')
  L.push(`Scope: \`${sc.glob}\` carrying \`${sc.marker}\`.`)
  if (Array.isArray(doc.tooling) && doc.tooling.length > 0) {
    L.push('')
    L.push(`Tooling checked: ${doc.tooling.map((t) => `\`${t}\``).join(', ')}. No rule below is covered by this tooling.`)
  }

  if (statics.length > 0) {
    L.push('', '## Static Rules', '', '```rules')
    for (const r of statics) {
      // The probe becomes the pattern AS-IS because the review kept check=grep.
      // The verdict establishes the ratio; the review establishes that it's enough to decide
      // the statement. Reworking it at render time would make it wrong.
      let line = `${r.id} | ${r.probe.sense} | ${r.probe.regex} | ${r.strength} ${r.rule}`
      // The gate travels with it, for the same reason: the STATIC verdict was established on
      // the population it carves out. Leaving it behind doesn't make the rule stricter, it
      // makes it wrong — any file outside the trigger would then flag as a violation.
      if (r.probe.gate) line += ` | gate${r.probe.gate.sense === 'absent' ? '!' : ''}=${r.probe.gate.regex}`
      if (r.via) line += ` | via=${r.via}`
      L.push(line)
    }
    L.push('```')
  }

  if (semantics.length > 0) {
    L.push('', '## Semantic Rules', '')
    for (const r of semantics) {
      const via = r.via ? ` [via=${r.via}]` : ''
      const coh = r.rationale === 'coherence' ? ' — coherence, non-blocking' : ''
      L.push(`- ${r.strength}${via}: ${r.rule}. Trigger: ${r.trigger}. Anchor: ${r.anchor}.${coh} (${r.measure.matched}/${r.measure.total})`)
    }
  }

  L.push('')
  writeFileSync(join(CONSTRAINTS_DIR, `${sc.slug}.md`), L.join('\n'))
  console.log(`${sc.slug}.md — ${statics.length} static, ${semantics.length} semantic`)
}
