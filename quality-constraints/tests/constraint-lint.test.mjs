import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const LINT = join(HERE, '..', 'bin', 'constraint-lint')

function lint(...args) {
  const r = spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

// One file per case: the lint must point at THE defect, not report four for one.
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'clint-'))
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, body)
  }
  return dir
}

const OK_HEAD = '---\npaths:\n  - "src/**/*.php"\n---\n# X\n'

// A real baseline's conformance is tested BY ITS OWNER: this plugin owns the format, not
// the content, and must not reference any other plugin.

// The case that motivates the whole SPEC: a rule under `## Rules` is extracted by nobody.
test('MUST rule outside a Semantic section — inert', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n## Rules\n- MUST: never called\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /outside any `## Semantic …` section/)
})

test('semantic section title in ### — invisible to the parser', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n### Semantic Rules\n- MUST: never called\n' })
  assert.equal(lint(d).code, 1)
})

test('lowercase severity — ignored without a word', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: real\n- must: ignored\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /UPPERCASE/)
})

// The defect that silently shifts every field of the executed rule.
test('spaced alternation in a regex — field shift, a single error', () => {
  const d = fixture({
    'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | (foo | bar)\\( | msg\n```\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /a regex likely contains/)
  const errs = (r.out.match(/^✗ /gm) || []).length
  assert.equal(errs, 1, `one cause = one error, got ${errs}:\n${r.out}`)
})

test('regex rejected by the engine that will run it (JS RegExp)', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | *nope | msg\n```\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /regex rejected by the engine that will run it/)
})

// Validating with grep -P accepted patterns the matcher rejects: the rule passed the lint
// then was never evaluated.
test('atomic group: accepted by grep -P, rejected by the matcher → lint error', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | (?>foo) | msg\n```\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /regex rejected by the engine that will run it/)
})

// Supported by globToRegex: rejecting them would force the author to work around a valid glob.
test('`?` and `{a,b}` globs accepted', () => {
  const d = fixture({
    'conventions/a.md': `---
paths:
  - "src/**/*{Handler,Command}.php"
  - "src/Acme?/**/*.php"
---
# A

## Semantic Rules
- MUST: something
`,
  })
  const r = lint(d)
  assert.equal(r.code, 0, r.out)
  assert.doesNotMatch(r.out, /not supported/)
})

test('valid `exclude:` accepted, its globs linted like those of `paths:`', () => {
  const ok = fixture({
    'conventions/a.md': `---
paths:
  - "src/**/Command/**/*.php"
exclude:
  - "src/**/Command/**/*Handler.php"
---
# A

## Semantic Rules
- MUST: something
`,
  })
  assert.equal(lint(ok).code, 0, lint(ok).out)

  const bad = fixture({
    'conventions/a.md': `---
paths:
  - "src/**/*.php"
exclude:
  - "src/**/!(*Handler).php"
---
# A

## Semantic Rules
- MUST: something
`,
  })
  const r = lint(bad)
  assert.equal(r.code, 1)
  assert.match(r.out, /not supported/)
})

// An empty `exclude:` key reads as an exclusion in place while removing nothing: the file
// looks like it handles the exemption case, and the rule still runs on it regardless.
test('`exclude:` with no glob → error', () => {
  const d = fixture({
    'conventions/a.md': `---
paths:
  - "src/**/*.php"
exclude:
---
# A

## Semantic Rules
- MUST: something
`,
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /`exclude:` with no glob/)
})

test('missing fields and unknown type', () => {
  const d = fixture({
    'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | onlythree\nXX-002 | maybe | x | msg\n```\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /3 field\(s\)/)
  assert.match(r.out, /type "maybe"/)
})

test('near-miss fence — block never read', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n``` rules\nXX-001 | absent | x | msg\n```\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /unrecognized fence/)
})

test('unclosed rules block', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | x | msg\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /never closed/)
})

test('missing frontmatter or paths', () => {
  const d = fixture({ 'conventions/a.md': '# X\n## Semantic Rules\n- MUST: x\n' })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /missing frontmatter/)
  assert.match(r.out, /no `paths:` key/)
})

test('untranslated globs', () => {
  const d = fixture({
    'conventions/a.md': '---\npaths:\n  - "src/Model[12]/*.php"\n  - "/abs/*.php"\n  - "./rel/*.php"\n---\n# X\n## Semantic Rules\n- MUST: x\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /`\[\]` not supported/)
  assert.match(r.out, /absolute/)
  assert.match(r.out, /remove the/)
})

// The lint knows no language: the scope's extensions are whatever the `paths:` declare. A
// `*.ts` or `*.py` glob is as legitimate as a `*.php` one, and so is an extensionless glob —
// it widens the scope instead of narrowing it, which the matcher assumes.
test('no extension is out of scope', () => {
  const d = fixture({
    'conventions/a.md': '---\npaths:\n  - "src/**/*Service.ts"\n  - "app/**/*.py"\n  - "config/**/*.yaml"\n  - "src/**/Legacy/**"\n---\n# X\n## Semantic Rules\n- MUST: x\n',
  })
  const r = lint(d)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.out.includes('out of scope'), false, r.out)
})

// ID uniqueness applies to the KEY, and two identical basenames merge into one key.
test('duplicated ID across the conventions/ + decisions/ merge', () => {
  const d = fixture({
    'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | x | msg\n```\n## Semantic Rules\n- MUST: y\n',
    'decisions/a.md': OK_HEAD + '\n```rules\nXX-001 | absent | z | other\n```\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /already declared for constraint "a"/)
  assert.match(r.out, /merged from 2 files/)
})

test('duplicated semantic text under the same key — ghost duplicate', () => {
  const d = fixture({
    'conventions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: same text\n',
    'decisions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: same text\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /ghost duplicate/)
})

// The trailing ratio is excluded from store identity: two bullets identical except for the
// ratio ARE the same ghost duplicate, and the lint must see it the way the store would.
test('ghost duplicate detected even when only the ratios differ', () => {
  const d = fixture({
    'conventions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: same text (13/14)\n',
    'decisions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: same text (14/15)\n',
  })
  const r = lint(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /ghost duplicate/)
})

// The advisory verdict applies to the merged key: a decisions/ file that is all SHOULD is not
// advisory if the conventions/ file of the same basename carries a MUST.
test('advisory judged on the merged key, not per file', () => {
  const merged = fixture({
    'conventions/a.md': OK_HEAD + '\n## Semantic Rules\n- MUST: hard rule\n',
    'decisions/a.md': OK_HEAD + '\n## Semantic Rules\n- SHOULD: soft rule\n',
  })
  const r1 = lint(merged)
  assert.equal(r1.code, 0, r1.out)
  assert.doesNotMatch(r1.out, /advisory/)

  const alone = fixture({ 'conventions/b.md': OK_HEAD + '\n## Semantic Rules\n- SHOULD: soft only\n' })
  const r2 = lint(alone)
  assert.equal(r2.code, 0, r2.out)
  assert.match(r2.out, /advisory/)
  // Documented mode (a constraint that is all SHOULD is advisory by choice): flagged as
  // info, never counted — otherwise the onboard gate would reject a SPEC-conforming render.
  assert.equal(lint(alone, '--strict').code, 0, 'advisory is a notice, not a defect — does not block under --strict')
})

test('gate= : valid accepted, regex rejected by the engine reported', () => {
  const ok = fixture({
    'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | JoinTable | msg | gate=ManyToMany\\(\nXX-002 | present | x | msg | gate!=readonly\n```\n',
  })
  assert.equal(lint(ok).code, 0, lint(ok).out)

  const ko = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | x | msg | gate=(?>foo)\n```\n' })
  const r = lint(ko)
  assert.equal(r.code, 1)
  assert.match(r.out, /gate rejected by the engine/)
})

test('empty gate → error: a trigger with no pattern restricts nothing', () => {
  const r = lint(fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | x | msg | gate=\n```\n' }))
  assert.equal(r.code, 1)
  assert.match(r.out, /empty gate/)
})

// A delegated rule is never executed by the checker: its gate therefore filters nothing.
// A legitimate combination nonetheless: the onboard render carries the gate down with the
// probe, `via=` is added afterwards by the dev — the notice is informational, never blocking.
test('gate= on a via= rule → info, the gate is inert but the rule is legitimate', () => {
  const d = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | x | msg | gate=Entity | via=phpstan\n```\n' })
  assert.match(lint(d).out, /the gate restricts nothing/)
  assert.equal(lint(d, '--strict').code, 0, 'an informational notice does not block under --strict')
})

// The case that motivated the reclassification: a perfectly conforming onboard render (static
// via= with gate, semantic via=, all-SHOULD semantics) must pass the --strict gate.
test('legitimate onboard render — via, gate+via, SHOULD-only — passes --strict', () => {
  const d = fixture({
    'handler.md': OK_HEAD
      + '\n```rules\nHDL-001 | present | RoutePrefix:: | MUST use RoutePrefix | gate=AsController | via=phpstan:proj.x\n```\n'
      + '\n## Semantic Rules\n'
      + '- MUST [via=phpstan:proj.noFlush]: Never flush() outside a transaction boundary. Trigger: flush call. Anchor: transactional(). (12/14)\n'
      + '- SHOULD: Return the created entity. Trigger: creation handler. Anchor: return. (10/14)\n',
  })
  const r = lint(d, '--strict')
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /info\(s\)/)
})

test('via= marker: valid accepted, malformed rejected', () => {
  const ok = fixture({
    'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | x | msg | via=phpstan:proj.rule\n```\n## Semantic Rules\n- MUST [via=deptrac]: layered\n- MUST: real one\n',
  })
  assert.equal(lint(ok).code, 0, lint(ok).out)

  const ko = fixture({ 'conventions/a.md': OK_HEAD + '\n```rules\nXX-001 | present | x | msg | via=phpstan.bad\n```\n' })
  const r = lint(ko)
  assert.equal(r.code, 1)
  assert.match(r.out, /malformed delegation marker/)
})

// "No errors" and "nothing verified" must never display the same.
test('nothing to check → exit 2, distinct from conforming', () => {
  const r = lint(join(tmpdir(), 'clint-inexistant-' + process.pid))
  assert.equal(r.code, 2)
  assert.match(r.out, /NO check performed/)
})
