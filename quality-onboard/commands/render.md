---
description: Steps 7 to 10 of the onboarding — renders the constraints and backlog, passes the gate, then requests human validation.
allowed-tools: Read, Bash
---

# Onboard — rendering, gate, and human validation

The first three steps are deterministic. The last one doesn't re-judge the
candidates one by one: it asks the human whether they accept the complete
deliverable.

## 7. Render the constraints

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/render-constraints.mjs
```

Generates `.claude/quality/code/constraints/{slug}.md` from each JSON, following
`references/constraint-format.md`. The markdown is the deliverable; it is never
hand-edited, it is regenerated. The file's title comes from `scope.label`, or
the `slug` if none.

The script refuses the entire run — without writing anything — if a rule
remains in `a-revoir` (to-review): rendering it would mean deciding in place of step 5.
In that case, go back to `/quality-onboard:review <slug>` for the offending scope.

## 8. Tooling backlog

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/render-backlog.mjs
```

Projects rules carrying an `automatable` field into
`.claude/quality/code/lint-backlog.md`, following `references/lint-backlog-format.md`.
The existing file isn't blindly overwritten: a line already marked `fait` (done) keeps
its status.

## 9. Gate

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/verify-onboard.mjs
```

Blocks as long as `constraint-lint --strict` doesn't exit 0, the measurement
report is missing or empty, a semantic rule has no ratio, or an `a-revoir`
(to-review) survives. An exit 2 from `constraint-lint` ("nothing verified") is not a success.

Nothing is presented for validation until the gate is green.

## 10. Final human review

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/render-review.mjs
```

Present its output **in full** to the user: just a few lines — the number of
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

This script writes `.claude/quality/onboard/approval.json`, hash-linked to the exact
content of all constraints files. Any later regeneration or edit invalidates
this approval.

## Output

The files written, the gate's verdict, and, after the user's response, the
verdict of the human validation. Nothing else.
Then: `→ /quality-onboard:skills`.
