---
description: Step 11 of the onboarding — generates the project's creation skills, one per scope, each routing to its constraints file.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Skill
---

# Onboard — skills

Last command in the pipeline. It makes each scope **addressable**: a technical
plan maps every file to create onto a skill, so each `scope` in `scopes.json`
gets its own — and it never has anything more to say than "read the
constraints". The rules live in `constraints/{slug}.md`, derived from the actual
code; a skill that said more would introduce a second normative source.

Preconditions: step 9's gate is green and the constraints have been explicitly
approved by a human at step 10. Check this second precondition before writing
anything:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/approval.mjs check
```

A missing approval, or one whose hash no longer matches the constraints, stops
the command and points back to `/quality-onboard:render`. A skill rendered from
ungated or unapproved constraints routes to rules that are wrong.

## 11a. The skill, scope by scope

For each `scope` in `.claude/quality/onboard/scopes.json`, render
`.claude/skills/quality-<slug>/SKILL.md` from this template:

```markdown
---
name: quality-<slug>
description: "Create <scope.label, or the slug if none> in <scope.glob>. Use whenever a file matching that pattern is added or modified."
allowed-tools: Read, Write, Edit, Skill
---

# Create <scope.label, or the slug if none>

## Workflow

1. Read `.claude/quality/code/constraints/<slug>.md` and apply it in full — it is the only normative source.
2. Read `<scope.model>` and mirror its shape; where the constraints disagree, the constraints win.

## Output

- `<scope.glob>`
```

Line 2 renders the scope's `model` — an actual file from the scope, fixed at
step 1. It is mandatory: `verify-skills.mjs` rejects a skill that routes to
none. A scope with no `model` in `scopes.json` gets fixed at step 1, not here —
never invent a path at render time.

Nothing else: no guardrail, no precondition, no other pointer into `src/` than
the resolved model. A line that seems to be missing here either already belongs
in the constraints, or is a rule candidate to report — never an add-on made in
passing.

An already-existing skill is **regenerated**, never merged: the source of
truth is the constraints + `scopes.json` pair, not the previous render. Same
name, mapping intact.

## 11b. The mapping

Write `.claude/skills/skill-mapping.md`: one line per scope —
file type (the `marker` helps), glob, skill. This is the table a technical
plan consumes to map file → skill, and where the arbitration against a
competing generic skill lives. Lines for scopes not covered here that are
already present are kept.

Then check:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/onboard/scripts/verify-skills.mjs --project .
```

## Output

A table: slug, skill, model (scope's `model`). Nothing else.
