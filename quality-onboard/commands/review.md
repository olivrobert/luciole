---
description: Steps 5 and 6 of the onboarding — in-depth review of a scope's candidates, then applying the findings. Optional argument: the slug.
argument-hint: "[slug]"
allowed-tools: Read, Bash, Task
---

# Onboard — in-depth review

Argument: `$1` — the slug to review. Without an argument, processes all slugs present in
`.claude/quality/onboard/candidates/`, **one at a time**, never in parallel.

This is the step that has the final word. A script has measured; no one has judged yet.

> One slug at a time is the recommended mode on a large project: you can `/clear` between
> two, the state lives on disk.

## What you don't do

**You open no candidates JSON, and no findings JSON.** That's the whole point of
this command: judgment travels through disk, from one agent to another. You see
counters, not rules.

## 5. Review

```
Agent(subagent_type: "scope-reviewer", prompt:
  slug: entity
  candidates: .claude/quality/onboard/candidates/entity.json
  refDir: ${CLAUDE_PLUGIN_ROOT}/skills/onboard/references
  findings: .claude/quality/onboard/findings/entity.json
)
```

Read-only. It checks the `retenu` (kept) rules against the criteria, and resolves **all**
`a-revoir` (to-review) ones — fix the probe and re-measure, keep, or discard.

## 6. Application

```
Agent(subagent_type: "finding-applier", prompt:
  slug: entity
  candidates: .claude/quality/onboard/candidates/entity.json
  findings: .claude/quality/onboard/findings/entity.json
  refDir: ${CLAUDE_PLUGIN_ROOT}/skills/onboard/references
)
```

It edits, it doesn't judge. Its final line gives the number of `reprobe`.

## Loop 6 → 4

A rule whose probe changed — `regex`, `sense`, or `gate` — no longer has a
valid verdict. If the applier reports at least one `reprobe`:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/measure.mjs --slug entity
```

`--slug` matters: it doesn't touch the JSON of other scopes, which another
command might be correcting at the same time.

Then loop back to step 5, for that slug only. **Two rounds are enough**; a rule
that needs a third one gets discarded — tell the applier so on the third pass.

`measure.mjs` preserves every `measure.by: "review"`, and keeps `check: semantic` on a
kept rule that already carries a measurement — a static candidate the review demoted
stays demoted across passes. To deliberately re-measure such a rule, the applier first
removes its `measure` field — which a `reprobe` does.

## Loop exit

No rule carries `a-revoir` (to-review) anymore:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-candidates.mjs --phase post
```

This script is global: as long as other slugs remain to review, it will fail
on them. That's expected — read only the lines for your slug, and treat it as
blocking only on the last one.

## Output

One line per slug processed: findings, applied, discarded, loop rounds.

If the applier reported rules **kept without a probe**, list them separately —
id and statement — with this note: "kept on manual review, no mechanical
measurement behind it — to confirm, or to discard via `/quality-onboard:review <slug>`".
This is the only point in the pipeline where a rule enters the deliverable
without a script having counted it: the human has the final word on it.

Once all slugs have been processed: `→ /quality-onboard:render`.
