#!/usr/bin/env node
// approval — records or checks the human approval of the exact version of the
// constraints. The script attests a content; the render command remains responsible
// for only running `approve` after an explicit answer from the user.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { APPROVAL_FILE, CONSTRAINTS_DIR } from './lib/candidates.mjs'

function markdownFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...markdownFiles(full))
    else if (entry.isFile() && extname(entry.name) === '.md') out.push(full)
  }
  return out.sort()
}

function constraintsHash() {
  const files = markdownFiles(CONSTRAINTS_DIR)
  if (files.length === 0) throw new Error(`no .md file in ${CONSTRAINTS_DIR}/`)

  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(CONSTRAINTS_DIR, file))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return { hash: `sha256:${hash.digest('hex')}`, files: files.length }
}

const action = process.argv[2]
if (!['approve', 'check'].includes(action)) {
  console.error('usage: approval.mjs approve|check')
  process.exit(2)
}

let current
try {
  current = constraintsHash()
} catch (error) {
  console.error(`approval: ${error.message}`)
  process.exit(1)
}

if (action === 'approve') {
  mkdirSync(dirname(APPROVAL_FILE), { recursive: true })
  writeFileSync(APPROVAL_FILE, JSON.stringify({
    constraintsHash: current.hash,
    files: current.files,
    approvedAt: new Date().toISOString(),
  }, null, 2) + '\n')
  console.log(`approval: ${current.files} constraints file(s) approved — ${APPROVAL_FILE}`)
  process.exit(0)
}

if (!existsSync(APPROVAL_FILE)) {
  console.error(`approval: ${APPROVAL_FILE} missing — run /quality-onboard:render and validate the rules`)
  process.exit(1)
}

let approval
try {
  approval = JSON.parse(readFileSync(APPROVAL_FILE, 'utf8'))
} catch (error) {
  console.error(`approval: ${APPROVAL_FILE} unreadable: ${error.message}`)
  process.exit(1)
}

if (approval.constraintsHash !== current.hash) {
  console.error('approval: constraints changed since human validation — rerun /quality-onboard:render')
  process.exit(1)
}

console.log(`approval: ${current.files} constraints file(s) approved, valid hash`)
