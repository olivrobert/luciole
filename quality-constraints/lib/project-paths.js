'use strict'

const fs = require('fs')
const path = require('path')

const CONFIG_FILE = '.luciole.env'
const DEFAULT_QUALITY_ROOT = '.ia/quality'

function qualityRoot(env = process.env, cwd = process.cwd()) {
  const configured = env.QUALITY_ROOT?.trim()
  if (configured) return configured

  const { configPath, contents } = readProjectEnv(cwd)
  if (!configPath) return DEFAULT_QUALITY_ROOT
  const value = envValue(contents, 'QUALITY_ROOT')
  if (!value) throw new Error(`${configPath}: QUALITY_ROOT must be a non-empty value`)
  return path.resolve(path.dirname(configPath), value)
}

function verifyEngine(env = process.env, cwd = process.cwd()) {
  const fromEnvironment = env.QUALITY_VERIFY_ENGINE?.trim()
  if (fromEnvironment) return validateVerifyEngine(fromEnvironment, 'QUALITY_VERIFY_ENGINE')

  const { configPath, contents } = readProjectEnv(cwd)
  const configured = (configPath ? envValue(contents, 'QUALITY_VERIFY_ENGINE') : null) || 'agent'
  const source = configPath ? `${configPath}: QUALITY_VERIFY_ENGINE` : 'QUALITY_VERIFY_ENGINE'
  return validateVerifyEngine(configured, source)
}

function validateVerifyEngine(configured, source) {
  if (!['agent', 'jev'].includes(configured)) {
    throw new Error(`${source} must be "agent" or "jev", got "${configured}"`)
  }
  return configured
}

function readProjectEnv(cwd) {
  const configPath = findUp(CONFIG_FILE, cwd)
  if (!configPath) return { configPath: null, contents: '' }
  try {
    return { configPath, contents: fs.readFileSync(configPath, 'utf8') }
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

function findUp(name, start) {
  let current = path.resolve(start)
  while (true) {
    const candidate = path.join(current, name)
    if (fs.existsSync(candidate)) return candidate
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

module.exports = { CONFIG_FILE, DEFAULT_QUALITY_ROOT, codeDir, constraintsDir, onboardDir, qualityRoot, verifyEngine }
