---
description: Steps 2 to 4 of the onboarding — generates rule candidates per scope, checks their shape, measures them.
allowed-tools: Read, Bash, Task
---

# Onboard — generation and measurement

Prerequisite: `.claude/quality/onboard/scopes.json`, written by `/quality-onboard:scope`.
If it is missing, stop and point back to that command.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-scopes.mjs
```

## 2. Generation

For each entry in `scopes.json`, launch the `candidate-generator` agent, passing it
its contract **as-is**, the references folder, and the output path:

```
Agent(subagent_type: "candidate-generator", prompt:
  slug: entity
  prefix: ENT
  glob: src/*/Domain/*.php
  exclude: src/*/Domain/*Embeddable.php
  marker: #[ORM\Entity]
  population: 52
  sample:
    - … (the files to read, copied from scopes.json)
  refDir: ${CLAUDE_PLUGIN_ROOT}/skills/onboard/references
  output: .claude/quality/onboard/candidates/entity.json
)
```

The types are independent: **launch them in parallel**, in a single message.

The agent reads `criteria.md` and `candidate-schema.md` itself from `refDir`. Do not copy
the criteria or the schema into the prompt.

You do not read any produced JSON. Each agent returns one line, that's all you need.

## 3. Shape validation

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-candidates.mjs --phase pre
```

Checks the invariants from `references/candidate-schema.md` — deterministic, so no
agent involved. `check` and `measure` are still absent everywhere: step 4 sets them.

On failure for a scope, relaunch **its** generator with the errors, not all of them.

## 4. Measurement

This is where every rule gets **classified**. Nothing is judged, and nothing is discarded.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/measure.mjs
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-candidates.mjs --phase measured
```

`measure.mjs` reads the `minPopulation` of each scope in `scopes.json` and runs one
pass per distinct floor. Only pass `--min-population` to deliberately override what
was fixed at step 1.

It projects the live candidates onto `measure-candidates`, writes
`.claude/quality/onboard/measures.json`, then reports the verdicts. `STATIC` and `SEMANTIC`
are kept; the others go back to `a-revoir` (to-review), **without discarding anything**. Details in
"How measurement classifies" (`candidate-schema.md`).

## Output

A table: slug, rules kept, discarded, `a-revoir` (to-review). Nothing else.
Then: `→ /quality-onboard:review [slug]`, listing the slugs to review.
