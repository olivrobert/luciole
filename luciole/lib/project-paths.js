'use strict'

const fs = require('fs')
const path = require('path')

const CONFIG_FILE = '.luciole.env'
// Uncommitted per-developer overrides, read before CONFIG_FILE, key by key.
const LOCAL_CONFIG_FILE = '.luciole.local.env'
const DEFAULT_QUALITY_ROOT = '.ia/quality'

function qualityRoot(env = process.env, cwd = process.cwd()) {
  const configured = env.QUALITY_ROOT?.trim()
  if (configured) return configured

  const config = readProjectConfig(cwd)
  if (!config) return DEFAULT_QUALITY_ROOT
  const found = configValue(config, 'QUALITY_ROOT')
  if (found) return path.resolve(config.root, found.value)
  if (config.shared) throw new Error(`${config.shared.configPath}: QUALITY_ROOT must be a non-empty value`)
  return DEFAULT_QUALITY_ROOT
}

function verifyEngine(env = process.env, cwd = process.cwd()) {
  const fromEnvironment = env.QUALITY_VERIFY_ENGINE?.trim()
  if (fromEnvironment) return validateVerifyEngine(fromEnvironment, 'QUALITY_VERIFY_ENGINE')

  const config = readProjectConfig(cwd)
  const found = config ? configValue(config, 'QUALITY_VERIFY_ENGINE') : null
  if (!found) return 'agent'
  return validateVerifyEngine(found.value, `${found.configPath}: QUALITY_VERIFY_ENGINE`)
}

function validateVerifyEngine(configured, source) {
  if (!['agent', 'jev'].includes(configured)) {
    throw new Error(`${source} must be "agent" or "jev", got "${configured}"`)
  }
  return configured
}

// The project root is the nearest directory holding either file; both are read from there.
function readProjectConfig(cwd) {
  const root = findUp([LOCAL_CONFIG_FILE, CONFIG_FILE], cwd)
  if (!root) return null
  return {
    root,
    local: readConfigFile(path.join(root, LOCAL_CONFIG_FILE)),
    shared: readConfigFile(path.join(root, CONFIG_FILE)),
  }
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) return null
  try {
    return { configPath, contents: fs.readFileSync(configPath, 'utf8') }
  } catch (error) {
    throw new Error(`${configPath}: unreadable Luciole configuration: ${error.message}`)
  }
}

function configValue(config, name) {
  for (const file of [config.local, config.shared]) {
    const value = file ? envValue(file.contents, name) : null
    if (value) return { value, configPath: file.configPath }
  }
  return null
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
  let current = path.resolve(start)
  while (true) {
    if (names.some((name) => fs.existsSync(path.join(current, name)))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function codeDir(env = process.env, cwd = process.cwd()) {
  return path.join(qualityRoot(env, cwd), 'code')
}

function onboardDir(env = process.env, cwd = process.cwd()) {
  return path.join(qualityRoot(env, cwd), 'onboard')
}

function constraintsDir(env = process.env, cwd = process.cwd()) {
  return path.join(codeDir(env, cwd), 'constraints')
}

module.exports = { CONFIG_FILE, DEFAULT_QUALITY_ROOT, LOCAL_CONFIG_FILE, codeDir, constraintsDir, onboardDir, qualityRoot, verifyEngine }
