import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPTS = join(HERE, '..', 'skills', 'onboard', 'scripts')
const ONBOARD = '.ia/quality/onboard'
const CONSTRAINTS = '.ia/quality/code/constraints'

function run(root, script, args = []) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, QUALITY_ROOT: '' },
  })
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
}

const next = (root) => run(root, 'next-step.mjs').stdout.trim()

const measured = { id: 'ENT-001', status: 'retenu', measure: { total: 4, matched: 4, verdict: 'STATIC' } }

// `/luciole:onboard` without an argument trusts this script to resume the run: each state the
// steps leave on disk must lead to the step that follows it, never to one already done.
test('next-step walks the onboarding in order, from an empty project to done', () => {
  const root = mkdtempSync(join(tmpdir(), 'next-step-'))
  assert.match(next(root), /^next: scope — /)

  write(root, `${ONBOARD}/scopes.json`, { scopes: [{ slug: 'entity' }, { slug: 'handler' }] })
  assert.match(next(root), /^next: generate — not generated or not measured: entity, handler$/)

  // A candidates file whose live rules are not measured yet: step 2 stopped before step 4.
  write(root, `${ONBOARD}/candidates/entity.json`, { rules: [{ id: 'ENT-001', status: 'retenu' }] })
  write(root, `${ONBOARD}/candidates/handler.json`, { rules: [measured] })
  assert.match(next(root), /^next: generate — not generated or not measured: entity$/)

  write(root, `${ONBOARD}/candidates/entity.json`, { rules: [measured, { id: 'ENT-002', status: 'a-revoir', measure: {} }] })
  assert.match(next(root), /^next: review-scope entity — no findings yet$/)

  // Findings written, but the applier left a rule to review: the loop is not over.
  write(root, `${ONBOARD}/findings/entity.json`, {})
  assert.match(next(root), /^next: review-scope entity — 1 rule\(s\) still a-revoir$/)

  write(root, `${ONBOARD}/candidates/entity.json`, { rules: [measured] })
  assert.match(next(root), /^next: review-scope handler — /)

  write(root, `${ONBOARD}/findings/handler.json`, {})
  assert.match(next(root), /^next: render — no constraints file for: entity, handler$/)

  write(root, `${CONSTRAINTS}/entity.md`, '# entity\n')
  write(root, `${CONSTRAINTS}/handler.md`, '# handler\n')
  assert.match(next(root), /^next: render — constraints not approved yet$/)

  assert.equal(run(root, 'approval.mjs', ['approve']).status, 0)
  assert.match(next(root), /^next: skills — no skill for: entity, handler$/)

  write(root, '.claude/skills/quality-entity/SKILL.md', '')
  write(root, '.claude/skills/quality-handler/SKILL.md', '')
  assert.match(next(root), /^next: skills — skill-mapping\.md absent$/)

  write(root, '.claude/skills/skill-mapping.md', '')
  assert.match(next(root), /^next: done — 2 scope\(s\) onboarded: entity, handler$/)

  // Going back over a review after the approval: the delivered constraints are stale.
  const later = new Date(Date.now() + 60_000)
  utimesSync(join(root, `${ONBOARD}/candidates/handler.json`), later, later)
  assert.match(next(root), /^next: render — candidates edited since the approval: handler$/)

  write(root, `${CONSTRAINTS}/entity.md`, '# entity, edited by hand\n')
  assert.match(next(root), /^next: render — constraints changed since the approval$/)
})

test('next-step stops on an unreadable state file instead of guessing past it', () => {
  const root = mkdtempSync(join(tmpdir(), 'next-step-'))
  write(root, `${ONBOARD}/scopes.json`, { scopes: [{ slug: 'entity' }] })
  write(root, `${ONBOARD}/candidates/entity.json`, '{ not json')

  const result = run(root, 'next-step.mjs')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /entity\.json unreadable/)
})
