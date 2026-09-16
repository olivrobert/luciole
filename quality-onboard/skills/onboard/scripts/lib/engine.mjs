// Where the `quality-constraints` engine binaries live — the ONE question every harness
// answers differently, so it's answered here and nowhere else.
//
// The onboard scripts call `constraint-lint` and `measure-candidates`, shipped by the sibling
// plugin. Spawning them by bare name only works once `/quality-constraints:install` has put
// shims on the PATH — a step the README used to call optional, so the run died at step 4
// with "not found". And no `${CLAUDE_PLUGIN_ROOT}`-style variable can help: it names THIS
// plugin, not its sibling, and it doesn't exist outside Claude Code (Codex, a CI job, a
// plain terminal).
//
// Resolution order, first hit wins:
//   1. `CONSTRAINT_KIT_BIN` — an explicit directory. Set but wrong is an error, not a
//      fallthrough: a misconfiguration must not silently pick another version.
//   2. the monorepo sibling: `<repo>/quality-constraints/bin`, relative to this file. That's
//      the layout of a plain `git clone`, whatever runs the scripts.
//   3. a versioned sibling: `<cache>/quality-onboard/<v>/…` next to
//      `<cache>/quality-constraints/<v>/bin` — the layout plugin marketplaces install into.
//      Highest version wins when several are cached.
//   4. the PATH, by bare name — the `/quality-constraints:install` shims, or a CI image.
//
// A resolved FILE is run through the current `node` (`process.execPath`), so neither an
// executable bit nor a `node` on the PATH is required. A bare NAME is spawned as-is.
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINE_BINARIES = ['constraint-lint', 'measure-candidates']
export const ENV_VAR = 'CONSTRAINT_KIT_BIN'

const HERE = dirname(fileURLToPath(import.meta.url))
// lib → scripts → onboard → skills → <quality-onboard root>
const PLUGIN_ROOT = resolve(HERE, '..', '..', '..', '..')

function versionedSiblings() {
  // PLUGIN_ROOT = <cache>/quality-onboard/<v>  →  <cache>/quality-constraints/<any v>/bin
  const cache = resolve(PLUGIN_ROOT, '..', '..')
  const dir = join(cache, 'quality-constraints')
  if (!existsSync(dir)) return []
  let versions
  try { versions = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
  return versions.sort().reverse().map((v) => join(dir, v, 'bin'))
}

/**
 * Resolves one engine binary. Returns `{ file }` (absolute path, run through node) or
 * `{ name }` (bare, resolved by the shell's PATH), or throws with a message that says
 * what was tried and how to fix it.
 */
export function resolveEngineBinary(name, env = process.env) {
  const explicit = env[ENV_VAR]
  if (explicit) {
    const file = join(explicit, name)
    if (existsSync(file)) return { file }
    throw new Error(`${ENV_VAR}=${explicit} is set but ${file} does not exist`)
  }
  for (const dir of [resolve(PLUGIN_ROOT, '..', 'quality-constraints', 'bin'), ...versionedSiblings()]) {
    const file = join(dir, name)
    if (existsSync(file)) return { file }
  }
  const onPath = (env.PATH || '').split(':').some((d) => d && existsSync(join(d, name)))
  if (onPath) return { name }
  throw new Error(
    `${name} not found — the quality-constraints engine is required by quality-onboard.\n` +
    `  Tried: ${ENV_VAR} (unset), ${resolve(PLUGIN_ROOT, '..', 'quality-constraints', 'bin')}, the plugin cache, the PATH.\n` +
    `  Fix: run /quality-constraints:install (Claude Code), or export ${ENV_VAR}=<path to quality-constraints/bin>.`,
  )
}

/** spawnSync on a resolved engine binary. Same return shape as spawnSync. */
export function runEngine(name, args, options = {}) {
  const bin = resolveEngineBinary(name)
  return bin.file
    ? spawnSync(process.execPath, [bin.file, ...args], { encoding: 'utf8', ...options })
    : spawnSync(bin.name, args, { encoding: 'utf8', ...options })
}

/**
 * Checks every engine binary resolves. Returns the list of error messages (empty = OK).
 * Meant for step 1: a missing engine must stop the run before an agent costs anything,
 * not at step 4 after N generators.
 */
export function engineErrors(names = ENGINE_BINARIES) {
  const errors = []
  for (const n of names) {
    try { resolveEngineBinary(n) } catch (e) { errors.push(e.message) }
  }
  return errors
}
