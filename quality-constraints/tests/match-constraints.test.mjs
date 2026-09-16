import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'quality-constraints-verify', 'scripts', 'match-constraints.js')
const RULE_STATS = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rule-stats')

// Disposable git repo reproducing the real structure observed (bandai):
// conventions/api-client.md + decisions/api-client.md — same basename in 2 subdirectories.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'mconstr-'))
  const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' })
  sh('git init -q')
  sh('git config user.email t@t.t')
  sh('git config user.name t')

  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  mkdirSync(join(cdir, 'conventions'), { recursive: true })
  mkdirSync(join(cdir, 'decisions'), { recursive: true })

  writeFileSync(join(cdir, 'conventions', 'api-client.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# API Client

## Static Rules
\`\`\`rules
API-001 | present | readonly class | api clients MUST be readonly
\`\`\`

## Semantic Rules
- MUST: convention rule from conventions
`)
  writeFileSync(join(cdir, 'decisions', 'api-client.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# API Client Decisions

## Static Rules
\`\`\`rules
API-D01 | present | ApiCallTrace | external calls MUST return an ApiCallTrace
\`\`\`

## Semantic Rules
- MUST: decision rule from decisions
`)
  // Constraint at the root of the directory (not in a subdirectory) — the **/*.md glob
  // without globstar was missing it, the listing must cover every level.
  writeFileSync(join(cdir, 'root-level.md'), `---
paths:
  - "src/**/*.php"
---
# Root

## Semantic Rules
- MUST: root level constraint found
`)

  // Rules delegated to another tool (phpstan/deptrac/rector) via a `via=` marker.
  // They STAY in the file — it is injected as-is into the generation prompts of the
  // scaffolding skills — but must no longer be executed or dispatched here.
  writeFileSync(join(cdir, 'conventions', 'delegated.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# Delegated

## Static Rules
\`\`\`rules
DEL-001 | present | neverPresentAnywhere | checked by phpstan | via=phpstan:acme.someRule
DEL-002 | present | neverPresentAnywhere | still checked here
\`\`\`

## Semantic Rules
- MUST [via=phpstan]: delegated semantic rule
- MUST: local semantic rule
`)

  // SHOULD-only constraint: never dispatched (advisory) → no feedback line.
  writeFileSync(join(cdir, 'conventions', 'advisory-only.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# Advisory

## Semantic Rules
- SHOULD: nothing blocking here
`)

  // Dead glob: matches NOTHING in the whole repo. Invisible in run mode
  // (the constraint is simply absent), detected only by --sweep.
  writeFileSync(join(cdir, 'conventions', 'dead-glob.md'), `---
paths:
  - "src/Legacy/**/*.php"
---
# Dead

## Static Rules
\`\`\`rules
DEAD-001 | present | whatever | never evaluated, the glob matches nothing
\`\`\`
`)

  // CONDITIONAL rules: `gate=` selects the files the rule concerns, without judging
  // their compliance. Without it, a file outside the trigger comes out as a violation of a rule
  // that isn't aimed at it — and the fixer ends up correcting code that was already correct.
  writeFileSync(join(cdir, 'conventions', 'gated.md'), `---
paths:
  - "lib/**/*.php"
---
# Gated

## Static Rules
\`\`\`rules
GAT-001 | present | JoinTable | owning side MUST name its join table | gate=ManyToMany
GAT-002 | present | strict_types | MUST declare strict_types | gate!=@legacy
\`\`\`
`)

  mkdirSync(join(root, 'lib'), { recursive: true })
  // triggered by both gates, compliant with both
  writeFileSync(join(root, 'lib', 'Owning.php'), '<?php\ndeclare(strict_types=1);\n// ManyToMany\n// JoinTable\n')
  // no ManyToMany: outside GAT-001's trigger, so neither compliant nor a violation
  writeFileSync(join(root, 'lib', 'Plain.php'), '<?php\ndeclare(strict_types=1);\n')
  // triggered by both, in violation of both
  writeFileSync(join(root, 'lib', 'Broken.php'), '<?php\n// ManyToMany\n')
  // `gate!=`: the @legacy marker takes it out of GAT-002's population
  writeFileSync(join(root, 'lib', 'Legacy.php'), '<?php\n// @legacy\n')

  mkdirSync(join(root, 'src', 'Acme'), { recursive: true })
  writeFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '<?php\nfinal readonly class FooApiClient\n{\n}\n')
  sh('git add -A')
  sh('git commit -qm init')
  return { root, sh }
}

function run(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' })
}

test('identical basenames (conventions/ + decisions/) → ONE JSON key, rules merged', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`)

  // The "api-client" key must appear only ONCE in the raw output
  // (JSON.parse silently swallows duplicate keys — the text has to be tested).
  const occurrences = (res.stdout.match(/"api-client"\s*:/g) || []).length
  assert.equal(occurrences, 1, `"api-client" key emitted ${occurrences} times:\n${res.stdout}`)

  const data = JSON.parse(res.stdout)
  const entry = data.constraints['api-client']
  assert.ok(entry, 'api-client entry expected under "constraints"')
  // Semantic rules from BOTH files present
  assert.ok(entry.semantic_rules.some((r) => r.includes('convention rule from conventions')))
  assert.ok(entry.semantic_rules.some((r) => r.includes('decision rule from decisions')))
  // File matched only once despite the paths of both files
  assert.deepEqual(entry.files, ['src/Acme/FooApiClient.php'])
  // Static rules from both files executed: ApiCallTrace absent → API-D01 violation,
  // readonly present → no API-001 violation
  assert.ok(entry.static_violations.some((v) => v.id === 'API-D01'))
  assert.ok(!entry.static_violations.some((v) => v.id === 'API-001'))
})

test('constraint at the root of constraints/ (outside a subdirectory) is discovered', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const data = JSON.parse(res.stdout)
  assert.ok(data.constraints['root-level'], 'root-level.md must be discovered')
  assert.ok(data.constraints['root-level'].semantic_rules.some((r) => r.includes('root level constraint found')))
})

// `exclude:` exists for populations that share a directory and differ only by a
// suffix — here a command message and its handler. Neither narrowing (same prefix) nor the
// pattern (the grammar forbids `!`) separates them.
test('`exclude:` removes files from the population, for every rule of the constraint', () => {
  const { root, sh } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'command.md'), `---
paths:
  - "src/Command/**/*.php"
exclude:
  - "src/Command/**/*Handler.php"
---
# Command

## Static Rules
\`\`\`rules
CMD-001 | present | readonly class | a command message MUST be readonly
\`\`\`
`)
  mkdirSync(join(root, 'src', 'Command', 'CreerX'), { recursive: true })
  writeFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerX.php'), '<?php\nreadonly class CreerX\n{\n}\n')
  writeFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerXHandler.php'), '<?php\nfinal class CreerXHandler\n{\n}\n')
  sh('git add -A')
  sh('git commit -qm command')
  appendFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerX.php'), '// touched\n')
  appendFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerXHandler.php'), '// touched\n')

  const data = JSON.parse(run(root).stdout)
  const entry = data.constraints.command
  assert.deepEqual(entry.files, ['src/Command/CreerX/CreerX.php'])
  assert.deepEqual(entry.static_violations, [])
})

test('without `exclude:`, the handler enters the population and puts the rule in violation', () => {
  const { root, sh } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'command.md'), `---
paths:
  - "src/Command/**/*.php"
---
# Command

## Static Rules
\`\`\`rules
CMD-001 | present | readonly class | a command message MUST be readonly
\`\`\`
`)
  mkdirSync(join(root, 'src', 'Command', 'CreerX'), { recursive: true })
  writeFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerX.php'), '<?php\nreadonly class CreerX\n{\n}\n')
  writeFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerXHandler.php'), '<?php\nfinal class CreerXHandler\n{\n}\n')
  sh('git add -A')
  sh('git commit -qm command')
  appendFileSync(join(root, 'src', 'Command', 'CreerX', 'CreerXHandler.php'), '// touched\n')

  const data = JSON.parse(run(root).stdout)
  assert.ok(data.constraints.command.static_violations.some((v) => v.id === 'CMD-001'))
})

test('git mode: per-file diff hunks matched in "diffs" (no re-derivation on the agent side)', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const data = JSON.parse(res.stdout)
  const hunk = data.diffs['src/Acme/FooApiClient.php']
  assert.ok(hunk, `diff expected for the modified file, diffs=${JSON.stringify(data.diffs)}`)
  assert.match(hunk, /@@/)
  assert.match(hunk, /\+\/\/ touched/)
})

test('git mode: untracked file matched but with no hunk (no diff vs HEAD)', () => {
  const { root } = makeRepo()
  writeFileSync(join(root, 'src', 'Acme', 'BarApiClient.php'), '<?php\nfinal readonly class BarApiClient\n{\n}\n')
  const res = run(root)
  const data = JSON.parse(res.stdout)
  assert.ok(data.constraints['api-client'].files.includes('src/Acme/BarApiClient.php'))
  assert.equal(data.diffs['src/Acme/BarApiClient.php'], undefined)
})

test('explicit files mode: no diffs (no git scope to derive)', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root, ['src/Acme/FooApiClient.php'])
  const data = JSON.parse(res.stdout)
  assert.ok(data.constraints['api-client'])
  assert.deepEqual(data.diffs, {})
})

test('via= marker: delegated static rule not executed, the others in the same block still are', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const entry = JSON.parse(res.stdout).constraints['delegated']
  assert.ok(entry, 'delegated entry expected')
  const ids = entry.static_violations.map((v) => v.id)
  // Both rules look for a pattern absent from the file: without the skip, both would violate.
  assert.ok(!ids.includes('DEL-001'), `DEL-001 carries via= → must not be executed, ids=${ids}`)
  assert.ok(ids.includes('DEL-002'), `DEL-002 without via= → must remain executed, ids=${ids}`)
})

test('[via=] marker: delegated semantic rule not dispatched, the others still are', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const rules = JSON.parse(res.stdout).constraints['delegated'].semantic_rules
  assert.ok(!rules.some((r) => r.includes('delegated semantic rule')), `[via=] rule dispatched: ${JSON.stringify(rules)}`)
  assert.ok(rules.some((r) => r.includes('local semantic rule')), `local rule missing: ${JSON.stringify(rules)}`)
})

test('static_rules: every evaluated rule is logged, violated or not, with its scope', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const rules = JSON.parse(run(root).stdout).constraints['api-client'].static_rules
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]))

  // API-001 passes (readonly present): without this line, a clean rule leaves
  // no trace and "N runs with no finding" stays uncomputable.
  assert.deepEqual(
    { kind: byId['API-001'].kind, files: byId['API-001'].files, hits: byId['API-001'].hits },
    { kind: 'static', files: 1, hits: 0 },
  )
  // API-D01 fails on the single matched file
  assert.equal(byId['API-D01'].hits, 1)
  assert.equal(byId['API-D01'].files, 1)
})

test('static_rules: via= rule logged as delegated (hits 0), not executed', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const rules = JSON.parse(run(root).stdout).constraints['delegated'].static_rules
  const del001 = rules.find((r) => r.id === 'DEL-001')
  const del002 = rules.find((r) => r.id === 'DEL-002')
  // Logged: this is what later proves the marker points to an id that is really
  // registered, instead of a rule nobody checks.
  assert.equal(del001.kind, 'delegated')
  assert.equal(del001.via, 'via=phpstan:acme.someRule')
  assert.equal(del001.hits, 0)
  // The unmarked neighbor looks for the same absent pattern → it does violate.
  assert.equal(del002.kind, 'static')
  assert.equal(del002.hits, 1)
})

test('feedback: one line per checked rule, static verdicted, semantic left null', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const fb = JSON.parse(run(root).stdout).feedback
  const byRule = Object.fromEntries(fb.map((r) => [r.rule, r]))

  // Static: resolved by the script, never left to the LLM
  assert.equal(byRule['api-client#API-001'].hits, 0)
  assert.equal(byRule['api-client#API-001'].verdict, 'pass')
  assert.equal(byRule['api-client#API-001'].kind, 'static')
  // Semantic: identity derived from the text (sigil ~), verdict to be filled in by the orchestrator.
  // Two rules here — conventions/api-client.md + decisions/api-client.md merged.
  const sem = fb.filter((r) => r.constraint === 'api-client' && r.kind === 'semantic')
  assert.equal(sem.length, 2)
  for (const r of sem) {
    assert.match(r.rule, /^api-client~[0-9a-f]{8}$/)
    assert.equal(r.verdict, null)
    assert.equal(r.hits, null)
    assert.equal(r.files, 1)
  }
})

test('feedback: semantic identity stable by text, distinct between two rules', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const a = JSON.parse(run(root).stdout).feedback
  const b = JSON.parse(run(root).stdout).feedback
  const ids = (fb) => fb.filter((r) => r.kind === 'semantic').map((r) => r.rule)
  // Two runs of the same repo → same identifiers (otherwise no accumulation is possible)
  assert.deepEqual(ids(a), ids(b))
  // Different texts → different identifiers
  assert.equal(new Set(ids(a)).size, ids(a).length)
})

test('feedback: SHOULD-only (advisory) constraint excluded — nobody checks it', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.ok(data.advisory['advisory-only'], 'advisory-only must be classified as advisory')
  assert.equal(data.feedback.filter((r) => r.constraint === 'advisory-only').length, 0)
})

test('--sweep: glob-based population across the whole repo, dead glob at 0', () => {
  const { root } = makeRepo()
  const res = run(root, ['--sweep'])
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`)
  const data = JSON.parse(res.stdout)
  // No rule executed in sweep mode — it's a scope measurement, not a check
  assert.deepEqual(data.constraints, {})

  // Dead glob: absent from run mode (nothing to match), visible here at 0
  assert.deepEqual(data.sweep['dead-glob'], [{ glob: 'src/Legacy/**/*.php', files: 0 }])
  // Live glob: counted on the tracked tree, not on the run's diff
  assert.deepEqual(data.sweep['api-client'], [{ glob: 'src/**/*ApiClient.php', files: 1 }])
})

test('--sweep: makes visible a constraint no run can report', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  // Run mode: dead-glob appears nowhere — indistinguishable from a compliant rule
  assert.equal(JSON.parse(run(root).stdout).constraints['dead-glob'], undefined)
  // Sweep mode: present and at zero
  assert.ok(JSON.parse(run(root, ['--sweep']).stdout).sweep['dead-glob'])
})

test('no modified file → {"error":"no_files"}', () => {
  const { root } = makeRepo()
  const res = run(root)
  assert.equal(res.status, 0)
  const data = JSON.parse(res.stdout)
  assert.equal(data.error, 'no_files')
})

// ------------------------------------------------ measurement block (rule-stats)

// Full chain as quality-constraints-verify describes it: the script emits the `feedback`
// rows with static verdicts resolved, the orchestrator fills in the semantic verdicts and
// writes them as the report's `json:constraints-run` block, rule-stats projects the reports.
test('end to end: match-constraints feedback → report block → rule-stats report', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const data = JSON.parse(run(root).stdout)
  const semantic = data.feedback.filter((r) => r.verdict === null)
  assert.ok(semantic.length >= 2, 'the fixture must produce several semantic rules')
  for (const r of data.feedback.filter((r) => r.kind !== 'semantic')) {
    assert.ok(['pass', 'fail'].includes(r.verdict), `static row ${r.rule} must arrive verdicted`)
  }

  const rules = data.feedback.map((r, i) => (r.verdict !== null ? r
    : { ...r, verdict: i === 0 ? 'fail' : 'pass', hits: i === 0 ? 1 : 0 }))
  const block = { run_ts: data.run_ts, ticket: 'PROJ-1', branch: data.branch, rules }
  const reportDir = join(root, 'reports')
  mkdirSync(reportDir)
  writeFileSync(join(reportDir, `${data.run_ts}-constraints.md`),
    '# Constraints Check\n\n```json:constraints-run\n' + JSON.stringify(block) + '\n```\n')

  const lint = spawnSync('node', [RULE_STATS, 'lint', `--reports=${reportDir}/*.md`], { cwd: root, encoding: 'utf8' })
  assert.equal(lint.status, 0, lint.stdout)

  const report = JSON.parse(spawnSync('node', [RULE_STATS, 'report', '--json', `--reports=${reportDir}/*.md`], {
    cwd: root, encoding: 'utf8',
  }).stdout)
  // All rules from the run — static ones resolved by the script, semantic ones by the orchestrator
  assert.equal(report.rules.length, data.feedback.length)
  // The delegated rule is logged: the projection proves the via= marker is still alive
  assert.ok(report.rules.some((r) => r.kind === 'delegated'), 'the via= rule must be logged')
  assert.equal(report.rules.reduce((n, r) => n + r.hits, 0) >= 1, true)
})

test('no file persisted under .git/ — the report is the only trace of a run', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  run(root)
  assert.ok(!existsSync(join(root, '.git', 'constraints-last.json')))
})

test('run mode: no sweep key — dead-globs must be able to tell the two outputs apart', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.sweep, undefined, 'a run output must not claim to carry a sweep')
  const res = spawnSync('node', [RULE_STATS, 'dead-globs', '-'], {
    cwd: root, encoding: 'utf8', input: JSON.stringify(data),
  })
  assert.equal(res.status, 2, 'dead-globs must refuse, not conclude "no dead glob"')
})

test('--sweep on an empty tree: every glob at 0, no no_files output', () => {
  // An empty tree is not "nothing to check": it's the case where every glob is dead.
  const { root } = makeRepo()
  execSync('git rm -q -r --cached src && rm -rf src', { cwd: root, stdio: 'pipe' })
  const res = run(root, ['--sweep'])
  assert.equal(res.status, 0, res.stderr)
  const data = JSON.parse(res.stdout)
  assert.equal(data.error, undefined)
  assert.deepEqual(data.sweep['api-client'], [{ glob: 'src/**/*ApiClient.php', files: 0 }])

  const dead = JSON.parse(spawnSync('node', [RULE_STATS, 'dead-globs', '-', '--json'], {
    cwd: root, encoding: 'utf8', input: res.stdout,
  }).stdout)
  assert.ok(dead.some((d) => d.constraint === 'api-client'))
})

// The script now has only one external dependency: git. The old bash + python3 + jq chain
// had TWO degraded modes that changed the shape of the output (no python3 → no
// agent_groups; no jq → empty diffs) — so a run could "succeed" while measuring nothing.
test('git alone on the PATH: full output, no degraded mode', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const stub = mkdtempSync(join(tmpdir(), 'gitonly-'))
  const gitBin = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  symlinkSync(gitBin, join(stub, 'git'))
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: stub },
  })
  assert.equal(res.status, 0, res.stderr)
  const data = JSON.parse(res.stdout)
  assert.ok(Array.isArray(data.agent_groups), 'grouping must always run')
  assert.ok(data.diffs['src/Acme/FooApiClient.php'], 'hunks no longer depend on jq')
  assert.match(data.run_ts, /^\d{8}-\d{6}$/)
  assert.equal(typeof data.branch, 'string')
})

// The 4 structural bug classes of the bash version, each invisible in the output:
// a false PASS or a false FAIL read exactly like a real one.
test('path with a space: matched and checked (unquoted word splitting in bash)', () => {
  const { root } = makeRepo()
  mkdirSync(join(root, 'src', 'Mon Dossier'), { recursive: true })
  writeFileSync(join(root, 'src', 'Mon Dossier', 'SpacedApiClient.php'), '<?php\nfinal class SpacedApiClient\n{\n}\n')
  const entry = JSON.parse(run(root).stdout).constraints['api-client']
  assert.ok(entry.files.includes('src/Mon Dossier/SpacedApiClient.php'), `file lost to the split: ${JSON.stringify(entry.files)}`)
  // `readonly class` absent → API-001 must violate on THIS file, not disappear
  assert.ok(entry.static_violations.some((v) => v.id === 'API-001' && v.file === 'src/Mon Dossier/SpacedApiClient.php'))
})

test('rule message with a quote and a tab: valid JSON', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'quoted.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# Quoted

## Static Rules
\`\`\`rules
Q-001 | absent | neverThere | the message carries a "quote" and a\ttab
\`\`\`
`)
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const data = JSON.parse(res.stdout) // the homegrown sed escaping used to break here
  const rule = data.constraints['quoted'].static_rules.find((r) => r.id === 'Q-001')
  assert.match(rule.text, /"quote"/)
})

test('invalid regex: logged as invalid, never silently compliant', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'broken.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# Broken

## Static Rules
\`\`\`rules
BAD-001 | absent | ( | uncompilable regex
\`\`\`
`)
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const res = run(root)
  const rule = JSON.parse(res.stdout).constraints['broken'].static_rules.find((r) => r.id === 'BAD-001')
  // Without this: `grep -cP` fails, `|| true` sets 0, the `absent` rule passes → a silent false PASS.
  assert.equal(rule.kind, 'invalid')
  assert.match(res.stderr, /invalid regex/)
})

test('POSIX class in a regex: translated, not rejected (grep -P supported it)', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'posix.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# Posix

## Static Rules
\`\`\`rules
POS-001 | present | class [[:upper:]][[:alnum:]]+ | class name in PascalCase
\`\`\`
`)
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const rule = JSON.parse(run(root).stdout).constraints['posix'].static_rules.find((r) => r.id === 'POS-001')
  assert.equal(rule.kind, 'static')
  assert.equal(rule.hits, 0, 'FooApiClient matches the PascalCase class')
})

test('{a,b} glob: expanded (the braces used to be matched literally → dead glob)', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'braces.md'), `---
paths:
  - "src/**/*{ApiClient,Repository}.php"
---
# Braces

## Semantic Rules
- MUST: brace glob alive
`)
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.deepEqual(data.constraints['braces'].files, ['src/Acme/FooApiClient.php'])
  assert.deepEqual(
    JSON.parse(run(root, ['--sweep']).stdout).sweep['braces'],
    [{ glob: 'src/**/*{ApiClient,Repository}.php', files: 1 }],
  )
})

test('{a,b} in the EXTENSION: the upstream filter expands it — `*.{ts,js}` used to answer no_files in diff/directory mode', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'scripts.md'), `---
paths:
  - "src/**/*.{ts,js}"
---
# Scripts

## Static Rules

\`\`\`rules
SCR-001 | absent | console\\.log | MUST NOT log to the console
\`\`\`
`)
  writeFileSync(join(root, 'src', 'Acme', 'app.ts'), 'console.log(1)\n')
  writeFileSync(join(root, 'src', 'Acme', 'legacy.js'), 'console.log(2)\n')
  // Directory mode: the same population the explicit-file mode already checked.
  const dir = JSON.parse(run(root, ['src']).stdout)
  assert.notEqual(dir.error, 'no_files')
  assert.deepEqual(dir.constraints['scripts'].static_violations.map((v) => v.file).sort(), ['src/Acme/app.ts', 'src/Acme/legacy.js'])
  // Diff mode: untracked files are part of the diff.
  const diff = JSON.parse(run(root).stdout)
  assert.notEqual(diff.error, 'no_files')
  assert.equal(diff.constraints['scripts'].static_violations.length, 2)
})

// `report-format.md:28` and the compact summary of quality-constraints-verify promise
// `path:line`. Without `line`, the orchestrator couldn't keep that promise — or had to invent it.
test('`absent` violation: line number of the offending line', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'nodump.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# No dump

## Static Rules
\`\`\`rules
ND-001 | absent | var_dump | no var_dump in production
\`\`\`
`)
  writeFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'),
    '<?php\nfinal readonly class FooApiClient\n{\n    public function a() { var_dump(1); }\n}\n')
  const v = JSON.parse(run(root).stdout).constraints['nodump'].static_violations
  assert.equal(v.length, 1)
  assert.equal(v[0].line, 4, `expected line 4, got ${JSON.stringify(v[0])}`)
  // Only one occurrence → no `lines`/`lines_total` to carry around
  assert.equal(v[0].lines, undefined)
})

test('multi-line `absent` violation: every line, cap never silent', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  writeFileSync(join(cdir, 'conventions', 'nodump.md'), `---
paths:
  - "src/**/*ApiClient.php"
---
# No dump

## Static Rules
\`\`\`rules
ND-001 | absent | var_dump | no var_dump in production
\`\`\`
`)
  // 25 offending lines > cap of 20: the truncation must stay visible
  const body = Array.from({ length: 25 }, () => '    var_dump(1);').join('\n')
  writeFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'),
    `<?php\nfinal readonly class FooApiClient\n{\n${body}\n}\n`)
  const v = JSON.parse(run(root).stdout).constraints['nodump'].static_violations[0]
  assert.equal(v.line, 4)
  assert.equal(v.lines.length, 20)
  assert.deepEqual(v.lines.slice(0, 3), [4, 5, 6])
  assert.equal(v.lines_total, 25, 'the real count must survive the cap')
})

test('`present` violation: line null — the default is absence, not a line', () => {
  const { root } = makeRepo()
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const v = JSON.parse(run(root).stdout).constraints['api-client'].static_violations
    .find((x) => x.id === 'API-D01')
  // ApiCallTrace cannot be found in the file: no line carries the defect.
  // A made-up number would send the fixer to look at an innocent line.
  assert.equal(v.line, null)
})

test('file deleted in the diff: out of scope (0 matches ≠ violation)', () => {
  const { root, sh } = makeRepo()
  writeFileSync(join(root, 'src', 'Acme', 'GoneApiClient.php'), '<?php\nfinal readonly class GoneApiClient\n{\n}\n')
  sh('git add -A')
  sh('git commit -qm gone')
  sh('rm src/Acme/GoneApiClient.php')
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const entry = JSON.parse(run(root).stdout).constraints['api-client']
  // Without the filter: grep fails on the missing file, counts 0, and the `present` rule
  // API-001 "violates" on a file that no longer exists.
  assert.ok(!entry.files.includes('src/Acme/GoneApiClient.php'), `deleted file kept: ${JSON.stringify(entry.files)}`)
  assert.ok(!entry.static_violations.some((v) => v.file === 'src/Acme/GoneApiClient.php'))
})

test('feedback: an id present in two merged files appears only once', () => {
  const { root } = makeRepo()
  // decisions/api-client.md redeclares the static rule from conventions/api-client.md
  appendFileSync(join(root, '.claude', 'quality', 'code', 'constraints', 'decisions', 'api-client.md'), `
## Static Rules
\`\`\`rules
API-001 | present | readonly | duplicate id across merged files
\`\`\`
`)
  appendFileSync(join(root, 'src', 'Acme', 'FooApiClient.php'), '// touched\n')
  const fb = JSON.parse(run(root).stdout).feedback
  assert.equal(fb.filter((r) => r.rule === 'api-client#API-001').length, 1)
})

// --------------------------------------------------------------------------------------------
// Extension-based scope — SPEC §2 "Scope".
//
// The matcher knows no language: it deduces the scope's extensions from the loaded
// constraints' `paths:`. These tests prove it on a repo with not a single line of PHP, and
// cover the two cases where the deduction gives up — an unboundable glob disables the
// narrowing, it never silently shrinks the scope.
// --------------------------------------------------------------------------------------------

const FENCE = '```'

// TypeScript repo: no PHP, no Twig. `paths:` declares `.ts`, and nothing else.
function makeTsRepo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mconstr-ts-'))
  const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' })
  sh('git init -q')
  sh('git config user.email t@t.t')
  sh('git config user.name t')

  const cdir = join(root, '.claude', 'quality', 'code', 'constraints')
  mkdirSync(cdir, { recursive: true })
  writeFileSync(join(cdir, 'service.md'), `---
paths:
  - "src/**/*Service.ts"
${extra.exclude ? `exclude:\n  - "${extra.exclude}"\n` : ''}---
# Service

${FENCE}rules
SVC-001 | absent | console\\.log\\( | MUST NOT log through console.log()
${FENCE}

## Semantic Rules
- MUST: a service depends only on interfaces
`)
  for (const [name, body] of Object.entries(extra.constraints || {})) {
    writeFileSync(join(cdir, `${name}.md`), body)
  }

  mkdirSync(join(root, 'src', 'user'), { recursive: true })
  writeFileSync(join(root, 'src', 'user', 'UserService.ts'), 'export class UserService {\n  find(id) {\n    console.log(id)\n  }\n}\n')
  writeFileSync(join(root, 'README.md'), 'doc\n')
  for (const [rel, body] of Object.entries(extra.files || {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  sh('git add -A')
  sh('git commit -qm init')
  return { root, sh }
}

test('scope deduced from paths: — a TypeScript repo is checked without changing a line', () => {
  const { root } = makeTsRepo()

  // Git mode: the modified .ts enters the scope, README.md does not.
  appendFileSync(join(root, 'src', 'user', 'UserService.ts'), '// touched\n')
  appendFileSync(join(root, 'README.md'), 'touched\n')
  const git = JSON.parse(run(root).stdout)
  assert.deepEqual(Object.keys(git.diffs), ['src/user/UserService.ts'])
  assert.deepEqual(git.constraints.service.files, ['src/user/UserService.ts'])
  assert.deepEqual(git.constraints.service.static_violations.map((v) => [v.id, v.line]), [['SVC-001', 3]])
  assert.deepEqual(git.constraints.service.semantic_rules, ['MUST: a service depends only on interfaces'])

  // Directory mode: walkCode filters on the deduced extensions, not on a fixed list.
  const dir = JSON.parse(run(root, ['src/']).stdout)
  assert.deepEqual(dir.constraints.service.files, ['src/user/UserService.ts'])

  // --sweep mode: the .ts glob is ALIVE. Before the deduction, `ls-files -- '*.php'` would have
  // counted it at 0 and `rule-stats dead-globs` would have declared it dead on a perfectly
  // healthy repo.
  const sweep = JSON.parse(run(root, ['--sweep']).stdout)
  assert.deepEqual(sweep.sweep.service, [{ glob: 'src/**/*Service.ts', files: 1 }])
})

test('compound extension: the glob declares `html.twig`, not `twig`', () => {
  const { root, sh } = makeTsRepo({
    constraints: {
      view: `---
paths:
  - "templates/**/*.html.twig"
---
# View

${FENCE}rules
VIE-001 | absent | onclick= | MUST NOT use an inline onclick
${FENCE}
`,
    },
    files: { 'templates/page.html.twig': '<p>{{ name }}</p>\n', 'templates/mail.twig': 'plain\n' },
  })

  // `mail.twig` is NOT declared: only `.html.twig` is. The extension is read from the FIRST dot.
  appendFileSync(join(root, 'templates', 'mail.twig'), 'touched\n')
  const only = JSON.parse(run(root).stdout)
  assert.equal(only.error, 'no_files', JSON.stringify(only))

  sh('git checkout -- templates/mail.twig')
  appendFileSync(join(root, 'templates', 'page.html.twig'), '<b onclick="x()">y</b>\n')
  const kept = JSON.parse(run(root).stdout)
  assert.deepEqual(kept.constraints.view.files, ['templates/page.html.twig'])
  assert.equal(kept.constraints.view.static_violations.length, 1)
})

test('diff entirely out of scope → no_files, not an empty run', () => {
  const { root } = makeTsRepo()
  appendFileSync(join(root, 'README.md'), 'touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.error, 'no_files')
})

test('exclude: does not contribute to the scope — it subtracts, it opens nothing', () => {
  const { root } = makeTsRepo({
    exclude: 'src/**/*.snap',
    files: { 'src/user/UserService.snap': 'snapshot\n' },
  })
  appendFileSync(join(root, 'src', 'user', 'UserService.snap'), 'touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.error, 'no_files', JSON.stringify(data))
})

// The two cases where the deduction gives up. Narrowing is an upstream saving, never the
// authority: giving it up widens what gets READ, it never silently shrinks a glob. The
// opposite — filtering on the extensions of other globs — would silently sterilize this glob.
test('glob without an extension → narrowing disabled, no no_files', () => {
  const { root } = makeTsRepo({
    constraints: {
      legacy: `---
paths:
  - "src/**/Legacy/**"
---
# Legacy

${FENCE}rules
LEG-001 | absent | TODO | MUST NOT leave a TODO behind
${FENCE}
`,
    },
  })
  appendFileSync(join(root, 'README.md'), 'touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.error, undefined, JSON.stringify(data))
  assert.deepEqual(Object.keys(data.constraints), [])
})

test('the extension itself is globbed → narrowing disabled', () => {
  const { root } = makeTsRepo({
    constraints: {
      script: `---
paths:
  - "bin/**/*.?s"
---
# Script

${FENCE}rules
SCR-001 | absent | eval\\( | MUST NOT call eval()
${FENCE}
`,
    },
  })
  appendFileSync(join(root, 'README.md'), 'touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.error, undefined, JSON.stringify(data))
})

test('no constraints → narrowing disabled, no false no_files', () => {
  const root = mkdtempSync(join(tmpdir(), 'mconstr-bare-'))
  const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' })
  sh('git init -q')
  sh('git config user.email t@t.t')
  sh('git config user.name t')
  mkdirSync(join(root, '.claude', 'quality', 'code', 'constraints'), { recursive: true })
  writeFileSync(join(root, 'README.md'), 'doc\n')
  sh('git add -A')
  sh('git commit -qm init')
  appendFileSync(join(root, 'README.md'), 'touched\n')
  const data = JSON.parse(run(root).stdout)
  assert.equal(data.error, undefined, JSON.stringify(data))
})

// Grouping sends one group into ONE agent prompt: mixing code and templates in it makes the
// rules inapplicable. The criterion is the intersection of file types, with no list of
// languages — proven here on .ts / .hbs, two extensions the engine has never known.
test('grouping: the MAX_GROUPS cap never merges two file types', () => {
  const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
  const constraints = {}
  const files = {}
  for (const n of names) {
    const prefix = n.slice(0, 3).toUpperCase()
    constraints[n] = `---
paths:
  - "lib/${n}/**/*.ts"
---
# ${n}

${FENCE}rules
${prefix}-001 | absent | debugger | MUST NOT leave a debugger statement
${FENCE}

## Semantic Rules
- MUST: rule of ${n}
`
    files[`lib/${n}/thing.ts`] = `export const ${n} = 1\n`
    files[`lib/${n}/other.ts`] = `export const ${n}2 = 2\n`
  }
  constraints.view = `---
paths:
  - "views/**/*.hbs"
---
# View

## Semantic Rules
- MUST: a view holds no business logic
`
  files['views/page.hbs'] = '<p>{{name}}</p>\n'

  const { root } = makeTsRepo({ constraints, files })
  // Explicit files: a directory as argv[0] would make the following arguments get ignored.
  const args = [...names.flatMap((n) => [`lib/${n}/thing.ts`, `lib/${n}/other.ts`]), 'views/page.hbs']
  const data = JSON.parse(run(root, args).stdout)

  const groups = data.agent_groups
  assert.ok(groups.length <= 5, `MAX_GROUPS cap not respected: ${groups.length}`)
  const merged = groups.filter((g) => g.constraints.length > 1)
  assert.ok(merged.length > 0, 'no merge: the cap did not trigger, test inconclusive')
  const view = groups.find((g) => g.constraints.includes('view'))
  assert.deepEqual(view.constraints, ['view'], 'the .hbs constraint merged with a .ts group')
  assert.deepEqual(view.files, ['views/page.hbs'])
  // `view` is the smallest group (1 file vs. 2), so the first candidate the cap
  // examines. This is what makes the test discriminating: without the compatibility criterion,
  // the merge would happen on IT. If this invariant slips, the test passes without proving anything.
  assert.equal(Math.min(...groups.map((g) => g.files.length)), 1)
  assert.equal(view.files.length, 1)
})

// A file's type is read from its NAME, not its path. Two extensionless files sharing the
// same name in different directories are of the same type and must be able to merge.
// Without splitting on `/`, `split('.').pop()` returned the whole path — never the same
// twice — and these groups never merged. No effect as long as extensionless files
// weren't entering the scope; extension deduction now lets them in.
test('grouping: two extensionless files with the same name are of the same type', () => {
  const constraints = {}
  const files = {}
  for (const n of ['alpha', 'beta', 'delta', 'gamma']) {
    constraints[n] = `---
paths:
  - "lib/${n}/**/*.ts"
---
# ${n}

## Semantic Rules
- MUST: rule of ${n}
`
    files[`lib/${n}/thing.ts`] = `export const ${n} = 1\n`
    files[`lib/${n}/other.ts`] = `export const ${n}2 = 2\n`
  }
  for (const d of ['toolsA', 'toolsB']) {
    constraints[d] = `---
paths:
  - "${d}/**"
---
# ${d}

## Semantic Rules
- MUST: a launcher stays free of business logic
`
    files[`${d}/console`] = '#!/bin/sh\nexec node .\n'
  }

  const { root } = makeTsRepo({ constraints, files })
  // Explicit files: the scope is given, this test is only about grouping.
  const args = ['toolsA/console', 'toolsB/console',
    ...['alpha', 'beta', 'delta', 'gamma'].flatMap((n) => [`lib/${n}/thing.ts`, `lib/${n}/other.ts`])]
  const data = JSON.parse(run(root, args).stdout)

  // 6 groups for a cap of 5: a merge happens. The two `console` groups are the smallest
  // (1 file vs. 2), so the first pair the cap examines.
  const merged = data.agent_groups.filter((g) => g.constraints.length > 1)
  assert.equal(merged.length, 1, JSON.stringify(data.agent_groups))
  assert.deepEqual(merged[0].constraints.slice().sort(), ['toolsA', 'toolsB'])
  assert.deepEqual(merged[0].files, ['toolsA/console', 'toolsB/console'])
})

// The defect the gate fixes: the rule is true but conditional. Executed across its whole
// glob, it accuses files it isn't aimed at — and the store ends up classifying it as a false
// positive, and so getting it removed.
test('gate=: a file outside the trigger is neither compliant nor a violation', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['lib/']).stdout).constraints['gated']
  const byId = Object.fromEntries(out.static_rules.map((r) => [r.id, r]))

  // Triggered population = Owning + Broken. Plain and Legacy have no ManyToMany.
  assert.equal(byId['GAT-001'].files, 2)
  assert.equal(byId['GAT-001'].hits, 1)
  const offenders = out.static_violations.filter((v) => v.id === 'GAT-001').map((v) => v.file)
  assert.deepEqual(offenders, ['lib/Broken.php'])
})

test('gate!=: the file is concerned when the pattern is MISSING', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['lib/']).stdout).constraints['gated']
  const gat002 = out.static_rules.find((r) => r.id === 'GAT-002')

  // Legacy.php carries @legacy: outside the population. The other 3 are in it.
  assert.equal(gat002.files, 3)
  assert.equal(gat002.hits, 1)
  const offenders = out.static_violations.filter((v) => v.id === 'GAT-002').map((v) => v.file)
  assert.deepEqual(offenders, ['lib/Broken.php'])
})

// `files` feeds the violation rate rule-stats reads. A denominator inflated by files never
// targeted makes that rate, and so the retrospective, wrong.
test('gate: `files` carries the triggered population, not the whole glob', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['lib/']).stdout).constraints['gated']
  assert.equal(out.files.length, 4, 'the glob does match all 4 files')
  const byId = Object.fromEntries(out.static_rules.map((r) => [r.id, r]))
  assert.ok(byId['GAT-001'].files < out.files.length, 'a gated rule cannot see its whole glob')
})

test('gate that fails to compile → invalid rule, never silently unfiltered', () => {
  const { root } = makeRepo()
  const cdir = join(root, '.claude', 'quality', 'code', 'constraints', 'conventions')
  writeFileSync(join(cdir, 'gated.md'), `---
paths:
  - "lib/**/*.php"
---
# Gated

## Static Rules
\`\`\`rules
GAT-003 | present | whatever | broken gate | gate=(?>foo)
\`\`\`
`)
  const r = run(root, ['lib/'])
  const gat003 = JSON.parse(r.stdout).constraints['gated'].static_rules.find((x) => x.id === 'GAT-003')
  assert.equal(gat003.kind, 'invalid')
  assert.equal(gat003.hits, 0)
  assert.match(r.stderr, /invalid gate/)
})

// A silently amputated scope reads like a clean scope: `src/ tests/` used to check only
// src/, and tests/'s constraints were never evaluated.
test('several directories as arguments: all resolved, not just the first', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['src/', 'lib/']).stdout).constraints
  assert.ok(out['api-client'], `src/'s constraint missing: ${Object.keys(out)}`)
  assert.ok(out['gated'], `lib/'s constraint missing: ${Object.keys(out)}`)
})

test('mix of directory + explicit file', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['lib/', 'src/Acme/FooApiClient.php']).stdout).constraints
  assert.ok(out['gated'])
  assert.deepEqual(out['api-client'].files, ['src/Acme/FooApiClient.php'])
})

// Two overlapping arguments must not count the file twice: it would violate the same rule
// twice, and `files` would lie about the size of the scope.
test('overlapping arguments: each file counted once', () => {
  const { root } = makeRepo()
  const out = JSON.parse(run(root, ['lib/', 'lib/Broken.php', 'lib/']).stdout).constraints['gated']
  assert.equal(out.files.length, 4)
  assert.equal(out.static_violations.filter((v) => v.id === 'GAT-001').length, 1)
})

test('missing path among several: reported, the others remain evaluated', () => {
  const { root } = makeRepo()
  const r = run(root, ['lib/', 'nope/Absent.php'])
  assert.match(r.stderr, /file not found, skipped — nope\/Absent\.php/)
  assert.ok(JSON.parse(r.stdout).constraints['gated'], 'the valid directory must remain evaluated')
})
