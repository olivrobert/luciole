# Onboard — rendering, gate, and human validation

Resolve `QUALITY_ROOT` from the environment, then `.luciole.local.env`,
then `.luciole.env`, defaulting to `.ia/quality`. Every path below is relative to that root.

## 7–9. Render and gate

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/render.mjs
```

Runs, in order, and stops at the first failure:

- `render-constraints.mjs` (7) — `${QUALITY_ROOT}/code/constraints/{slug}.md`, following
  `references/constraint-format.md`. Regenerated, never hand-edited. Refuses the whole
  run, writing nothing, on a surviving `a-revoir` or a shape error: go back to
  `/luciole:onboard review-scope <slug>` for the offending scope.
- `render-backlog.mjs` (8) — `${QUALITY_ROOT}/code/lint-backlog.md`, following
  `references/lint-backlog-format.md`. A line marked `done` keeps its status.
- `verify-onboard.mjs` (9) — the gate: `constraint-lint --strict` (an exit 2, "nothing
  verified", is not a success), the measurement report, a ratio on every semantic rule.
- `render-review.mjs` (10) — the summary for the human. It only runs once the gate is green.

## 10. Final human review

Present the summary `render.mjs` ended with **in full** to the user: just a few lines — the number of
rules kept per scope and the path to each constraints file to read. Never copy
the rules into the conversation: the deliverable is the file.

Ask the user to read these files, then give an explicit validation of the
whole set. No response, an ambiguous validation, or a refusal is not an
approval: stop the run, don't launch step 11, and don't write any approval
file. If the user asks for proof of an ID, show only its `evidence`, its
`counterExamples`, its finding, and the cited source files, then ask for
validation again.

Only after an explicitly positive response:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/approval.mjs approve
```

This script writes `${QUALITY_ROOT}/onboard/approval.json`, hash-linked to the exact
content of all constraints files. Any later regeneration or edit invalidates
this approval.

## Output

The files written, the gate's verdict, and, after the user's response, the
verdict of the human validation. Nothing else.
Then: → `/luciole:onboard` for the next step (skills).
