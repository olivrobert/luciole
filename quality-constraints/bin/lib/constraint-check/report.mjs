// Renders exactly the report format of the quality-constraints-verify skill: `rule-stats`
// and `quality-retrospective` read these files, so the `json:constraints-run` measurement
// block has to stay in the expected shape, on every run — including passing ones, since
// recording only failures would bias the sample.

export function renderReport(run) {
    const { counts } = run
    const header = statusHeader(counts)

    const parts = [
        `## Constraints Check: ${header}`,
        '',
        `Files checked: ${counts.files}`,
        `Static rules checked: ${counts.staticRules} (0 tokens)`,
        `Semantic rules checked: ${counts.semanticRules}`,
        `Violations found: ${counts.violations}`,
        `Warnings: ${counts.warnings}`,
        `Verification errors: ${counts.errors ?? 0}`,
    ]

    if (run.staticViolations.length > 0) {
        parts.push('', '### Static Violations (grep)', ...renderStatic(run.staticViolations))
    }

    if (run.semanticViolations.length > 0) {
        parts.push('', '### Semantic Violations (TypeSafe)', ...renderSemantic(run.semanticViolations))
    }

    if (run.semanticWarnings.length > 0) {
        parts.push('', '### Warnings', ...renderSemantic(run.semanticWarnings))
    }

    if (run.staticWarnings.length > 0) {
        parts.push('', '### Static Warnings (grep)', ...renderStatic(run.staticWarnings))
    }

    if (run.errors.length > 0) {
        parts.push('', '### Verification errors', ...run.errors.map((error) => `- ${error.file}: ${error.message}`))
    }

    if (run.advisories.length > 0) {
        parts.push('', '### Advisory (SHOULD-only, never dispatched)', ...run.advisories.map((text) => `- ${text}`))
    }

    parts.push('', '### Summary by Constraint Type', ...renderSummary(run.summary))
    parts.push(
        '',
        `### Total: ${counts.violations} violations, ${counts.warnings} warnings across ${counts.files} files`,
    )
    parts.push('', '```json:constraints-run', JSON.stringify(run.measurement), '```')

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

function renderSemantic(findings) {
    const lines = []

    for (const [file, rows] of groupByFile(findings)) {
        lines.push('', `#### ${file}`)
        for (const row of rows) {
            lines.push(`- **${row.id}** (${row.severity}): ${row.message}`)
            lines.push(`  p(violation) = ${row.violation.toFixed(2)}${formatTrigger(row)}`)
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

export function renderSummaryLine(run, reportPath) {
    const { counts } = run
    const header = statusHeader(counts)
    const lines = [
        `## Constraints Check: ${header}`,
        `Files: ${counts.files} | Static: ${counts.staticRules} | Semantic: ${counts.semanticRules} | Violations: ${counts.violations} | Warnings: ${counts.warnings} | Errors: ${counts.errors ?? 0}`,
        '',
    ]

    for (const row of run.staticViolations) {
        lines.push(`- ${row.file}${formatLine(row)} ${row.id} (${row.severity}): ${row.message}`)
    }
    for (const row of run.semanticViolations) {
        lines.push(`- ${row.file} ${row.id} (${row.severity}): ${row.message} [p=${row.violation.toFixed(2)}]`)
    }
    for (const error of run.errors) {
        lines.push(`- ERROR ${error.file}: ${error.message}`)
    }

    if (reportPath) {
        lines.push('', `Full report: ${reportPath}`)
    }

    return `${lines.join('\n')}\n`
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

        return row.linesTotal && row.linesTotal > row.lines.length
            ? ` lines ${shown} (${row.linesTotal} in total)`
            : ` lines ${shown}`
    }

    return formatLine(row) === '' ? '' : ` line ${row.line}`
}

function formatTrigger(row) {
    return row.trigger === null || row.trigger === undefined ? '' : `, p(trigger) = ${row.trigger.toFixed(2)}`
}
