#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  checkerPrompt, chunk, DEFAULT_CONFIGS, jevPredictions, mustCells, parseCheckerResult,
  parseConfigs, renderMisses, renderTable, resolveExpected, score, summarize,
} from './lib.mjs'

const run = promisify(execFile)
const EVALS = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(EVALS)
const MATCHER = join(REPO, 'luciole/skills/verify/scripts/match-constraints.js')
const CONSTRAINT_CHECK = join(REPO, 'luciole/bin/constraint-check')
const CHECKER = readFileSync(join(REPO, 'luciole/agents/checker.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim()
const EXPECTED = JSON.parse(readFileSync(join(EVALS, 'fixtures/expected.json'), 'utf8'))

const USAGE = `
node evals/run.mjs [options]

Mesure le jugement sémantique de luciole sur les fixtures de evals/fixtures,
contre expected.json, par taille de lot, modèle et moteur.

  --configs=<list>     haiku, sonnet, opus, agent:<model>, jev, jev:<model> (défaut : ${DEFAULT_CONFIGS})
                       jev juge un fichier par requête : --sizes=1 suffit pour lui
  --sizes=<list>       tailles de lot (défaut : 1,2,5,10)
  --repeat=<n>         répétitions par cellule (défaut : 3)
  --concurrency=<n>    lots évalués en parallèle (défaut : 4)
  --dry-run            affiche le plan et le nombre d'appels, sans rien appeler

Moteur agent : le prompt de luciole/agents/checker.md, via \`claude -p --model\`, un appel par
groupe du matcher, comme le skill verify (sans inline). Moteur jev : constraint-check, qui lit
TYPESAFE_API_KEY dans l'environnement ou dans le .env.local du dépôt luciole.
`.trimStart()

function parseArgs(argv) {
  const o = { configs: DEFAULT_CONFIGS, sizes: '1,2,5,10', repeat: 3, concurrency: 4, dryRun: false }
  for (const arg of argv) {
    const [key, value] = arg.split(/=(.*)/s)
    if (key === '-h' || key === '--help') { process.stdout.write(USAGE); process.exit(0) }
    else if (key === '--configs') o.configs = value
    else if (key === '--sizes') o.sizes = value
    else if (key === '--repeat') o.repeat = Number(value)
    else if (key === '--concurrency') o.concurrency = Number(value)
    else if (key === '--dry-run') o.dryRun = true
    else throw new Error(`unknown option: ${arg}`)
  }
  return { ...o, configs: parseConfigs(o.configs), sizes: o.sizes.split(',').map(Number) }
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'luciole-eval-'))
  cpSync(join(EVALS, 'fixtures/project'), dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

function match(cwd, files) {
  return JSON.parse(execFileSync('node', [MATCHER, ...files], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
}

function jevEnv() {
  if (process.env.TYPESAFE_API_KEY) return process.env
  const local = join(REPO, '.env.local')
  const line = existsSync(local) && readFileSync(local, 'utf8').split('\n').find((l) => /^\s*TYPESAFE_API_KEY\s*=/.test(l))
  return line ? { ...process.env, TYPESAFE_API_KEY: line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') } : process.env
}

async function askChecker(cwd, group, model) {
  const args = [
    '-p', checkerPrompt(group), '--model', model, '--system-prompt', CHECKER,
    '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--setting-sources', 'project',
    '--no-session-persistence', '--output-format', 'json',
  ]
  try {
    const { stdout } = await run('claude', args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 })
    const out = JSON.parse(stdout)
    if (out.is_error) return { predictions: [], error: `claude: ${out.result}`, costUsd: out.total_cost_usd ?? 0 }
    return { ...parseCheckerResult(out.result ?? '', group), costUsd: out.total_cost_usd ?? 0 }
  } catch (error) {
    return { predictions: [], error: `claude: ${error.message.split('\n')[0]}`, costUsd: 0 }
  }
}

async function evalAgent(cwd, lot, config) {
  const groups = match(cwd, lot).agent_groups
  const results = await Promise.all(groups.map((g) => askChecker(cwd, g, config.model)))
  return {
    predictions: results.flatMap((r) => r.predictions),
    errors: results.filter((r) => r.error).map((r) => r.error),
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    calls: groups.length,
  }
}

async function evalJev(cwd, lot, config) {
  const args = [CONSTRAINT_CHECK, ...lot, '--json', '--semantic-only', ...(config.model ? [`--model=${config.model}`] : [])]
  let stdout
  try {
    ({ stdout } = await run('node', args, { cwd, env: jevEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 600_000 }))
  } catch (error) {
    stdout = error.stdout ?? ''
  }
  try {
    const doc = JSON.parse(stdout)
    return { predictions: jevPredictions(doc), errors: (doc.errors ?? []).map((e) => `jev: ${e.message}`), costUsd: null, calls: lot.length }
  } catch {
    return { predictions: [], errors: ['jev: unreadable output'], costUsd: null, calls: lot.length }
  }
}

async function pool(tasks, size) {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const cwd = workspace()
  try {
    const all = match(cwd, EXPECTED.files)
    const expected = resolveExpected(EXPECTED, all)

    const plan = []
    for (const config of options.configs) {
      for (const size of options.sizes) {
        for (let rep = 1; rep <= options.repeat; rep++) {
          for (const lot of chunk(EXPECTED.files, size)) plan.push({ config, size, rep, lot })
        }
      }
    }

    if (options.dryRun) {
      const calls = new Map()
      for (const p of plan) {
        const n = p.config.engine === 'agent' ? match(cwd, p.lot).agent_groups.length : p.lot.length
        calls.set(p.config.label, (calls.get(p.config.label) ?? 0) + n)
      }
      process.stdout.write(`${EXPECTED.files.length} fichiers, ${expected.size} violations attendues, ${mustCells(all).size} cellules MUST\n`)
      for (const [label, n] of calls) process.stdout.write(`${label} : ${n} appels\n`)
      return
    }

    process.stderr.write(`${plan.length} lots à évaluer…\n`)
    const runs = await pool(plan.map((p) => async () => {
      const started = Date.now()
      const result = p.config.engine === 'agent' ? await evalAgent(cwd, p.lot, p.config) : await evalJev(cwd, p.lot, p.config)
      const universe = mustCells(match(cwd, p.lot))
      const lotExpected = new Map([...expected].filter(([k]) => universe.has(k)))
      process.stderr.write('.')
      return {
        config: p.config.label, size: p.size, rep: p.rep, lot: p.lot,
        durationMs: Date.now() - started, ...result,
        score: score(result.predictions, lotExpected, universe),
      }
    }), options.concurrency)
    process.stderr.write('\n')

    const table = renderTable(summarize(runs))
    const errors = runs.flatMap((r) => r.errors.map((e) => `- ${r.config} · lot ${r.size} · rep ${r.rep} : ${e}`))
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const resultsDir = join(EVALS, 'results')
    mkdirSync(resultsDir, { recursive: true })
    const report = [
      `# Eval luciole · ${stamp}`, '', table, '',
      '## Erreurs de jugement', '', renderMisses(runs), '',
      ...(errors.length ? ['## Erreurs d\'exécution', '', ...errors, ''] : []),
    ].join('\n')
    writeFileSync(join(resultsDir, `${stamp}.md`), report)
    writeFileSync(join(resultsDir, `${stamp}.json`), JSON.stringify(runs, null, 2))
    process.stdout.write(`${table}\n\nDétail : evals/results/${stamp}.md\n`)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`eval: ${error.message}\n`)
  process.exit(2)
})
