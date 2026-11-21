const MODEL_SHORTCUTS = new Set(['haiku', 'sonnet', 'opus'])

export const DEFAULT_CONFIGS = 'haiku,sonnet'

export function parseConfigs(spec) {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((raw) => {
    if (MODEL_SHORTCUTS.has(raw)) return { label: raw, engine: 'agent', model: raw }
    const [engine, model] = raw.split(':')
    if (engine === 'agent' && model) return { label: raw, engine, model }
    if (engine === 'jev') return { label: raw, engine, model: model ?? null }
    throw new Error(`unknown config "${raw}" (expected haiku, sonnet, opus, agent:<model>, jev or jev:<model>)`)
  })
}

export function chunk(items, size) {
  const lots = []
  for (let i = 0; i < items.length; i += size) lots.push(items.slice(i, i + size))
  return lots
}

export const cellKey = (file, constraint, text) => `${file}\t${constraint}\t${text}`

export function splitKey(key) {
  const [file, constraint, text] = key.split('\t')
  return { file, constraint, text }
}

const isMust = (text) => text.startsWith('MUST')

export function mustCells(matched) {
  const cells = new Set()
  for (const [constraint, c] of Object.entries(matched.constraints ?? {})) {
    for (const text of (c.semantic_rules ?? []).filter(isMust)) {
      for (const file of c.files ?? []) cells.add(cellKey(file, constraint, text))
    }
  }
  return cells
}

// `rule` is a substring of the rule text: readable in expected.json, and checked unique here.
export function resolveExpected(expected, matched) {
  const keys = new Map()
  for (const v of expected.violations) {
    const rules = matched.constraints?.[v.constraint]?.semantic_rules ?? []
    const hits = rules.filter((text) => text.includes(v.rule))
    if (hits.length !== 1) throw new Error(`expected.json: "${v.rule}" matches ${hits.length} rules of ${v.constraint}`)
    if (!isMust(hits[0])) throw new Error(`expected.json: "${v.rule}" is not a MUST rule`)
    if (!(matched.constraints[v.constraint].files ?? []).includes(v.file)) {
      throw new Error(`expected.json: ${v.file} is not in the scope of ${v.constraint}`)
    }
    keys.set(cellKey(v.file, v.constraint, hits[0]), v.level ?? 'obvious')
  }
  return keys
}

export function checkerPrompt(group) {
  return [
    `## Constraint Group: ${group.constraints.join('+')}`,
    '',
    ...group.rules,
    '',
    'Files to check:',
    ...group.files.map((f) => `- ${f}`),
  ].join('\n')
}

function resolveFile(reported, files) {
  const clean = reported.replace(/^\.\//, '')
  return files.find((f) => clean === f || clean.endsWith(`/${f}`) || f.endsWith(`/${clean}`)) ?? clean
}

// Parses the `constraint-result` block of agents/checker.md. MUST violations only:
// SHOULD rules never block, so they stay out of the score.
export function parseCheckerResult(text, group) {
  const rules = new Map()
  for (const line of group.rules) {
    const m = line.match(/^#(\d+) \[([^\]]+)\] (.*)$/)
    if (m) rules.set(Number(m[1]), { constraint: m[2], text: m[3] })
  }
  const status = text.match(/^\s*status:\s*(PASS|FAIL|ERROR)\b/m)?.[1] ?? null
  if (status === null || status === 'ERROR') {
    return { predictions: [], error: status === null ? 'no constraint-result status' : 'checker reported ERROR' }
  }
  const predictions = []
  const violations = text.split(/^VIOLATIONS:\s*$/m)[1] ?? ''
  for (const line of violations.split('\n')) {
    const m = line.match(/^\s*[-*]\s+`?([^\s`:]+)`?(?::[^\s#]*)?\s*#(\d+)\b/)
    if (!m) continue
    const rule = rules.get(Number(m[2]))
    if (!rule || !isMust(rule.text)) continue
    predictions.push(cellKey(resolveFile(m[1], group.files), rule.constraint, rule.text))
  }
  return { predictions, error: null }
}

export function jevPredictions(doc) {
  const texts = new Map((doc.rules ?? []).map((r) => [r.rule, r]))
  const predictions = []
  for (const v of doc.semanticViolations ?? []) {
    const rule = texts.get(v.id)
    if (rule && isMust(rule.text)) predictions.push(cellKey(v.file, rule.constraint, rule.text))
  }
  return predictions
}

// `expected` maps each expected cell to its level (obvious or subtle).
export function score(predicted, expected, universe) {
  const p = new Set(predicted)
  const tp = [...p].filter((k) => expected.has(k))
  const fp = [...p].filter((k) => !expected.has(k))
  const fn = [...expected.keys()].filter((k) => universe.has(k) && !p.has(k))
  const subtle = (k) => expected.get(k) === 'subtle'
  return { tp: tp.length, fp, fn, tpSubtle: tp.filter(subtle).length, fnSubtle: fn.filter(subtle).length }
}

const pct = (num, den) => (den === 0 ? '—' : `${Math.round((100 * num) / den)} %`)

export function summarize(runs) {
  const rows = new Map()
  for (const run of runs) {
    const id = `${run.config}\t${run.size}`
    const row = rows.get(id) ?? { config: run.config, size: run.size, tp: 0, fp: 0, fn: 0, tpSubtle: 0, fnSubtle: 0, cost: 0, costKnown: true, durations: [], calls: 0, errors: 0, reps: new Set() }
    row.tp += run.score.tp
    row.tpSubtle += run.score.tpSubtle
    row.fnSubtle += run.score.fnSubtle
    row.fp += run.score.fp.length
    row.fn += run.score.fn.length
    row.calls += run.calls
    row.errors += run.errors.length
    row.durations.push(run.durationMs)
    row.reps.add(run.rep)
    if (run.costUsd === null) row.costKnown = false
    else row.cost += run.costUsd
    rows.set(id, row)
  }
  return [...rows.values()]
}

export function renderTable(rows) {
  const lines = [
    '| taille | config | précision | rappel | rappel subtil | VP | FP | FN | coût / campagne | durée moy. / lot | appels | erreurs |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const r of rows) {
    const cost = r.costKnown ? `$${(r.cost / r.reps.size).toFixed(3)}` : '—'
    const avg = r.durations.reduce((a, b) => a + b, 0) / r.durations.length
    lines.push(`| ${r.size} | ${r.config} | ${pct(r.tp, r.tp + r.fp)} | ${pct(r.tp, r.tp + r.fn)} | ${pct(r.tpSubtle, r.tpSubtle + r.fnSubtle)} | ${r.tp} | ${r.fp} | ${r.fn} | ${cost} | ${(avg / 1000).toFixed(1)} s | ${r.calls} | ${r.errors} |`)
  }
  return lines.join('\n')
}

export function renderMisses(runs) {
  const count = new Map()
  for (const run of runs) {
    for (const [kind, keys] of [['FN', run.score.fn], ['FP', run.score.fp]]) {
      for (const key of keys) {
        const id = `${run.config}\t${run.size}\t${kind}\t${key}`
        count.set(id, (count.get(id) ?? 0) + 1)
      }
    }
  }
  if (count.size === 0) return '_Aucune erreur de jugement._'
  return [...count.entries()].sort().map(([id, n]) => {
    const [config, size, kind, ...rest] = id.split('\t')
    const { file, constraint, text } = splitKey(rest.join('\t'))
    return `- ${kind} ×${n} · ${config} · lot ${size} · \`${file}\` · [${constraint}] ${text.slice(0, 90)}`
  }).join('\n')
}
