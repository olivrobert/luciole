import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONFIG_FILE = '.luciole.env'
// Uncommitted per-developer overrides, read before CONFIG_FILE, key by key.
export const LOCAL_CONFIG_FILE = '.luciole.local.env'
export const DEFAULT_QUALITY_ROOT = '.ia/quality'

export function qualityRoot(env = process.env, cwd = process.cwd()) {
  const fromEnvironment = env.QUALITY_ROOT?.trim()
  if (fromEnvironment) return fromEnvironment

  // The project root is the nearest directory holding either file; both are read from there.
  const root = findUp([LOCAL_CONFIG_FILE, CONFIG_FILE], cwd)
  if (!root) return DEFAULT_QUALITY_ROOT

  const sharedPath = join(root, CONFIG_FILE)
  for (const configPath of [join(root, LOCAL_CONFIG_FILE), sharedPath]) {
    const value = existsSync(configPath) ? envValue(readConfigFile(configPath), 'QUALITY_ROOT') : null
    if (value) return resolve(root, value)
  }
  if (existsSync(sharedPath)) throw new Error(`${sharedPath}: QUALITY_ROOT must be a non-empty value`)
  return DEFAULT_QUALITY_ROOT
}

function readConfigFile(configPath) {
  try {
    return readFileSync(configPath, 'utf8')
  } catch (error) {
    throw new Error(`${configPath}: unreadable Luciole configuration: ${error.message}`)
  }
}

function envValue(contents, name) {
  const line = contents.split(/\r?\n/).find((candidate) => {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`)
    return pattern.test(candidate)
  })
  if (!line) return null
  let value = line.slice(line.indexOf('=') + 1).trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { value = JSON.parse(value) } catch { return null }
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1)
  }
  return value.trim() || null
}

function findUp(names, start) {
  let current = resolve(start)
  while (true) {
    if (names.some((name) => existsSync(join(current, name)))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}
