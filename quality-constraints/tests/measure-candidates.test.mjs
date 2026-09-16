import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'measure-candidates')

// A throwaway repo: `files` is a map of relative path → content.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'measure-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

function run(root, payload, args = []) {
  const file = join(root, 'candidates.json')
  writeFileSync(file, JSON.stringify(payload))
  const proc = spawnSync('node', [BIN, file, ...args], { cwd: root, encoding: 'utf8' })
  return { status: proc.status, stderr: proc.stderr, out: proc.stdout ? JSON.parse(proc.stdout) : null }
}

// Six handlers: five conforming, one deviant. Serves as the population for the whole suite.
function handlers({ deviant = 1, total = 6 } = {}) {
  const files = {}
  for (let i = 0; i < total; i++) {
    files[`src/App/Handler/H${i}.php`] = i < total - deviant
      ? '<?php final readonly class H { public function __invoke(): Entity {} }'
      : '<?php final class H { public function __invoke(): void {} }'
  }
  return files
}

function candidate(overrides = {}) {
  return {
    id: 'HDL-001',
    slug: 'handler',
    text: 'MUST: be readonly',
    glob: 'src/**/*.php',
    probe: { regex: 'readonly class', sense: 'present' },
    ...overrides,
  }
}

// ------------------------------------------------------------------- verdicts

test('ratio 1 → STATIC', () => {
  const root = repo(handlers({ deviant: 0 }))
  const { out, status } = run(root, { candidates: [candidate()] })
  assert.equal(out.results[0].verdict, 'STATIC')
  assert.equal(out.results[0].ratio, 1)
  assert.equal(status, 0)
})

test('ratio between the threshold and 1 → SEMANTIC, not STATIC: a single counter-example is enough to disqualify a mechanically enforced rule', () => {
  const root = repo(handlers({ deviant: 1, total: 20 }))
  const { out, status } = run(root, { candidates: [candidate()] })
  assert.equal(out.results[0].verdict, 'SEMANTIC')
  assert.equal(out.results[0].ratio, 0.95)
  assert.equal(status, 0)
})

test('ratio below the threshold → REFORMULATE, with counter-examples to narrow the condition', () => {
  const root = repo(handlers({ deviant: 3, total: 6 }))
  const { out, status } = run(root, { candidates: [candidate()] })
  const [result] = out.results
  assert.equal(result.verdict, 'REFORMULATE')
  assert.equal(result.conform, 3)
  assert.equal(result.violations, 3)
  assert.equal(result.counterexamples.length, 3)
  assert.equal(status, 1)
})

test('population below the floor → INSUFFICIENT even at 100%: 2/2 proves nothing', () => {
  const root = repo(handlers({ deviant: 0, total: 2 }))
  const { out, status } = run(root, { candidates: [candidate()] })
  assert.equal(out.results[0].verdict, 'INSUFFICIENT')
  assert.equal(out.results[0].files, 2)
  assert.equal(status, 1)
})

test('candidate with no probe → UNMEASURED: not expressible as a regex, so a tool-candidate, never a constraint', () => {
  const root = repo(handlers())
  const { out } = run(root, { candidates: [candidate({ probe: undefined })] })
  assert.equal(out.results[0].verdict, 'UNMEASURED')
})

test('invalid regex → UNMEASURED rather than a crash', () => {
  const root = repo(handlers())
  const { out } = run(root, { candidates: [candidate({ probe: { regex: '([', sense: 'present' } })] })
  assert.equal(out.results[0].verdict, 'UNMEASURED')
  assert.match(out.results[0].reason, /invalid regex/)
})

// ----------------------------------------------------------------- mechanics

test('sense absent: conforming = the file does NOT contain the regex', () => {
  const root = repo(handlers({ deviant: 2, total: 10 }))
  const { out } = run(root, {
    candidates: [candidate({ probe: { regex: '\\): void', sense: 'absent' } })],
  })
  assert.equal(out.results[0].conform, 8)
  assert.equal(out.results[0].verdict, 'REFORMULATE')
})

test('the glob follows the frontmatter grammar — braces included', () => {
  const root = repo({
    'src/Acheteur/Domain/Model/A.php': '<?php use IdentityTrait;',
    'src/Common/Domain/Model/B.php': '<?php // escape hatch',
    'src/Catalogue/Domain/Model/C.php': '<?php use IdentityTrait;',
  })
  const { out } = run(root, {
    candidates: [candidate({
      glob: 'src/{Acheteur,Catalogue}/Domain/Model/**/*.php',
      probe: { regex: 'use IdentityTrait;', sense: 'present' },
    })],
  }, ['--min-population', '2'])
  assert.equal(out.results[0].files, 2)
  assert.equal(out.results[0].verdict, 'STATIC')
})

test('root restricts the scan', () => {
  const root = repo({
    'src/A.php': '<?php readonly class A {}',
    'tests/B.php': '<?php class B {}',
  })
  const { out } = run(root, { root: 'src', candidates: [candidate()] }, ['--min-population', '1'])
  assert.equal(out.scanned, 1)
  assert.equal(out.results[0].verdict, 'STATIC')
})

test('--threshold and --min-population are configurable', () => {
  const root = repo(handlers({ deviant: 3, total: 6 }))
  const { out } = run(root, { candidates: [candidate()] }, ['--threshold', '0.4'])
  assert.equal(out.results[0].verdict, 'SEMANTIC')
})

test('verdict counts are aggregated, and the exit code signals what is left to arbitrate', () => {
  const root = repo(handlers({ deviant: 3, total: 6 }))
  const { out, status } = run(root, {
    candidates: [candidate(), candidate({ id: 'HDL-002', probe: { regex: 'class', sense: 'present' } })],
  })
  assert.deepEqual(out.counts, { REFORMULATE: 1, STATIC: 1 })
  assert.equal(status, 1)
})

test('unreadable input → exit code 2, not an empty measurement that would pass for success', () => {
  const root = repo(handlers())
  const proc = spawnSync('node', [BIN, join(root, 'absent.json')], { cwd: root, encoding: 'utf8' })
  assert.equal(proc.status, 2)
})

// ------------------------------------------------- line-by-line evaluation

// Real defect: the probe was tested against the WHOLE content with a RegExp without the `m`
// flag, while the production matcher evaluates line by line. Any probe anchored by `^` then
// measured an artifact — 0% in `present`, 100% for free in `absent` — and fabricated STATIC
// verdicts.
test('probe anchored by ^: measured line by line, like the production matcher', () => {
  const root = repo({
    'src/App/A.php': '<?php\ndeclare(strict_types=1);\n',
    'src/App/B.php': '<?php\ndeclare(strict_types=1);\n',
    'src/App/C.php': '<?php\ndeclare(strict_types=1);\n',
    'src/App/D.php': '<?php\ndeclare(strict_types=1);\n',
    'src/App/E.php': '<?php\ndeclare(strict_types=1);\n',
  })
  const { out } = run(root, {
    candidates: [candidate({ probe: { regex: '^declare\\(strict_types=1\\);', sense: 'present' } })],
  })
  assert.equal(out.results[0].verdict, 'STATIC')
  assert.equal(out.results[0].ratio, 1)
})

test('probe anchored by ^ in `absent`: a real counter-example is seen, not a free 100%', () => {
  const root = repo({
    'src/App/A.php': '<?php\nfinal class A {}\n',
    'src/App/B.php': '<?php\nfinal class B {}\n',
    'src/App/C.php': '<?php\nfinal class C {}\n',
    'src/App/D.php': '<?php\nfinal class D {}\n',
    'src/App/E.php': '<?php\nabstract class E {}\n',
  })
  const { out } = run(root, {
    candidates: [candidate({ probe: { regex: '^abstract class', sense: 'absent' } })],
  })
  assert.equal(out.results[0].conform, 4)
  assert.equal(out.results[0].violations, 1)
})

test('multi-line probe → UNMEASURED: the rule would be inert on the matcher side, and a ratio would read like a real ratio', () => {
  const root = repo(handlers())
  const { out } = run(root, {
    candidates: [candidate({ probe: { regex: 'class[\\s\\S]*__invoke', sense: 'present' } })],
  })
  assert.equal(out.results[0].verdict, 'UNMEASURED')
  assert.match(out.results[0].reason, /multi-line/)
})

// ------------------------------------------------------------------- exclude

test('`exclude` subtracts from the population: two populations sharing a folder become measurable', () => {
  const root = repo({
    'src/App/Command/CreerX/CreerX.php': '<?php\nreadonly class CreerX {}\n',
    'src/App/Command/CreerX/CreerXHandler.php': '<?php\nfinal class CreerXHandler {}\n',
    'src/App/Command/EditX/EditX.php': '<?php\nreadonly class EditX {}\n',
    'src/App/Command/EditX/EditXHandler.php': '<?php\nfinal class EditXHandler {}\n',
    'src/App/Command/SupprimerX/SupprimerX.php': '<?php\nreadonly class SupprimerX {}\n',
    'src/App/Command/SupprimerX/SupprimerXHandler.php': '<?php\nfinal class SupprimerXHandler {}\n',
    'src/App/Command/ValiderX/ValiderX.php': '<?php\nreadonly class ValiderX {}\n',
    'src/App/Command/ValiderX/ValiderXHandler.php': '<?php\nfinal class ValiderXHandler {}\n',
    'src/App/Command/RefuserX/RefuserX.php': '<?php\nreadonly class RefuserX {}\n',
    'src/App/Command/RefuserX/RefuserXHandler.php': '<?php\nfinal class RefuserXHandler {}\n',
  })
  const base = { glob: 'src/App/Command/**/*.php', probe: { regex: 'readonly class', sense: 'present' } }

  const sans = run(root, { candidates: [candidate(base)] })
  assert.equal(sans.out.results[0].files, 10)
  assert.equal(sans.out.results[0].verdict, 'REFORMULATE')

  const avec = run(root, {
    candidates: [candidate({ ...base, exclude: 'src/App/Command/**/*Handler.php' })],
  })
  assert.equal(avec.out.results[0].files, 5)
  assert.equal(avec.out.results[0].verdict, 'STATIC')
  assert.deepEqual(avec.out.results[0].exclude, ['src/App/Command/**/*Handler.php'])
})

test('`exclude` accepts a list', () => {
  const root = repo({
    ...handlers({ deviant: 0, total: 6 }),
    'src/App/Legacy/L1.php': '<?php final class L1 {}',
    'src/App/Legacy/L2.php': '<?php final class L2 {}',
  })
  const { out } = run(root, {
    candidates: [candidate({ exclude: ['src/App/Legacy/L1.php', 'src/App/Legacy/L2.php'] })],
  })
  assert.equal(out.results[0].files, 6)
  assert.equal(out.results[0].verdict, 'STATIC')
})

// ---------------------------------------------------------------------- gate

// A mixed population: 6 entities carry the trigger (and all comply with it), 6 don't carry it.
// This is the ENT-006 case in miniature — the rule is true, measuring without a gate declares
// it false because it counts the 6 out-of-scope files as non-conforming.
function mixed({ triggered = 6, inert = 6, deviant = 0 } = {}) {
  const files = {}
  for (let i = 0; i < triggered; i++) {
    files[`src/App/Domain/T${i}.php`] = i < triggered - deviant
      ? '<?php\nclass T { #[ORM\\ManyToMany(inversedBy: "x")]\n#[ORM\\JoinTable(name: "t_x")]\nprivate $x; }\n'
      : '<?php\nclass T { #[ORM\\ManyToMany(inversedBy: "x")]\nprivate $x; }\n'
  }
  for (let i = 0; i < inert; i++) {
    files[`src/App/Domain/I${i}.php`] = '<?php\nclass I { private $name; }\n'
  }
  return files
}

const GATED = {
  glob: 'src/App/Domain/*.php',
  probe: {
    regex: 'JoinTable\\(name:',
    sense: 'present',
    gate: { regex: 'ManyToMany\\(inversedBy:', sense: 'present' },
  },
}

test('without a gate, `triggered` equals the entire population and the verdict is unchanged', () => {
  const root = repo(handlers({ deviant: 1, total: 20 }))
  const { out } = run(root, { candidates: [candidate()] })
  const [r] = out.results
  assert.equal(r.triggered, r.files)
  assert.equal(r.verdict, 'SEMANTIC')
  assert.equal(r.ratio, 0.95)
  assert.equal(r.probe.gate, undefined)
})

test('the gate takes files outside the trigger out of the measurement: neither conforming nor counter-examples', () => {
  const root = repo(mixed())
  const sans = run(root, { candidates: [candidate({ ...GATED, probe: { regex: GATED.probe.regex, sense: 'present' } })] })
  assert.equal(sans.out.results[0].files, 12)
  assert.equal(sans.out.results[0].conform, 6)
  assert.equal(sans.out.results[0].verdict, 'REFORMULATE')

  const avec = run(root, { candidates: [candidate(GATED)] })
  const [r] = avec.out.results
  assert.equal(r.files, 12)
  assert.equal(r.triggered, 6)
  assert.equal(r.conform, 6)
  assert.equal(r.violations, 0)
  assert.equal(r.ratio, 1)
  assert.equal(r.verdict, 'STATIC')
  assert.deepEqual(r.probe.gate, { regex: 'ManyToMany\\(inversedBy:', sense: 'present' })
})

test('a counter-example WITHIN the trigger stays counted', () => {
  const root = repo(mixed({ triggered: 6, inert: 6, deviant: 1 }))
  const { out } = run(root, { candidates: [candidate(GATED)] })
  const [r] = out.results
  assert.equal(r.triggered, 6)
  assert.equal(r.conform, 5)
  assert.equal(r.counterexamples.length, 1)
  assert.match(r.counterexamples[0], /T5\.php$/)
  assert.equal(r.verdict, 'REFORMULATE')
})

test('the floor applies to the triggered population, not the glob population', () => {
  const root = repo(mixed({ triggered: 3, inert: 9 }))
  const { out, status } = run(root, { candidates: [candidate(GATED)] })
  const [r] = out.results
  assert.equal(r.files, 12)
  assert.equal(r.triggered, 3)
  assert.equal(r.ratio, 1)
  assert.equal(r.verdict, 'INSUFFICIENT')
  assert.match(r.reason, /triggered on 3/)
  assert.equal(status, 1)
})

test('`gate.sense: absent` selects files that do NOT carry the pattern', () => {
  const root = repo(mixed())
  const { out } = run(root, {
    candidates: [candidate({
      glob: 'src/App/Domain/*.php',
      probe: { regex: 'private \\$name', sense: 'present', gate: { regex: 'ManyToMany', sense: 'absent' } },
    })],
  })
  const [r] = out.results
  assert.equal(r.triggered, 6)
  assert.equal(r.verdict, 'STATIC')
})

test('gate that fails to compile → UNMEASURED, not a crash or a fabricated ratio', () => {
  const root = repo(mixed())
  const { out } = run(root, {
    candidates: [candidate({ ...GATED, probe: { ...GATED.probe, gate: { regex: '([a-z', sense: 'present' } } })],
  })
  assert.equal(out.results[0].verdict, 'UNMEASURED')
  assert.match(out.results[0].reason, /invalid gate/)
})

test('multi-line gate → UNMEASURED: the matcher evaluates line by line', () => {
  const root = repo(mixed())
  const { out } = run(root, {
    candidates: [candidate({ ...GATED, probe: { ...GATED.probe, gate: { regex: 'class[\\s\\S]*Many', sense: 'present' } } })],
  })
  assert.equal(out.results[0].verdict, 'UNMEASURED')
  assert.match(out.results[0].reason, /multi-line gate/)
})
