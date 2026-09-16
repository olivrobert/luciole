import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERIFY = join(HERE, '..', 'skills', 'onboard', 'scripts', 'verify-onboard.mjs')
const LINT = join(HERE, '..', '..', 'quality-constraints', 'bin', 'constraint-lint')

// Sets up a toy project with `constraint-lint` on the PATH, and returns verify-onboard's output.
function runVerify(files, { measures, projectFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verify-onboard-'))
  const bin = join(root, 'bin')
  const constraints = join(root, '.claude', 'quality', 'code', 'constraints', 'conventions')
  mkdirSync(bin, { recursive: true })
  mkdirSync(constraints, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(constraints, name), content)
  for (const [name, content] of Object.entries(projectFiles)) {
    const target = join(root, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  if (measures !== undefined) {
    mkdirSync(join(root, '.claude', 'quality', 'onboard'), { recursive: true })
    writeFileSync(join(root, '.claude', 'quality', 'onboard', 'measures.json'), measures)
  }

  writeFileSync(join(bin, 'constraint-lint'), `#!/usr/bin/env bash\nexec "${process.execPath}" "${LINT}" "$@"\n`)
  chmodSync(join(bin, 'constraint-lint'), 0o755)

  return spawnSync(process.execPath, [VERIFY], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
}

const VALID_ENTITY_CONSTRAINT = [
  '---',
  'paths:',
  '  - "src/**/*.php"',
  '---',
  '',
  String.fromCharCode(96).repeat(3) + 'rules',
  'ENT-001 | absent | TODO | MUST NOT contain TODO',
  String.fromCharCode(96).repeat(3),
  '',
].join('\n')

test('Gate 2: constraint-lint blocks a constraint that grep paths: would have accepted', () => {
  // `paths:` is present, but outside the frontmatter: the matcher ignores it and lint must block.
  const result = runVerify({
    'handler.md': 'paths:\n  - "src/**/*.php"\n\n## Semantic Rules\n- MUST: inert rule\n',
  })

 assert.equal(result.status, 1)
  assert.match(result.stdout + result.stderr, /Constraint files not conformant|frontmatter absent/)
})

test('Gate 2: constraints with no trace of measurement block — an unmeasured rule is indistinguishable from a measured one on re-read', () => {
  const result = runVerify({
    'handler.md': '---\npaths:\n  - "src/**/*.php"\n---\n\n## Semantic Rules\n- MUST: plausible convention\n',
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /MISSING: \.claude\/quality\/onboard\/measures\.json/)
})

test('Gate 2: an empty measures file is a measurement that never happened, not a measurement with no candidate', () => {
  const result = runVerify(
    { 'handler.md': '---\npaths:\n  - "src/**/*.php"\n---\n\n## Semantic Rules\n- MUST: plausible convention (62/66)\n' },
    { measures: '{\n  "results": []\n}\n' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /the rules were never measured/)
})

test('Gate 2: a semantic rule with no ratio is flagged', () => {
  const result = runVerify(
    { 'handler.md': '---\npaths:\n  - "src/**/*.php"\n---\n\n## Semantic Rules\n- MUST: no ratio\n- MUST: with ratio (62/66)\n' },
    { measures: '{\n  "results": [{"id": "HDL-001", "verdict": "SEMANTIC"}]\n}\n' },
  )

  assert.match(result.stdout, /⚠ 1 semantic rule\(s\) without a ratio/)
})

test("Gate 2: \"nothing verified\" (exit 2) does not render as a format error", () => {
  // No `.md` file: lint exits 2. Confusing it with 1 would send us fixing grammar
  // on rules that don't exist.
  const result = runVerify({})

  assert.equal(result.status, 1)
  assert.match(result.stdout, /NO \.md file/)
  assert.doesNotMatch(result.stdout, /not conformant to the SPEC/)
})

test('Gate 2: a complete local set with no project reference passes', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    {
      measures: '{\n  "results": [{"id": "ENT-001", "verdict": "VALID", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n',
    },
  )

  assert.equal(result.status, 0)
})

// --- the join between what is rendered and what was measured.

test('Gate 2: a measures file that never measured THIS rule blocks — a result under another id is not a trace', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    { measures: '{\n  "results": [{"id": "OTH-042", "verdict": "VALID", "probe": {"regex": "x", "sense": "present"}}]\n}\n' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /ENT-001 — no result in/)
})

test('Gate 2: a rule whose regex drifted from the measured probe blocks — the ratio no longer belongs to it', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    { measures: '{\n  "results": [{"id": "ENT-001", "verdict": "VALID", "probe": {"regex": "FIXME", "sense": "absent"}}]\n}\n' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /ENT-001 — regex differs from the measured one \(FIXME\)/)
})

test('Gate 2: a gate dropped at render time blocks — the STATIC verdict was established on the gated population', () => {
  const gated = VALID_ENTITY_CONSTRAINT.replace('ENT-001 | absent | TODO | MUST NOT contain TODO', 'ENT-001 | absent | TODO | MUST NOT contain TODO | gate=class')
  const result = runVerify(
    { 'entity.md': gated },
    { measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /ENT-001 — gate differs from the measured one \(none\)/)
})

// --- `a-revoir`: the state that measurement produces and that the in-depth review must resolve.

const CANDIDATES = '.claude/quality/onboard/candidates/entity.json'

function candidatesDoc(rules) {
  return JSON.stringify({ scope: { slug: 'entity', prefix: 'ENT' }, rules }, null, 2)
}

test('Gate 2: a rule left in "a-revoir" blocks — it is neither rendered nor discarded, it vanishes', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    {
      measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n',
      projectFiles: {
        [CANDIDATES]: candidatesDoc([
          { id: 'ENT-001', status: 'retenu', check: 'grep' },
          { id: 'ENT-006', status: 'a-revoir', measure: { matched: 3, total: 9, verdict: 'REFORMULATE' } },
        ]),
      },
    },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /1 rule\(s\) still "a-revoir"/)
  assert.match(result.stdout, /ENT-006 — REFORMULATE/)
})

test('Gate 2: candidates that are all resolved pass', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    {
      measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n',
      projectFiles: {
        [CANDIDATES]: candidatesDoc([
          { id: 'ENT-001', status: 'retenu', check: 'grep' },
          { id: 'ENT-006', status: 'ecarte', reason: 'incoherent', note: 'two practices coexist' },
        ]),
      },
    },
  )

  assert.equal(result.status, 0)
})

test('Gate 2: an unreadable candidates file blocks rather than implying everything is resolved', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    {
      measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n',
      projectFiles: { [CANDIDATES]: '{ "rules": [' },
    },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /unreadable/)
})

test('Gate 2: no candidates folder — nothing to attest, the gate does not block on this', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT },
    { measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n' },
  )

  assert.equal(result.status, 0)
  assert.doesNotMatch(result.stdout, /a-revoir/)
})

// --- hand-maintained files: SPEC allows them next to the onboarded ones (constraint-update
// and the retrospective handle both). They never went through measurement, so the gate
// must not ask them for one — only for SPEC conformance.

const HAND_WRITTEN = [
  '---',
  'paths:',
  '  - "public/images/**"',
  '---',
  '',
  '# Images Constraints',
  '',
  '## Static Rules',
  '',
  '```rules',
  'IMG-001 | present | :widths= | MUST advertise its widths',
  '```',
  '',
  '## Semantic Rules',
  '',
  '- MUST: Declare every heavy image in images.config.mjs',
  '',
].join('\n')

test('Gate 2: a hand-maintained file next to onboarded ones is lint-checked only, never asked for a measurement', () => {
  const result = runVerify(
    { 'entity.md': VALID_ENTITY_CONSTRAINT, 'images.md': HAND_WRITTEN },
    {
      measures: '{\n  "results": [{"id": "ENT-001", "verdict": "STATIC", "probe": {"regex": "TODO", "sense": "absent"}}]\n}\n',
      projectFiles: { [CANDIDATES]: candidatesDoc([{ id: 'ENT-001', status: 'retenu', check: 'grep' }]) },
    },
  )

  assert.equal(result.status, 0, result.stdout)
  assert.match(result.stdout, /1 hand-maintained file\(s\)/)
  assert.match(result.stdout, /images\.md/)
  assert.doesNotMatch(result.stdout, /IMG-001/)
})

test('Gate 2: without any candidates JSON, every file is still held to the measurement', () => {
  const result = runVerify(
    { 'images.md': HAND_WRITTEN },
    { measures: '{\n  "results": [{"id": "OTH-001", "verdict": "STATIC", "probe": {"regex": "x", "sense": "present"}}]\n}\n' },
  )

  assert.equal(result.status, 1)
  assert.match(result.stdout, /IMG-001 — no result in/)
  assert.doesNotMatch(result.stdout, /hand-maintained/)
})
