# Constraint File Format — SPEC v1

**Status: normative.** This file is the single source of truth for the constraint file
format. Every producer, parser, editor or verifier of constraints conforms to it and
references it instead of re-describing the format in prose.

Motivation: the format used to be specified in four independent places (generator,
parser, editor, store). They diverged — a rule written under `## Rules` by
`constraint-update` was never read by the parser, which only extracts under
`## Semantic`. The rule was **silently inert**: present in the file, re-read by humans,
never executed. That is the class of defect this SPEC and `bin/constraint-lint` exist
to eliminate.

## 0. Who reads what

The format belongs to the **`quality-constraints`** plugin — language-agnostic. Bare
paths in this table are relative to its root; `plugin:skill`-qualified entries are
external consumers.

| Role | Implementation | Authority |
|---|---|---|
| Grammar | this file | **normative** |
| Executable grammar | `lib/parse-constraints.js` | conforming |
| Execution / grouping / identity | `skills/quality-constraints-verify/scripts/match-constraints.js` | conforming |
| Measurement blocks and their projection | `bin/rule-stats`, `bin/lib/rule-stats.js` | conforming (§5 is normative) |
| Format conformance | `bin/constraint-lint` | **executable form of this SPEC** |
| Pre-write measurement | `bin/measure-candidates` | conforming (same glob grammar, same regex grammar, **same line-by-line evaluation** — a probe measured here behaves identically once written as a rule) |
| Initial generation | `quality-onboard:onboard` (track A) | conforming |
| Editing | `quality-constraints:constraint-update` | conforming |
| Injection into generation | the project's scaffolding skills — `quality-*/SKILL.md`, rendered by `quality-onboard:skills` | consumer |

A grammar change modifies **this file first**, then the conforming implementations. A
conforming implementation that accepts more than the SPEC produces inert rules; one that
accepts less breaks valid files.

## 1. Location and grouping

- Single root: `.claude/quality/code/constraints/` (hardcoded in the matcher).
- All `*.md` files, **at any depth** (`find -type f -name '*.md'`).
- **The extensionless `basename` is the constraint KEY**, not the path. Two files with
  the same basename in different folders (`conventions/handler.md` +
  `decisions/handler.md`) are **merged under one key**: `paths`, static rules and
  semantic rules concatenated.
- Direct consequence: **a static ID must be unique per KEY, not per file.** Two rules
  with the same ID in the group → only one survives identity deduplication, the other
  is never measured.
- Convention (not enforced by the parser): `conventions/` = what the code does,
  `decisions/` = why. Onboarding does not use them: it writes flat `{slug}.md` files at
  the root, regenerated from its candidates JSON. The subfolders are a convention for
  hand-maintained constraint sets; the matcher reads both layouts identically.

## 2. Frontmatter — mandatory

```
---
paths:
  - "src/**/Controller/**/*.php"
  - src/**/*ApiClient.php
---
```

- The file **must** start with `---`. The second `---` closes the frontmatter.
- `paths:` and `exclude:` are the only keys read. Each is a list of `- <glob>` items,
  quotes optional. The first line that is neither a list item nor one of these two keys
  ends the list.
- Empty or missing `paths:` ⇒ the constraint never matches anything: it is **excluded
  from the output**, silently. Lint error.

### `exclude:` — optional subtraction

```
---
paths:
  - "src/**/Application/Message/Command/**/*.php"
exclude:
  - "src/**/Application/Message/Command/**/*Handler.php"
---
```

The population is `paths:` **minus** `exclude:`, both unioned across the files merged
under one constraint key. Same glob grammar — `exclude:` is a subtraction *by path*, not
a negation *inside a pattern*, so the globs themselves stay readable.

A file removed by `exclude:` is removed for **every rule of the constraint**, never for
one rule. When only some rules need the narrower population, that is two constraint
files, not one `exclude:`.

Reach for it only when the two populations **cannot** be separated by narrowing: they
share a directory and differ by a suffix (a CQRS command message and its handler, an
entity and an embeddable in the same `Domain/Model`). Narrowing remains the first
answer — an `exclude:` widens the frontmatter a reader must hold in their head.

Empty `exclude:` (key present, no glob) reads as an exclusion in place while removing
nothing: lint error.

### Supported glob syntax — exhaustive

| Pattern | Meaning | Translation |
|---|---|---|
| `*` | does not cross `/` | `[^/]*` |
| `**` | crosses `/` | `.*` |
| `**/` | **zero** or more levels | `(?:.*/)?` |
| `?` | one character, not `/` | `[^/]` |
| `{a,b}` | alternation | `(?:a|b)` |
| `.` | literal | `\.` |

The glob is anchored on the path **relative to the repository root**, both ends
(`^…$`). `**/Model/**/*.php` therefore also matches `Model/Slot.php`.

**Forbidden**: `[abc]`, `!`. Untranslated, they are escaped and thus matched
**literally** — the glob then matches nothing, which is indistinguishable from a dead
glob. No negation inside a pattern: to exclude, **narrow** the glob — or, when the two
populations share a directory and no narrowing separates them, subtract with `exclude:`.

### Scope

The extension list is **not fixed**. The matcher derives it from the `paths:` globs of the
constraints it loads (`codeExtensionFilter`, applied in all three modes: diff, directory,
`--sweep`). A glob `src/**/*Service.ts` is by itself the declaration that `.ts` is in scope. No
language is privileged, and porting the engine to another stack requires **no code change** —
writing the constraints is enough.

- The extension of a glob is what follows the **first** dot of its last segment, so a compound
  extension stays whole: `templates/**/*.html.twig` declares `html.twig`, not `twig`.
- An alternation in the last segment is expanded first: `src/**/*.{ts,js}` declares `ts` **and**
  `js`. Taken literally it would declare nothing any file carries, and diff/directory runs would
  answer `no_files` while an explicitly passed file still gets checked.
- `exclude:` does not contribute. It subtracts from a population; it never widens the scope.
- A glob whose last segment carries **no** extension (`src/**/Legacy/**`), or whose extension is
  itself globbed (`*.php*`), cannot be bounded. The narrowing is then **disabled for the whole
  run** and every file of the diff — or of the traversed directory — is read. That is the
  intended behaviour, the alternative being to silence that glob; but it is a global effect
  decided by one local line.

This narrowing is only an upstream saving: the authoritative matching stays glob by glob (§2),
so a file no glob claims is discarded whether or not it passed the filter. It has exactly two
real effects — not reading files that cannot violate anything, and keeping the early `no_files`
exit meaningful. A diff touching only a `README.md` must answer "nothing to check", not "no rule
matched".

Corollary for `constraint-lint`: **no extension is out of scope**, so the lint carries no
extension whitelist and never rejects a glob over its extension.

### Liveness — outside the lint's scope

A syntactically valid glob may match no real file (glob narrowed by enumeration,
renamed folder). That is **not** a format defect and the lint does not detect it: that
is `match-constraints --sweep | rule-stats dead-globs`, which counts over the whole
repository. A "0 files" on one run proves nothing — the run simply touched no file of
that type.

## 3. Static rules

Fenced block, opened by the line **exactly** ```` ```rules ````:

````
## Static Rules

```rules
CTL-001 | present | #\[Route\(          | MUST have a #[Route] attribute
CTL-002 | absent  | ->getDoctrine\(     | MUST NOT use ->getDoctrine()
CTL-003 | absent  | (json_encode|var_dump)\( | MUST NOT dump or hand-encode
CTL-004 | present | RoutePrefix::        | MUST use RoutePrefix constants | via=phpstan:proj.routePrefix
```
````

Several `rules` blocks in one file are cumulative. The `## Static Rules` title is
**decorative**: only the fence matters.

### Field splitting

Fields are separated by the **literal sequence ` | `** (space, pipe, space) — not by
`|` alone. Each field is then trimmed.

```
ID | present|absent | regex | message [| gate[!]=<regex>] [| via=<tool>[:<identifier>]]
```

Fields past the message are **named suffixes**, recognised by their prefix, not by their
position: the order of `gate=` and `via=` is free. A 5th or 6th field carrying no known
prefix is an **error**, not an exotic suffix — it is almost always a regex that contains
` | ` and got split in two.

> **A regex must NEVER contain ` | `.** Alternation is written without spaces:
> `(foo|bar)`, never `(foo | bar)`. Otherwise the split shifts every field and the rule
> that runs is not the rule that was written.

Trimming also means a regex cannot rely on a leading or trailing space. `^  ` does not
survive; use `^[[:space:]]{2}` or `^\s\s`.

### Semantics

- **`present`**: *every* file in scope must have ≥ 1 matching line. This asserts an
  **invariant over the glob's whole population** — restricted by `gate=` when the rule
  carries one. A single legitimately exempt file makes the rule false → add a `gate=`
  if the exemption is a condition a regex can express, otherwise narrow the glob or
  demote to semantic.
- **`absent`**: *no* file may have a matching line.
- Engine: JavaScript `RegExp`, **line by line**. Single-line: no multiline lookaround,
  no `\n`, no cross-line context. The subset shared with `grep -P` is safe (classes,
  quantifiers, lookaround, and POSIX classes `[[:upper:]]` which are translated);
  atomic groups `(?>…)`, possessive quantifiers `a++` and `\A \z` are **not**. A regex
  that does not compile is recorded `kind: invalid` and **not evaluated** — it never
  counts as conforming. `constraint-lint` validates with this same JavaScript library
  (`lib/parse-constraints.js`).
- `hits` = number of **files** in violation (same unit for `present` and `absent`),
  not the number of matched lines. `files` = the **triggered** population — the glob
  minus what `gate=` filters out — so the violation rate stays comparable across runs
  and against the onboarding measurement.
- Each violation carries `{id, file, line, message}`, plus `{lines, lines_total}` when
  several lines offend (`lines` capped at 20, `lines_total` = the real count, so a
  truncation never reads as "a single occurrence").
- `line` is **`null`** on a `present` rule: the defect is the *absence* of the pattern,
  no line carries it. A consumer must not invent a number — it reports the file alone.

### `ID`

- Convention: `^[A-Z]{2,5}-[0-9]{3}$` (`ENT-001`, `HDL-002`, `TW-005`).
- **Unique per constraint key** (§1), messages included.
- The ID is the rule's durable identity (§5): renaming it resets its measurement
  history.

### `gate=` — the rule's trigger

`gate=<regex>` (or `gate!=<regex>` for the inverse sense) is a **second regex that
selects the files the rule applies to, without judging their conformance**. Files it
filters out are neither conforming nor violating: they leave the calculation.

```
ENT-004 | present | #\[ORM\\JoinTable\(name: ' | MUST name the join table | gate=#\[ORM\\ManyToMany\(inversedBy:
```

Many true rules do not target their whole scope. *"The owning side of a ManyToMany names
its join table"* says nothing about entities that have no ManyToMany. Run ungated over 9
entities, it reports `3` conforming and **6 violations that are all wrong** — and the
fixer then edits correct code.

- `gate=` — the file is in scope when the pattern **is present**;
- `gate!=` — the file is in scope when the pattern **is absent**;
- same grammar, same engine, same constraints as the main regex (single-line, trimmed,
  no ` | `). A gate that does not compile makes the whole rule `kind: invalid` — never
  silently unfiltered;
- `files` in the run block reports the triggered population, and `hits` counts violations
  within it.

> **A gate must never be cut to make a rule pass.** A gate narrowed until it retains
> only the files you already know conform manufactures a fake invariant, exactly like a
> hand-tailored probe. It exists so the population is right, not so the verdict is green.
> Same regex as the one measured during onboarding: the `static` verdict was established
> on the population the gate carves out, so running the rule on a wider population is
> not stricter — it is false.

### `via=` — rule delegated to another tool

5th field `via=<tool>` or `via=<tool>:<identifier>` (`via=phpstan:proj.noFlush`,
`via=deptrac`, `via=rector`). The rule is then:

- **not executed** by the checker (`kind: delegated`, `hits: 0`) — the tool already
  blocks it in your quality gate; re-checking duplicates the verdict and burns a fix
  round-trip;
- **kept in the file** — the file is injected verbatim into generation prompts:
  deleting the rule teaches the generator to stop applying the convention, and the
  tool then blocks the build behind it;
- **recorded in the run block**, which proves the marker points at a tool rule that is
  actually registered.

> **`via=` is for a tool that REJECTS, not one that REWRITES.** A blocking analyser
> (PHPStan, Deptrac, Psalm) reports and stops there: the convention must stay in the
> file, or the generator stops applying it and the tool blocks the build behind it.
> A tool that fixes the code itself (CS Fixer, Rector, any formatter) needs no rule at
> all — the fixer restores the convention on the next run. Such a rule is **dropped**
> from the constraints and recorded in the project's tooling backlog (see below);
> marking it `via=` would only inflate every generation prompt with something no human
> ever has to decide.
>
> Outside those two cases, **never delete a rule on the grounds that a tool covers it.**
> Deletion is otherwise reserved for rules that are **false** (they misdescribe the
> code) — those pollute generation too.

## 4. Semantic rules

```markdown
## Semantic Rules

### General
- MUST: Inject the domain repository interface — not the infrastructure implementation
- MUST NOT: Depend on infrastructure classes — only domain interfaces
- SHOULD: Return the entity (created or modified)
- MUST [via=phpstan]: Never call flush() outside a transaction boundary
```

- **The title is significant**: the JavaScript parser opens the section on
  `^##[ \t]+Semantic`. So `## Semantic Rules` ✅, `## Semantic` ✅ —
  but `### Semantic Rules` ❌, `## Règles sémantiques` ❌, `## Rules` ❌.
  Anything outside this section is **invisible** to the parser.
- The section ends at the next `## `; `### ` headings stay inside (free subsections,
  purely documentary).
- A bullet is a rule if and only if it matches
  `^[ \t]*-[ \t]+(MUST|SHOULD)`. `MUST NOT` and `SHOULD NOT` are covered by the
  prefix. Everything else (`- Must:`, `- must`, `- The handler should…`, `* MUST:`)
  is **ignored without a word**.
- ` — ` separates the *what* from the *why*. A readability convention, not parsed.
- `[via=` anywhere in the line ⇒ rule **skipped** (same logic as §3).
- **Severity and cost**: a constraint where *no* semantic rule starts with `MUST`
  becomes **`advisory`**: listed as a warning, never dispatched to an agent, hence
  **never measured**. A MUST semantic rule costs one LLM agent on *every* run — it is
  the only variable cost of verification.
- What grep cannot express (inheritance, cross-file resolution, typed conditions) is
  **not** to be demoted to semantic by default: record it in the project's tooling
  backlog as the spec of a future tool rule.

### The tooling backlog — one file, two possible names

Rules that belong in a tool rather than in a constraint are recorded in **one** file:

- **Onboarded project** (`.claude/quality/onboard/candidates/*.json` exists):
  `.claude/quality/code/lint-backlog.md` — a deterministic projection of the candidates'
  `automatable` field, regenerated by `quality-onboard:render`. **Never append to it by
  hand**: like the constraint files, hand edits are erased at the next regeneration. To
  add an entry, set `automatable: { tool, note? }` (or `status: "ecarte"` +
  `reason: "fixer"` + `automatable` for rewriting tools) on the rule in its candidates
  JSON, then regenerate.
- **Hand-maintained project** (no candidates JSON): `.claude/quality/code/tool-candidates.md`,
  appended directly.

Exactly one of the two should exist; which one tells every consumer how to write to it.

## 5. Rule identity and measurement blocks

Every rule has a stable identity, and every verification run records one verdict per
identity in the report it writes. Two namespaces, never colliding:

| Type | Identity | Stability |
|---|---|---|
| static | `{key}#{ID}` | stable — rewording the message changes nothing |
| semantic | `{key}~{sha1(text)[0:8]}` | **the text IS the identity** — minus the trailing measurement ratio |

The hashed text excludes a trailing `(m/t)` ratio (`semanticIdentityText` in
`lib/parse-constraints.js`). That suffix is a measurement trace, not the rule: the
onboarding renderer refreshes it at every re-measure, and hashing it would mint a new
identity every time the population moves — resetting the whole semantic history on each
re-onboard. Re-measuring is not rewording.

**Consequence to know before editing**: rewording a semantic rule — even to fix a
typo — mints a new identity. The old one stops, the new one restarts from zero runs.
This is intentional: a reworded rule has no past, it must earn one back before anything
is concluded from it. But a cosmetic `--fix` across ten files erases ten histories.

Corollary: never duplicate a semantic rule text between `conventions/x.md` and
`decisions/x.md` — same key + same text = same identity, the second is a ghost
duplicate.

### Measurement blocks — normative

There is **no store**. The statistics are a projection of two fenced blocks, computed on
demand by `rule-stats report --reports=<glob>` over whatever files the caller names. The
reports are committed with their ticket and are the archive; where they live is the
project's business and the kit hardcodes nothing (no default path, no config file).

**Run block** — written by `quality-constraints-verify` at the end of every report,
passing or failing. The fence info string is **exactly** `json:constraints-run`.

````markdown
```json:constraints-run
{"run_ts":"20260909-095722","ticket":"FOOD-407","branch":"fix/x",
 "rules":[
  {"rule":"controller~a1b2c3d4","kind":"semantic","files":1,"verdict":"pass","hits":0,"text":"…"},
  {"rule":"controller~c3d4e5f6","kind":"semantic","files":1,"verdict":"fail","hits":1,"text":"…"},
  {"rule":"controller~e5f60000","kind":"semantic","files":1,"verdict":"n/a","text":"…"},
  {"rule":"functional-test~8a9b0000","kind":"semantic","files":1,"verdict":"false-positive","hits":1,"reason":"partial Twig partagé"},
  {"rule":"controller#CTL-004","kind":"static","files":1,"verdict":"pass","hits":0,"text":"…"}
 ]}
```
````

| Field | Required | Meaning |
|---|---|---|
| `run_ts` | yes | the matcher's `run_ts`; deduplication key with `rule` — a run copied into two files counts once; a block without it is refused |
| `ticket`, `branch` | no | labels, carried into the fp rows |
| `rules[].rule` | yes | the identity above, copied from the matcher's `feedback[]` |
| `rules[].verdict` | yes | `pass` (0 hits) · `fail` (`hits` files in violation, ≥ 1) · `n/a` (not applicable to these files: no observation) · `false-positive` (fired, unfounded: counted as `hits` AND as an fp, `reason` recommended) |
| `rules[].files` | yes | files inspected for this rule — the denominator |
| `rules[].hits` | on fail / false-positive | files in violation; missing ⇒ counted as 1 and flagged by `lint` |
| `rules[].kind`, `text` | no | `kind` defaults from the sigil (`#` static, `~` semantic); `text` is display only |

A `verdict` that is `null` or unknown is a **lost measurement**: the rule is skipped and
`rule-stats lint` reports it. It is never read as a pass.

**Annotations block** — written by `quality-retrospective` in its dated deliverable, for
verdicts revised after the run (a violation the fixer or reviewer later dismissed). The
run's own block is never rewritten: that would rewrite history. Info string **exactly**
`json:constraints-annotations`.

````markdown
```json:constraints-annotations
{"ts":"20260813-095152","annotations":[
 {"rule":"integration-test~1d89ab97","ticket":"PACASEC-363","verdict":"false-positive",
  "reason":"rendu PDF signature RC sans dépendance session","n":1}
]}
```
````

Only `verdict: "false-positive"` is measured. An fp is deduplicated on
`(ticket, rule, reason)`, never on the ts: two distinct false positives on the same rule
and ticket need two distinct reasons; the same one re-emitted by a re-run counts once;
`n` declares several occurrences of the same reason.

Both blocks tolerate indentation and longer fences (```` ```` ````); a tagged fence quoted
inside another fenced block is documentation, not a block.

## 6. What the format does not say

| Question | Tool | Why not the lint |
|---|---|---|
| Does this glob still match anything? | `--sweep` + `rule-stats dead-globs` | needs the whole repository |
| Is this rule useful at all? | `rule-stats report --reports=<glob>` | needs N reports of history |
| Is this rule true of the code? | the matcher's JavaScript engine over the full population | that is the producer's job (onboard) |
| Does this regex compile in the engine? | `constraint-lint` (library shared with the matcher) | — that IS the lint |
| Is this rule well worded? | human review | not decidable |

The lint answers only: **will this rule be executed as written?**

## 7. Conformance

```bash
constraint-lint                 # .claude/quality/code/constraints
constraint-lint <dir|file>...   # e.g. a plugin's baseline
constraint-lint --strict        # warnings counted as errors
rule-stats lint --reports=<glob> # reports whose measurement block is missing, unreadable or unfilled
```

Exit codes: `0` conforming · `1` format errors · `2` **nothing could be checked**
(missing directory, matcher regex validator unavailable). The `2` is deliberately
distinct from `0`: "no errors" and "nothing verified" must never display the same.

Three diagnostic levels: **error** (the rule will not be executed as written), **warning**
(suspect construct — counted as an error under `--strict`), **info** (a construct this SPEC
documents as legitimate, worth pointing out but never counted, even under `--strict`).
Informational: a delegated rule (`via=` / `[via=`), a `gate=` on a delegated rule, an
`advisory` constraint (semantic rules with no MUST). These are all shapes the onboarding
renderer legitimately produces — a gate running `--strict` must not reject a conforming file.

Hook points:
- `quality-onboard:render` — Gate 2, run by `verify-onboard.mjs`;
- `quality-constraints:constraint-update` — Step 7, after editing, before handing back;
- kit tests — a plugin carrying a baseline lints it on its own side, never here: this
  plugin owns the format, not the content;
- `quality-constraints-verify` — off the critical path: a format defect is not a code
  violation and must not weigh on a run's verdict.
