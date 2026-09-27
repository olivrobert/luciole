#!/usr/bin/env node

// constraint-check — checks code against .ia/quality/code/constraints.
//
// Scope, static rules and the file ↔ constraint matching are delegated to
// match-constraints.js (the quality-constraints-verify skill already leans on it, and that
// work costs 0 tokens). This CLI replaces the one stage that used to go through agents:
// verifying the semantic rules, handed here to TypeSafe System One — one request per file,
// two Noul questions per rule, evaluated in parallel.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import projectPaths from '../../../lib/project-paths.js'

import { buildQuestions, readAnswers } from './questions.mjs'
import { finalize, FORMAT, renderReport, renderSummaryLine, renderVerdict, writeData, writeRun } from './report.mjs'
import { isBlocking, parseSemanticRule } from './rules.mjs'
import { mapWithConcurrency, TypeSafeClient, TypeSafeError } from './typesafe.mjs'

const { codeDir } = projectPaths

const USAGE = `
constraint-check [files… | directories…] [options]

With no argument, the scope is the current git diff.

Options
  --ticket=<name>           Identifier carried into the run document.
  --reports=<dir>           Report folder (default: .ia/quality/code/reports/constraints).
                            Each run writes <run_ts>-constraints.json (the run document,
                            read by rule-stats) and <run_ts>-constraints.md (rendered from it).
  --out=<path>              Also write the run document to this exact path — a fixed name
                            a gate can read without knowing the run_ts.
  --matcher=<path>          Path to match-constraints.js (default: bundled matcher).
  --model=<name>            System One model (default: jev-latest).
  --threshold=<0-1>         Violation threshold (default: 0.70).
  --trigger-threshold=<0-1> Threshold above which a rule is deemed to apply (default: 0.50).
  --uncertain=<0-1>         Floor of the uncertainty band, reported as a warning (default: 0.50).
  --concurrency=<n>         Concurrent requests (default: 6).
  --max-chars=<n>           Maximum file size in characters (default: 60000); larger files
                            make the check incomplete, never silently truncated.
  --semantic-only           Drop the static (grep) rules, keep only the TypeSafe stage.
  --respect-non-blocking    Downgrade MUST rules flagged "non-blocking" to warnings.
  --json                    Emit only the run document on stdout.
  --stdout                  Print the markdown report instead of writing the report folder.
  --dry-run                 Do not call the API: print the requests that would be sent.
  -h, --help                This help.

Environment
  QUALITY_ROOT              Quality artifacts root. Overrides project-root
                            .luciole.local.env then .luciole.env; default: .ia/quality.
  TYPESAFE_API_KEY          Required for semantic checks, except with --dry-run.
                            Falls back to TYPESAFE_API_KEY in <project-root>/.env.local.

Exit status
  0                        Complete check, no MUST violations.
  1                        Complete check, MUST violations found.
  2                        Incomplete check or command error; the gate must block.
`.trimStart()

const DEFAULTS = {
    model: 'jev-latest',
    threshold: 0.7,
    triggerThreshold: 0.5,
    uncertain: 0.5,
    concurrency: 6,
    maxChars: 60_000,
}

function run() {
    main().catch((error) => {
        const message = error instanceof TypeSafeError ? error.message : (error.stack ?? String(error))
        process.stderr.write(`constraint-check: ${message}\n`)
        const verdict = { success: false, violations: 0, warnings: 0, errors: 1 }
        const failed = { format: FORMAT, verdict, errors: [{ file: null, message }] }
        process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(failed)}\n` : renderVerdict(verdict))
        process.exit(2)
    })
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
        process.stdout.write(USAGE)

        return
    }

    const matched = runMatcher(options)
    options.projectRoot = matched.project_root ?? process.cwd()
    if (matched.error === 'no_files') {
        // Nothing measured, so no report — but a gate waiting on `--out` still gets its verdict.
        const doc = finalize({ format: FORMAT, run_ts: timestamp(), ticket: options.ticket, engine: engineOf(options), rules: [] })
        if (options.out) writeData(doc, resolve(process.cwd(), options.out))
        process.stdout.write(
            options.json ? `${JSON.stringify(doc)}\n` : `## Constraints Check: PASSED ✅\nNo files to check.\n\n${renderVerdict(doc.verdict)}`,
        )

        return
    }

    const jobs = buildJobs(matched, options)
    if (options.dryRun) {
        process.stdout.write(`${JSON.stringify(jobs, null, 2)}\n`)
        process.exitCode = jobs.some((job) => job.error) ? 2 : 0

        return
    }

    const hasRequests = jobs.some((job) => !job.error)
    if (hasRequests) loadApiKey(options.projectRoot)
    const client = hasRequests ? new TypeSafeClient({ model: options.model }) : null
    const findings = await verify(jobs, client, options)
    const doc = assemble(matched, jobs, findings, options)

    emit(doc, options)

    process.exit(doc.counts.errors > 0 ? 2 : doc.counts.violations > 0 ? 1 : 0)
}

// ----------------------------------------------------------------------------- arguments

function parseArgs(argv) {
    const options = {
        ...DEFAULTS,
        targets: [],
        ticket: null,
        reports: null,
        out: null,
        matcher: null,
        semanticOnly: false,
        respectNonBlocking: false,
        json: false,
        stdout: false,
        dryRun: false,
        help: false,
    }

    for (const arg of argv) {
        const [key, value] = splitFlag(arg)
        switch (key) {
            case '-h':
            case '--help':
                options.help = true
                break
            case '--ticket':
                options.ticket = value
                break
            case '--reports':
                options.reports = value
                break
            case '--out':
                options.out = value
                break
            case '--matcher':
                options.matcher = value
                break
            case '--model':
                options.model = value
                break
            case '--threshold':
                options.threshold = number(value, '--threshold')
                break
            case '--trigger-threshold':
                options.triggerThreshold = number(value, '--trigger-threshold')
                break
            case '--uncertain':
                options.uncertain = number(value, '--uncertain')
                break
            case '--concurrency':
                options.concurrency = number(value, '--concurrency')
                break
            case '--max-chars':
                options.maxChars = number(value, '--max-chars')
                break
            case '--semantic-only':
                options.semanticOnly = true
                break
            case '--respect-non-blocking':
                options.respectNonBlocking = true
                break
            case '--json':
                options.json = true
                break
            case '--stdout':
                options.stdout = true
                break
            case '--dry-run':
                options.dryRun = true
                break
            default:
                if (key.startsWith('-')) {
                    throw new Error(`unknown option: ${key}`)
                }
                options.targets.push(arg)
        }
    }

    for (const key of ['threshold', 'triggerThreshold', 'uncertain']) {
        if (options[key] < 0 || options[key] > 1) throw new Error(`${key} must be between 0 and 1`)
    }
    if (options.uncertain > options.threshold) throw new Error('--uncertain must not exceed --threshold')
    for (const key of ['concurrency', 'maxChars']) {
        if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`${key} must be a positive integer`)
    }
    return options
}

function splitFlag(arg) {
    const at = arg.indexOf('=')

    return at === -1 ? [arg, null] : [arg.slice(0, at), arg.slice(at + 1)]
}

function number(value, flag) {
    const parsed = Number(value)
    if (value === null || value.trim() === '' || !Number.isFinite(parsed)) {
        throw new Error(`${flag} expects a number, got "${value}"`)
    }

    return parsed
}

// Keep secrets in the checked project, never in the plugin installation. An explicit
// environment variable always wins (notably in CI); .env.local preserves the convenient
// local workflow used by Symfony projects without executing or importing the whole file.
function loadApiKey(projectRoot = process.cwd()) {
    if (process.env.TYPESAFE_API_KEY) return

    const path = resolve(projectRoot, '.env.local')
    if (!existsSync(path)) return

    const line = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .find((candidate) => /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=/.test(candidate))
    if (!line) return

    let value = line.slice(line.indexOf('=') + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
    }
    if (value) process.env.TYPESAFE_API_KEY = value
}

// ------------------------------------------------------------------------------- matcher

function runMatcher(options) {
    const script = options.matcher ?? locateMatcher()
    const raw = execFileSync(process.execPath, [script, ...options.targets], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })

    return JSON.parse(raw)
}

// The CLI ships beside the matcher, both in a checkout and in the plugin cache. Keeping
// this lookup relative makes the two components version together. `--matcher=` remains
// available for an explicit override.
function locateMatcher() {
    const fromEnv = process.env.CLAUDE_PLUGIN_ROOT
        ? join(process.env.CLAUDE_PLUGIN_ROOT, 'skills/quality-constraints-verify/scripts/match-constraints.js')
        : null
    if (fromEnv && existsSync(fromEnv)) return fromEnv

    const bundled = resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../skills/quality-constraints-verify/scripts/match-constraints.js',
    )
    if (existsSync(bundled)) return bundled

    throw new Error('match-constraints.js not found — pass --matcher=<path>.')
}

// ---------------------------------------------------------------------------------- jobs

/** One System One request per file: same state, all of its semantic rules in parallel. */
function buildJobs(matched, options) {
    const perFile = new Map()

    for (const [constraint, entry] of Object.entries(matched.constraints)) {
        if (Object.hasOwn(matched.advisory ?? {}, constraint)) continue
        const rules = (entry.semantic_rules ?? []).map((text) => ({
            ...parseSemanticRule(text),
            constraint,
            id: findRuleId(matched.feedback, constraint, text),
        }))
        if (rules.length === 0) continue

        for (const file of entry.files ?? []) {
            const bucket = perFile.get(file) ?? { file, rules: [] }
            bucket.rules.push(...rules)
            perFile.set(file, bucket)
        }
    }

    const projectRoot = matched.project_root ?? options.projectRoot ?? process.cwd()
    return [...perFile.values()].map(({ file, rules }) => {
        try {
            return { file, rules, state: buildState(file, rules, options, projectRoot), questions: buildQuestions(rules) }
        } catch (error) {
            return { file, rules, error: error.message }
        }
    })
}

function buildState(file, rules, options, projectRoot) {
    const absolute = resolve(projectRoot, file)
    const content = readFileSync(absolute, 'utf8')
    if (content.length > options.maxChars) {
        throw new Error(`${file}: ${content.length} characters exceeds --max-chars=${options.maxChars}; file not checked. Increase --max-chars or use --engine=agent.`)
    }

    return {
        file_path: file,
        constraint_scope: [...new Set(rules.map((rule) => rule.constraint))].join(', '),
        file_content: content,
    }
}

// `feedback[]` carries the stable rule ids (`enum~10e9235f`) that rule-stats expects: hook
// onto them by rule text rather than recomputing one.
function findRuleId(feedback, constraint, text) {
    const row = (feedback ?? []).find(
        (candidate) =>
            candidate.constraint === constraint && candidate.kind === 'semantic' && candidate.text === text,
    )

    return row?.rule ?? `${constraint}~unknown`
}

// ----------------------------------------------------------------------------- inference

async function verify(jobs, client, options) {
    return mapWithConcurrency(jobs, options.concurrency, async (job) => {
        if (job.error) return { file: job.file, verdicts: [], error: job.error }
        try {
            const response = await client.systemOne(job.state, job.questions)

            return {
                file: job.file,
                verdicts: readAnswers(response.answers ?? {}, job.rules, {
                    violationThreshold: options.threshold,
                    triggerThreshold: options.triggerThreshold,
                    uncertainThreshold: options.uncertain,
                }),
                error: null,
            }
        } catch (error) {
            // Finish the other files, but an incomplete check must block the gate.
            return { file: job.file, verdicts: [], error: error.message }
        }
    })
}

// -------------------------------------------------------------------------------- report

function assemble(matched, jobs, findings, options) {
    const staticFindings = options.semanticOnly ? [] : collectStatic(matched)
    const staticViolations = staticFindings.filter((row) => row.severity === 'MUST')
    const staticWarnings = staticFindings.filter((row) => row.severity === 'SHOULD')
    const semanticViolations = []
    const semanticWarnings = []
    const errors = []
    const tally = new Map()

    findings.forEach((finding, index) => {
        const job = jobs[index]
        if (finding.error !== null) {
            errors.push({ file: finding.file, message: finding.error })

            return
        }

        for (const verdict of finding.verdicts) {
            const rule = job.rules[verdict.index]
            const row = {
                file: finding.file,
                id: rule.id,
                constraint: rule.constraint,
                severity: rule.severity,
                message: `${rule.severity}: ${rule.statement}`,
                trigger: verdict.trigger,
                violation: verdict.violation,
            }

            const blocking = isBlocking(rule, { downgradeNonBlocking: options.respectNonBlocking })

            if (verdict.status === 'violation' && blocking) {
                semanticViolations.push(row)
                bump(tally, rule.constraint, 'semantic')
            } else if (verdict.status === 'violation' || verdict.status === 'uncertain') {
                semanticWarnings.push(row)
            }
        }
    })

    for (const row of staticViolations) {
        bump(tally, row.constraint, 'static')
    }

    const files = new Set(Object.values(matched.constraints).flatMap((entry) => entry.files ?? []))
    const staticRules = options.semanticOnly
        ? 0
        : Object.values(matched.constraints).reduce((total, entry) => total + (entry.static_rules?.length ?? 0), 0)
    const semanticRules = Object.entries(matched.constraints).reduce(
        (total, [name, entry]) => total + (Object.hasOwn(matched.advisory ?? {}, name) ? 0 : (entry.semantic_rules?.length ?? 0)),
        0,
    )
    const advisories = Object.values(matched.advisory ?? {}).flat()

    return finalize({
        format: FORMAT,
        run_ts: matched.run_ts,
        ticket: options.ticket,
        branch: matched.branch,
        engine: engineOf(options),
        counts: { files: files.size, staticRules, semanticRules },
        staticViolations,
        semanticViolations,
        semanticWarnings,
        staticWarnings,
        advisories,
        errors,
        summary: buildSummary(matched, tally),
        rules: buildMeasurement(matched, findings, jobs, options),
    })
}

function engineOf(options) {
    return `typesafe:${options.model}`
}

// Same shape as the matcher's `run_ts`, for the one path that never reaches it.
function timestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

function collectStatic(matched) {
    const rows = []

    for (const [constraint, entry] of Object.entries(matched.constraints)) {
        for (const violation of entry.static_violations ?? []) {
            rows.push({
                file: violation.file,
                id: violation.id,
                constraint,
                severity: violation.message?.match(/\b(MUST|SHOULD)\b/)?.[1] ?? 'MUST',
                message: violation.message,
                line: violation.line ?? null,
                lines: violation.lines ?? null,
                lines_total: violation.lines_total ?? null,
            })
        }
    }

    return rows
}

function bump(tally, constraint, key) {
    const row = tally.get(constraint) ?? { static: 0, semantic: 0 }
    row[key] += 1
    tally.set(constraint, row)
}

function buildSummary(matched, tally) {
    return Object.entries(matched.constraints).map(([constraint, entry]) => {
        const row = tally.get(constraint) ?? { static: 0, semantic: 0 }

        return {
            constraint,
            static: row.static,
            semantic: row.semantic,
            total: row.static + row.semantic,
            files: (entry.files ?? []).length,
        }
    })
}

// The `rules` array of the run document: one row per rule, clean or not — the only source
// that lets rule-stats say "this rule found nothing for N runs".
function buildMeasurement(matched, findings, jobs, options) {
    const perRule = new Map()
    const incomplete = new Set()

    findings.forEach((finding, index) => {
        if (finding.error !== null) {
            for (const rule of jobs[index].rules) incomplete.add(rule.id)
            return
        }

        for (const verdict of finding.verdicts) {
            const rule = jobs[index].rules[verdict.index]
            const current = perRule.get(rule.id) ?? { checked: 0, fails: 0 }
            if (verdict.status !== 'skipped') current.checked += 1
            if (verdict.status === 'violation') current.fails += 1
            perRule.set(rule.id, current)
        }
    })

    const rules = (matched.feedback ?? [])
        .filter((row) => !(options.semanticOnly && row.kind === 'static'))
        .map((row) => {
            // Some matcher builds leave `verdict` off the static rows: rule-stats needs one
            // on every row, and `hits` already settles it.
            if (row.kind !== 'semantic') {
                return row.verdict ? row : { ...row, verdict: row.hits > 0 ? 'fail' : 'pass' }
            }

            const stats = perRule.get(row.rule)
            // Keep missing measurements explicit so rule-stats rejects them instead of
            // counting the unverified population as clean or not applicable.
            if (incomplete.has(row.rule)) {
                return { ...row, verdict: null, hits: null, reason: 'Verification incomplete; see verification errors' }
            }
            if (!stats || stats.checked === 0) return { ...row, verdict: 'n/a', hits: 0 }
            if (stats.fails > 0) return { ...row, verdict: 'fail', hits: stats.fails }

            return { ...row, verdict: 'pass', hits: 0 }
        })

    return rules
}

// -------------------------------------------------------------------------------- output

function emit(doc, options) {
    if (options.out) writeData(doc, resolve(process.cwd(), options.out))

    if (options.json) {
        process.stdout.write(`${JSON.stringify(doc)}\n`)

        return
    }

    for (const error of doc.errors) {
        process.stderr.write(`ERROR ${error.file}: ${error.message}\n`)
    }

    const folder = resolveReportsFolder(options)
    if (options.stdout || folder === null) {
        process.stdout.write(`${renderReport(doc)}\n${renderVerdict(doc.verdict)}`)

        return
    }

    const paths = writeRun(doc, join(folder, `${doc.run_ts}-constraints.json`))

    process.stdout.write(`${renderSummaryLine(doc, paths)}\n${renderVerdict(doc.verdict)}`)
}

function resolveReportsFolder(options) {
    if (options.reports) return resolve(process.cwd(), options.reports)
    const projectRoot = options.projectRoot ?? process.cwd()
    const qualityCodeDir = resolve(projectRoot, codeDir(process.env, projectRoot))
    if (existsSync(qualityCodeDir)) {
        return resolve(qualityCodeDir, 'reports/constraints')
    }

    return null
}

export { assemble, buildJobs, loadApiKey, parseArgs, run }
