# Onboard — in-depth review

Resolve `QUALITY_ROOT` from the environment, then `.luciole.local.env`,
then `.luciole.env`, defaulting to `.ia/quality`. Every path below is relative to that root.

Argument: the slug to review (the word after `review-scope`). Without an argument, processes all slugs present in
`${QUALITY_ROOT}/onboard/candidates/`, **one at a time**, never in parallel.

This is the step that has the final word. A script has measured; no one has judged yet.

> One slug at a time is the recommended mode on a large project: you can `/clear` between
> two, the state lives on disk.

## What you don't do

**You open no candidates JSON, and no findings JSON.** That's the whole point of
this command: judgment travels through disk, from one agent to another. You see
counters, not rules.

When `/luciole:onboard` routed here with "rule(s) not re-measured since their reprobe",
the run stopped inside the loop: start at the `measure.mjs --slug` of "Loop 6 → 4", then
continue with step 5.

## 5. Review

```
Agent(subagent_type: "scope-reviewer", prompt:
  slug: entity
  candidates: ${QUALITY_ROOT}/onboard/candidates/entity.json
  refDir: ${CLAUDE_PLUGIN_ROOT}/skills/onboard/references
  findings: ${QUALITY_ROOT}/onboard/findings/entity.json
)
```

Read-only. It checks the `retenu` (kept) rules against the criteria, and resolves **all**
`a-revoir` (to-review) ones — fix the probe and re-measure, keep, or discard.

## 6. Application

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/apply-findings.mjs --slug entity
```

Applies every finding as written, or none. On a refusal (exit 1) nothing was written:
relaunch the reviewer with the refusals it printed, then run this again. Its line gives
the round, the number of `reprobe` and the `a-revoir` remaining.

## Loop 6 → 4

A rule whose probe changed — `regex`, `sense`, or `gate` — no longer has a
valid verdict. If `apply-findings` reports at least one `reprobe`:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/measure.mjs --slug entity
```

`--slug` matters: it doesn't touch the JSON of other scopes, which another
command might be correcting at the same time.

Then loop back to step 5, for that slug only. `apply-findings` counts the rounds on
disk and refuses a third `reprobe` on the same rule: the reviewer keeps or discards it.

`measure.mjs` preserves every `measure.by: "review"`, and keeps `check: semantic` on a
kept rule that already carries a measurement — a static candidate the review demoted
stays demoted across passes. To deliberately re-measure such a rule, a `reprobe` removes
its `measure` field first.

## Loop exit

No rule carries `a-revoir` (to-review) anymore, and the JSON is well-formed.
`measure.mjs` and the `/luciole:onboard` routing both check the shape: when either
reports shape errors for this slug, relaunch the reviewer with them.

## Output

One line per slug processed: findings, applied, discarded, loop rounds.

If `apply-findings` reported rules **kept without a probe** (`no probe:`), list them separately —
id and statement — with this note: "kept on manual review, no mechanical
measurement behind it — to confirm, or to discard via `/luciole:onboard review-scope <slug>`".
This is the only point in the pipeline where a rule enters the deliverable
without a script having counted it: the human has the final word on it.

Then: → `/luciole:onboard` for the next step — the next slug to review, or the render once all are done. On a large project, `/clear` first.
