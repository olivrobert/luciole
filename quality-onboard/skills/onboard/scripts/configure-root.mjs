#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CONFIG_FILE, DEFAULT_QUALITY_ROOT } from './lib/project-paths.mjs'

const requested = process.argv[2]?.trim()
const verifyEngine = process.argv[3]?.trim() || 'agent'
if (!requested || process.argv.length > 4) {
  console.error(`Usage: configure-root.mjs <path> [agent|jev]\nExample: configure-root.mjs ${DEFAULT_QUALITY_ROOT} agent`)
  process.exit(2)
}

const configPath = resolve(process.cwd(), CONFIG_FILE)
if (/[\r\n]/.test(requested)) {
  console.error('QUALITY_ROOT cannot contain a newline')
  process.exit(1)
}
if (!['agent', 'jev'].includes(verifyEngine)) {
  console.error(`QUALITY_VERIFY_ENGINE must be "agent" or "jev", got "${verifyEngine}"`)
  process.exit(1)
}

writeFileSync(
  configPath,
  `QUALITY_ROOT=${JSON.stringify(requested)}\nQUALITY_VERIFY_ENGINE=${JSON.stringify(verifyEngine)}\n`,
)
console.log(`${CONFIG_FILE}: QUALITY_ROOT = ${requested}, QUALITY_VERIFY_ENGINE = ${verifyEngine}`)
