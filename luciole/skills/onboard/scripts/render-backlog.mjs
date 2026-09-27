#!/usr/bin/env node
// render-backlog — step 8. Projects rules carrying `automatable` into
// `lint-backlog.md`, following references/lint-backlog-format.md.
//
// No analysis: a cross-type projection of the candidates JSON. A single file for the
// whole project, because an analyzer or formatter is configured once, not once per
// file type.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BACKLOG_FILE, loadCandidates, rules } from './lib/candidates.mjs'

const HEADER = [
  '# Tooling backlog',
  '',
  'Rules observed in the code and implementable in tooling.',
  '',
  'A rule carried by a tool that **rejects** stays in `constraints/{slug}.md` once',
  'implemented: it moves to `via=` there, and its line here moves to `done`. A rule',
  'carried by a tool that **rewrites** is never entered into the constraints.',
  '',
  '| Type | Rule | Tool | Nature | Status |',
  '|---|---|---|---|---|',
]

const docs = loadCandidates()
const broken = docs.filter((d) => d.error)
if (broken.length > 0) {
  for (const d of broken) console.log(`${d.name} unreadable: ${d.error}`)
  process.exit(1)
}

// The `done` mark set by hand survives regeneration: on a `rewrites` line, nothing in the
// JSON can carry it, and rewriting it to `to do` would reopen an already-handled ticket.
const done = new Set()
if (existsSync(BACKLOG_FILE)) {
  for (const line of readFileSync(BACKLOG_FILE, 'utf8').split('\n')) {
    // `| a | b | c | d | e |` splits into SEVEN cells, both empty edges included:
    // the status is at index 5, not 6.
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length === 7 && cells[5] === 'done') done.add(`${cells[1]} ${cells[2]}`)
  }
}

const rows = []
for (const { doc } of docs) {
  const slug = doc.scope?.slug || '(sans slug)'
  for (const r of rules(doc)) {
    // A rule enters here as soon as it carries `automatable`, whatever its status — except
    // those discarded for a reason that leaves nothing to implement (`outillage` is already
    // covered). `fixer` and `sans-sonde` are tool-candidates: the rule is taken out of the
    // constraints, the tool remains to be written. An `a-revoir` doesn't enter: its fate
    // isn't decided.
    const eligible = r.status === 'retenu'
      || (r.status === 'ecarte' && ['fixer', 'sans-sonde'].includes(r.reason))
    if (!eligible) continue
    if (!r.automatable?.tool && !r.via) continue

    const tool = r.automatable?.tool || String(r.via).split(':')[0]
    const note = r.automatable?.note ? ` (${r.automatable.note})` : ''
    // A `via` rule without `automatable` is necessarily carried by a tool that rejects:
    // only that nature leaves the rule alive in the JSON (see lint-backlog-format.md).
    const nature = (r.automatable?.nature ?? 'rejette') === 'reecrit' ? 'rewrites' : 'rejects'
    const status = r.via || done.has(`${slug} ${r.rule}`) ? 'done' : 'to do'
    rows.push({ slug, rule: r.rule, tool: `${tool}${note}`, nature, status, sortTool: tool })
  }
}

if (rows.length === 0) {
  console.log('render-backlog: no toolable rule, file not produced')
  process.exit(0)
}

// Grouped by tool then by type: one tool configured at a time.
rows.sort((a, b) => a.sortTool.localeCompare(b.sortTool) || a.slug.localeCompare(b.slug) || a.rule.localeCompare(b.rule))

const lines = [...HEADER]
for (const r of rows) lines.push(`| ${r.slug} | ${r.rule} | ${r.tool} | ${r.nature} | ${r.status} |`)
lines.push('')
mkdirSync(dirname(BACKLOG_FILE), { recursive: true })
writeFileSync(BACKLOG_FILE, lines.join('\n'))
console.log(`${BACKLOG_FILE} — ${rows.length} line(s), ${rows.filter((r) => r.status === 'done').length} done`)
