---
name: quality-constraints-verify
description: Verify code quality constraints from .claude/quality/code/constraints. Accepts files, directories, or uses git diff by default.
argument-hint: "[file1 file2 …] [dir/ …] [--ticket=<name>] [--reports=<dir>] (empty = git diff)"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/quality-constraints-verify/scripts/match-constraints.js), Read, Agent, Write
model: opus
---

# Constraints Checker (Orchestrator)

Read-only orchestrator. Static checks, constraint matching and agent grouping are pre-computed by a script — you dispatch semantic checks and build the report. DETECTS and REPORTS only, never fixes: corrections are the caller's job.

## Input

**Raw arguments received:** $ARGUMENTS

Strip `--ticket=<name>` → `TICKET` (written into the report's measurement block, Phase 3: a ticket id, a branch name). Strip `--reports=<dir>` → `REPORTS_DIR` (Phase 3). Forward the remaining arguments to the script as-is.

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

Merge static violations + agent results + inline results. Compute: N files, S static rules, M semantic rules, V MUST violations, W warnings (SHOULD + advisory findings). If an agent fails or returns no parseable result, mark its group as WARN.

**Full report format** — `PASSED ✅` header when V=0, else `FAILED ❌`:

````
## Constraints Check: FAILED ❌

Files checked: N
Static rules checked: S (0 tokens)
Semantic rules checked: M
Violations found: V
Warnings: W

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
- On each semantic row, set `verdict` to one of `pass` (checked, clean), `fail` (checked, violated — set `hits` to the number of files in violation), `n/a` (rule not applicable to these files), `false-positive` (the rule fired but the finding is unfounded — set `hits` and add `"reason":"…"`, one sentence). Never leave `verdict: null`: an unfilled verdict is a lost measurement, not a pass.
- Degraded no-Agent mode included: you verified the rules inline, so you have the verdicts.
- Keep the block on one line or pretty-printed, fenced exactly as shown (`json:constraints-run`, nothing else on the fence line). `rule-stats lint` rejects anything else.

**Where it goes** — file OR terminal, never the full report twice.

Resolve the report folder: 1) `REPORTS_DIR` if provided, 2) else `.claude/quality/code/reports/constraints` if `.claude/quality/code/` exists (the standard location, read by `quality-retrospective`).

**If a folder resolved** — Write the full report, measurement block included, to `{reports folder}/{run_ts}-constraints.md` (folder auto-created), and print ONLY a compact summary (no block):

```
## Constraints Check: FAILED ❌ (or PASSED ✅)
Files: N | Static: S | Semantic: M | Violations: V | Warnings: W

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

`success`: true only if 0 MUST violations. `violations`: MUST count. `warnings`: SHOULD count.
