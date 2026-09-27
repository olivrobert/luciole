#!/usr/bin/env node
// next-step — reads the onboarding state on disk and names the step to run next, so that
// `/luciole:onboard` without an argument always resumes where the run stopped: after a
// `/clear`, an interruption, or a step the human re-ran by hand.
//
// Output, on stdout: `next: <step> [slug] — <why>`, or `next: done — <summary>`.
// Exit 1 only when a state file is unreadable: guessing past it would re-run a step on
// top of work that exists.
//
// Usage:
//   next-step          # from the project root

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  APPROVAL_FILE, CANDIDATES_DIR, CONSTRAINTS_DIR, FINDINGS_DIR, SCOPES_FILE, loadScopes, rules,
} from './lib/candidates.mjs'
import { constraintsHash } from './lib/approval.mjs'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`next-step: ${path} unreadable: ${error.message}`)
    process.exit(1)
  }
}

function next(step, why) {
  console.log(`next: ${step} — ${why}`)
  process.exit(0)
}

if (!existsSync(SCOPES_FILE)) next('scope', `${SCOPES_FILE} absent`)
readJson(SCOPES_FILE)
const scopes = loadScopes()
if (scopes.length === 0) next('scope', `${SCOPES_FILE} holds no scope`)
const slugs = scopes.map((s) => s.slug)

// Generation is done once every scope has candidates and every live rule a measurement:
// a candidates file without measurement is a step 2 interrupted before step 4.
const docs = new Map()
const ungenerated = []
for (const slug of slugs) {
  const path = join(CANDIDATES_DIR, `${slug}.json`)
  if (!existsSync(path)) { ungenerated.push(slug); continue }
  const doc = readJson(path)
  docs.set(slug, doc)
  if (rules(doc).some((r) => r.status !== 'ecarte' && !r.measure)) ungenerated.push(slug)
}
if (ungenerated.length > 0) next('generate', `not generated or not measured: ${ungenerated.join(', ')}`)

// A scope is reviewed once its findings exist and no rule is left `a-revoir` — the exit
// condition of the review loop. One slug at a time, in scopes.json order.
for (const slug of slugs) {
  if (!existsSync(join(FINDINGS_DIR, `${slug}.json`))) next(`review-scope ${slug}`, 'no findings yet')
  const pending = rules(docs.get(slug)).filter((r) => r.status === 'a-revoir').length
  if (pending > 0) next(`review-scope ${slug}`, `${pending} rule(s) still a-revoir`)
}

// Rendering is done once every scope has its constraints file and the human approval still
// matches them. A candidates file edited after the approval (a review re-run) means the
// constraints were rendered from an older state.
const unrendered = slugs.filter((slug) => !existsSync(join(CONSTRAINTS_DIR, `${slug}.md`)))
if (unrendered.length > 0) next('render', `no constraints file for: ${unrendered.join(', ')}`)
if (!existsSync(APPROVAL_FILE)) next('render', 'constraints not approved yet')
const approval = readJson(APPROVAL_FILE)
if (approval.constraintsHash !== constraintsHash().hash) next('render', 'constraints changed since the approval')
const approvedAt = statSync(APPROVAL_FILE).mtimeMs
const edited = slugs.filter((slug) => statSync(join(CANDIDATES_DIR, `${slug}.json`)).mtimeMs > approvedAt)
if (edited.length > 0) next('render', `candidates edited since the approval: ${edited.join(', ')}`)

const skillsDir = join('.claude', 'skills')
const unskilled = slugs.filter((slug) => !existsSync(join(skillsDir, `quality-${slug}`, 'SKILL.md')))
if (unskilled.length > 0) next('skills', `no skill for: ${unskilled.join(', ')}`)
if (!existsSync(join(skillsDir, 'skill-mapping.md'))) next('skills', 'skill-mapping.md absent')

console.log(`next: done — ${slugs.length} scope(s) onboarded: ${slugs.join(', ')}`)
