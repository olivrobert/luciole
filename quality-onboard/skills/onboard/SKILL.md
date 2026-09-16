---
name: onboard
description: Full run of the quality onboarding, and a map of the pipeline — the five commands, their artifacts, and the invariants that link them.
disable-model-invocation: true
---

# Onboard

Generates the constraint files (`constraints/{slug}.md`) that `quality-constraints` **enforces** during review and that scaffolding skills follow when creating classes. A deviation from `SPEC.md` produces a silently inert rule, hence the deterministic steps that frame the agents: measurement and the gate.

Determinism measures, checks shape, flags — it never **deletes a rule**: a low ratio can mean "wrong" as much as "poorly scoped". Substantive review decides; the human validates once, at the end, the whole delivered set.

This file executes nothing. Instructions live in `commands/`, facts in `references/`, roles in `agents/`, determinism in `scripts/`.

## The five commands

| Command | Steps | Produces |
|---|---|---|
| `/quality-onboard:scope` | 1 | `scopes.json` — the scope contract |
| `/quality-onboard:generate` | 2-4 | `candidates/{slug}.json`, measured |
| `/quality-onboard:review [slug]` | 5-6 | `findings/{slug}.json`, then corrected candidates |
| `/quality-onboard:render` | 7-10 | `constraints/{slug}.md`, `lint-backlog.md`, gate, human validation |
| `/quality-onboard:skills` | 11 | one skill per scope + `skill-mapping.md` |

## The full run

Invoked directly, this skill chains the five commands: read each file in `${CLAUDE_PLUGIN_ROOT}/commands/` in table order and apply it. Control goes back to the human once, after the `render` gate, to validate the delivered rules.

A script that exits with an error **stops the run**. Moving on and hoping the gate catches it means wrong files get written first.

On a project with several scopes of 40+ files, do not run it in one go: the review step saturates a single context (each slug chains a review and an application, and the 6→4 loop can need two passes). Run the five commands by hand, with a `/clear` between two `/quality-onboard:review <slug>` calls.

## What protects the orchestrator's context

- **The orchestrator never reads a candidates JSON.** Agents return a single line; state lives on disk.
- **Judgment travels through files.** `scope-reviewer` writes findings, `finding-applier` reads them. No review prose comes back up.

Corollary: every command is resumable, and what step 1 wrote is never rediscovered — two discoveries of the same scope don't yield the same `sample`.

The population is `glob - exclude`, recomputed by the scripts and never enumerated (`scope.population` is its count); `scope.sample` (≤ 15) is what the generator reads. Measurement runs the probe against the whole population and overwrites `counterExamples`: the agent **discovers**, the script **generalizes**. Details in `references/candidate-schema.md`.

## The actors

| Actor | Does | Does not |
|---|---|---|
| `candidate-generator` | reads `sample`, writes the candidates | set `check` or `measure` |
| `measure.mjs` → `measure-candidates` | classifies by ratio | discard anything |
| `scope-reviewer` | judges, writes the findings | write into the candidates |
| `finding-applier` | applies the findings | judge, delete a rule |
| `verify-onboard.mjs` → `constraint-lint` | blocks | fix |
| `render-review.mjs` → `approval.mjs` | points to the constraints to re-read, then attests the validated hash | modify any rule |

## The run invariants

- `glob - exclude` matches exactly `population` files; `sample` is a subset of it, ≤ 15
- a `slug` and a `prefix` belong to exactly one scope
- a rule `id` is durable: renumbering it erases its measurement history
- a discarded rule **stays** in `rules`, with its `reason` — it documents the rejection
- a rule whose probe changes goes back through measurement
- at the end, no rule carries `a-revoir`, the gate is green, and the constraints hash matches the human approval

## The artifacts

```
.claude/quality/onboard/scopes.json             step 1
.claude/quality/onboard/candidates/{slug}.json  steps 2-6
.claude/quality/onboard/findings/{slug}.json    steps 5-6
.claude/quality/onboard/measures.json           step 4
.claude/quality/code/constraints/{slug}.md      step 7  — the deliverable
.claude/quality/code/lint-backlog.md            step 8
.claude/quality/onboard/approval.json           step 10 — approval of the delivered hash
.claude/skills/quality-{slug}/SKILL.md          step 11
.claude/skills/skill-mapping.md                 step 11 — the file → skill table
```

The constraints markdown is never edited by hand: it is regenerated from the JSON.

## The references

| File | Carries |
|---|---|
| `references/criteria.md` | what deserves to be a rule, and how to handle an `a-revoir` |
| `references/candidate-schema.md` | structure of the candidates and of `scopes.json`, how measurement classifies |
| `references/findings-schema.md` | structure of the findings |
| `references/constraint-format.md` | the deliverable template |
| `references/lint-backlog-format.md` | the tooling backlog template |
