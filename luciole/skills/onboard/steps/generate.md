# Onboard — generation and measurement

Resolve `QUALITY_ROOT` from the environment, then `.luciole.local.env`,
then `.luciole.env`, defaulting to `.ia/quality`. Every path below is relative to that root.

Prerequisite: `${QUALITY_ROOT}/onboard/scopes.json`, written by `/luciole:onboard scope`.
If it is missing, stop and point back to that step.

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-scopes.mjs
```

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/next-step.mjs
```

It prints `next: generate — not generated: <slugs>; not measured: <slugs>` (either part
may be absent). Those two lists are the whole work of this step. Any other `next:`
means generation is over: say so and stop.

## 2. Generation

For each **not generated** slug — and only those — launch the `candidate-generator`
agent, passing it its contract from `scopes.json` **as-is**, the references folder, and
the output path:

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
  output: ${QUALITY_ROOT}/onboard/candidates/entity.json
)
```

The types are independent: **launch them in parallel**, in a single message.

Never launch a generator on a slug whose candidates file exists: it may already carry
measurements, and overwriting it loses them. To regenerate a scope on purpose, the human
deletes its candidates file first — and its findings, with `findings/rounds/{slug}.*`.

The agent reads `criteria.md` and `candidate-schema.md` itself from `refDir`. Do not copy
the criteria or the schema into the prompt.

You do not read any produced JSON. Each agent returns one line, that's all you need.

## 3–4. Shape validation and measurement

This is where every rule gets **classified**. Nothing is judged, and nothing is discarded.

For each slug of both lists, one after the other:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/measure.mjs --slug entity
```

`--slug` keeps the measurement off the scopes this step didn't produce.

`measure.mjs` first checks the invariants from `references/candidate-schema.md`, and
refuses to measure or write anything if one fails. The errors are prefixed by the file:
relaunch the generator of **that** scope with them, then re-run its measurement. It's
the one case where a generator overwrites an existing file: a refused file was never
measured, there is nothing on it to lose.

`measure.mjs` reads the scope's `minPopulation` in `scopes.json`. Only pass
`--min-population` to deliberately override what was fixed at step 1.

It projects the live candidates onto `measure-candidates`, writes
`${QUALITY_ROOT}/onboard/measures.json`, then reports the verdicts. `STATIC` and `SEMANTIC`
are kept; the others go back to `a-revoir` (to-review), **without discarding anything**. Details in
"How measurement classifies" (`candidate-schema.md`).

## Output

A table: slug, rules kept, discarded, `a-revoir` (to-review). Nothing else.
Then: → `/luciole:onboard` for the next step (the review, one slug at a time), listing the slugs to review.
