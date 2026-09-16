import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rs = require('../bin/lib/rule-stats.js')
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'rule-stats')

function dir() {
  return mkdtempSync(join(tmpdir(), 'rstats-'))
}

function cli(args, input) {
  return spawnSync('node', [BIN, ...args], { encoding: 'utf8', input })
}

function obs(ts, rule, { kind = 'semantic', files = 10, hits = 0, fp, reason, ticket } = {}) {
  return fp !== undefined
    ? { t: 'fp', ts, rule, n: fp, reason, ticket }
    : { t: 'obs', ts, rule, constraint: rule.split(/[#~]/)[0], kind, files, hits, text: rule }
}

// A verification report as quality-constraints-verify writes it: prose + the run block.
function runBlock(run) {
  return '```json:constraints-run\n' + JSON.stringify(run) + '\n```\n'
}

function report(run, prose = '# Constraints Check: PASSED ✅\n\nFiles checked: 2\n\n') {
  return prose + runBlock(run)
}

function annotationsBlock(a) {
  return '```json:constraints-annotations\n' + JSON.stringify(a) + '\n```\n'
}

// Writes reports under two layouts on purpose: the glob is the caller's business.
function writeReports(root, entries) {
  const paths = []
  for (const [rel, text] of Object.entries(entries)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
    paths.push(p)
  }
  return paths
}

// ---------------------------------------------------------------- aggregation

test('aggregate: runs = distinct observations, files and hits cumulated', () => {
  const rows = [
    obs('20260101-0900', 'ctl~aaaa1111', { files: 12, hits: 0 }),
    obs('20260102-0900', 'ctl~aaaa1111', { files: 8, hits: 2 }),
  ]
  const [a] = rs.aggregate(rows)
  assert.deepEqual(
    { runs: a.runs, files_seen: a.files_seen, hits: a.hits, first_ts: a.first_ts, last_ts: a.last_ts },
    { runs: 2, files_seen: 20, hits: 2, first_ts: '20260101-0900', last_ts: '20260102-0900' },
  )
})

test('aggregate: the same run read twice increments nothing (idempotent on ts+rule)', () => {
  const line = obs('20260101-0900', 'ctl~aaaa1111', { files: 12, hits: 1 })
  const [a] = rs.aggregate([line, { ...line }])
  assert.equal(a.runs, 1)
  assert.equal(a.files_seen, 12)
  assert.equal(a.hits, 1)
})

test('aggregate: two distinct false positives in the same second count as two', () => {
  const rows = [
    obs('20260101-0900', 'hdl~beef0001', { files: 5, hits: 4 }),
    obs('20260101-1000', 'hdl~beef0001', { fp: 1, ticket: 'PROJ-1', reason: 'out of scope' }),
    obs('20260101-1000', 'hdl~beef0001', { fp: 1, ticket: 'PROJ-1', reason: 'false match on a test' }),
  ]
  assert.equal(rs.aggregate(rows)[0].fp, 2)
})

test('aggregate: the same annotation with a different ts does not double the fp', () => {
  const a = obs('20260101-1000', 'hdl~beef0001', { fp: 1, ticket: 'PROJ-1', reason: 'out of scope' })
  const b = { ...a, ts: '20260202-1500' }
  assert.equal(rs.aggregate([a, b])[0].fp, 1)
})

// ---------------------------------------------------------------- classification

test('classify: clean semantic over N runs and a large population → promotion', () => {
  const rows = Array.from({ length: 5 }, (_, i) => obs(`2026010${i + 1}-0900`, 'enum~cafe0001', { files: 20, hits: 0 }))
  const cls = rs.classify(rs.aggregate(rows))
  assert.equal(cls.promotion.length, 1)
  assert.equal(cls.promotion[0].rule, 'enum~cafe0001')
})

test('classify: insufficient population → no promotion despite 0 violation', () => {
  const rows = Array.from({ length: 5 }, (_, i) => obs(`2026010${i + 1}-0900`, 'enum~cafe0001', { files: 1, hits: 0 }))
  assert.equal(rs.classify(rs.aggregate(rows)).promotion.length, 0)
})

test('classify: a single false positive disqualifies the promotion', () => {
  const rows = Array.from({ length: 5 }, (_, i) => obs(`2026010${i + 1}-0900`, 'enum~cafe0001', { files: 20, hits: 0 }))
  rows.push(obs('20260106-0900', 'enum~cafe0001', { fp: 1 }))
  assert.equal(rs.classify(rs.aggregate(rows)).promotion.length, 0)
})

test('classify: static rule never violated → no proposal (it costs 0 token)', () => {
  const rows = Array.from({ length: 5 }, (_, i) => obs(`2026010${i + 1}-0900`, 'ctl#CTL-001', { kind: 'static', files: 20, hits: 0 }))
  const cls = rs.classify(rs.aggregate(rows))
  assert.equal(cls.promotion.length, 0)
  assert.equal(cls.falsePositiveProne.length, 0)
})

test('classify: half the hits dismissed as false positive → poorly worded rule', () => {
  const rows = [
    obs('20260101-0900', 'hdl~beef0001', { files: 5, hits: 4 }),
    obs('20260101-1000', 'hdl~beef0001', { fp: 2 }),
  ]
  const cls = rs.classify(rs.aggregate(rows))
  assert.equal(cls.falsePositiveProne.length, 1)
  assert.equal(cls.promotion.length, 0)
})

// ------------------------------------------------------------- block extraction

test('extractBlocks: only the exactly-tagged fence, indented or longer fences accepted', () => {
  const text = [
    '# Report', '', '```json', '{"not":"it"}', '```', '',
    '  ````json:constraints-run', '  {"a":1}', '  ````', '',
    '```json:constraints-run extra', '{"b":2}', '```',
  ].join('\n')
  const blocks = rs.extractBlocks(text, 'json:constraints-run')
  assert.equal(blocks.length, 1)
  assert.equal(JSON.parse(blocks[0].body).a, 1)
  assert.equal(blocks[0].line, 7)
})

test('extractBlocks: a tagged fence quoted inside a plain block is not a block', () => {
  // The SKILL documents the format with the block inside a ```` fence: a report that pastes
  // that documentation must not produce a phantom run.
  const text = ['````', '```json:constraints-run', '{"run_ts":"x","rules":[]}', '```', '````'].join('\n')
  assert.deepEqual(rs.extractBlocks(text, 'json:constraints-run'), [])
})

// --------------------------------------------------------------- parseReports

test('parseReport: one verdict per rule → pass counts 0 hits, fail counts its hits, n/a nothing', () => {
  const { rows, problems } = rs.parseReport('r.md', report({
    run_ts: '20260909-095722',
    ticket: 'FOOD-407',
    branch: 'fix/x',
    rules: [
      { rule: 'controller~a1b2c3d4', kind: 'semantic', files: 1, verdict: 'pass', text: 'invoke' },
      { rule: 'controller~c3d4e5f6', kind: 'semantic', files: 1, verdict: 'fail', hits: 1, text: 'flash' },
      { rule: 'controller~e5f60000', kind: 'semantic', files: 1, verdict: 'n/a' },
      { rule: 'controller#CTL-004', kind: 'static', files: 1, verdict: 'pass', hits: 0 },
    ],
  }))
  assert.deepEqual(problems, [])
  assert.deepEqual(rows.map((r) => [r.t, r.rule, r.hits]), [
    ['obs', 'controller~a1b2c3d4', 0],
    ['obs', 'controller~c3d4e5f6', 1],
    ['obs', 'controller#CTL-004', 0],
  ])
  assert.equal(rows[0].ticket, 'FOOD-407')
  assert.equal(rows[0].branch, 'fix/x')
  assert.equal(rows[0].ts, '20260909-095722')
  assert.equal(rows[0].constraint, 'controller')
})

test('parseReport: false-positive verdict → a hit AND an fp with the reason', () => {
  const { rows } = rs.parseReport('r.md', report({
    run_ts: '20260909-095722',
    ticket: 'FOOD-407',
    rules: [{ rule: 'functional-test~8a9b0000', files: 1, verdict: 'false-positive', hits: 1, reason: 'partial Twig partagé' }],
  }))
  assert.deepEqual(rows.map((r) => r.t), ['obs', 'fp'])
  assert.equal(rows[0].hits, 1)
  assert.equal(rows[1].n, 1)
  assert.equal(rows[1].reason, 'partial Twig partagé')
  assert.equal(rows[1].ticket, 'FOOD-407')
})

test('parseReport: kind derived from the id when the block omits it', () => {
  const { rows } = rs.parseReport('r.md', report({
    run_ts: 't', rules: [{ rule: 'a~1', verdict: 'pass' }, { rule: 'a#A-1', verdict: 'pass' }],
  }))
  assert.deepEqual(rows.map((r) => r.kind), ['semantic', 'static'])
})

test('parseReport: a null verdict is a missing measurement — flagged, never a pass', () => {
  const { rows, problems } = rs.parseReport('r.md', report({
    run_ts: 't', rules: [{ rule: 'a~1', verdict: null }, { rule: 'a~2', verdict: 'maybe' }, { rule: 'a~3', verdict: 'pass' }],
  }))
  assert.equal(rows.length, 1)
  assert.equal(problems.length, 2)
  assert.match(problems[0].msg, /a~1: verdict null/)
  assert.match(problems[1].msg, /a~2: verdict "maybe"/)
})

test('parseReport: fail without hits → counted as 1 file and flagged', () => {
  const { rows, problems } = rs.parseReport('r.md', report({ run_ts: 't', rules: [{ rule: 'a~1', verdict: 'fail' }] }))
  assert.equal(rows[0].hits, 1)
  assert.match(problems[0].msg, /fail without hits/)
})

test('parseReport: missing run_ts → the whole block is refused (dedup impossible)', () => {
  const { rows, problems, blocks } = rs.parseReport('r.md', report({ rules: [{ rule: 'a~1', verdict: 'pass' }] }))
  assert.equal(blocks, 1)
  assert.deepEqual(rows, [])
  assert.match(problems[0].msg, /without run_ts/)
})

test('parseReport: unreadable JSON → problem with the line of the fence, not fatal', () => {
  const { rows, problems } = rs.parseReport('r.md', '# x\n\n```json:constraints-run\n{"run_ts": \n```\n')
  assert.deepEqual(rows, [])
  assert.equal(problems[0].line, 3)
  assert.match(problems[0].msg, /unreadable/)
})

test('parseReport: zero rules is not a clean run — flagged', () => {
  const { problems } = rs.parseReport('r.md', report({ run_ts: 't', rules: [] }))
  assert.match(problems[0].msg, /zero rules/)
})

test('parseReport: annotations block → fp rows, only false-positive is measured', () => {
  const { rows, problems } = rs.parseReport('p.md', '# Proposal\n\n' + annotationsBlock({
    ts: '20260813-095152',
    annotations: [
      { rule: 'integration-test~1d89ab97', ticket: 'PACASEC-363', verdict: 'false-positive', reason: 'rendu PDF sans session' },
      { rule: 'integration-test~1d89ab97', ticket: 'PACASEC-364', verdict: 'false-positive', reason: 'idem', n: 2 },
      { rule: 'integration-test~1d89ab97', ticket: 'PACASEC-365', verdict: 'confirmed', reason: 'real' },
    ],
  }))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => [r.t, r.ticket, r.n, r.ts]), [
    ['fp', 'PACASEC-363', 1, '20260813-095152'],
    ['fp', 'PACASEC-364', 2, '20260813-095152'],
  ])
  assert.equal(problems.length, 1)
  assert.match(problems[0].msg, /only false-positive is measured/)
})

test('parseReports: a report without any block is listed, not counted, not a problem', () => {
  const { rows, problems, noBlock } = rs.parseReports([
    { path: 'old.md', text: '# Constraints Check: PASSED ✅\n\nFiles checked: 3\n' },
    { path: 'new.md', text: report({ run_ts: 't', rules: [{ rule: 'a~1', verdict: 'pass', files: 2 }] }) },
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(problems, [])
  assert.deepEqual(noBlock, ['old.md'])
})

test('parseReports → aggregate: the same run in two files counts once, an annotation joins by rule', () => {
  const run = { run_ts: '20260101-0900', ticket: 'P-1', rules: [{ rule: 'a~1', verdict: 'fail', hits: 2, files: 4 }] }
  const { rows } = rs.parseReports([
    { path: 'a.md', text: report(run) },
    { path: 'copy.md', text: report(run) },
    { path: 'proposal.md', text: annotationsBlock({ ts: 'x', annotations: [{ rule: 'a~1', ticket: 'P-1', verdict: 'false-positive', reason: 'r' }] }) },
  ])
  const [a] = rs.aggregate(rows)
  assert.deepEqual({ runs: a.runs, hits: a.hits, fp: a.fp, files_seen: a.files_seen }, { runs: 1, hits: 2, fp: 1, files_seen: 4 })
})

// ------------------------------------------------------------------ dead globs

test('deadGlobs: only a 0 across the whole repo counts, live globs are ignored', () => {
  const dead = rs.deadGlobs({
    controller: [{ glob: 'src/**/Controller/**/*.php', files: 111 }, { glob: 'src/Legacy/**/*.php', files: 0 }],
    entity: [{ glob: 'src/**/Entity/*.php', files: 40 }],
  })
  assert.deepEqual(dead, [{ constraint: 'controller', glob: 'src/Legacy/**/*.php' }])
})

test('deadGlobs: an entry that is not a sweep does not manufacture fake dead globs', () => {
  assert.deepEqual(rs.deadGlobs({ error: 'no_files', constraints: {} }), [])
  assert.deepEqual(rs.deadGlobs(null), [])
  assert.deepEqual(rs.deadGlobs('no_files'), [])
})

test('deadGlobs: malformed glob entry ignored, no undefined glob', () => {
  const dead = rs.deadGlobs({ c: [{ files: 0 }, null, { glob: 'src/Dead/*.php', files: 0 }] })
  assert.deepEqual(dead, [{ constraint: 'c', glob: 'src/Dead/*.php' }])
})

// ------------------------------------------------------------------------ CLI

function semanticRun(ts, files = 30, hits = 0) {
  return { run_ts: ts, rules: [{ rule: 'e~cafe0001', kind: 'semantic', files, verdict: hits ? 'fail' : 'pass', hits, text: 'no getLabel()' }] }
}

test('CLI report: no --reports → exit 2 that shows the expected form', () => {
  const res = cli(['report'])
  assert.equal(res.status, 2)
  assert.match(res.stderr, /--reports=<glob>/)
})

test('CLI report: reads every report matched by several globs across two layouts', () => {
  const root = dir()
  writeReports(root, {
    '.claude/work-items/P-1/quality-reports/constraints/20260101-0900-constraints.md': report(semanticRun('20260101-0900')),
    '.lance-nuit/work-items/P-2/reports/20260102-0900-constraints.md': report(semanticRun('20260102-0900')),
    '.lance-nuit/work-items/P-3/reports/LOT-01/20260103-0900-constraints.md': report(semanticRun('20260103-0900')),
    '.lance-nuit/work-items/P-3/reports/LOT-01/20260103-0900-review.md': '# not a constraints report\n',
  })
  const res = cli(['report', '--json',
    `--reports=${root}/.claude/work-items/**/*-constraints.md`,
    '--reports', `${root}/.lance-nuit/work-items/**/*-constraints.md`])
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.reports, 3)
  assert.equal(out.rules[0].runs, 3)
  assert.equal(out.rules[0].files_seen, 90)
})

test('CLI report: a directory value is read recursively', () => {
  const root = dir()
  writeReports(root, {
    'a/1-constraints.md': report(semanticRun('20260101-0900')),
    'a/deep/2-constraints.md': report(semanticRun('20260102-0900')),
  })
  const out = JSON.parse(cli(['report', '--json', `--reports=${root}/a`]).stdout)
  assert.equal(out.rules[0].runs, 2)
})

test('CLI report: no match → explicit message, exit 0', () => {
  const res = cli(['report', `--reports=${dir()}/**/*.md`])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /no report matches/)
})

test('CLI report: reports present but none with a block → says so instead of an empty table', () => {
  const root = dir()
  writeReports(root, { 'old-constraints.md': '# Constraints Check: PASSED ✅\n' })
  const res = cli(['report', `--reports=${root}/*.md`])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /1 report\(s\) read, none carries a measurable block/)
})

test('CLI report: thresholds overridable on the command line', () => {
  const root = dir()
  writeReports(root, {
    '1-constraints.md': report(semanticRun('20260101-0900')),
    '2-constraints.md': report(semanticRun('20260102-0900')),
  })
  const pat = `--reports=${root}/*.md`
  assert.equal(JSON.parse(cli(['report', '--json', pat]).stdout).promotion.length, 0, 'default threshold = 5 runs')
  const relaxed = JSON.parse(cli(['report', '--json', pat, '--min-runs=2']).stdout)
  assert.equal(relaxed.promotion.length, 1)
  assert.equal(relaxed.thresholds.minRuns, 2)
})

test('CLI report: table + a pointer to lint when a block has problems', () => {
  const root = dir()
  writeReports(root, {
    'ok-constraints.md': report(semanticRun('20260101-0900')),
    'bad-constraints.md': report({ run_ts: '20260102-0900', rules: [{ rule: 'e~cafe0001', kind: 'semantic', files: 3, verdict: null }] }),
    'old-constraints.md': '# Constraints Check: PASSED ✅\n',
  })
  const res = cli(['report', `--reports=${root}/*.md`])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /^RULE\s+KIND\s+RUNS/m)
  assert.match(res.stdout, /1 without a measurement block/)
  assert.match(res.stdout, /1 problem\(s\) in the blocks — run `rule-stats lint`/)
})

test('CLI report: an annotation in a retrospective deliverable joins the run by rule', () => {
  const root = dir()
  writeReports(root, {
    'reports/1-constraints.md': report({ run_ts: '20260101-0900', ticket: 'P-1', rules: [{ rule: 'a#A-1', kind: 'static', files: 3, verdict: 'fail', hits: 2, text: 'r' }] }),
    'constraints-proposal-2026-01-02.md': '# Proposal\n\n' + annotationsBlock({ ts: '20260102-1000', annotations: [{ rule: 'a#A-1', ticket: 'P-1', verdict: 'false-positive', reason: 'out of scope' }] }),
  })
  const out = JSON.parse(cli(['report', '--json', `--reports=${root}/**/*.md`]).stdout)
  assert.equal(out.rules[0].hits, 2)
  assert.equal(out.rules[0].fp, 1)
})

test('CLI lint: lists each problem as path:line, reports without block, exit 1', () => {
  const root = dir()
  writeReports(root, {
    'ok.md': report(semanticRun('20260101-0900')),
    'bad.md': '# x\n\n```json:constraints-run\n' + JSON.stringify({ run_ts: 't', rules: [{ rule: 'a~1', verdict: null }] }) + '\n```\n',
    'old.md': '# Constraints Check: PASSED ✅\n',
  })
  const res = cli(['lint', `--reports=${root}/*.md`])
  assert.equal(res.status, 1)
  assert.match(res.stdout, new RegExp(`${root}/bad.md:3: a~1: verdict null`))
  assert.match(res.stdout, /1 report\(s\) without a measurement block/)
  assert.match(res.stdout, /3 report\(s\), 1 problem\(s\), 1 without block/)
})

test('CLI lint: clean reports → exit 0', () => {
  const root = dir()
  writeReports(root, { 'ok.md': report(semanticRun('20260101-0900')) })
  const res = cli(['lint', `--reports=${root}/*.md`])
  assert.equal(res.status, 0, res.stdout)
})

test('CLI dead-globs: reads the --sweep output of match-constraints', () => {
  const sweep = JSON.stringify({ sweep: { c: [{ glob: 'src/Dead/**/*.php', files: 0 }, { glob: 'src/Ok/*.php', files: 3 }] } })
  const res = cli(['dead-globs', '-'], sweep)
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /src\/Dead\/\*\*\/\*\.php/)
  assert.ok(!res.stdout.includes('src/Ok/'), 'a live glob must not be listed')
})

test('CLI dead-globs: entry with no sweep key → exit 2 rather than "no dead glob"', () => {
  const res = cli(['dead-globs', '-'], '{"error":"no_files","constraints":{}}')
  assert.equal(res.status, 2)
  assert.match(res.stderr, /no sweep data/)
})

test('CLI: removed store commands and unknown commands → usage + exit 2', () => {
  for (const c of ['record', 'fp', 'path', 'nope']) {
    const res = cli([c])
    assert.equal(res.status, 2, c)
    assert.match(res.stderr, /usage: rule-stats <report\|lint\|dead-globs>/)
  }
})
