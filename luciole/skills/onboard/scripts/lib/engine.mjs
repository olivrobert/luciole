// Where the engine binaries live — the ONE question every harness answers differently, so
// it's answered here and nowhere else.
//
// The onboard scripts call `constraint-lint` and `measure-candidates`, shipped in this
// plugin's `bin/`. Spawning them by bare name only works once `/luciole:install` has put
// shims on the PATH, and `${CLAUDE_PLUGIN_ROOT}` doesn't exist outside Claude Code (Codex,
// a CI job, a plain terminal): the scripts find them by position instead.
//
// Resolution order, first hit wins:
//   1. `CONSTRAINT_KIT_BIN` — an explicit directory. Set but wrong is an error, not a
//      fallthrough: a misconfiguration must not silently pick another version.
//   2. `<plugin root>/bin`, relative to this file — a plain `git clone` and the plugin
//      cache alike.
//   3. the PATH, by bare name — the `/luciole:install` shims, or a CI image.
//
// A resolved FILE is run through the current `node` (`process.execPath`), so neither an
// executable bit nor a `node` on the PATH is required. A bare NAME is spawned as-is.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENGINE_BINARIES = ['constraint-lint', 'measure-candidates']
export const ENV_VAR = 'CONSTRAINT_KIT_BIN'

const HERE = dirname(fileURLToPath(import.meta.url))
// lib → scripts → onboard → skills → <plugin root>
const PLUGIN_BIN = resolve(HERE, '..', '..', '..', '..', 'bin')

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
  const file = join(PLUGIN_BIN, name)
  if (existsSync(file)) return { file }
  const onPath = (env.PATH || '').split(':').some((d) => d && existsSync(join(d, name)))
  if (onPath) return { name }
  throw new Error(
    `${name} not found — the onboarding needs the luciole engine binaries.\n` +
    `  Tried: ${ENV_VAR} (unset), ${PLUGIN_BIN}, the PATH.\n` +
    `  Fix: run /luciole:install (Claude Code), or export ${ENV_VAR}=<path to luciole/bin>.`,
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
