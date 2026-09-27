// The run document and its projections. One run = one JSON document (`FORMAT`), the only
// source of truth: `rule-stats` and the gates read it, and the markdown report is rendered
// from it for a human reader — it carries no data a machine has to parse back. Both
// engines go through here (`constraint-check` directly, the agent workflow through
// `constraint-report`), so they cannot drift apart.
//
// The document is written on EVERY run, passing or failing: its `rules` array is the
// only source that lets rule-stats say "this rule found nothing for N runs", and
// recording only failures would bias the sample.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const FORMAT = 'constraints-run/1'

const FINDING_LISTS = ['staticViolations', 'semanticViolations', 'semanticWarnings', 'staticWarnings', 'advisories', 'errors', 'summary']

export class ReportError extends Error {}

/**
 * Validates a run document and recomputes everything derivable from its findings: the
 * violation/warning/error counts and the verdict are never taken on trust — an agent that
 * lists a MUST violation cannot also declare success.
 */
export function finalize(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ReportError('the run document must be a JSON object')
    if (doc.format !== FORMAT) throw new ReportError(`"format" must be "${FORMAT}", got ${JSON.stringify(doc.format ?? null)}`)
    if (typeof doc.run_ts !== 'string' || doc.run_ts === '') throw new ReportError('"run_ts" is required')
    if (!Array.isArray(doc.rules)) throw new ReportError('"rules" must be an array (the matcher\'s feedback rows, verdicted)')

    const lists = {}
    for (const key of FINDING_LISTS) {
        const value = doc[key] ?? []
        if (!Array.isArray(value)) throw new ReportError(`"${key}" must be an array`)
        lists[key] = value
    }

    const violations = lists.staticViolations.length + lists.semanticViolations.length
    const warnings = lists.staticWarnings.length + lists.semanticWarnings.length + lists.advisories.length
    const errors = lists.errors.length

    return {
        format: FORMAT,
        run_ts: doc.run_ts,
        ticket: doc.ticket ?? null,
        branch: doc.branch ?? null,
        engine: doc.engine ?? null,
        verdict: {
            success: violations === 0 && errors === 0,
            violations,
            warnings,
            ...(errors > 0 ? { errors } : {}),
        },
        counts: {
            files: doc.counts?.files ?? 0,
            staticRules: doc.counts?.staticRules ?? 0,
            semanticRules: doc.counts?.semanticRules ?? 0,
            violations,
            warnings,
            errors,
        },
        ...lists,
        rules: doc.rules,
    }
}

// --------------------------------------------------------------------------------- files

/** Writes `<name>.json` and the rendered `<name>.md` beside it. */
export function writeRun(doc, dataPath) {
    if (!dataPath.endsWith('.json')) throw new ReportError(`${dataPath}: the run document must be a .json file`)
    const reportPath = `${dataPath.slice(0, -'.json'.length)}.md`
    writeData(doc, dataPath)
    writeFileSync(reportPath, renderReport(doc), 'utf8')

    return { dataPath, reportPath }
}

/** Writes the document alone — a caller-chosen path a gate can read without guessing `run_ts`. */
export function writeData(doc, path) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

// ------------------------------------------------------------------------------- renders

export function renderReport(doc) {
    const { counts } = doc
    const parts = [
        `## Constraints Check: ${statusHeader(counts)}`,
        '',
        `Run: ${doc.run_ts} | Ticket: ${doc.ticket ?? '-'} | Branch: ${doc.branch ?? '-'} | Engine: ${doc.engine ?? '-'}`,
        '',
        `Files checked: ${counts.files}`,
        `Static rules checked: ${counts.staticRules} (0 tokens)`,
        `Semantic rules checked: ${counts.semanticRules}`,
        `Violations found: ${counts.violations}`,
        `Warnings: ${counts.warnings}`,
        `Verification errors: ${counts.errors}`,
    ]

    if (doc.staticViolations.length > 0) {
        parts.push('', '### Static Violations (grep)', ...renderStatic(doc.staticViolations))
    }

    if (doc.semanticViolations.length > 0) {
        parts.push('', '### Semantic Violations', ...renderSemantic(doc.semanticViolations))
    }

    if (doc.semanticWarnings.length > 0) {
        parts.push('', '### Semantic Warnings', ...renderSemantic(doc.semanticWarnings))
    }

    if (doc.staticWarnings.length > 0) {
        parts.push('', '### Static Warnings (grep)', ...renderStatic(doc.staticWarnings))
    }

    if (doc.errors.length > 0) {
        parts.push('', '### Verification errors', ...doc.errors.map((error) => `- ${error.file ?? '(run)'}: ${error.message}`))
    }

    if (doc.advisories.length > 0) {
        parts.push('', '### Advisory (SHOULD-only, never dispatched)', ...doc.advisories.map((text) => `- ${text}`))
    }

    if (doc.summary.length > 0) {
        parts.push('', '### Summary by Constraint Type', ...renderSummary(doc.summary))
    }

    parts.push(
        '',
        `### Total: ${counts.violations} violations, ${counts.warnings} warnings across ${counts.files} files`,
    )

    return `${parts.join('\n')}\n`
}

function renderStatic(violations) {
    const lines = []

    for (const [file, rows] of groupByFile(violations)) {
        lines.push('', `#### ${file}`)
        for (const row of rows) {
            lines.push(`- **${row.id}** (${row.severity})${formatLines(row)}: ${row.message}`)
        }
    }

    return lines
}

// `violation` / `trigger` are the Jev probabilities; `detail` is the agent's own evidence
// ("Lines 43-62: …"). A row carries one or the other.
function renderSemantic(findings) {
    const lines = []

    for (const [file, rows] of groupByFile(findings)) {
        lines.push('', `#### ${file}`)
        for (const row of rows) {
            lines.push(`- **${row.id}** (${row.severity}): ${row.message}`)
            if (typeof row.violation === 'number') {
                lines.push(`  p(violation) = ${row.violation.toFixed(2)}${formatTrigger(row)}`)
            }
            if (row.detail) lines.push(`  ${row.detail}`)
        }
    }

    return lines
}

function renderSummary(summary) {
    const lines = [
        '| Constraint | Static | Semantic | Total | Files |',
        '|------------|--------|----------|-------|-------|',
    ]

    for (const row of summary) {
        lines.push(`| ${row.constraint} | ${row.static} | ${row.semantic} | ${row.total} | ${row.files} |`)
    }

    return lines
}

export function renderSummaryLine(doc, { reportPath, dataPath } = {}) {
    const { counts } = doc
    const lines = [
        `## Constraints Check: ${statusHeader(counts)}`,
        `Files: ${counts.files} | Static: ${counts.staticRules} | Semantic: ${counts.semanticRules} | Violations: ${counts.violations} | Warnings: ${counts.warnings} | Errors: ${counts.errors}`,
        '',
    ]

    for (const row of doc.staticViolations) {
        lines.push(`- ${row.file}${formatLine(row)} ${row.id} (${row.severity}): ${row.message}`)
    }
    for (const row of doc.semanticViolations) {
        const p = typeof row.violation === 'number' ? ` [p=${row.violation.toFixed(2)}]` : ''
        lines.push(`- ${row.file} ${row.id} (${row.severity}): ${row.message}${p}`)
    }
    for (const error of doc.errors) {
        lines.push(`- ERROR ${error.file ?? '(run)'}: ${error.message}`)
    }

    if (reportPath) lines.push('', `Full report: ${reportPath}`)
    if (dataPath) lines.push(`Run data: ${dataPath}`)

    return `${lines.join('\n')}\n`
}

export function renderVerdict(verdict) {
    return `\`\`\`json:verdict\n${JSON.stringify(verdict)}\n\`\`\`\n`
}

function statusHeader(counts) {
    if (counts.errors > 0) return 'INCOMPLETE ❌'
    return counts.violations === 0 ? 'PASSED ✅' : 'FAILED ❌'
}

function groupByFile(rows) {
    const grouped = new Map()

    for (const row of rows) {
        const bucket = grouped.get(row.file) ?? []
        bucket.push(row)
        grouped.set(row.file, bucket)
    }

    return grouped
}

// `line: null` on a `present` rule is not an anomaly: the defect is the ABSENCE of the
// pattern, so there is no offending line to quote.
function formatLine(row) {
    return row.line === null || row.line === undefined ? '' : `:${row.line}`
}

function formatLines(row) {
    if (Array.isArray(row.lines) && row.lines.length > 1) {
        const shown = row.lines.join(', ')

        return row.lines_total && row.lines_total > row.lines.length
            ? ` lines ${shown} (${row.lines_total} in total)`
            : ` lines ${shown}`
    }

    return formatLine(row) === '' ? '' : ` line ${row.line}`
}

function formatTrigger(row) {
    return row.trigger === null || row.trigger === undefined ? '' : `, p(trigger) = ${row.trigger.toFixed(2)}`
}
