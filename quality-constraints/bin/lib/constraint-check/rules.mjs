// Executable grammar for the semantic rules as match-constraints.js hands them over:
//
//   MUST: <statement>. Trigger: <trigger>. Anchor: <anchor>. — coherence, non-blocking (28/28)
//
// Parsing feeds two distinct Noul questions — "is the trigger present?" and "is the anchor
// respected?". Splitting beats a single question: without the trigger, a file that is of the
// right type but simply does not exhibit the situation comes back as a violation.

const SEVERITY = /^(MUST NOT|SHOULD NOT|MUST|SHOULD)\s*:\s*/
const TRAILING = /\s*—\s*([^—()]*?)\s*(?:\((\d+)\s*\/\s*(\d+)\))?\s*$/
const STATS_ONLY = /\s*\((\d+)\s*\/\s*(\d+)\)\s*$/

/**
 * @param {string} text  The raw rule text, as carried by feedback[].text
 * @returns {{severity: string, statement: string, trigger: string|null, anchor: string|null, flags: string[], sample: {hits: number, total: number}|null, text: string}}
 */
export function parseSemanticRule(text) {
    let rest = text.trim()

    const severityMatch = rest.match(SEVERITY)
    const severity = severityMatch ? severityMatch[1] : 'MUST'
    if (severityMatch) {
        rest = rest.slice(severityMatch[0].length)
    }

    let flags = []
    let sample = null

    const trailing = rest.match(TRAILING)
    if (trailing) {
        flags = trailing[1]
            .split(',')
            .map((flag) => flag.trim())
            .filter(Boolean)
        if (trailing[2] !== undefined) {
            sample = { hits: Number(trailing[2]), total: Number(trailing[3]) }
        }
        rest = rest.slice(0, trailing.index)
    } else {
        const stats = rest.match(STATS_ONLY)
        if (stats) {
            sample = { hits: Number(stats[1]), total: Number(stats[2]) }
            rest = rest.slice(0, stats.index)
        }
    }

    const { statement, trigger, anchor } = splitSections(rest.trim())

    return {
        severity,
        statement,
        trigger,
        anchor,
        flags,
        sample,
        text: text.trim(),
    }
}

// `Trigger:` and `Anchor:` are boundaries, not YAML keys: cut on the first occurrence of each
// so that the wording keeps its own inner colons.
function splitSections(body) {
    const triggerAt = body.search(/\bTrigger\s*:/)
    const anchorAt = body.search(/\bAnchor\s*:/)

    const endOfStatement = firstPositive(triggerAt, anchorAt, body.length)
    const statement = clean(body.slice(0, endOfStatement))

    let trigger = null
    if (triggerAt >= 0) {
        const end = anchorAt > triggerAt ? anchorAt : body.length
        trigger = clean(body.slice(triggerAt, end).replace(/^\bTrigger\s*:/, ''))
    }

    let anchor = null
    if (anchorAt >= 0) {
        const end = triggerAt > anchorAt ? triggerAt : body.length
        anchor = clean(body.slice(anchorAt, end).replace(/^\bAnchor\s*:/, ''))
    }

    return { statement, trigger, anchor }
}

function firstPositive(...candidates) {
    for (const candidate of candidates) {
        if (candidate >= 0) return candidate
    }

    return 0
}

function clean(value) {
    return value.trim().replace(/[.\s]+$/, '')
}

/**
 * A SHOULD is always a warning. A MUST is blocking, unless the caller explicitly asks to
 * honour the `non-blocking` annotation — the default stays what the skill does, otherwise
 * the reports would no longer be comparable.
 */
export function isBlocking(rule, { downgradeNonBlocking = false } = {}) {
    if (!rule.severity.startsWith('MUST')) return false
    if (downgradeNonBlocking && rule.flags.includes('non-blocking')) return false

    return true
}
