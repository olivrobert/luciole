---
name: verify
description: Verify code quality constraints from the configured quality root. Accepts files, directories, or uses git diff by default.
argument-hint: "[file1 file2 …] [dir/ …] [--engine=agent|jev] [--ticket=<name>] [--reports=<dir>] [--out=<path>] (empty = git diff)"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/quality-config *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-check *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-report *), Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/verify/scripts/match-constraints.js), Read, Agent, Write
model: opus
---

# Constraints Checker (Orchestrator)

Resolve `QUALITY_ROOT` from the environment, then `.luciole.local.env`,
then `.luciole.env`, defaulting to `.ia/quality`.

Read-only orchestrator. Static checks, constraint matching and agent grouping are pre-computed by a script — you dispatch semantic checks and write the run document; code renders the report and the verdict. DETECTS and REPORTS only, never fixes: corrections are the caller's job.

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
(written into the run document, Phase 3: a ticket id, a branch name). Strip
`--reports=<dir>` → `REPORTS_DIR` and `--out=<path>` → `OUT` (Phase 3). Forward the
remaining arguments to the matcher as-is.

## Phase 1: Run the matching script

Run `node ${CLAUDE_PLUGIN_ROOT}/skills/verify/scripts/match-constraints.js <args without the two flags>`.

Output JSON keys:
- `constraints.{name}.static_violations` — static rules ALREADY executed: report them directly, no re-checking. Each carries `{id, file, line, message}`, plus `{lines, lines_total}` when several lines offend (`lines` is capped at 20, `lines_total` is the real count — quote it when they differ). **`line: null` on a `present` rule is expected**: the defect is the ABSENCE of the pattern, so report the file alone and never invent a line number.
- `agent_groups[]` — constraints pre-merged into dispatch groups: `{constraints, files, rules (numbered, [constraint]-tagged), must_count, inline_eligible}`. Use them AS-IS: do not re-group, re-number or re-derive anything.
- `advisory.{name}` — SHOULD-only rules: list as warnings in the report, never dispatch.
- `diffs.{file}` — change hunks (git mode); `diffs_truncated[]` — files whose diff was too large (Read them instead).
- `run_ts`, `branch` — for Phase 3.
- `feedback[]` — one row per rule verified this run, clean or not: `{rule (stable id), constraint, kind, files, verdict, hits, text}`. Static rows arrive with `verdict` already set (`pass`/`fail`); **semantic rows carry `verdict: null, hits: null`** — you fill them in Phase 3. These rows become the run document's `rules`, so keep them as-is.

Exit early: `"error":"no_files"` → report "No files to check". Zero constraints → report "No applicable constraints". Either way, write no run document (nothing was measured) and end with `{"success": true, "violations": 0, "warnings": 0}` as a `json:verdict` block.

**The `files` lists are the AUTHORITATIVE scope.** Never re-derive the perimeter: no `git diff`, no `find`, no `git status`. A file not listed is out of scope — do not read it, even "for context".

**The `diffs` hunks are the change content.** Use them for any rule scoped to the change. Read a full file ONLY when a rule requires whole-class context — and then skip its diff.

## Phase 2: Dispatch groups

For each `agent_groups` entry:
- `inline_eligible: true` → verify inline yourself (diffs first, Read only for whole-file context). Spawn cost exceeds verification cost on these.
- otherwise → ONE `luciole:checker` agent (plugin-qualified: the short name is ambiguous once other plugins are installed). Pass file PATHS only — the agent reads them itself. Dispatch ALL agents in a SINGLE message (parallel), after inline groups are done.

Agent prompt (compact, paste `rules` and `files` verbatim):

```
## Constraint Group: {constraints joined with +}

{rules, one per line}

Files to check:
- {file paths}
```

**No Agent tool? Inline everything, silently.** Do NOT call `ToolSearch`: it invalidates the prompt cache. Batch every Read for a group in a single message, work rule-by-rule, report in the same format. Expected degraded mode, not an anomaly.

**Violation investigation is CAPPED at 2 operations total per violation** (Read or Bash). Rule text + offending line are sufficient grounds to report. If 2 operations don't settle it, report the violation with what you have — the fixer re-checks anyway.

## Phase 3: Run document

Merge static violations + agent results + inline results into ONE JSON document. You write
**data only**: the markdown report, the counts and the verdict are computed from it by
`constraint-report`, identically to the Jev engine. Never write markdown or a verdict by hand.

If an agent fails, returns no parseable result, cannot read a complete file, or its COVERAGE
omits an expected file/rule, mark its group as a verification error. The same applies to
incomplete inline checks and matcher failures. These errors block the gate without
inventing constraint violations.

**Where** — `{folder}/{run_ts}-constraints.json`, folder = `REPORTS_DIR` if provided, else
`${QUALITY_ROOT}/code/reports/constraints` (the standard location, read by
`luciole:retrospective`). Write it with the Write tool (folder auto-created).

```json
{
  "format": "constraints-run/1",
  "run_ts": "<run_ts>", "ticket": "<TICKET or null>", "branch": "<branch>", "engine": "agent",
  "counts": { "files": N, "staticRules": S, "semanticRules": M },
  "staticViolations":   [{ "file": "…", "id": "TW-001", "constraint": "…", "severity": "MUST", "message": "…", "line": 42 }],
  "staticWarnings":     [],
  "semanticViolations": [{ "file": "…", "id": "<feedback rule id>", "constraint": "…", "severity": "MUST", "message": "MUST: …", "detail": "Lines 43-62: …" }],
  "semanticWarnings":   [],
  "advisories": ["<advisory rule text>"],
  "errors": [{ "file": "…", "message": "<what could not be verified, and why>" }],
  "summary": [{ "constraint": "…", "static": 0, "semantic": 1, "total": 1, "files": 3 }],
  "rules": [<feedback rows, verdicted>]
}
```

- **Static findings** — copy each `static_violations` entry as-is (`id, file, line`, and `lines, lines_total` when present) and add `constraint` and `severity` (`MUST` or `SHOULD`, from its message). **`line: null` on a `present` rule is expected**: keep it, never invent a line. MUST → `staticViolations`, SHOULD → `staticWarnings`.
- **Semantic findings** — one row per (file, rule) in violation. `id` is the rule's `rule` id in `feedback[]`, `message` the rule text, `detail` your evidence in one line (offending lines + what is wrong). MUST → `semanticViolations`, SHOULD → `semanticWarnings`.
- **`advisories`** — the `advisory.{name}` texts, never checked.
- **`counts`** — N files, S static rules, M semantic rules. Leave out violations/warnings/errors and `verdict`: `constraint-report` derives them from the lists and overwrites anything written there.
- **`rules`** — the measurement `rule-stats` reads, written on **every run, passing or failing** (recording only failing runs would bias the sample; it is the only source that can say "this rule found nothing for N runs"). Built from `feedback[]`:
  - Copy every row **verbatim** — `rule` ids and `text` included, no paraphrase, no reordering, no row dropped. Static rows are complete already.
  - On each completely checked semantic row, set `verdict` to one of `pass` (checked, clean), `fail` (checked, violated — set `hits` to the number of files in violation), `n/a` (rule not applicable to these files), `false-positive` (the rule fired but the finding is unfounded — set `hits` and add `"reason":"…"`, one sentence).
  - If a rule's population was not completely checked because of a verification error, keep `verdict: null, hits: null` and add a `reason`. Do not substitute `pass` or `n/a`: `rule-stats lint` must flag the incomplete measurement and must not count it as a clean observation.
  - Degraded no-Agent mode included: you verified the rules inline, so you have the verdicts.

## Phase 4: Render and verdict

Run `node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-report {json path}` (append `--out=OUT` when
provided). It validates the document, rewrites it normalized, renders
`{run_ts}-constraints.md` beside it, and prints a compact summary ending with the
`json:verdict` block. **Print its stdout unchanged as your final output** — the verdict block
MUST be the last thing you output (CI jobs and orchestrators parse it).

- Exit `0` — passed. Exit `1` — MUST violations: the command worked, the constraints failed.
- Exit `2` with `INCOMPLETE` — verification errors: the gate blocks, even with zero violations.
- Exit `2` with a `constraint-report:` error on stderr — the document is invalid. Fix it and
  run the command again, once. Never replace the command's verdict with one of your own.

`success` is true only if 0 MUST violations AND verification is complete (E=0); on E>0 the
block carries `errors: E`:

```json:verdict
{"success": false, "violations": 0, "warnings": 0, "errors": 1}
```
