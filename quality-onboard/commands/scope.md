---
description: Step 1 of the onboarding — surveys the project's file types and fixes the scope contract in scopes.json.
allowed-tools: Read, Grep, Glob, Bash, Write
---

# Onboard — scopes

First command in the pipeline. It decides **once** what the following ones will
never rediscover.

## 1. Survey the types

Survey the file types present in the project (entity, command, handler, form…).
Keep only those with **more than 5 files**: below that threshold, no ratio proves
anything and measurement will discard them all.

## 2. Write the contract

For each type kept, establish a `scope` contract:

| Field | Content |
|---|---|
| `slug` | short name of the type (`entity`, `handler`…) — basename of the constraints file, so the key in the `SPEC.md` §1 sense. Unique |
| `prefix` | ID prefix, `^[A-Z]{2,5}$` (`ENT`, `HDL`, `CTL`). Also unique |
| `glob` | file pattern, in the glob grammar from `SPEC.md` §2 |
| `exclude` | optional — glob or list of globs subtracted from `glob` |
| `marker` | distinctive sign: attribute, implemented interface, class suffix |
| `population` | the number of files matched by `glob - exclude` — a count, never the list: a 500-file scope enumerated costs 6k tokens per copy, and the scripts recompute the set in milliseconds |
| `sample` | the files the generator will read — **at most 15** |
| `model` | the scope's reference file, taken from `sample` — the shape the creation skill will mimic |
| `minPopulation` | measurement floor for this scope |
| `label` | optional — human title for the scope (`Doctrine Entities`), rendered as the title of the constraints file. Defaults to the `slug` as title |

`glob - exclude` must match exactly `population` files. The script checks this: count
from the same glob you wrote down, not from memory.

### Choosing the `sample`

The population is what the probe walks, `sample` is what an agent reads. A generator given
52 files doesn't measure better: it discovers conventions, and it's the probe run
on the whole population that generalizes them (`references/candidate-schema.md`).

Take `min(15, population)` files, chosen for their **diversity**, not at random:

- different modules / bounded contexts
- the largest and the smallest file
- the oldest and the most recent (`git log --diff-filter=A`)

A sample taken from a single module produces rules that are true only in that
module — measurement will send them back to `a-revoir` (to-review), but at the cost of an
extra round.

### Choosing the `model`

The file the creation skill will mimic. The constraints state the rule; the
model shows what no rule states — member order, breakdown, local naming.
Without it, the agent creating a file invents that part on its own.

Take it **from `sample`**: a model the generator hasn't read shows a shape that
the rules don't describe. Choose the most **representative** one, not the
richest: the scope's median structure, with no special case or visible debt. A
recent, short file beats a large historical one.

The choice is fixed here, but it isn't final: `quality-retrospective` can
propose a better model once the constraints are known.

### Choosing `minPopulation`

Default **5**. For a small scope, a proportional floor:
`min(5, max(2, ceil(population / 3)))`.

It is fixed here, not recalculated at measurement time: two runs under two
different floors aren't comparable.

## 3. Write and validate

Write `.claude/quality/onboard/scopes.json`:

```json
{ "scopes": [ { "slug": "…", "prefix": "…", "glob": "…", "marker": "…",
                "population": 52, "sample": ["…"], "model": "…", "minPopulation": 5 } ] }
```

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/validate-scopes.mjs
```

It runs before a single agent is launched — that's its whole point: a wrong
`glob` discovered later has already cost N generators. It also checks that the
`quality-constraints` engine (`constraint-lint`, `measure-candidates`) is reachable: it is
needed at steps 4 and 9, and its absence must stop the run here, not there. If it fails
on that, follow the message (`CONSTRAINT_KIT_BIN`, or `/quality-constraints:install`).

## Output

A table: slug, number of files, sample size, model, minPopulation. Nothing else.
Then: `→ /quality-onboard:generate`.
