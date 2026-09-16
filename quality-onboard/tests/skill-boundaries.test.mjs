import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const ONBOARD = join(PLUGIN, 'skills', 'onboard')

// onboard orchestrates: facts live in references/, roles in agents/, the
// deterministic part in scripts/. A SKILL.md that grows is a SKILL.md that has reabsorbed one
// of those three — and it then gets re-read in full on every invocation, prompts included.
test('onboard stays an orchestrator and loads its details on demand', () => {
  const skill = readFileSync(join(ONBOARD, 'SKILL.md'), 'utf8')

  assert.ok(skill.split('\n').length <= 180, 'onboard/SKILL.md exceeds 180 lines: details belong in references/')

  for (const resource of [
    'references/candidate-schema.md',
    'references/criteria.md',
    'references/findings-schema.md',
    'references/constraint-format.md',
    'references/lint-backlog-format.md',
    'scripts/verify-onboard.mjs',
    'scripts/render-review.mjs',
    'scripts/approval.mjs',
  ]) {
    assert.ok(existsSync(join(ONBOARD, resource)), `missing: ${resource}`)
  }

  for (const agent of ['candidate-generator.md', 'scope-reviewer.md', 'finding-applier.md']) {
    assert.ok(existsSync(join(PLUGIN, 'agents', agent)), `missing: agents/${agent}`)
  }

  // Neither the schema nor the output template is copied here: the agent reads them itself,
  // and two copies of a format diverge on the very first change.
  assert.doesNotMatch(skill, /"candidates":\s*\[/, 'the JSON schema is copied into SKILL.md')
  assert.doesNotMatch(skill, /^```rules$/m, 'the constraints template is copied into SKILL.md')
})

// The two deterministic steps bracket the agents' work. Losing sight of them means
// falling back to rules that are neither measured nor enforceable, and nothing on a re-read shows it.
test('onboard keeps its two deterministic steps', () => {
  const skill = readFileSync(join(ONBOARD, 'SKILL.md'), 'utf8')

  assert.match(skill, /measure-candidates/, 'measurement has vanished from the orchestration')
  assert.match(skill, /constraint-lint/, 'the conformity gate has vanished from the orchestration')
})

// SKILL.md has become a map: execution lives in commands/. A SKILL.md that
// reabsorbs a step is a SKILL.md re-read in full by four commands instead of one.
test('the pipeline\'s four commands exist and SKILL.md does not duplicate them', () => {
  const skill = readFileSync(join(ONBOARD, 'SKILL.md'), 'utf8')

  // No commands/onboard.md: the full run is the skill itself, and two entries
  // for `/quality-onboard:onboard` would fight over the same name.
  for (const command of ['scope.md', 'generate.md', 'review.md', 'render.md']) {
    assert.ok(existsSync(join(PLUGIN, 'commands', command)), `missing: commands/${command}`)
  }

  // A command is invoked, it is not copied: SKILL.md names the deterministic
  // scripts (that's its map) but calls no agent itself.
  assert.doesNotMatch(skill, /Agent\(subagent_type/, 'SKILL.md launches an agent: that\'s a command\'s job')
  assert.equal(existsSync(join(PLUGIN, 'commands', 'onboard.md')), false, 'commands/onboard.md collides with the onboard skill')
})

// The split only holds if state lives on disk. Each command must be able to
// start with no knowledge of what the previous one had in context.
test('each command names the artifacts it depends on', () => {
  const read = (name) => readFileSync(join(PLUGIN, 'commands', name), 'utf8')

  assert.match(read('scope.md'), /scopes\.json/, 'scope does not write scopes.json')
  assert.match(read('generate.md'), /scopes\.json/, 'generate does not read scopes.json')
  assert.match(read('review.md'), /findings/, 'review does not go through the findings')
  assert.match(read('review.md'), /--slug/, 'review re-measures without restricting to the scope')
  assert.match(read('render.md'), /verify-onboard/, 'render does not pass the gate')
  assert.match(read('render.md'), /render-review/, 'render does not present the final human review')
  assert.match(read('render.md'), /approval\.mjs approve/, 'render does not record human approval')
  assert.match(read('skills.md'), /approval\.mjs check/, 'skills does not verify human approval')
})
