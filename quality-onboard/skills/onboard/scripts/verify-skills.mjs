#!/usr/bin/env node
// verify-skills — step 11. Checks the creation skills rendered in `.claude/skills/`
// against the scope contract `scopes.json`.
//
// The skills are minimal by construction: they route to the constraints file, the sole
// normative source. This script therefore has no grammar to enforce — it catches what
// doesn't show up on a re-read: a scope without a skill, a template token left in the
// render, a skill without a form model, a mapping that doesn't cover a slug.
//
// Usage:
//   verify-skills [--project <dir>]   # default: cwd

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const i = argv.indexOf('--project')
const projectRoot = i === -1 ? process.cwd() : argv[i + 1]

const errors = []
const fail = (file, msg) => errors.push(`${file}: ${msg}`)

const scopesFile = join(projectRoot, '.claude/quality/onboard/scopes.json')
if (!existsSync(scopesFile)) {
  console.log('verify-skills: scopes.json absent — nothing to check')
  process.exit(2)
}
const scopes = JSON.parse(readFileSync(scopesFile, 'utf8'))?.scopes ?? []
const skillsDir = join(projectRoot, '.claude', 'skills')

for (const scope of scopes) {
  const name = `quality-${scope.slug}`
  const dir = join(skillsDir, name)
  const skillFile = join(dir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    fail(`.claude/skills/${name}/SKILL.md`, 'absent — every scope gets its skill')
    continue
  }
  // A skill folder contains only SKILL.md. Everything else — a leftover reference.md,
  // a snippet, a commented-out variant — is waiting to be copied in, and nothing in the
  // skill points to it.
  const stray = readdirSync(dir).filter((e) => e !== 'SKILL.md')
  if (stray.length > 0) {
    fail(`.claude/skills/${name}`, `must contain only SKILL.md — also found: ${stray.join(', ')}`)
  }
  const text = readFileSync(skillFile, 'utf8')
  // A rendered skill carries no token: one still present means generation didn't finish.
  const left = [...new Set([...text.matchAll(/\{[A-Z_]+\}/g)].map((m) => m[0]))]
  if (left.length > 0) fail(`.claude/skills/${name}/SKILL.md`, `unresolved token: ${left.join(', ')} — generation incomplete`)
  if (!text.includes(`constraints/${scope.slug}.md`)) {
    fail(`.claude/skills/${name}/SKILL.md`, `does not route to constraints/${scope.slug}.md — the skill has no other normative source`)
  }
  // The constraints state the rule, the model shows the shape. A skill without a model
  // leaves everything the rules don't cover — member order, splitting, local naming —
  // to the invention of the agent creating the file.
  if (!scope.model) {
    fail(`.claude/skills/${name}/SKILL.md`, `scope \`${scope.slug}\` has no \`model\` in scopes.json — the skill cannot show a reference shape`)
  } else if (!text.includes(scope.model)) {
    fail(`.claude/skills/${name}/SKILL.md`, `does not route to the model ${scope.model} declared by the scope`)
  }
}

const mapping = join(skillsDir, 'skill-mapping.md')
if (!existsSync(mapping)) {
  fail('.claude/skills/skill-mapping.md', 'absent — this is where the arbitration against a competing generic skill lives')
} else {
  const text = readFileSync(mapping, 'utf8').toLowerCase()
  for (const scope of scopes) {
    if (!text.includes(`quality-${scope.slug}`)) fail('.claude/skills/skill-mapping.md', `does not cover \`${scope.slug}\``)
  }
}

if (errors.length === 0) {
  console.log(`verify-skills: ${scopes.length} scope(s), OK`)
  process.exit(0)
}
console.log(`verify-skills: ${scopes.length} scope(s), ${errors.length} error(s)`)
for (const e of errors) console.log(`  ${e}`)
process.exit(1)
