#!/usr/bin/env node
// render — steps 7 to 10, the deterministic half of the rendering: constraints, tooling
// backlog, gate, then the summary to present to the human.
//
// One entry point instead of four, because none of them is optional and their order is
// not a choice: the backlog is projected from the same candidates, the gate reads what
// was just rendered, and nothing is presented to the human until the gate is green. A
// run that skipped one would still look finished.
//
// Stops at the first script that fails, with its exit code. The approval (approval.mjs)
// stays out: it needs an explicit human answer, never a script's.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STEPS = ['render-constraints.mjs', 'render-backlog.mjs', 'verify-onboard.mjs', 'render-review.mjs']

for (const script of STEPS) {
  const run = spawnSync(process.execPath, [join(HERE, script)], { stdio: 'inherit' })
  if (run.error) {
    console.log(`render: ${script} failed to start: ${run.error.message}`)
    process.exit(1)
  }
  if (run.status !== 0) {
    console.log(`render: stopped at ${script} (exit ${run.status ?? run.signal}) — the steps after it did not run`)
    process.exit(run.status || 1)
  }
}
