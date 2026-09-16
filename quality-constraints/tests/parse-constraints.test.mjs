import { test } from 'node:test'
import assert from 'node:assert/strict'
import parser from '../lib/parse-constraints.js'

const { isInSemanticSection, isInStaticBlock, parseConstraintFile, parseStaticRule, regexError } = parser

test('parseConstraintFile: frontmatter, rules blocks and semantic section share the same grammar', () => {
  const document = parseConstraintFile(`---
paths:
  - "src/**/*.php"
  - templates/**/*.html.twig
---
# Example

\`\`\`rules
EX-001 | absent | var_dump\\( | do not dump
\`\`\`

## Semantic Rules
### Special case
- MUST: respect the invariant
- SHOULD [via=phpstan]: delegate to the right tool

## Notes
- MUST: this line is outside the section
`)

  assert.deepEqual(document.paths, ['src/**/*.php', 'templates/**/*.html.twig'])
  assert.deepEqual(document.staticRules, ['EX-001 | absent | var_dump\\( | do not dump'])
  assert.deepEqual(document.semanticRules, ['MUST: respect the invariant'])
  assert.equal(isInStaticBlock(document, 9), true)
  assert.equal(isInSemanticSection(document, 14), true)
  assert.equal(isInSemanticSection(document, 18), false)
})

test('parseConstraintFile: only a leading frontmatter is consumed', () => {
  const document = parseConstraintFile(`# No frontmatter
---
paths:
  - "src/**/*.php"
---
`)

  assert.equal(document.frontmatter.openAt, null)
  assert.deepEqual(document.paths, [])
})

test('parseConstraintFile: `exclude:` is read like `paths:`, and each key receives its own items', () => {
  const document = parseConstraintFile(`---
paths:
  - "src/**/Command/**/*.php"
exclude:
  - "src/**/Command/**/*Handler.php"
  - src/Legacy/**/*.php
---
# Example
`)

  assert.deepEqual(document.paths, ['src/**/Command/**/*.php'])
  assert.deepEqual(document.exclude, ['src/**/Command/**/*Handler.php', 'src/Legacy/**/*.php'])
  assert.equal(document.frontmatter.excludeAt, 4)
})

test('parseConstraintFile: without `exclude:`, the list stays empty — nothing is subtracted by default', () => {
  const document = parseConstraintFile(`---
paths:
  - "src/**/*.php"
---
`)

  assert.deepEqual(document.exclude, [])
  assert.equal(document.frontmatter.excludeAt, null)
})

test('parseStaticRule and regexError carry the shared splitting and engine', () => {
  assert.deepEqual(parseStaticRule('EX-001 | absent | (foo|bar) | message | via=phpstan:project.rule'), {
    fields: ['EX-001', 'absent', '(foo|bar)', 'message', 'via=phpstan:project.rule'],
    id: 'EX-001',
    type: 'absent',
    regex: '(foo|bar)',
    message: 'message',
    via: 'via=phpstan:project.rule',
    gate: null,
    unknown: [],
  })
  assert.equal(regexError('(?>foo)') !== null, true)
  assert.equal(regexError('[[:upper:]]+'), null)
})

test('gate= is extracted as a trigger probe, sense present by default', () => {
  const rule = parseStaticRule('EX-002 | present | JoinTable | message | gate=ManyToMany\\(inversedBy')
  assert.deepEqual(rule.gate, { sense: 'present', regex: 'ManyToMany\\(inversedBy' })
  assert.equal(rule.via, '')
  assert.deepEqual(rule.unknown, [])
})

test('gate!= carries the absent sense: the file is concerned when the pattern is missing', () => {
  assert.deepEqual(parseStaticRule('EX-003 | present | x | message | gate!=readonly class').gate, {
    sense: 'absent',
    regex: 'readonly class',
  })
})

// Suffixes are recognized by their prefix, not their position: a rule carrying both must
// not depend on the order in which the render wrote them.
test('gate= and via= coexist in either order', () => {
  const a = parseStaticRule('EX-004 | present | x | msg | gate=Entity | via=phpstan')
  const b = parseStaticRule('EX-004 | present | x | msg | via=phpstan | gate=Entity')
  assert.deepEqual(a.gate, b.gate)
  assert.equal(a.via, b.via)
  assert.deepEqual(a.unknown, [])
  assert.deepEqual(b.unknown, [])
})

// A field with no known prefix is not an exotic suffix: it's a regex split in two by an
// internal ` | `. It must stay visible so the linter can report it.
test('field 5 with no known prefix → unknown, never swallowed by via', () => {
  const rule = parseStaticRule('EX-005 | absent | (foo | bar) | message')
  assert.deepEqual(rule.unknown, ['message'])
  assert.equal(rule.via, '')
  assert.equal(rule.gate, null)
})

// A semantic rule's identity excludes the trailing measurement ratio: the onboard render
// refreshes it on every re-measurement, and the store's history must not reset to zero just
// because the population moved from 14 to 15 files.
test('semanticIdentityText: the trailing ratio is dropped, the rest is untouched', () => {
  const { semanticIdentityText } = parser
  assert.equal(
    semanticIdentityText('MUST: Return the entity. Trigger: creation. Anchor: return. (13/14)'),
    'MUST: Return the entity. Trigger: creation. Anchor: return.'
  )
  // Updated ratio → same identity
  assert.equal(
    semanticIdentityText('MUST: x. (13/14)'),
    semanticIdentityText('MUST: x. (14/15)')
  )
  // No ratio → text unchanged; a parenthesis in the middle of the text is not a ratio
  assert.equal(semanticIdentityText('MUST: call flush() once'), 'MUST: call flush() once')
  assert.equal(semanticIdentityText('MUST: limit (2/3) of cases at the start'), 'MUST: limit (2/3) of cases at the start')
  // The consistency suffix is part of the text: it does not change on re-measurement
  assert.equal(
    semanticIdentityText('SHOULD: y — consistency, non-blocking (9/12)'),
    'SHOULD: y — consistency, non-blocking'
  )
})
