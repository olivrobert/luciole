import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { cellKey, chunk, jevPredictions, mustCells, parseCheckerResult, parseConfigs, resolveExpected, score } from './lib.mjs'

const EVALS = dirname(fileURLToPath(import.meta.url))

const group = {
  constraints: ['handler'],
  files: ['src/A/Application/Message/Command/X/XHandler.php'],
  rules: ['#1 [handler] MUST: La classe est readonly.', '#2 [handler] SHOULD: Un détail.'],
}

test('parseConfigs maps shortcuts and engines', () => {
  assert.deepEqual(parseConfigs('haiku,agent:claude-sonnet-5-5,jev,jev:jev-2').map((c) => [c.engine, c.model]), [
    ['agent', 'haiku'], ['agent', 'claude-sonnet-5-5'], ['jev', null], ['jev', 'jev-2'],
  ])
  assert.throws(() => parseConfigs('gpt'), /unknown config/)
})

test('chunk splits a list into lots of the given size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('parseCheckerResult keeps MUST violations and resolves reported paths', () => {
  const text = [
    '```constraint-result', 'constraint: handler', 'files_checked: 1', '', 'COVERAGE:', '- XHandler.php: 2 rules checked — 2 FAIL, 0 N/A', '',
    'VIOLATIONS:',
    '- /tmp/x/src/A/Application/Message/Command/X/XHandler.php:12 #1 (MUST): pas readonly',
    '- XHandler.php:3 #2 (SHOULD): détail', '', 'status: FAIL', 'violations: 2', '```',
  ].join('\n')
  const { predictions, error } = parseCheckerResult(text, group)
  assert.equal(error, null)
  assert.deepEqual(predictions, [cellKey(group.files[0], 'handler', 'MUST: La classe est readonly.')])
})

test('parseCheckerResult flags a missing or ERROR status', () => {
  assert.match(parseCheckerResult('rien', group).error, /no constraint-result/)
  assert.match(parseCheckerResult('VIOLATIONS:\nstatus: ERROR', group).error, /ERROR/)
})

test('jevPredictions maps violation ids to MUST rule texts', () => {
  const doc = {
    rules: [{ rule: 'handler~a', constraint: 'handler', text: 'MUST: R' }, { rule: 'handler~b', constraint: 'handler', text: 'SHOULD: S' }],
    semanticViolations: [{ file: 'f.php', id: 'handler~a' }, { file: 'f.php', id: 'handler~b' }],
  }
  assert.deepEqual(jevPredictions(doc), [cellKey('f.php', 'handler', 'MUST: R')])
})

test('score separates true positives, false positives and misses within the lot', () => {
  const expected = new Set(['a', 'b'])
  const result = score(['a', 'c'], expected, new Set(['a', 'b', 'c']))
  assert.deepEqual(result, { tp: 1, fp: ['c'], fn: ['b'] })
})

test('expected.json resolves every violation to one MUST rule of the fixtures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'luciole-eval-test-'))
  try {
    cpSync(join(EVALS, 'fixtures/project'), dir, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const expected = JSON.parse(readFileSync(join(EVALS, 'fixtures/expected.json'), 'utf8'))
    const matcher = join(EVALS, '../luciole/skills/verify/scripts/match-constraints.js')
    const matched = JSON.parse(execFileSync('node', [matcher, ...expected.files], { cwd: dir, encoding: 'utf8' }))
    const keys = resolveExpected(expected, matched)
    assert.equal(keys.size, expected.violations.length)
    const cells = mustCells(matched)
    for (const key of keys) assert.ok(cells.has(key))
    for (const c of Object.values(matched.constraints)) assert.deepEqual(c.static_violations ?? [], [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
