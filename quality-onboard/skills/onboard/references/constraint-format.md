# Structure of a constraints file

One markdown file per file type, in
`.claude/quality/code/constraints/{slug}.md`.

It's the deliverable, and it has **two readers**:

- the `create-*` skills, which inject it as-is into the prompt when writing a
  file — an LLM reader, which reads everything;
- the `quality-constraints` matcher, which enforces it during review — a parser, which
  only sees what its grammar describes.

Hence the rule that governs this whole document: **the grammar is not negotiable**.
It is standardized by the `quality-constraints` plugin's `SPEC.md`, and a deviation doesn't
produce an error — it produces a silently inert rule, still readable
by a human, never enforced again. `constraint-lint` is the executable of this
grammar; it runs at the gate (step 9), via `verify-onboard.mjs`.

The file is **generated from the candidates JSON** (see `candidate-schema.md`), never
hand-written — otherwise the two would diverge.

## Template

````markdown
---
paths:
  - "{scope.glob}"
---

# Constraints — {File type}

Scope: `{scope.glob}` carrying `{scope.marker}`.

Tooling checked: {tooling}. No rule below is covered by this tooling.

## Static Rules

```rules
{id} | {probe.sense} | {probe.regex} | {STRENGTH} {rule}
{id} | {probe.sense} | {probe.regex} | {STRENGTH} {rule} | gate={probe.gate.regex}
{id} | {probe.sense} | {probe.regex} | {STRENGTH} {rule} | via={via}
```

## Semantic Rules

- {STRENGTH}: {rule}. Trigger: {trigger}. Anchor: {anchor}. ({matched}/{total})
- {STRENGTH} [via={tool}]: {rule}. Trigger: {trigger}. Anchor: {anchor}. ({matched}/{total})
````

## What the grammar requires

These points are not a matter of taste. Breaking them makes the rule invisible to the parser.

- **the file starts with `---`**, no line before it. The frontmatter carries `paths:`,
  the only key read along with `exclude:`. Empty or absent `paths:` ⇒ the constraint matches nothing,
  silently.
- **the `## Static Rules` heading is decorative**: only the ```` ```rules ```` fence
  opens the block. Multiple blocks in a file are cumulative.
- **the `## Semantic Rules` heading is significant**: the parser opens the section on
  `^##[ \t]+Semantic`. `## Semantic Rules` ✅, `## Semantic` ✅, but
  `### Semantic Rules` ❌ and **`## Règles sémantiques` ❌**. Outside this section, a
  rule doesn't exist.
- **fields are separated by the literal sequence ` | `** — space, pipe, space.
  Not by `|` alone. Hence the ban on ` | ` inside a `pattern`.
- **a bullet is a rule only if it matches `^[ \t]*-[ \t]+(MUST|SHOULD)`.**
  `- Must:`, `- must`, `* MUST:` are ignored, missing a word.
- **the semantic section closes at the next `## `.** A `### ` stays inside it.

## Rendering rules

- one section per `check` value: `grep` → `rules` block, `semantic` → bullets.
  An empty section is omitted, fence included. `check` comes from measurement, with a
  possible demotion by review; rendering doesn't reclassify anything.
- on a static rule, `probe.sense` supplies the 2nd field and `probe.regex` the 3rd,
  as-is. A rule is rendered as static only if review kept `check: grep`:
  the verdict establishes that the probe covers its population, review that it's enough
  to decide the statement. Touching it up at render time would make it wrong.
- `probe.gate`, if it exists, is rendered as a `gate={regex}` suffix — `gate!={regex}` when
  its `sense` is `absent`. It carries over for the same reason as the probe: the `STATIC`
  verdict was established on the population it carves out. Leaving it behind wouldn't make
  the rule stricter, it would make it wrong: every file outside the trigger would then come
  out as a violation, and the fixer would go correct code that's already correct.
- `strength` opens the message, in uppercase. In the `rules` block it's the 4th field
  (`MUST NOT use ->getDoctrine()`); in the bullets it's the prefix (`- MUST: …`).
- `trigger` and `anchor` are rendered only on semantic rules: the matcher
  dispatches these rules to an agent, they are its working instructions.
- `measure` is rendered at the end of the bullet, `({matched}/{total})`, on semantic rules only. A semantic rule isn't
  measured by anything at execution time — the ratio is the only trace that someone checked it
  against the population before writing it. A static rule doesn't carry one: the matcher
  recounts on every run. The ratio is **excluded from the measurement identity** (`SPEC.md` §5):
  refreshing it on re-measure doesn't reset the rule's measurement history — only a
  rewording of the text does.
- `via` is rendered as the 5th field (`| via=phpstan:proj.x`) on a static rule, in brackets
  before the `:` (`- MUST [via=phpstan]: …`) on a semantic one. In both cases the
  rule is **kept and not enforced**: deleting it would teach the generator to stop
  applying the convention, and the tool would block the build behind it.
- `rationale: "coherence"` adds ` — coherence, non-blocking` before the ratio. A
  `grep " — coherence"` over the directory gives the accepted debt.
- `rationale: "invariant"` does not render the `why`: the rule justifies itself.
- `evidence` is not rendered: neither count nor names. The delivered file is a list of
  rules to apply, not a measurement report.
- `counterExamples` is not rendered either. On a static `present` rule it's empty by
  construction; on a semantic one, the ratio already says how many files deviate, and
  the text of a semantic rule **is its identity** (`SPEC.md` §5) — writing file names into
  it would reset its measurement history to zero on the first rename.
  The names stay in the JSON.
- rules with `status: "ecarte"` are not rendered at all, whatever their `reason`.
  They stay in the candidates JSON, which documents the rejection for later runs.
- a rule with `status: "a-revoir"` is not rendered either — but this isn't a
  rendering decision: at step 7 none should remain. Encountering one
  signals that the substantive review (step 5) didn't resolve them all, and rendering
  isn't the place to decide in its stead.

## Not to do

- do not translate the section headings: they are grammar, not prose.
  The **rule text** stays in French, the parser only reads the strength prefix.
- do not write a rule absent from the JSON
- do not modify a strength, a reason, or a wording at render time
- do not merge two rules from the JSON into one line
- do not reword an existing semantic rule to "clarify" it: its text is
  its identity, rewording it makes it lose its history
- do not render discarded rules: no "Discarded" section in the deliverable
