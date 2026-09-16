# Structure of the tooling backlog

A single file for the whole project: `.claude/quality/code/lint-backlog.md`.

One file, not one per type: an analyzer or formatter is configured once, not once per
file type. A backlog split across six files can't be read.

Audience: the dev who configures the tooling. It's not a review deliverable —
the reviewer reads `constraints/{slug}.md` instead, and doesn't need to know which linter
would carry the rule.

This file plays the role that `quality-constraints`'s `SPEC.md` calls the "tooling
backlog". On an onboarded project, this is the one that exists; `tool-candidates.md` is
its equivalent on a project managed by hand, without a candidates JSON (SPEC §4). Only one of
the two exists — and quality-constraints consumers (retrospective,
constraint-update) never write here directly: they go through the candidates'
`automatable` field, which this file projects.

## Source

No analysis of its own: the file is a cross-type projection of the candidates JSON.
It's deterministic — a script, not an agent.

A rule appears here as soon as it carries an `automatable` field, whatever its `status`:

| In the JSON | Nature | Status | In `constraints/{slug}.md` |
|---|---|---|---|
| `retenu` + `automatable` | `rejette` | `to do` | present, enforced |
| `retenu` + `via` | `rejette` | `done` | present, marked `via=`, not enforced |
| `ecarte` + `reason: fixer` + `automatable` | `reecrit` | `to do` | absent |
| `ecarte` + `reason: sans-sonde` + `automatable` | depends on `automatable.nature` | `to do` | absent |

A tool that **rejects** (blocking analyzer: phpstan, deptrac, eslint, mypy…) leaves
the rule in the constraints even once written: deleting the rule would teach the
generator to stop applying the convention, and the tool would block the build behind
it. A tool that **rewrites** (formatter/fixer: cs-fixer, rector, prettier…) restores
the convention on its own: the rule never enters the constraints.

`reason: sans-sonde` is the other tool-candidate: the substantive review judged the rule
true but unverifiable by reading — a tool would carry it better than an agent.

No `ecarte` rule for any other `reason` enters here. In particular
`reason: outillage`: that one is already covered, there's nothing to implement.

## Template

```markdown
# Tooling backlog

Rules observed in the code and implementable in tooling.

A rule carried by a tool that **rejects** stays in `constraints/{slug}.md` once
implemented: it moves to `via=` there, and its line here moves to `done`. A rule
carried by a tool that **rewrites** is never entered into the constraints.

| Type | Rule | Tool | Nature | Status |
|---|---|---|---|---|
| {slug} | {rule} | {automatable.tool} | rejects | to do |
```

## Rendering rules

- `Type` is the `scope.slug` from the source JSON (`entity`, `handler`…), to find the
  rule again in its constraints file.
- `Rule` repeats `rule` word for word, without the `strength`: the backlog doesn't talk
  about strength, it talks about feasibility.
- `Tool` is `automatable.tool`. A non-empty `automatable.note` is rendered in
  parentheses after it — that's where the targeted sniff or fixer is specified.
- `Nature` is `automatable.nature` (`reecrit` renders as `rewrites`). A line coming from a
  `via` without `automatable` is `rejects` by construction: only that nature leaves the
  rule alive in the JSON. Never entered by hand in the backlog.
- `Status` is `done` as soon as the rule carries a `via` in the JSON, `to do` otherwise.
  On a `rewrites` line, nothing in the JSON can carry the `done`: it's set by
  hand, and a regeneration never overwrites it — like any line already marked `done`.
- Lines are grouped by tool, then by type — one tool is configured at a time.
- File absent if no rule carries `automatable`.

## Lifecycle of a line

1. the generator observes the rule and judges it tool-able → `to do` line
2. the dev writes the rule into the tool → sets `via` in the JSON → `done` line, and the
   rule stops being enforced by the matcher while staying readable by the generator
3. on the next onboard run, the rule is now covered: criterion 1 flips it to
   `ecarte / outillage`, and its line disappears from the backlog

Step 3 is the only moment a line leaves the file. A `done` line that persists
run after run signals that criterion 1 doesn't see the tool's rule — meaning
`via` points to something that isn't registered.

## Not to do

- do not duplicate the `trigger`, the `anchor` or the `evidence` here: the backlog is a
  list of tickets, not a rule spec — the spec lives in the JSON
- do not remove a rule from `constraints/{slug}.md` on the pretext that it's listed
  here: as long as the tool doesn't carry it, review remains the only safety net
- do not let a rule without `automatable` enter here on the grounds that it "could"
  be automated: it's the generator that sets the field, not the projection
