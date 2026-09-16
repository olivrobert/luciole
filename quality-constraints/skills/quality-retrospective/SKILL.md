---
name: quality-retrospective
description: "Quality retrospective: analyzes the constraint reports and the measurements they carry, proposes improvements to the constraint files. Proposes only — never applies."
argument-hint: "[--reports=<dir>] [--out=<dir>]"
allowed-tools: Read, Write, Bash(ls *), Bash(test *), Bash(date:*), Bash(grep *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/rule-stats *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/quality-constraints-verify/scripts/match-constraints.js --sweep)
model: opus
effort: high
---

# Quality Retrospective

NON-BLOCKING analysis. Consumes material already collected at zero cost (the constraint reports written by `quality-constraints-verify`, and the measurement blocks they carry) and derives proposals to improve the `.claude/quality/code/constraints/` files. PROPOSES only: never edits a constraint file, never fixes code, never commits. Appending to `tool-candidates.md` (Phase 2) is not an exception — that file changes what no checker enforces.

## Input

**Raw arguments:** $ARGUMENTS

- `--reports=<dir>` — where `quality-constraints-verify` wrote its reports. Default `.claude/quality/code/reports/constraints/` if it exists. Read recursively: a runner isolating a batch under `reports/<BATCH-ID>/` is covered. Resolve ONCE as `REPORTS_DIR`. No folder at all → no material.
- `--out=<dir>` — where the proposal file goes. Default `.claude/quality/code/`. A runner owning a per-ticket folder passes it so the proposal lives with the run's artifacts (from a git worktree, an untracked file under `.claude/` disappears with the worktree). Resolve ONCE as `OUT_DIR`, use it for every path in Phases 3 and 4.

## Phase 1: Gather the material — 15 reads max

1. **Reports** — if a folder resolved: list `*-constraints.md` there AND one level of sub-folders (`ls <dir> <dir>/*/` — a runner isolates a batch under `reports/<BATCH-ID>/`), read the **10 most recent** (lexicographic = chronological). Each lists violations with rule IDs (e.g. `HDL-002`).

2. **Cumulative measurements** (ALL reports under `REPORTS_DIR`, plus the annotations of past retrospectives):
   - `node ${CLAUDE_PLUGIN_ROOT}/bin/rule-stats report --reports=<REPORTS_DIR> --reports='<OUT_DIR>/constraints-proposal-*.md'` — per rule: `runs`, `files_seen`, `hits`, `fp`, plus ready-made actionable sections. Computed from the `json:constraints-run` blocks of the reports and the `json:constraints-annotations` blocks of earlier proposal files — nothing is stored elsewhere. The ONLY source that can state "N runs with no finding": the prose lists violations, never the rules that stayed clean.
   - `node ${CLAUDE_PLUGIN_ROOT}/bin/rule-stats lint` with the same `--reports` — reports whose block is missing, unreadable or left with `null` verdicts. Not a constraint flaw: a verification run that lost its measurement. Count them for Phase 4, propose nothing about them.
   - `node ${CLAUDE_PLUGIN_ROOT}/skills/quality-constraints-verify/scripts/match-constraints.js --sweep | node ${CLAUDE_PLUGIN_ROOT}/bin/rule-stats dead-globs -` — per-glob population over the whole tracked tree. A glob at 0 there is dead; a run-scoped 0 proves nothing. If it fails or is slow, skip it and say so.

3. **Shape models** — read `.claude/quality/onboard/scopes.json` (skip silently if absent). A scope with no `model` is MODEL PROMOTION material.

NO material (no report) → display `Retrospective: no material`, emit the verdict with `proposals: 0`, finish.

## Phase 2: Classify

Aggregate violations BY rule across the reports, cross-reference with `rule-stats report`. FIRST matching category:

| Category | Signal | Proposal |
|---|---|---|
| **FALSE POSITIVE** | `rule-stats report` shows `fp` for the rule, or a report argues a listed violation is unfounded (see **Annotations** below) | Restrict / clarify (scope, explicit exception) |
| **AMBIGUOUS RULE** | same rule violated in ≥ 2 distinct reports | Reword, more concrete (class, pattern, example) |
| **STATIC PROMOTION** | recurring semantic violation detectable by a simple grep | Propose the `static` regex |
| **TOOL PROMOTION** | `rule-stats report` lists it under TOOL PROMOTION (semantic, ≥ 5 runs, ≥ 25 files seen, 0 violation, 0 FP) | Route to the tooling backlog — below |
| **DEAD GLOB** | `dead-globs` reports 0 over the whole repo | Fix the glob, or delete it if the folder is gone |
| **MODEL PROMOTION** | scope without `model`, `population` ≥ 5, no violation of its rules in the reports read | Set `model` in `scopes.json` — below |

**WHEN IN DOUBT, propose NOTHING.** A single occurrence is implementation noise, not a rule flaw; 0 proposals beats weakening a rule on an isolated case.

**Annotations.** A report sometimes lists a violation and, in its own prose, argues it is unfounded ("conforme à l'intention de la règle", "l'aligner divergerait de la famille") — the checker fired, the fixer disagreed, and the run block still says `fail`. That information is lost unless you record it: for each such case, note `{rule, ticket, reason}` for Phase 3. Take the `rule` id from the report's `json:constraints-run` block (never recompute it). Only a violation the report itself dismisses qualifies — your own doubt about a rule is a proposal, not an annotation. A run block already carrying `verdict: "false-positive"` for it needs no annotation.

**MODEL PROMOTION.** Designate a candidate from the scope's population (`glob - exclude`): prefer one repeatedly cited as `evidence` in the candidates JSON, never one appearing in a report's violations. Regular entry in the dated proposal file; its **Apply** line is manual: set `"model": "{path}"` on the scope in `scopes.json`, then re-run `/quality-onboard:skills`. Skip a scope whose `model` is already set.

**TOOL PROMOTION.** A rule nobody violates is a candidate for cheaper enforcement. Destination depends on whether the project is onboarded:

- **Onboarded** (`.claude/quality/onboard/candidates/{key}.json` exists for the rule's constraint key): `lint-backlog.md` is regenerated from that JSON, so never append to it by hand. Write a regular proposal (Phase 3) whose **Proposal** is: set `automatable: { "tool": "...", "nature": "rejette", "note": "..." }` on rule `{id}` in `candidates/{key}.json`; the next `quality-onboard:render` projects it into the backlog. Skip a rule already carrying `automatable` or `via`.
- **Hand-maintained** (no candidates JSON): append to `.claude/quality/code/tool-candidates.md` (create with a `# Tool Candidates` header if missing), skipping rules already listed:

```markdown
## {rule-id} — {short title}
Target tool: {blocking analyser | formatter/fixer | dependency checker | CI}
Detect: {what to detect, in code terms}
Why not grep: {why a regex cannot express it — or "syntactic"}
Suggested config: {analyser rule + identifier {project}.{camelCaseName} | fixer name/config | dependency layer | CI target}
Measured population: {files_seen} file observations over {runs} runs, 0 violation (rule-stats)
```

Name the project's actual tool (PHPStan, ESLint, mypy, Deptrac…); purely syntactic or forbidden-dependency rules target the formatter or the dependency checker instead.

For EACH proposal, read the target constraint file (`.claude/quality/code/constraints/` at any depth: flat `{slug}.md` when onboarded, `conventions/` and `decisions/` subfolders when hand-maintained) to quote the EXACT current rule and write the proposed rule in the file's own format (onboarded semantic bullets carry `Trigger: … Anchor: … (m/t)`, hand-written ones `MUST/SHOULD … — <why>`).

## Phase 3: Write the proposal

`tool-candidates.md` stays at `.claude/quality/code/tool-candidates.md`, a cumulative backlog the project commits; its entries are not repeated here but count in `proposals`. Everything else goes to `OUT_DIR`.

**If ≥ 1 proposal targeting a constraint file, candidates JSON or scopes.json, OR ≥ 1 annotation** — write `{OUT_DIR}/constraints-proposal-{date +%Y-%m-%d}.md`. One file per day: a second run the same day OVERWRITES it (re-read its annotations block first and carry the entries over — they are deduplicated on `ticket + rule + reason`, so repeating one costs nothing, losing one costs a measurement), older dated files are never touched, and no undated `constraints-proposal.md` is ever written.

````markdown
# Constraints Proposal — {date +%Y-%m-%d}

## P1 — {CATEGORY}: {rule/ID}
- **Constraint file**: .claude/quality/code/constraints/{file}.md (or its candidates JSON for an `automatable` proposal, or scopes.json for a MODEL PROMOTION)
- **Current rule**: {exact text, or "(none)" for a missing rule}
- **Evidence**: {reports concerned, `rule-stats report` rows, short excerpts}
- **Proposal**: {exact text of the new/reworded rule}
- **Apply**: `/quality-constraints:constraint-update {one-sentence description}`

## Annotations

```json:constraints-annotations
{"ts":"{date +%Y%m%d-%H%M%S}","annotations":[
 {"rule":"{rule id}","ticket":"{ticket}","verdict":"false-positive","reason":"{one sentence, from the report}"}
]}
```
````

The `## Annotations` section and its block appear only when there is ≥ 1 annotation. The block is what `rule-stats` reads back on the next run: fenced exactly as shown, `verdict` always `false-positive`, one entry per dismissed violation. These verdicts live here, after the fact, and NOT in the verification report: rewriting a run's block would rewrite history.

**Otherwise** — write NO file.

## Phase 4: Terminal output + verdict

One line per proposal (category, rule, target file), one line for the annotations count, one line for the reports `rule-stats lint` flagged (if any), then, as the LAST thing displayed:

```json:verdict
{"success": true, "proposals": 0, "file": null}
```

- `success`: ALWAYS `true` — the retrospective is informative, never blocking, even on analysis failure.
- `proposals`: number of proposals written (both kinds). Annotations are not proposals.
- `file`: path of the dated proposal file, or `null`.
