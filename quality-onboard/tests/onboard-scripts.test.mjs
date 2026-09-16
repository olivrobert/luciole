import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(HERE, '..', 'skills', 'onboard', 'scripts')
const CONSTRAINTS_BIN = join(HERE, '..', '..', 'quality-constraints', 'bin')

const CANDIDATES = '.claude/quality/onboard/candidates'

// A toy project: 2 files carry the trigger and comply with it, 2 don't carry it.
// This is the case that, without `gate`, comes out at 2/4 and fails a rule that is actually true.
function project({ rules, files, scope } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'onboard-scripts-'))
  mkdirSync(join(root, CANDIDATES), { recursive: true })
  mkdirSync(join(root, 'src', 'Domain'), { recursive: true })

  const src = files || {
    'A1.php': '<?php\nclass A1 {\n#[ORM\\ManyToMany(inversedBy: "x")]\n#[ORM\\JoinTable(name: "t1")]\nprivate $x;\n}\n',
    'A2.php': '<?php\nclass A2 {\n#[ORM\\ManyToMany(inversedBy: "x")]\n#[ORM\\JoinTable(name: "t2")]\nprivate $x;\n}\n',
    'B1.php': '<?php\nclass B1 {\nprivate $name;\n}\n',
    'B2.php': '<?php\nclass B2 {\nprivate $name;\n}\n',
  }
  for (const [name, content] of Object.entries(src)) writeFileSync(join(root, 'src', 'Domain', name), content)

  writeFileSync(join(root, CANDIDATES, 'entity.json'), JSON.stringify({
    scope: {
      slug: 'entity', label: 'Doctrine Entities', prefix: 'ENT',
      glob: 'src/Domain/*.php', marker: '#[ORM\\Entity]',
      population: Object.keys(src).length,
      ...scope,
      // `sample` is always a subset of the population: a test scope that restricts
      // it (legacy `files`, or `exclude`) must restrict the sample along with it.
      sample: scope?.sample || scope?.files || Object.keys(src).map((f) => `src/Domain/${f}`),
    },
    tooling: ['phpstan.dist.neon'],
    rules,
  }, null, 2))
  return root
}

function run(root, script, args = []) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${CONSTRAINTS_BIN}:${process.env.PATH}` },
  })
}

function readRules(root) {
  const doc = JSON.parse(readFileSync(join(root, CANDIDATES, 'entity.json'), 'utf8'))
  return Object.fromEntries(doc.rules.map((r) => [r.id, r]))
}

const GATED = {
  id: 'ENT-001',
  status: 'retenu',
  strength: 'MUST',
  rule: 'The owning side of a ManyToMany names its join table',
  probe: {
    regex: 'JoinTable\\(name:',
    sense: 'present',
    gate: { regex: 'ManyToMany\\(inversedBy:', sense: 'present' },
  },
  trigger: 'ManyToMany owning side',
  anchor: '#[ORM\\JoinTable(name:)]',
  rationale: 'invariant',
  why: 'the name Doctrine derives changes if a class is renamed',
  evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
  counterExamples: [],
}

// The same rule without its `gate`: the measurement counts the 2 unrelated files as
// violations. This is the false negative that this whole mechanism exists to prevent.
const UNGATED = { ...GATED, id: 'ENT-002', probe: { regex: GATED.probe.regex, sense: 'present' } }

// ------------------------------------------------------------ validate-candidates

test('validate --phase pre refuses a check or measure set before measurement', () => {
  const root = project({ rules: [{ ...GATED, check: 'grep' }] })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /check\/measure set before measurement/)
})

test('validate --phase pre refuses an a-revoir: only measurement can set it', () => {
  const root = project({ rules: [{ ...GATED, status: 'a-revoir' }] })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /a-revoir before measurement/)
})

// `population` is the orchestrator's own count of `glob - exclude`: a mismatch means the glob
// written down is not the one it looked at.
test('validate --phase pre refuses a population that does not match glob minus exclude', () => {
  const root = project({ rules: [GATED], scope: { population: 2 } })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scope\.population 2 ≠ 4 file\(s\) matched by glob - exclude/)
})

test('validate --phase pre accepts a population equal to glob minus exclude', () => {
  const root = project({
    rules: [GATED],
    scope: { exclude: 'src/Domain/B*.php', population: 2, sample: ['src/Domain/A1.php', 'src/Domain/A2.php'] },
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('validate requires the population to be declared', () => {
  const root = project({ rules: [GATED], scope: { population: undefined } })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scope\.population absent/)
})

// A candidates JSON written before 4.2 enumerates `files` instead of counting them. It is
// still read: the list is then the population, and it must still equal glob minus exclude.
test('validate --phase pre still checks a pre-4.2 scope.files list against the glob', () => {
  const root = project({
    rules: [GATED],
    scope: { population: undefined, files: ['src/Domain/A1.php', 'src/Domain/A2.php'] },
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /glob - exclude contains a file missing from scope\.files: src\/Domain\/B1\.php/)
})

test('validate --phase pre accepts a pre-4.2 scope.files list exactly equal to glob minus exclude', () => {
  const root = project({
    rules: [GATED],
    scope: { population: undefined, exclude: 'src/Domain/B*.php', files: ['src/Domain/A1.php', 'src/Domain/A2.php'] },
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('validate validates probe.gate like the probe: a regex that fails to compile is refused', () => {
  const root = project({ rules: [{ ...GATED, probe: { ...GATED.probe, gate: { regex: '([a-z', sense: 'present' } } }] })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'pre'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /probe\.gate\.regex does not compile/)
})

test('validate --phase measured requires the a-revoir to have kept its fields, and have no check', () => {
  const root = project({
    rules: [{
      ...GATED, status: 'a-revoir', check: 'semantic',
      measure: { matched: 2, total: 4, verdict: 'REFORMULATE' },
    }],
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /check set on an a-revoir/)
})

test('validate --phase post refuses any surviving a-revoir', () => {
  const root = project({
    rules: [{ ...GATED, status: 'a-revoir', measure: { matched: 2, total: 4, verdict: 'REFORMULATE' } }],
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'post'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /still a-revoir/)
})

// ------------------------------------------------------------------------ measure

test('measure: the gate measures the triggered sub-population, and reports the whole population', () => {
  const root = project({ rules: [GATED] })
  const r = run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(r.status, 0)
  const m = readRules(root)['ENT-001']
  assert.equal(m.status, 'retenu')
  assert.equal(m.check, 'grep')
  assert.deepEqual(m.measure, { matched: 2, total: 2, verdict: 'STATIC', population: 4 })
})

test('measure: a negative verdict sends back to a-revoir, with no reason and nothing removed', () => {
  const root = project({ rules: [UNGATED] })
  const r = run(root, 'measure.mjs', ['--min-population', '2'])
  assert.match(r.stdout, /1 rule\(s\) a-revoir/)
  assert.match(r.stdout, /none is discarded/)
  const m = readRules(root)['ENT-002']
  assert.equal(m.status, 'a-revoir')
  assert.equal(m.reason, undefined)
  assert.equal(m.check, undefined)
  assert.equal(m.measure.verdict, 'REFORMULATE')
  // Everything needed to re-examine and re-measure it must have survived.
  for (const field of ['probe', 'trigger', 'anchor', 'why', 'strength', 'evidence']) {
    assert.ok(m[field], `field lost on the a-revoir: ${field}`)
  }
})

test('measure: a re-scoped a-revoir goes back through measurement and comes back retenu', () => {
  const root = project({ rules: [UNGATED] })
  run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(readRules(root)['ENT-002'].status, 'a-revoir')

  // What step 6 does after a "trigger not isolated" finding: set the gate.
  const path = join(root, CANDIDATES, 'entity.json')
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  doc.rules[0].probe.gate = { regex: 'ManyToMany\\(inversedBy:', sense: 'present' }
  writeFileSync(path, JSON.stringify(doc, null, 2))

  run(root, 'measure.mjs', ['--min-population', '2'])
  const m = readRules(root)['ENT-002']
  assert.equal(m.status, 'retenu')
  assert.equal(m.measure.matched, 2)
  assert.equal(m.measure.total, 2)
})

test('measure preserves a by-review measurement while re-measuring the other rules', () => {
  const reviewed = {
    ...GATED,
    check: 'semantic',
    measure: { matched: 2, total: 2, verdict: 'SEMANTIC', by: 'review' },
  }
  const toMeasure = { ...GATED, id: 'ENT-002' }
  const root = project({ rules: [reviewed, toMeasure] })

  const r = run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const measured = readRules(root)
  assert.deepEqual(measured['ENT-001'].measure, reviewed.measure)
  assert.equal(measured['ENT-001'].check, 'semantic')
  assert.equal(measured['ENT-002'].measure.verdict, 'STATIC')
})

// The review demotes a static candidate with `fix check=semantic` and keeps the probe's
// measurement. A `--slug` pass of the 6→4 loop re-measures it — same probe, same STATIC
// verdict — and must not re-derive `grep` from that verdict: the demotion is a decision.
test('measure keeps a review demotion to semantic on a re-measured STATIC rule', () => {
  const demoted = { ...GATED, check: 'semantic', measure: { matched: 2, total: 2, verdict: 'STATIC' } }
  // Same shape but no `measure`: a reprobed rule, whose check must be re-derived.
  const reprobed = { ...GATED, id: 'ENT-002', check: 'semantic' }
  const root = project({ rules: [demoted, reprobed] })

  const r = run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const measured = readRules(root)
  assert.equal(measured['ENT-001'].measure.verdict, 'STATIC')
  assert.equal(measured['ENT-001'].check, 'semantic')
  assert.equal(measured['ENT-002'].check, 'grep')
})

test('measure passes on scope.exclude and does not count the excluded files', () => {
  const root = project({
    rules: [GATED],
    scope: { exclude: 'src/Domain/B*.php', population: 2, sample: ['src/Domain/A1.php', 'src/Domain/A2.php'] },
  })
  const r = run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(readRules(root)['ENT-001'].measure, { matched: 2, total: 2, verdict: 'STATIC' })
})

// -------------------------------------------------------------- render-constraints

test('render-constraints refuses to render while an a-revoir survives, and writes nothing', () => {
  const root = project({ rules: [GATED, UNGATED] })
  run(root, 'measure.mjs', ['--min-population', '2'])
  const r = run(root, 'render-constraints.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /nothing was written/)
  assert.equal(existsSync(join(root, '.claude/quality/code/constraints/entity.md')), false)
})

test('render-constraints removes the stale {slug}.md once the last rule of a scope is discarded, and leaves hand-written files alone', () => {
  const root = project({ rules: [GATED] })
  run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(run(root, 'render-constraints.mjs').status, 0)
  const rendered = join(root, '.claude/quality/code/constraints/entity.md')
  assert.ok(existsSync(rendered))

  const manualDir = join(root, '.claude/quality/code/constraints/conventions')
  mkdirSync(manualDir, { recursive: true })
  writeFileSync(join(manualDir, 'entity.md'), '---\npaths:\n  - "src/**/*.php"\n---\n\n## Semantic Rules\n- MUST: hand-written rule\n')

  // The review discards the only rule: the previous render must not survive it.
  const path = join(root, CANDIDATES, 'entity.json')
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  doc.rules[0].status = 'ecarte'
  doc.rules[0].reason = 'hors-perimetre'
  writeFileSync(path, JSON.stringify(doc, null, 2))

  const r = run(root, 'render-constraints.mjs')
  assert.equal(r.status, 0, r.stdout)
  assert.match(r.stdout, /stale file removed/)
  assert.equal(existsSync(rendered), false, 'the discarded rule must no longer be enforceable')
  assert.ok(existsSync(join(manualDir, 'entity.md')), 'hand-written constraints are never touched')
})

test('render-constraints produces a file that constraint-lint --strict accepts', () => {
  const root = project({ rules: [GATED] })
  run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(run(root, 'render-constraints.mjs').status, 0)

  const md = readFileSync(join(root, '.claude/quality/code/constraints/entity.md'), 'utf8')
  assert.match(md, /# Constraints — Doctrine Entities/)
  assert.match(md, /ENT-001 \| present \| JoinTable/)

  const bin = join(root, 'lint.sh')
  writeFileSync(bin, `#!/usr/bin/env bash\nexec "${process.execPath}" "${join(CONSTRAINTS_BIN, 'constraint-lint')}" "$@"\n`)
  chmodSync(bin, 0o755)
  const lint = spawnSync(bin, ['.claude/quality/code/constraints', '--strict'], { cwd: root, encoding: 'utf8' })
  assert.equal(lint.status, 0, lint.stdout + lint.stderr)
})

// --------------------------------------------------------------- human review

test('render-review announces the files to read without copying the rules back', () => {
  const semantic = {
    ...GATED,
    id: 'ENT-002',
    check: 'semantic',
    rule: 'An exposed collection is returned read-only',
    trigger: 'getter returning a Doctrine Collection',
    anchor: 'call to ->toArray()',
    measure: { matched: 3, total: 4, verdict: 'SEMANTIC' },
  }
  const discarded = {
    id: 'ENT-003', status: 'ecarte', reason: 'maker', note: 'generator output',
    rule: 'An entity has a constructor',
    evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
  }
  const root = project({
    rules: [{ ...GATED, check: 'grep', measure: { matched: 2, total: 2, verdict: 'STATIC', population: 4 } }, semantic, discarded],
  })

  const result = run(root, 'render-review.mjs')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /# Final human review/)
  assert.match(result.stdout, /2 rule\(s\) kept/)
  assert.match(result.stdout, /1 static, 1 semantic/)
  assert.match(result.stdout, /\.claude\/quality\/code\/constraints\/entity\.md/)
  assert.match(result.stdout, /Read these constraints files before validating/)
  assert.doesNotMatch(result.stdout, /ENT-001/)
  assert.doesNotMatch(result.stdout, /ENT-002/)
  assert.doesNotMatch(result.stdout, /ENT-003/)
})

test('approval ties validation to the exact content of the constraints', () => {
  const root = project({ rules: [GATED] })
  run(root, 'measure.mjs', ['--min-population', '2'])
  assert.equal(run(root, 'render-constraints.mjs').status, 0)

  const missing = run(root, 'approval.mjs', ['check'])
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /approval\.json missing/)

  const approved = run(root, 'approval.mjs', ['approve'])
  assert.equal(approved.status, 0, approved.stdout + approved.stderr)
  assert.equal(run(root, 'approval.mjs', ['check']).status, 0)

  const constraint = join(root, '.claude/quality/code/constraints/entity.md')
  writeFileSync(constraint, readFileSync(constraint, 'utf8') + '\n<!-- changed -->\n')
  const stale = run(root, 'approval.mjs', ['check'])
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /constraints changed since human validation/)
})

// ----------------------------------------------------------------- render-backlog

test('render-backlog projects automatable rules and preserves lines already marked done', () => {
  const root = project({
    rules: [
      { ...GATED, automatable: { tool: 'phpstan', nature: 'rejette', note: 'custom rule' } },
      {
        id: 'ENT-003', status: 'ecarte', reason: 'fixer', note: 'cs-fixer restores it alone',
        rule: 'An entity is declared final',
        automatable: { tool: 'cs-fixer', nature: 'reecrit' },
        evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
      },
    ],
  })
  assert.equal(run(root, 'render-backlog.mjs').status, 0)
  let md = readFileSync(join(root, '.claude/quality/code/lint-backlog.md'), 'utf8')
  assert.match(md, /\| entity \| An entity is declared final \| cs-fixer \| rewrites \| to do \|/)
  assert.match(md, /phpstan \(custom rule\) \| rejects \| to do \|/)

  // The `done` mark set by hand on a `rewrites` line can't come from any JSON field:
  // a regeneration that flipped it back to `to do` would reopen a ticket already handled.
  writeFileSync(join(root, '.claude/quality/code/lint-backlog.md'), md.replace('| rewrites | to do |', '| rewrites | done |'))
  run(root, 'render-backlog.mjs')
  md = readFileSync(join(root, '.claude/quality/code/lint-backlog.md'), 'utf8')
  assert.match(md, /An entity is declared final \| cs-fixer \| rewrites \| done \|/)
})

test('render-backlog produces no file when no rule is toolable', () => {
  const root = project({ rules: [GATED] })
  const r = run(root, 'render-backlog.mjs')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /no toolable rule/)
  assert.equal(existsSync(join(root, '.claude/quality/code/lint-backlog.md')), false)
})

test('render-backlog ignores a rule already covered and discarded as tooling', () => {
  const root = project({
    rules: [{
      id: 'ENT-003', status: 'ecarte', reason: 'outillage',
      note: 'already covered by the configuration in place, no rule to write',
      rule: 'An entity is declared final',
      automatable: { tool: 'phpstan' },
      evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
    }],
  })
  const r = run(root, 'render-backlog.mjs')
  assert.equal(r.status, 0)
  assert.equal(existsSync(join(root, '.claude/quality/code/lint-backlog.md')), false)
})

// ── sample: what the generator reads, distinct from the population ────────────────────────

test('validate refuses a sample that overflows the population', () => {
  const root = project({
    rules: [GATED],
    scope: { sample: ['src/Domain/A1.php', 'src/Domain/Z9.php'] },
  })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scope\.sample contains a file outside the population: src\/Domain\/Z9\.php/)
})

// The cap is the field's reason for existing: without it, `sample` becomes `files` again and the
// generator re-reads the 52 files the split was supposed to spare it from.
test('validate refuses a sample above the cap', () => {
  const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`C${i}.php`, '<?php\nclass C {}\n']))
  const root = project({ rules: [{ ...GATED, evidence: [{ file: 'src/Domain/C0.php' }, { file: 'src/Domain/C1.php' }] }], files })
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scope\.sample has 20 files > 15/)
})

test('validate requires the sample to be declared', () => {
  const root = project({ rules: [GATED], scope: { sample: undefined } })
  const doc = JSON.parse(readFileSync(join(root, CANDIDATES, 'entity.json'), 'utf8'))
  delete doc.scope.sample
  writeFileSync(join(root, CANDIDATES, 'entity.json'), JSON.stringify(doc, null, 2))
  const r = run(root, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scope\.sample absent/)
})

// ── validate-scopes: the gate for step 1, before an agent costs anything at all ──

// The 5-file floor is a criterion of the contract: the toy project has 4, so a
// fifth is needed to test something other than that floor.
const FIVE = {
  'A1.php': '<?php\nclass A1 {}\n', 'A2.php': '<?php\nclass A2 {}\n',
  'B1.php': '<?php\nclass B1 {}\n', 'B2.php': '<?php\nclass B2 {}\n',
  'B3.php': '<?php\nclass B3 {}\n',
}

function scopesProject(scopes) {
  const root = project({ rules: [GATED], files: FIVE })
  mkdirSync(join(root, '.claude/quality/code'), { recursive: true })
  writeFileSync(join(root, '.claude/quality/onboard/scopes.json'), JSON.stringify({ scopes }, null, 2))
  return root
}

const ALL = Object.keys(FIVE).map((f) => `src/Domain/${f}`)
const SCOPE = { slug: 'entity', prefix: 'ENT', glob: 'src/Domain/*.php', marker: '#[ORM\\Entity]', population: ALL.length, sample: ALL, model: ALL[0], minPopulation: 2 }

test('validate-scopes accepts a consistent contract', () => {
  const r = run(scopesProject([SCOPE]), 'validate-scopes.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /entity \(5\/5\)/)
})

// ── the engine binaries: resolved by the scripts, never assumed on the PATH ──

// Harness-agnostic: no `${CLAUDE_PLUGIN_ROOT}`, no shell shims required. In a monorepo
// clone the sibling `quality-constraints/bin` is found by position, whatever the PATH says.
test('validate-scopes finds the engine next to the plugin even with an empty PATH', () => {
  const root = scopesProject([SCOPE])
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'validate-scopes.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', CONSTRAINT_KIT_BIN: '' },
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('CONSTRAINT_KIT_BIN pointing at a directory without the engine is an error, not a fallthrough', () => {
  const root = scopesProject([SCOPE])
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'validate-scopes.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CONSTRAINT_KIT_BIN: join(root, 'nowhere') },
  })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /CONSTRAINT_KIT_BIN=.*nowhere is set but .*constraint-lint does not exist/)
})

test('CONSTRAINT_KIT_BIN is honoured by the measurement, run through the current node', () => {
  const root = project({ rules: [GATED] })
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'measure.mjs'), '--min-population', '2'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', CONSTRAINT_KIT_BIN: CONSTRAINTS_BIN },
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(readRules(root)['ENT-001'].status, 'retenu')
})

test('validate-scopes refuses two scopes that share a slug', () => {
  const r = run(scopesProject([SCOPE, { ...SCOPE, prefix: 'ENZ' }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /slug "entity" duplicated/)
})

// Two scopes under the same prefix produce two ENT-001: `measure` indexes by id
// alone, and the second silently overwrites the first.
test('validate-scopes refuses two scopes that share a prefix', () => {
  const r = run(scopesProject([SCOPE, { ...SCOPE, slug: 'command' }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /prefix "ENT" already used/)
})

test('validate-scopes refuses a population that does not match glob minus exclude', () => {
  const r = run(scopesProject([{ ...SCOPE, population: 2 }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /population 2 ≠ 5 file\(s\) matched by glob - exclude/)
})

test('validate-scopes requires the population', () => {
  const { population, ...noPopulation } = SCOPE
  const r = run(scopesProject([noPopulation]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /population absent/)
})

// A scopes.json written before 4.2 enumerates `files`: still accepted, still checked.
test('validate-scopes still checks a pre-4.2 files list against the glob', () => {
  const r = run(scopesProject([{ ...SCOPE, population: undefined, files: ['src/Domain/A1.php', 'src/Domain/A2.php'] }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /glob - exclude contains a file missing from files: src\/Domain\/B1\.php/)
})

test('validate-scopes accepts a consistent pre-4.2 contract', () => {
  const r = run(scopesProject([{ ...SCOPE, population: undefined, files: ALL }]), 'validate-scopes.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /entity \(5\/5\)/)
})

test('validate-scopes refuses a minPopulation no rule can reach', () => {
  const r = run(scopesProject([{ ...SCOPE, minPopulation: 9 }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /minPopulation 9 > 5 files/)
})

test('validate-scopes refuses a scope under the 5-file floor', () => {
  const r = run(scopesProject([{ ...SCOPE, glob: 'src/Domain/A*.php', population: 2, sample: ['src/Domain/A1.php'] }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /2 file\(s\) < 5/)
})

// The model is what the creation skill will make imitated: without it, everything the
// constraints don't say — member order, splitting — is left to invention.
test('validate-scopes refuses a scope with no model', () => {
  const { model, ...noModel } = SCOPE
  const r = run(scopesProject([noModel]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /model absent/)
})

test('validate-scopes refuses a model outside the scope', () => {
  const r = run(scopesProject([{ ...SCOPE, model: 'src/Domain/Z9.php' }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /model "src\/Domain\/Z9\.php" outside the population/)
})

// A model the generator hasn't read shows a form the rules don't describe.
test('validate-scopes refuses a model outside the sample', () => {
  const r = run(scopesProject([{ ...SCOPE, sample: ALL.slice(1), model: ALL[0] }]), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /missing from sample/)
})

test('validate-scopes flags the missing file rather than passing', () => {
  const r = run(project({ rules: [GATED] }), 'validate-scopes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stdout, /scopes\.json missing/)
})

// ── measure --slug: the 6→4 loop without touching neighboring scopes ──────────────────

// A second scope, in the same toy project. `--slug` must leave it untouched: another
// command may be in the middle of fixing it.
function twoScopes() {
  const root = project({ rules: [GATED] })
  const doc = JSON.parse(readFileSync(join(root, CANDIDATES, 'entity.json'), 'utf8'))
  writeFileSync(join(root, CANDIDATES, 'command.json'), JSON.stringify({
    ...doc,
    scope: { ...doc.scope, slug: 'command', prefix: 'CMD' },
    rules: [{ ...GATED, id: 'CMD-001' }],
  }, null, 2))
  return root
}

function rulesOf(root, slug) {
  const doc = JSON.parse(readFileSync(join(root, CANDIDATES, `${slug}.json`), 'utf8'))
  return Object.fromEntries(doc.rules.map((r) => [r.id, r]))
}

test('measure --slug only measures its own scope', () => {
  const root = twoScopes()
  const r = run(root, 'measure.mjs', ['--min-population', '2', '--slug', 'entity'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /for scope entity/)
  assert.ok(rulesOf(root, 'entity')['ENT-001'].measure, 'entity not measured')
  assert.equal(rulesOf(root, 'command')['CMD-001'].measure, undefined, 'command was measured')
})

// The report is what Gate 2 reads. A per-slug measurement that overwrote it would make
// the other scopes appear as never measured.
test('measure --slug merges its report with the existing one', () => {
  const root = twoScopes()
  run(root, 'measure.mjs', ['--min-population', '2'])
  run(root, 'measure.mjs', ['--min-population', '2', '--slug', 'entity'])
  const report = JSON.parse(readFileSync(join(root, '.claude/quality/onboard/measures.json'), 'utf8'))
  const ids = report.results.map((r) => r.id).sort()
  assert.deepEqual(ids, ['CMD-001', 'ENT-001'])
})

test('measure --slug on an unknown scope fails instead of measuring everything', () => {
  const r = run(twoScopes(), 'measure.mjs', ['--slug', 'form'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /NO candidates\/form\.json/)
})

// The floor is fixed at step 1: that's what makes two runs comparable. Without
// scopes.json the previous behavior is kept — a single floor, the default one.
test('measure reads the minPopulation of each scope from scopes.json', () => {
  const root = twoScopes()
  mkdirSync(join(root, '.claude/quality/code'), { recursive: true })
  writeFileSync(join(root, '.claude/quality/onboard/scopes.json'), JSON.stringify({
    scopes: [{ slug: 'entity', minPopulation: 2 }, { slug: 'command', minPopulation: 4 }],
  }, null, 2))

  const r = run(root, 'measure.mjs')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /2 pass\(es\)/)
  // entity passes the floor of 2 on its 2 triggered files; command, under 4, does not.
  assert.equal(rulesOf(root, 'entity')['ENT-001'].measure.verdict, 'STATIC')
  assert.equal(rulesOf(root, 'command')['CMD-001'].measure.verdict, 'INSUFFICIENT')
})

// ------------------------------------------------------------------ automatable.nature

// The nature is no longer inferred from a list of tools maintained by the plugin: it is declared
// by the agent and validated against the status. A tool unknown to the plugin remains usable.
test('validate refuses an automatable with no nature, and a nature inconsistent with the status', () => {
  const sansNature = project({
    rules: [{ ...GATED, check: 'grep', measure: { matched: 2, total: 2, verdict: 'STATIC' }, automatable: { tool: 'phpstan' } }],
  })
  let r = run(sansNature, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /automatable\.nature "undefined" invalid/)

  const natureFixer = project({
    rules: [{
      id: 'ENT-003', status: 'ecarte', reason: 'fixer', note: 'the fixer restores it alone',
      rule: 'An entity is declared final',
      automatable: { tool: 'mon-fixer-maison', nature: 'rejette' },
      evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
    }],
  })
  r = run(natureFixer, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /nature must be "reecrit"/)

  const ok = project({
    rules: [{
      id: 'ENT-003', status: 'ecarte', reason: 'fixer', note: 'the fixer restores it alone',
      rule: 'An entity is declared final',
      automatable: { tool: 'mon-fixer-maison', nature: 'reecrit' },
      evidence: [{ file: 'src/Domain/A1.php' }, { file: 'src/Domain/A2.php' }],
    }],
  })
  r = run(ok, 'validate-candidates.mjs', ['--phase', 'measured'])
  assert.equal(r.status, 0, r.stdout)
})

// --------------------------------------------------------------------- verify-skills

// The creation skill is minimal by construction: it routes to the constraints. The
// script catches what a re-read wouldn't show — a scope with no skill, a template
// token left in the rendered output, an incomplete mapping.
test('verify-skills checks skills and mapping against scopes.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-skills-'))
  mkdirSync(join(root, '.claude/quality/onboard'), { recursive: true })
  writeFileSync(join(root, '.claude/quality/onboard/scopes.json'), JSON.stringify({
    scopes: [{ slug: 'entity', prefix: 'ENT', glob: 'src/Domain/*.php', model: 'src/Domain/A1.php' }],
  }))

  // Nothing rendered: the scope has no skill, the mapping is missing.
  let r = run(root, 'verify-skills.mjs', ['--project', root])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /quality-entity\/SKILL\.md: absent/)
  assert.match(r.stdout, /skill-mapping\.md: absent/)

  // Fully rendered but unfinished: a template token has survived.
  mkdirSync(join(root, '.claude/skills/quality-entity'), { recursive: true })
  writeFileSync(join(root, '.claude/skills/quality-entity/SKILL.md'),
    '# Create entity\n\n1. Read `.claude/quality/code/constraints/entity.md`\n2. Read `{MODEL}`\n')
  writeFileSync(join(root, '.claude/skills/skill-mapping.md'), '| entity | src/Domain/*.php | quality-entity |\n')
  r = run(root, 'verify-skills.mjs', ['--project', root])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /unresolved token: \{MODEL\}/)

  // Rendered without the model line: the constraints state the rule, but nothing shows
  // the form — what the skill then leaves to invention doesn't show on a re-read.
  writeFileSync(join(root, '.claude/skills/quality-entity/SKILL.md'),
    '# Create entity\n\n1. Read `.claude/quality/code/constraints/entity.md`\n')
  r = run(root, 'verify-skills.mjs', ['--project', root])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /does not route to the model src\/Domain\/A1\.php/)

  // Clean render: everything passes.
  writeFileSync(join(root, '.claude/skills/quality-entity/SKILL.md'),
    '# Create entity\n\n1. Read `.claude/quality/code/constraints/entity.md`\n2. Read `src/Domain/A1.php`\n')
  r = run(root, 'verify-skills.mjs', ['--project', root])
  assert.equal(r.status, 0, r.stdout)
})

// A scope with no `model` in scopes.json cannot produce any compliant skill: the
// gate says so here rather than letting through a skill silent on the form.
test('verify-skills refuses a scope with no model', () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-skills-nomodel-'))
  mkdirSync(join(root, '.claude/skills/quality-entity'), { recursive: true })
  mkdirSync(join(root, '.claude/quality/onboard'), { recursive: true })
  writeFileSync(join(root, '.claude/quality/onboard/scopes.json'), JSON.stringify({
    scopes: [{ slug: 'entity', prefix: 'ENT', glob: 'src/Domain/*.php' }],
  }))
  writeFileSync(join(root, '.claude/skills/quality-entity/SKILL.md'),
    '# Create entity\n\n1. Read `.claude/quality/code/constraints/entity.md`\n')
  writeFileSync(join(root, '.claude/skills/skill-mapping.md'), '| entity | src/Domain/*.php | quality-entity |\n')
  const r = run(root, 'verify-skills.mjs', ['--project', root])
  assert.equal(r.status, 1)
  assert.match(r.stdout, /has no `model` in scopes\.json/)
})
