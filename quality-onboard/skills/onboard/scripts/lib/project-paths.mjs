import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONFIG_FILE = '.luciole.env'
export const DEFAULT_QUALITY_ROOT = '.ia/quality'

export function qualityRoot(env = process.env, cwd = process.cwd()) {
  const fromEnvironment = env.QUALITY_ROOT?.trim()
  if (fromEnvironment) return fromEnvironment

  const configPath = findUp(CONFIG_FILE, cwd)
  if (!configPath) return DEFAULT_QUALITY_ROOT

  let contents
  try {
    contents = readFileSync(configPath, 'utf8')
  } catch (error) {
    throw new Error(`${configPath}: unreadable Luciole configuration: ${error.message}`)
  }
  const value = envValue(contents, 'QUALITY_ROOT')
  if (!value) throw new Error(`${configPath}: QUALITY_ROOT must be a non-empty value`)
  return resolve(dirname(configPath), value)
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

function findUp(name, start) {
  let current = resolve(start)
  while (true) {
    const candidate = join(current, name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}
