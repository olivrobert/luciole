---
name: quality-constraints-verify
description: Verify code quality constraints from the configured quality root. Accepts files, directories, or uses git diff by default.
argument-hint: "[file1 file2 …] [dir/ …] [--engine=agent|jev] [--ticket=<name>] [--reports=<dir>] (empty = git diff)"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/quality-config *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-check *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/quality-constraints-verify/scripts/match-constraints.js), Read, Agent, Write
model: opus
---

# Constraints Checker (Orchestrator)

Resolve `QUALITY_ROOT` from the environment, then `.luciole.local.env`,
then `.luciole.env`, defaulting to `.ia/quality`.

Read-only orchestrator. Static checks, constraint matching and agent grouping are pre-computed by a script — you dispatch semantic checks and build the report. DETECTS and REPORTS only, never fixes: corrections are the caller's job.

## Input

**Raw arguments received:** $ARGUMENTS

Strip `--engine=<name>` → `ENGINE_OVERRIDE`. It accepts only `agent` or `jev`; any other
value is an error. Without an override, run
`node ${CLAUDE_PLUGIN_ROOT}/bin/quality-config verify-engine` to resolve the process
environment, `.luciole.local.env`, `.luciole.env`, then the `agent` default.

If the resolved engine is `jev`, run
`node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-check <all raw arguments except --engine>` and
return its output unchanged. Exit `1` means constraints failed, not that the command was
inoperative. Exit `2` means verification is incomplete or inoperative and MUST block the
gate, even with zero reported violations. Do not run any phase below and do not dispatch an agent: `constraint-check`
performs the same matching/static stages and ends with the same `json:verdict` contract.

If the resolved engine is `agent`, continue below. Strip `--ticket=<name>` → `TICKET`
(written into the report's measurement block, Phase 3: a ticket id, a branch name). Strip
`--reports=<dir>` → `REPORTS_DIR` (Phase 3). Forward the remaining arguments to the matcher
as-is.

## Phase 1: Run the matching script

Run `node ${CLAUDE_PLUGIN_ROOT}/skills/quality-constraints-verify/scripts/match-constraints.js <args without the two flags>`.

Output JSON keys:
- `constraints.{name}.static_violations` — static rules ALREADY executed: report them directly, no re-checking. Each carries `{id, file, line, message}`, plus `{lines, lines_total}` when several lines offend (`lines` is capped at 20, `lines_total` is the real count — quote it when they differ). **`line: null` on a `present` rule is expected**: the defect is the ABSENCE of the pattern, so report the file alone and never invent a line number.
- `agent_groups[]` — constraints pre-merged into dispatch groups: `{constraints, files, rules (numbered, [constraint]-tagged), must_count, inline_eligible}`. Use them AS-IS: do not re-group, re-number or re-derive anything.
- `advisory.{name}` — SHOULD-only rules: list as warnings in the report, never dispatch.
- `diffs.{file}` — change hunks (git mode); `diffs_truncated[]` — files whose diff was too large (Read them instead).
- `run_ts`, `branch` — for Phase 3.
- `feedback[]` — one row per rule verified this run, clean or not: `{rule (stable id), constraint, kind, files, verdict, hits, text}`. Static rows arrive with `verdict` already set (`pass`/`fail`); **semantic rows carry `verdict: null, hits: null`** — you fill them in Phase 3. These rows become the report's measurement block, so keep them as-is.

Exit early: `"error":"no_files"` → report "No files to check". Zero constraints → report "No applicable constraints".

**The `files` lists are the AUTHORITATIVE scope.** Never re-derive the perimeter: no `git diff`, no `find`, no `git status`. A file not listed is out of scope — do not read it, even "for context".

**The `diffs` hunks are the change content.** Use them for any rule scoped to the change. Read a full file ONLY when a rule requires whole-class context — and then skip its diff.

## Phase 2: Dispatch groups

For each `agent_groups` entry:
- `inline_eligible: true` → verify inline yourself (diffs first, Read only for whole-file context). Spawn cost exceeds verification cost on these.
- otherwise → ONE `quality-constraints:quality-constraints-checker` agent (plugin-qualified: the short name is ambiguous once other plugins are installed). Pass file PATHS only — the agent reads them itself. Dispatch ALL agents in a SINGLE message (parallel), after inline groups are done.

Agent prompt (compact, paste `rules` and `files` verbatim):

```
## Constraint Group: {constraints joined with +}

{rules, one per line}

Files to check:
- {file paths}
```

**No Agent tool? Inline everything, silently.** Do NOT call `ToolSearch`: it invalidates the prompt cache. Batch every Read for a group in a single message, work rule-by-rule, report in the same format. Expected degraded mode, not an anomaly.

**Violation investigation is CAPPED at 2 operations total per violation** (Read or Bash). Rule text + offending line are sufficient grounds to report. If 2 operations don't settle it, report the violation with what you have — the fixer re-checks anyway.

## Phase 3: Report

Merge static violations + agent results + inline results. Compute: N files, S static rules, M semantic rules, V MUST violations, W warnings (SHOULD + advisory findings), E verification errors. Static SHOULD findings are warnings too, never part of V.

If an agent fails, returns no parseable result, cannot read a complete file, or its COVERAGE
omits an expected file/rule, mark its group as a verification error. The same applies to
incomplete inline checks and matcher failures. These errors block the gate without
inventing constraint violations. List the affected files/groups and reasons in the report.

**Full report format** — `INCOMPLETE ❌` when E>0; otherwise `PASSED ✅` when V=0, else `FAILED ❌`:

````
## Constraints Check: FAILED ❌

Files checked: N
Static rules checked: S (0 tokens)
Semantic rules checked: M
Violations found: V
Warnings: W
Verification errors: E

### Static Violations (grep)

#### file1.html.twig
- **TW-001** (MUST) line 42: message
- **TW-002** (MUST) lines 7, 19, 25: message          ← several offending lines
- **TW-003** (MUST): message                          ← `line: null` (`present` rule: pattern absent from the file)

### Semantic Violations (LLM)

#### file2.html.twig
- **TW-005** (MUST): message
  Lines 43-62: detail

### Summary by Constraint Type
| Constraint | Static | Semantic | Total | Files |
|------------|--------|----------|-------|-------|

### Total: V violations, W warnings across N files

```json:constraints-run
{"run_ts":"<run_ts>","ticket":"<TICKET or null>","branch":"<branch>","rules":[<feedback rows, verdicted>]}
```
````

**The measurement block is part of the report, on every run, passing or failing** — recording only failing runs would bias the sample. It is what lets `rule-stats` say "this rule found nothing for N runs", the only source that can: the prose lists violations, never the rules that stayed clean. Build it from `feedback[]`:

- Copy every row **verbatim** — `rule` ids and `text` included, no paraphrase, no reordering, no row dropped. Static rows are complete already.
- On each completely checked semantic row, set `verdict` to one of `pass` (checked, clean), `fail` (checked, violated — set `hits` to the number of files in violation), `n/a` (rule not applicable to these files), `false-positive` (the rule fired but the finding is unfounded — set `hits` and add `"reason":"…"`, one sentence).
- If a rule's population was not completely checked because of a verification error, keep `verdict: null, hits: null` and add a `reason`. Do not substitute `pass` or `n/a`: `rule-stats lint` must flag the incomplete measurement and must not count it as a clean observation.
- Degraded no-Agent mode included: you verified the rules inline, so you have the verdicts.
- Keep the block on one line or pretty-printed, fenced exactly as shown (`json:constraints-run`, nothing else on the fence line). `rule-stats lint` rejects anything else.

**Where it goes** — file OR terminal, never the full report twice.

Resolve the report folder: 1) `REPORTS_DIR` if provided, 2) else
`${QUALITY_ROOT}/code/reports/constraints` if `${QUALITY_ROOT}/code/` exists (the standard
location, read by `quality-retrospective`).

**If a folder resolved** — Write the full report, measurement block included, to `{reports folder}/{run_ts}-constraints.md` (folder auto-created), and print ONLY a compact summary (no block):

```
## Constraints Check: FAILED ❌ (or PASSED ✅, or INCOMPLETE ❌)
Files: N | Static: S | Semantic: M | Violations: V | Warnings: W | Errors: E

- file.php:42 HDL-002 (MUST): message          ← one line per violation, no sections
- file.php HDL-003 (MUST): message             ← no `:line` when `line` is null (`present` rule)
Full report: {report path}
```

**Otherwise** — print the FULL report to the terminal, block included. Never skip silently, never fail the verdict over an unwritable report.

## Phase 4: Verdict Block

End with a `json:verdict` block — MUST be the last thing you output (CI jobs and orchestrators parse it):

```json:verdict
{"success": true, "violations": 0, "warnings": 0}
```

`success`: true only if 0 MUST violations AND verification is complete (E=0).
`violations`: MUST count. `warnings`: SHOULD + advisory count. When E>0, add `errors: E`
and return `success: false`, even if `violations: 0`. For example:

```json:verdict
{"success": false, "violations": 0, "warnings": 0, "errors": 1}
```
