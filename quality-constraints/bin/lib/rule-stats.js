'use strict'
// rule-stats — SINGLE SOURCE for aggregating constraint measurements.
//
// There is NO store. The statistics are a projection of the deliverables, computed on
// demand from two kinds of fenced blocks:
//
//   ```json:constraints-run           — in a verification report, one verdict per rule
//   {"run_ts":"…","ticket":"…","branch":"…",
//    "rules":[{"rule":"ctl~a1b2","verdict":"pass|fail|n/a|false-positive",
//              "files":N,"hits":N,"kind":"…","text":"…","reason":"…"}]}
//
//   ```json:constraints-annotations   — in a retrospective deliverable, verdicts revised
//   {"ts":"…","annotations":[{"rule":"…","ticket":"…","verdict":"false-positive",
//                              "reason":"…","n":1}]}
//
// Why not a store: the previous append-only log lived under `.claude/quality/code/` and
// was deleted twice during re-onboards, needed `merge=union` to survive parallel
// worktrees, and depended on a hook-like extra command after every run that nobody
// called for the false positives. The reports are committed with their ticket and have a
// value of their own — they ARE the archive. If they go, the stats go with them; accepted.
//
// `parseReports()` turns the blocks into the rows `aggregate()` always consumed:
//   {"t":"obs","ts","ticket","branch","rule","constraint","kind","files","hits","text"}
//   {"t":"fp","ts","ticket","rule","n","reason"}
//
// `hits` = number of FILES in violation on this run. `files` = size of the scope actually
// inspected. Without this denominator, a rule that's never violated and a rule whose glob
// matches nothing are indistinguishable.

const DEFAULTS = {
  minRuns: 5, // number of distinct runs before an absence of findings counts as proof
  minFiles: 25, // cumulative file observations — 5 runs on 1 file prove nothing
  maxFp: 0, // a single confirmed false positive disqualifies promotion
}

const RUN_FENCE = 'json:constraints-run'
const ANNOTATIONS_FENCE = 'json:constraints-annotations'
const VERDICTS = new Set(['pass', 'fail', 'n/a', 'false-positive'])

// Extracts every fenced block whose info string is exactly `tag`. The fence may be
// indented (a block quoted in a list) and use 3+ backticks; the closing fence must have
// at least as many. Anything else on the info line (`json:constraints-run extra`) is NOT
// the block: an agent that decorates the tag breaks the contract, and lint must say so
// rather than silently read a neighbor.
function extractBlocks(text, tag) {
  const out = []
  const lines = String(text || '').split('\n')
  let open = null
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,})(.*)$/.exec(lines[i])
    if (!open) {
      if (!m) continue
      // Any other fence (```json, plain ```, ````) opens a block we must skip through:
      // otherwise a tagged fence quoted inside it — the SKILL documents the format that
      // way — would be read as the real thing.
      open = { fence: m[1], start: i + 1, body: [], skip: m[2].trim() !== tag }
      continue
    }
    if (m && m[1].length >= open.fence.length && m[2].trim() === '') {
      if (!open.skip) out.push({ line: open.start, body: open.body.join('\n') })
      open = null
      continue
    }
    open.body.push(lines[i])
  }
  return out
}

// A rule id encodes its kind: `key#ID` is static (or delegated), `key~hash` is semantic.
// Used only when the block omits `kind` — the block written from the script's `feedback`
// carries it, a hand-written block may not.
function kindOf(rule, kind) {
  if (kind) return kind
  return rule.includes('~') ? 'semantic' : 'static'
}

function badRow(rows, path, line, msg) {
  rows.push({ path, line, msg })
}

// Turns the blocks of ONE report into rows. Returns:
//   rows      — obs/fp rows for `aggregate()`
//   problems  — `{path, line, msg}`; a report with problems still yields the rows it could
//   blocks    — number of blocks found (0 = a report from before the format, not an error)
function parseReport(path, text) {
  const rows = []
  const problems = []
  let blocks = 0

  for (const b of extractBlocks(text, RUN_FENCE)) {
    blocks++
    let o
    try {
      o = JSON.parse(b.body)
    } catch (e) {
      badRow(problems, path, b.line, `unreadable ${RUN_FENCE} block — ${e.message}`)
      continue
    }
    const ts = o && (o.run_ts || o.ts)
    if (!o || typeof o !== 'object' || typeof ts !== 'string' || !ts) {
      // Without a timestamp two copies of the same run would count twice: refuse the block.
      badRow(problems, path, b.line, `${RUN_FENCE} block without run_ts — cannot deduplicate, ignored`)
      continue
    }
    if (!Array.isArray(o.rules)) {
      badRow(problems, path, b.line, `${RUN_FENCE} block without a rules array`)
      continue
    }
    if (o.rules.length === 0) {
      // A run with no rule is not a clean run: nothing was measured. Reported, not counted.
      badRow(problems, path, b.line, `${RUN_FENCE} block with zero rules — nothing was measured`)
    }
    const ticket = typeof o.ticket === 'string' && o.ticket ? o.ticket : null
    const branch = typeof o.branch === 'string' && o.branch ? o.branch : null
    for (const [i, r] of o.rules.entries()) {
      if (!r || typeof r.rule !== 'string' || !r.rule) {
        badRow(problems, path, b.line, `rule #${i + 1} without an identifier`)
        continue
      }
      if (!VERDICTS.has(r.verdict)) {
        // `null` = the orchestrator never filled it in. Counting it as a pass would
        // fabricate proof of conformity out of an absence of measurement.
        badRow(problems, path, b.line, `${r.rule}: verdict ${JSON.stringify(r.verdict === undefined ? null : r.verdict)} — expected pass|fail|n/a|false-positive`)
        continue
      }
      if (r.verdict === 'n/a') continue // rule not applicable to these files: no observation
      const files = Number(r.files) || 0
      let hits = 0
      if (r.verdict !== 'pass') {
        // fail / false-positive: at least one file is concerned, `hits` says how many
        if (r.hits === null || r.hits === undefined) {
          hits = 1
          badRow(problems, path, b.line, `${r.rule}: ${r.verdict} without hits — counted as 1 file`)
        } else {
          hits = Math.max(1, Number(r.hits) || 0)
        }
      }
      rows.push({
        t: 'obs',
        ts,
        ticket,
        branch,
        rule: r.rule,
        constraint: r.constraint || r.rule.split(/[#~]/)[0],
        kind: kindOf(r.rule, r.kind),
        files,
        hits,
        text: r.text || '',
      })
      if (r.verdict === 'false-positive') {
        // A false positive declared IN the run: the checker itself judged the hit unfounded.
        // Counted as a hit (the rule did fire) AND as an fp (it should not have).
        rows.push({ t: 'fp', ts, ticket, rule: r.rule, n: hits, reason: r.reason || '' })
      }
    }
  }

  for (const b of extractBlocks(text, ANNOTATIONS_FENCE)) {
    blocks++
    let o
    try {
      o = JSON.parse(b.body)
    } catch (e) {
      badRow(problems, path, b.line, `unreadable ${ANNOTATIONS_FENCE} block — ${e.message}`)
      continue
    }
    if (!o || typeof o !== 'object' || !Array.isArray(o.annotations)) {
      badRow(problems, path, b.line, `${ANNOTATIONS_FENCE} block without an annotations array`)
      continue
    }
    const ts = typeof o.ts === 'string' ? o.ts : ''
    for (const [i, a] of o.annotations.entries()) {
      if (!a || typeof a.rule !== 'string' || !a.rule) {
        badRow(problems, path, b.line, `annotation #${i + 1} without a rule identifier`)
        continue
      }
      if (a.verdict !== 'false-positive') {
        // The only revision that changes a statistic. Anything else is prose.
        badRow(problems, path, b.line, `${a.rule}: annotation verdict ${JSON.stringify(a.verdict === undefined ? null : a.verdict)} — only false-positive is measured`)
        continue
      }
      rows.push({
        t: 'fp',
        ts: typeof a.ts === 'string' && a.ts ? a.ts : ts,
        ticket: typeof a.ticket === 'string' && a.ticket ? a.ticket : null,
        rule: a.rule,
        n: Number.isFinite(a.n) && a.n > 0 ? a.n : 1,
        reason: a.reason || '',
      })
    }
  }

  return { rows, problems, blocks }
}

// `reports` = [{path, text}]. Returns everything `report` and `lint` need:
//   rows      — for `aggregate()`
//   problems  — every defect, with the file and the block's line
//   noBlock   — reports with no block at all (pre-format reports: listed, never counted)
function parseReports(reports) {
  const rows = []
  const problems = []
  const noBlock = []
  for (const { path, text } of reports) {
    const r = parseReport(path, text)
    rows.push(...r.rows)
    problems.push(...r.problems)
    if (r.blocks === 0) noBlock.push(path)
  }
  return { rows, problems, noBlock }
}

// One observation per (ts, rule): the same run copied in two reports increments nothing,
// since the `ts` comes from the run itself (`run_ts`) rather than from the moment it's read.
function obsKey(o) {
  return `${o.ts} ${o.rule}`
}

// A false positive is deduplicated on (ticket, rule, reason) — NOT on the ts.
// Two reasons, opposite and both observed in practice:
//   - a retrospective annotates a ticket's fps in a burst, so two distinct false positives on
//     the same rule share a ts and would count as only one. That's exactly the measurement
//     that decides `FALSE POSITIVE PRONE` and must block a PHPStan promotion;
//   - conversely, re-running the retrospective on the same ticket produces a DIFFERENT ts:
//     so the ts never protected against the double counting it was meant to prevent.
// Two genuinely distinct occurrences of the same reason on the same ticket are declared
// with `n`, not by repeating the annotation.
function fpKey(o) {
  return [o.ticket || '', o.rule, o.reason || ''].join(' ')
}

function aggregate(rows) {
  const acc = new Map()
  const seenObs = new Set()
  const seenFp = new Set()

  const slot = (o) => {
    if (!acc.has(o.rule)) {
      acc.set(o.rule, {
        rule: o.rule,
        constraint: o.constraint || o.rule.split(/[#~]/)[0],
        kind: o.kind || 'unknown',
        text: o.text || '',
        runs: 0,
        files_seen: 0,
        hits: 0,
        fp: 0,
        first_ts: null,
        last_ts: null,
      })
    }
    return acc.get(o.rule)
  }

  for (const o of rows) {
    if (o.t === 'fp') {
      const k = fpKey(o)
      if (seenFp.has(k)) continue
      seenFp.add(k)
      const a = slot(o)
      a.fp += Number.isFinite(o.n) ? o.n : 1
      continue
    }
    if (o.t !== 'obs') continue
    const k = obsKey(o)
    if (seenObs.has(k)) continue
    seenObs.add(k)
    const a = slot(o)
    a.runs += 1
    a.files_seen += Number(o.files) || 0
    a.hits += Number(o.hits) || 0
    // kind/text follow the latest observation: a reworded rule changes identity, but a
    // rule promoted from semantic to delegated keeps its own — we want the latest state.
    if (o.kind) a.kind = o.kind
    if (o.text) a.text = o.text
    if (!a.first_ts || o.ts < a.first_ts) a.first_ts = o.ts
    if (!a.last_ts || o.ts > a.last_ts) a.last_ts = o.ts
  }
  return [...acc.values()].sort((x, y) => x.rule.localeCompare(y.rule))
}

// ACTIONABLE categories only. A static rule that's always been clean produces nothing:
// it costs 0 tokens, keeping it is free. Only semantic rules cost something on every run.
//
// No "empty-scope rule" category here: it would be unreachable. A rule whose glob matches
// nothing NEVER enters a report — the script doesn't evaluate it, so it has no observation
// and stays at runs=0, not files_seen=0. That's what `--sweep` + `dead-globs` detect, by
// counting globs across the whole repo rather than across runs.
function classify(aggs, opts = {}) {
  const { minRuns, minFiles, maxFp } = { ...DEFAULTS, ...opts }
  const out = { promotion: [], falsePositiveProne: [] }

  for (const a of aggs) {
    if (a.hits > 0 && a.fp >= Math.ceil(a.hits / 2)) {
      out.falsePositiveProne.push(a)
      continue
    }
    if (a.kind === 'semantic' && a.runs >= minRuns && a.hits === 0 && a.fp <= maxFp && a.files_seen >= minFiles) {
      out.promotion.push(a)
    }
  }
  // Best-supported first — that's the order the retrospective should propose them in.
  out.promotion.sort((x, y) => y.files_seen - x.files_seen)
  return out
}

// A glob with 0 files across the WHOLE repo is dead. The same glob at 0 on a single run
// proves nothing — the run simply didn't touch that file type.
//
// Tolerates JSON that isn't `--sweep` output: the caller pipes the script's output, and
// that can be a degraded mode (`{"error":"no_files"}`). Without the filter below, a
// non-array value was iterated anyway — a string gets iterated character by character and
// fabricated that many fake dead globs, an object made the command crash.
function deadGlobs(sweep) {
  const out = []
  const src = sweep && typeof sweep === 'object' ? sweep : {}
  for (const [constraint, globs] of Object.entries(src)) {
    if (!Array.isArray(globs)) continue
    for (const g of globs) {
      if (!g || typeof g !== 'object' || typeof g.glob !== 'string') continue
      if ((Number(g.files) || 0) === 0) out.push({ constraint, glob: g.glob })
    }
  }
  return out.sort((a, b) => (a.constraint + a.glob).localeCompare(b.constraint + b.glob))
}

module.exports = {
  DEFAULTS,
  RUN_FENCE,
  ANNOTATIONS_FENCE,
  VERDICTS,
  extractBlocks,
  parseReport,
  parseReports,
  obsKey,
  fpKey,
  aggregate,
  classify,
  deadGlobs,
}
