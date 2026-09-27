// The hash of the rendered constraints, shared by the approval (which records it) and the
// next-step detection (which checks it is still current).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { CONSTRAINTS_DIR } from './candidates.mjs'

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

export function constraintsHash() {
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
