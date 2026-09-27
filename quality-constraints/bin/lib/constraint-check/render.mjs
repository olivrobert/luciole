// constraint-report — turns a run document written by the agent workflow into the same
// artifacts `constraint-check` writes: the normalized `.json` (rewritten in place) and the
// `.md` rendered beside it. The agent writes data only; the markdown and the verdict come
// from code, so both engines render identically and a verdict cannot contradict its
// findings.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { finalize, ReportError, renderSummaryLine, renderVerdict, writeData, writeRun } from './report.mjs'

const USAGE = `
constraint-report <run.json> [--out=<path>]

Validates a run document, recomputes its counts and verdict, rewrites it in place and
renders <run>.md beside it. Prints the summary and the json:verdict block.

Options
  --out=<path>   Also write the run document to this exact path.
  -h, --help     This help.

Exit status
  0   Complete check, no MUST violations.
  1   Complete check, MUST violations found.
  2   Incomplete check, or an unreadable / invalid run document.
`.trimStart()

export function run() {
    try {
        main(process.argv.slice(2))
    } catch (error) {
        const message = error instanceof ReportError || error instanceof SyntaxError ? error.message : (error.stack ?? String(error))
        process.stderr.write(`constraint-report: ${message}\n`)
        process.stdout.write(renderVerdict({ success: false, violations: 0, warnings: 0, errors: 1 }))
        process.exit(2)
    }
}

function main(argv) {
    if (argv.includes('-h') || argv.includes('--help')) {
        process.stdout.write(USAGE)

        return
    }

    const out = argv.find((arg) => arg.startsWith('--out='))?.slice('--out='.length) ?? null
    const unknown = argv.find((arg) => arg.startsWith('-') && !arg.startsWith('--out='))
    if (unknown) throw new ReportError(`unknown option: ${unknown}`)
    const inputs = argv.filter((arg) => !arg.startsWith('-'))
    if (inputs.length !== 1) throw new ReportError('expected exactly one run document path')

    const dataPath = resolve(process.cwd(), inputs[0])
    const doc = finalize(JSON.parse(readFileSync(dataPath, 'utf8')))
    const paths = writeRun(doc, dataPath)
    if (out) writeData(doc, resolve(process.cwd(), out))

    process.stdout.write(`${renderSummaryLine(doc, paths)}\n${renderVerdict(doc.verdict)}`)
    process.exitCode = doc.counts.errors > 0 ? 2 : doc.counts.violations > 0 ? 1 : 0
}
