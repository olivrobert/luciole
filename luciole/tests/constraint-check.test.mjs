import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadApiKey, parseArgs } from '../bin/lib/constraint-check/index.mjs'
import { FORMAT, renderVerdict } from '../bin/lib/constraint-check/report.mjs'
import { buildQuestions, readAnswers } from '../bin/lib/constraint-check/questions.mjs'
import { parseSemanticRule } from '../bin/lib/constraint-check/rules.mjs'
import projectPaths from '../lib/project-paths.js'
import ruleStats from '../bin/lib/rule-stats.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'bin', 'constraint-check')
const RENDER = join(ROOT, 'bin', 'constraint-report')

test('QUALITY_ROOT resolution prefers the process environment over .luciole.env', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-root-'))
  writeFileSync(
    join(root, '.luciole.env'),
    'QUALITY_ROOT="from-config"\nQUALITY_VERIFY_ENGINE="jev"\n',
  )

  assert.equal(projectPaths.qualityRoot({ QUALITY_ROOT: '' }, root), join(root, 'from-config'))
  assert.equal(projectPaths.qualityRoot({ QUALITY_ROOT: 'from-environment' }, root), 'from-environment')
  assert.equal(projectPaths.verifyEngine({ QUALITY_VERIFY_ENGINE: '' }, root), 'jev')
  assert.equal(projectPaths.verifyEngine({ QUALITY_VERIFY_ENGINE: 'agent' }, root), 'agent')
})

test('.luciole.local.env overrides .luciole.env key by key', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-root-'))
  writeFileSync(join(root, '.luciole.env'), 'QUALITY_ROOT="shared"\nQUALITY_VERIFY_ENGINE="agent"\n')
  writeFileSync(join(root, '.luciole.local.env'), 'QUALITY_VERIFY_ENGINE="jev"\n')
  const nested = join(root, 'src', 'Domain')
  mkdirSync(nested, { recursive: true })

  assert.equal(projectPaths.qualityRoot({}, nested), join(root, 'shared'))
  assert.equal(projectPaths.verifyEngine({}, nested), 'jev')
  assert.equal(projectPaths.verifyEngine({ QUALITY_VERIFY_ENGINE: 'agent' }, nested), 'agent')

  writeFileSync(join(root, '.luciole.local.env'), 'QUALITY_ROOT="mine"\n')
  assert.equal(projectPaths.qualityRoot({}, nested), join(root, 'mine'))
  assert.equal(projectPaths.verifyEngine({}, nested), 'agent')
})

test('a lone .luciole.local.env is enough, and falls back to defaults for missing keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'quality-root-'))
  writeFileSync(join(root, '.luciole.local.env'), 'QUALITY_VERIFY_ENGINE="jev"\n')

  assert.equal(projectPaths.qualityRoot({}, root), projectPaths.DEFAULT_QUALITY_ROOT)
  assert.equal(projectPaths.verifyEngine({}, root), 'jev')

  writeFileSync(join(root, '.luciole.env'), 'QUALITY_VERIFY_ENGINE="jev"\n')
  assert.throws(() => projectPaths.qualityRoot({}, root), /\.luciole\.env: QUALITY_ROOT must be a non-empty value/)
})

test('JEV output uses the same verdict block as agent verification', () => {
  const block = renderVerdict({ success: false, violations: 2, warnings: 1 })
  assert.equal(block, '```json:verdict\n{"success":false,"violations":2,"warnings":1}\n```\n')
})

test('semantic rules become independent trigger and compliance questions', () => {
  const rule = parseSemanticRule(
    'MUST: handlers return the entity. Trigger: a command is handled. Anchor: the return statement — coherence (12/12)',
  )
  const questions = buildQuestions([rule])

  assert.equal(rule.severity, 'MUST')
  assert.equal(rule.trigger, 'a command is handled')
  assert.equal(rule.anchor, 'the return statement')
  assert.deepEqual(rule.sample, { hits: 12, total: 12 })
  assert.deepEqual(Object.keys(questions), ['t0', 'c0'])
})

test('probabilities are recomposed into a violation only when the trigger applies', () => {
  const rules = [{ trigger: 'a relevant call' }]
  const thresholds = { violationThreshold: 0.7, triggerThreshold: 0.5, uncertainThreshold: 0.5 }

  assert.equal(readAnswers({ t0: 0.8, c0: 0.2 }, rules, thresholds)[0].status, 'violation')
  assert.equal(readAnswers({ t0: 0.2, c0: 0.1 }, rules, thresholds)[0].status, 'skipped')
  assert.equal(readAnswers({ t0: 0.9, c0: 0.4 }, rules, thresholds)[0].status, 'uncertain')
})

test('the API key comes from the environment first, then the checked project .env.local', () => {
  const cwd = process.cwd()
  const previous = process.env.TYPESAFE_API_KEY
  const root = mkdtempSync(join(tmpdir(), 'constraint-check-key-'))
  writeFileSync(join(root, '.env.local'), 'OTHER=value\nTYPESAFE_API_KEY="local-test-key"\n')

  try {
    process.chdir(root)
    delete process.env.TYPESAFE_API_KEY
    loadApiKey()
    assert.equal(process.env.TYPESAFE_API_KEY, 'local-test-key')

    process.env.TYPESAFE_API_KEY = 'environment-test-key'
    loadApiKey()
    assert.equal(process.env.TYPESAFE_API_KEY, 'environment-test-key')
  } finally {
    process.chdir(cwd)
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = previous
  }
})

test('CLI resolves its bundled matcher and builds a dry-run without an API key', () => {
  const root = mkdtempSync(join(tmpdir(), 'constraint-check-cli-'))
  const constraints = join(root, '.quality-artifacts', 'code', 'constraints')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(constraints, { recursive: true })
  writeFileSync(join(root, 'src', 'Handler.php'), '<?php\nfinal class Handler {}\n')
  writeFileSync(join(root, '.luciole.env'), 'QUALITY_ROOT=".quality-artifacts"\n')
  writeFileSync(join(constraints, 'handler.md'), `---
paths:
  - "src/**/*Handler.php"
---
## Semantic Rules
- MUST: handlers are final. Trigger: a handler class is declared. Anchor: final class
`)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })

  const result = spawnSync(process.execPath, [CLI, '--dry-run', 'src/Handler.php'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, QUALITY_ROOT: '', TYPESAFE_API_KEY: '' },
  })

  assert.equal(result.status, 0, result.stderr)
  const jobs = JSON.parse(result.stdout)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].file, 'src/Handler.php')
  assert.deepEqual(Object.keys(jobs[0].questions), ['t0', 'c0'])
})

test('CLI help documents API key discovery', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /TYPESAFE_API_KEY/)
  assert.match(result.stdout, /QUALITY_ROOT/)
  assert.match(result.stdout, /\.env\.local/)
  assert.equal(parseArgs(['--dry-run']).dryRun, true)
})

test('compliance questions preserve the modality, including both negative severities', () => {
  for (const severity of ['MUST', 'MUST NOT', 'SHOULD', 'SHOULD NOT']) {
    const rule = parseSemanticRule(`${severity}: Depend on infrastructure classes`)
    assert.ok(buildQuestions([rule]).c0.instructions.includes(`${severity}: Depend on infrastructure classes`))
  }
})

test('missing, malformed and out-of-range probabilities cannot become clean or N/A', () => {
  const rules = [{ trigger: 'a relevant call' }]
  const thresholds = { violationThreshold: 0.7, triggerThreshold: 0.5, uncertainThreshold: 0.5 }
  for (const answers of [null, {}, { c0: 0.99 }, { t0: 0.01 }]) {
    assert.throws(() => readAnswers(answers, rules, thresholds), /Missing or invalid Noul/)
  }
  for (const value of [-0.1, 1.1, NaN, Infinity, '0.9', {}, null]) {
    assert.throws(() => readAnswers({ t0: 0.99, c0: value }, rules, thresholds), /invalid Noul answer c0/)
    assert.throws(() => readAnswers({ t0: value, c0: 0.99 }, rules, thresholds), /invalid Noul answer t0/)
  }
  assert.equal(readAnswers({ t0: { noul: 0.01 }, c0: { noul: 0.01 } }, rules, thresholds)[0].status, 'skipped')
})

// Exercise the real matcher, HTTP client, report writer and exit status. Only fetch is
// replaced, so tests never use a live service or the developer's API key.
function checkProject({ semantic = 'MUST: handlers are final. Trigger: a handler class is declared. Anchor: final class',
  staticRules = '', content = '<?php\nfinal class Handler {}\n', apiKey = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'constraint-check-gate-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.quality-artifacts/code/constraints'), { recursive: true })
  writeFileSync(join(root, '.luciole.env'), 'QUALITY_ROOT=".quality-artifacts"\nQUALITY_VERIFY_ENGINE="jev"\n')
  if (apiKey) writeFileSync(join(root, '.env.local'), 'TYPESAFE_API_KEY=fixture-key\n')
  writeFileSync(join(root, 'src/Handler.php'), content)
  writeFileSync(join(root, '.quality-artifacts/code/constraints/handler.md'), `---
paths:
  - "src/**/*.php"
---
## Static Rules
\`\`\`rules
${staticRules}
\`\`\`
## Semantic Rules
${semantic ? `- ${semantic}` : ''}
`)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '-A'], { cwd: root })
  return root
}

function check(root, args = [], { body = { answers: { t0: { noul: 0.99 }, c0: { noul: 0.99 } } },
  status = 200, cwd = root } = {}) {
  const mock = join(root, 'mock-fetch.mjs')
  writeFileSync(mock, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  appendFileSync(${JSON.stringify(join(root, 'requests.jsonl'))}, JSON.stringify({ url, headers: options.headers, body: JSON.parse(options.body) }) + '\\n');
  return new Response(${JSON.stringify(JSON.stringify(body))}, { status: ${status} });
};\n`)
  return spawnSync(process.execPath, ['--import', mock, CLI, 'src/Handler.php', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, QUALITY_ROOT: '', TYPESAFE_API_KEY: '' },
  })
}

// The two artifacts of the single run written under the default report folder.
function readRun(root) {
  const folder = join(root, '.quality-artifacts/code/reports/constraints')
  const names = readdirSync(folder).sort()
  assert.equal(names.length, 2, names.join(', '))
  const [dataName, reportName] = names
  assert.match(dataName, /^\d{8}-\d{6}-constraints\.json$/)
  assert.equal(reportName, dataName.replace(/\.json$/, '.md'))
  const dataPath = join(folder, dataName)
  return { data: JSON.parse(readFileSync(dataPath, 'utf8')), report: readFileSync(join(folder, reportName), 'utf8'), dataPath }
}

function verdict(stdout) {
  return JSON.parse(stdout.match(/```json:verdict\n([^\n]+)/)[1])
}

test('CLI sends the full file and negative rule with the official Noul request shape', () => {
  const content = '<?php\nfinal class Handler { public Infrastructure $service; }\n'
  const root = checkProject({ semantic: 'MUST NOT: Depend on infrastructure classes', content })
  const result = check(root, ['--stdout'], { body: { answers: { c0: { type: 'noul', noul: 0.01 } } } })
  assert.equal(result.status, 1, result.stderr)
  assert.deepEqual(verdict(result.stdout), { success: false, violations: 1, warnings: 0 })
  const request = JSON.parse(readFileSync(join(root, 'requests.jsonl'), 'utf8').trim())
  assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(request.headers.Authorization, 'Bearer fixture-key')
  assert.equal(request.body.model, 'jev-latest')
  assert.equal(request.body.state.file_content, content)
  assert.equal(request.body.questions.c0.type, 'noul')
  assert.match(request.body.questions.c0.instructions, /MUST NOT: Depend on infrastructure classes/)
})

for (const [name, response] of [
  ['HTTP authentication failure', { status: 401, body: { error: 'Unauthorized' } }],
  ['missing answers', { body: {} }],
  ['missing trigger', { body: { answers: { c0: { noul: 0.99 } } } }],
  ['invalid compliance', { body: { answers: { t0: { noul: 0.99 }, c0: { noul: 2 } } } }],
]) {
  test(`CLI blocks on ${name} and retains the incomplete measurement`, () => {
    const root = checkProject()
    const result = check(root, [], response)
    assert.equal(result.status, 2, result.stderr)
    assert.deepEqual(verdict(result.stdout), { success: false, violations: 0, warnings: 0, errors: 1 })
    assert.match(result.stdout, /INCOMPLETE/)
    const { report, data, dataPath } = readRun(root)
    assert.match(report, /### Verification errors/)
    assert.equal(data.rules[0].verdict, null)
    assert.match(data.rules[0].reason, /incomplete/)
    const parsed = ruleStats.parseReport(dataPath, readFileSync(dataPath, 'utf8'))
    assert.equal(parsed.rows.length, 0, 'unverified files must not count as clean observations')
    assert.ok(parsed.problems.length > 0)
  })
}

test('a partial API failure cannot attest a clean population', () => {
  const root = checkProject()
  writeFileSync(join(root, 'src/Other.php'), '<?php final class Other {}')
  const mock = join(root, 'partial-fetch.mjs')
  writeFileSync(mock, `globalThis.fetch = async (url, options) => {
    const { state } = JSON.parse(options.body);
    return state.file_path.endsWith('Other.php')
      ? new Response('{}', { status: 401 })
      : new Response(JSON.stringify({ answers: { t0: { noul: 1 }, c0: { noul: 1 } } }));
  };`)
  const result = spawnSync(process.execPath, ['--import', mock, CLI, 'src/', '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, QUALITY_ROOT: '', TYPESAFE_API_KEY: '' },
  })
  assert.equal(result.status, 2, result.stderr)
  const run = JSON.parse(result.stdout)
  assert.equal(run.counts.errors, 1)
  assert.equal(run.rules[0].verdict, null)
})

test('static SHOULD findings warn, while static MUST findings block', () => {
  for (const [severity, exitCode] of [['SHOULD', 0], ['MUST', 1]]) {
    for (const message of [`${severity}: declare strict_types`, `handlers ${severity} declare strict_types`]) {
      const root = checkProject({ semantic: '', apiKey: false,
        staticRules: `HDL-001 | present | strict_types | ${message}` })
      const result = check(root, ['--stdout'])
      assert.equal(result.status, exitCode, result.stderr)
      assert.deepEqual(verdict(result.stdout), { success: exitCode === 0, violations: exitCode, warnings: 1 - exitCode })
      assert.match(result.stdout, /HDL-001/)
    }
  }
})

test('SHOULD-only constraints stay advisory without an API key or any request', () => {
  const root = checkProject({ semantic: 'SHOULD: handlers are final', apiKey: false })
  const dryRun = check(root, ['--dry-run'])
  assert.equal(dryRun.status, 0, dryRun.stderr)
  assert.deepEqual(JSON.parse(dryRun.stdout), [])
  const result = check(root, ['--json'])
  assert.equal(result.status, 0, result.stderr)
  const run = JSON.parse(result.stdout)
  assert.equal(run.counts.semanticRules, 0)
  assert.equal(run.counts.warnings, 1)
  assert.equal(run.semanticWarnings.length, 0)
  assert.ok(!readdirSync(root).includes('requests.jsonl'))
})

test('oversized files block without sending a prefix; raising the limit sends the full file', () => {
  const content = ' '.repeat(60_000) + 'FORBIDDEN'
  const root = checkProject({ content })
  const result = check(root, ['--stdout'])
  assert.equal(result.status, 2, result.stderr)
  assert.equal(verdict(result.stdout).success, false)
  assert.match(result.stdout, /exceeds --max-chars/)
  assert.ok(!readdirSync(root).includes('requests.jsonl'))
  const complete = check(root, [`--max-chars=${content.length}`, '--stdout'])
  assert.equal(complete.status, 0, complete.stderr)
  assert.equal(verdict(complete.stdout).success, true)
  const request = JSON.parse(readFileSync(join(root, 'requests.jsonl'), 'utf8').trim())
  assert.equal(request.body.state.file_content, content)
})

test('subdirectory invocation resolves source, API key and default reports from the project root', () => {
  const root = checkProject()
  const result = check(root, [], { cwd: join(root, 'src') })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(verdict(result.stdout).success, true)
  const request = JSON.parse(readFileSync(join(root, 'requests.jsonl'), 'utf8').trim())
  assert.equal(request.body.state.file_content, readFileSync(join(root, 'src/Handler.php'), 'utf8'))
  assert.equal(request.headers.Authorization, 'Bearer fixture-key')
  assert.equal(readdirSync(join(root, '.quality-artifacts/code/reports/constraints')).length, 2)
})

test('missing credentials produce an explicit unsuccessful verdict', () => {
  const root = checkProject({ apiKey: false })
  const result = check(root, ['--stdout'])
  assert.equal(result.status, 2, result.stderr)
  assert.deepEqual(verdict(result.stdout), { success: false, violations: 0, warnings: 0, errors: 1 })
})

test('invalid numeric options cannot bypass semantic verification', () => {
  for (const flag of ['--concurrency=0', '--concurrency=-1', '--concurrency=0.5', '--max-chars=0',
    '--max-chars', '--threshold=2', '--trigger-threshold=-1', '--uncertain=0.9']) {
    assert.throws(() => parseArgs([flag]), undefined, flag)
  }
})

test('a run writes the JSON document and a markdown report free of data blocks', () => {
  const root = checkProject({ staticRules: 'HDL-001 | present | strict_types | MUST: declare strict_types' })
  const result = check(root, ['--ticket=PROJ-1'], { body: { answers: { t0: { noul: 0.99 }, c0: { noul: 0.1 } } } })
  assert.equal(result.status, 1, result.stderr)
  // Paths under the working directory print relative to it.
  assert.match(result.stdout, /Full report: \.quality-artifacts\/code\/reports\/constraints\/\d{8}-\d{6}-constraints\.md\n/)
  assert.match(result.stdout, /Run data: \.quality-artifacts\/code\/reports\/constraints\/\d{8}-\d{6}-constraints\.json\n/)

  const { data, report } = readRun(root)
  assert.equal(data.format, FORMAT)
  assert.equal(data.ticket, 'PROJ-1')
  assert.deepEqual(data.verdict, { success: false, violations: 2, warnings: 0 })
  assert.equal(data.staticViolations[0].id, 'HDL-001')
  assert.equal(data.semanticViolations[0].violation.toFixed(2), '0.90')
  assert.ok(data.rules.length >= 2)
  assert.ok(!report.includes('```'), 'the markdown report must carry no fenced data')
  assert.match(report, /Ticket: PROJ-1/)
  assert.match(report, /### Static Violations \(grep\)/)
  assert.match(report, /### Semantic Violations\n/)
})

test('renders print a severity once, the document keeps the message whole', () => {
  const root = checkProject({
    staticRules: 'HDL-001 | present | strict_types | MUST: declare strict_types',
    semantic: 'MUST NOT: Depend on infrastructure classes',
  })
  const result = check(root, [], { body: { answers: { t0: { noul: 0.99 }, c0: { noul: 0.1 } } } })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /HDL-001 \(MUST\): declare strict_types/)
  assert.match(result.stdout, /~[0-9a-f]{8} \(MUST NOT\): Depend on infrastructure classes/)

  const { data, report } = readRun(root)
  assert.match(report, /\*\*HDL-001\*\* \(MUST\): declare strict_types/)
  assert.match(report, /\(MUST NOT\): Depend on infrastructure classes/)
  assert.equal(data.semanticViolations[0].message, 'MUST NOT: Depend on infrastructure classes')
})

test('--out writes the run document at a fixed path, and --json prints the same document', () => {
  const root = checkProject()
  const result = check(root, ['--out=gate/constraints.json'])
  assert.equal(result.status, 0, result.stderr)
  const gate = JSON.parse(readFileSync(join(root, 'gate/constraints.json'), 'utf8'))
  assert.deepEqual(gate, readRun(root).data)
  assert.equal(gate.verdict.success, true)

  const json = JSON.parse(check(root, ['--json']).stdout)
  assert.deepEqual(Object.keys(json), Object.keys(gate))
})

test('--out still receives a verdict when there is nothing to check', () => {
  const root = checkProject()
  const matcher = join(root, 'no-files-matcher.js')
  writeFileSync(matcher, 'process.stdout.write(\'{"error":"no_files","constraints":{}}\\n\')\n')
  const result = spawnSync(process.execPath, [CLI, `--matcher=${matcher}`, '--out=gate.json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, QUALITY_ROOT: '', TYPESAFE_API_KEY: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /No files to check/)
  const gate = JSON.parse(readFileSync(join(root, 'gate.json'), 'utf8'))
  assert.deepEqual(gate.verdict, { success: true, violations: 0, warnings: 0 })
})

// ---------------------------------------------------------------- constraint-report

function renderRun(doc, args = []) {
  const root = mkdtempSync(join(tmpdir(), 'constraint-report-'))
  const path = join(root, 'reports', '20260927-101200-constraints.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof doc === 'string' ? doc : JSON.stringify(doc))
  const result = spawnSync(process.execPath, [RENDER, path, ...args], { cwd: root, encoding: 'utf8' })
  return { root, path, result }
}

const agentRun = {
  format: FORMAT,
  run_ts: '20260927-101200',
  ticket: 'PROJ-2',
  branch: 'feat/x',
  engine: 'agent',
  counts: { files: 1, staticRules: 0, semanticRules: 1 },
  semanticViolations: [{ file: 'src/Handler.php', id: 'handler~aaaa1111', constraint: 'handler', severity: 'MUST',
    message: 'MUST: handlers are final', detail: 'Line 2: class Handler is not final' }],
  verdict: { success: true, violations: 0, warnings: 0 },
  rules: [{ rule: 'handler~aaaa1111', constraint: 'handler', kind: 'semantic', files: 1, verdict: 'fail', hits: 1, text: 'MUST: handlers are final' }],
}

test('constraint-report renders the markdown beside the document and recomputes the verdict', () => {
  const { path, result } = renderRun(agentRun)
  assert.equal(result.status, 1, result.stderr)
  assert.deepEqual(verdict(result.stdout), { success: false, violations: 1, warnings: 0 })

  const data = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(data.verdict, { success: false, violations: 1, warnings: 0 }, 'a declared verdict never survives its findings')
  assert.deepEqual(data.staticViolations, [])
  const report = readFileSync(path.replace(/\.json$/, '.md'), 'utf8')
  assert.match(report, /FAILED ❌/)
  assert.match(report, /Line 2: class Handler is not final/)
  assert.ok(!report.includes('p(violation)'))
  assert.equal(ruleStats.parseReport(path, readFileSync(path, 'utf8')).rows.length, 1)
})

test('constraint-report blocks on an invalid document', () => {
  for (const doc of ['{not json', { ...agentRun, format: 'other' }, { ...agentRun, run_ts: undefined },
    { ...agentRun, rules: undefined }, { ...agentRun, errors: 'oops' }]) {
    const { path, result } = renderRun(doc)
    assert.equal(result.status, 2, JSON.stringify(doc))
    assert.deepEqual(verdict(result.stdout), { success: false, violations: 0, warnings: 0, errors: 1 })
    assert.ok(!readdirSync(dirname(path)).some((name) => name.endsWith('.md')))
  }
})

test('constraint-report copies the document to --out and flags verification errors', () => {
  const { root, result } = renderRun({ ...agentRun, semanticViolations: [], errors: [{ file: 'src/Handler.php', message: 'agent returned no result' }] },
    ['--out=gate.json'])
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stdout, /INCOMPLETE/)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'gate.json'), 'utf8')).verdict, { success: false, violations: 0, warnings: 0, errors: 1 })
})
