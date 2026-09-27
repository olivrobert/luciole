---
name: onboard
description: Quality onboarding — the full run, or one of its five steps (scope, generate, review-scope, render, skills) — and a map of the pipeline, its artifacts, and the invariants that link them.
argument-hint: "[scope | generate | review-scope [slug] | render | skills]"
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, Task, Skill
disable-model-invocation: true
---

# Onboard

`QUALITY_ROOT` is the harness-independent state root. `/luciole:onboard scope` asks for it
once and stores it in the project-root `.luciole.env`; `.luciole.local.env`
beside it, then a process environment variable, can override it, and `.ia/quality` remains
the fallback. Both `code/` deliverables and
`onboard/` intermediate state live below it.

Generates the constraint files (`constraints/{slug}.md`) that `luciole` **enforces** during review and that scaffolding skills follow when creating classes. A deviation from `SPEC.md` produces a silently inert rule, hence the deterministic steps that frame the agents: measurement and the gate.

Determinism measures, checks shape, flags — it never **deletes a rule**: a low ratio can mean "wrong" as much as "poorly scoped". Substantive review decides; the human validates once, at the end, the whole delivered set.

This file executes nothing. Instructions live in `steps/`, facts in `references/`, roles in `agents/`, determinism in `scripts/`.

## The five steps

| Invocation | Steps | Produces |
|---|---|---|
| `/luciole:onboard scope` | 1 | `scopes.json` — the scope contract |
| `/luciole:onboard generate` | 2-4 | `candidates/{slug}.json`, measured |
| `/luciole:onboard review-scope [slug]` | 5-6 | `findings/{slug}.json`, then corrected candidates |
| `/luciole:onboard render` | 7-10 | `constraints/{slug}.md`, `lint-backlog.md`, gate, human validation |
| `/luciole:onboard skills` | 11 | one skill per scope + `skill-mapping.md` |

## The full run

Arguments: $ARGUMENTS

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. The step files are read as plain files, so the plugin-root variable they cite is not expanded, and the shell does not define it either: substitute this path wherever a step or an agent prompt uses it.

- **A step name** (`scope`, `generate`, `review-scope`, `render`, `skills`): read `${CLAUDE_PLUGIN_ROOT}/skills/onboard/steps/{step}.md` and apply it, nothing else. Words after the step name are its arguments (`review-scope entity`: the slug). The step names its successor when it ends; do not chain it.
- **No argument**: the full run. Read each file in `${CLAUDE_PLUGIN_ROOT}/skills/onboard/steps/` in table order and apply it. Control goes back to the human once, after the `render` gate, to validate the delivered rules.
- **Anything else**: list the five steps and stop.

A script that exits with an error **stops the run**. Moving on and hoping the gate catches it means wrong files get written first.

On a project with several scopes of 40+ files, do not run it in one go: the review step saturates a single context (each slug chains a review and an application, and the 6→4 loop can need two passes). Run the five steps one by one, with a `/clear` between two `/luciole:onboard review-scope <slug>` calls.

## What protects the orchestrator's context

- **The orchestrator never reads a candidates JSON.** Agents return a single line; state lives on disk.
- **Judgment travels through files.** `scope-reviewer` writes findings, `finding-applier` reads them. No review prose comes back up.

Corollary: every step is resumable, and what step 1 wrote is never rediscovered — two discoveries of the same scope don't yield the same `sample`.

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
${QUALITY_ROOT}/onboard/scopes.json             step 1
${QUALITY_ROOT}/onboard/candidates/{slug}.json  steps 2-6
${QUALITY_ROOT}/onboard/findings/{slug}.json    steps 5-6
${QUALITY_ROOT}/onboard/measures.json           step 4
${QUALITY_ROOT}/code/constraints/{slug}.md      step 7  — the deliverable
${QUALITY_ROOT}/code/lint-backlog.md            step 8
${QUALITY_ROOT}/onboard/approval.json           step 10 — approval of the delivered hash
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
