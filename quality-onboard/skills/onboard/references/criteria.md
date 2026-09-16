# Criteria for retaining a rule

Single source, read by the generator (step 2) and by the substantive reviewer (step 5). If
a criterion changes here, both steps change together.

The two don't use it the same way: the generator uses it to **write**, the
reviewer to **decide** — including on rules that measurement sends back as
`a-revoir`. See "Handling an `a-revoir`" at the end of this document.

A rule only passes if it clears **all** the criteria. The first failure
determines its `reason`.

## The criteria

| # | Question | Failure → `reason` |
|---|---|---|
| 1 | Does the existing tooling already cover it (the configs listed in `tooling`: static analyzer, formatter)? | `outillage` |
| 2 | Could a tool that **rewrites** code (formatter/fixer: cs-fixer, rector, prettier…) carry it? | `fixer` |
| 3 | Would a senior dev on the stack, arriving on the project, write it spontaneously — in particular: is it the output of the framework's code generator? | `maker` |
| 4 | Is it observed in at least 2 **distinct** files of the sample? | `occurrence-unique` |
| 5 | Is it structuring? | `une-seule-facon` |
| 6 | Is it based on an observed practice, rather than an absence (0 occurrences)? | `absence` |
| 7 | Do the `evidence` files actually carry the described practice? | `incoherent` |
| 8 | Is it specific to the analyzed type, rather than a general project convention? | `hors-perimetre` |
| 9 | Can you write a **probe** correlated to the rule — a single-line regex that, without being exact, varies with it? | *not a rejection*: referred to `a-revoir` |

## Details

**Criterion 2 — rejecting is not rewriting.** A tool that *rejects* (blocking analyzer:
phpstan, deptrac, eslint, mypy…) flags and stops: the convention must stay written down,
otherwise the generator stops applying it and the tool blocks the build behind it. Such
a rule is **retained**, with `automatable` (`nature: "rejette"`). A tool that
*rewrites* (formatter/fixer: cs-fixer, rector, prettier…) restores the convention on its
own: the rule is discarded as `fixer`, also with `automatable`
(`nature: "reecrit"`) — it goes to the tooling backlog, not into the constraints.

**Criterion 4 — distinct occurrences.** It applies to the sample, like criterion 7:
two occurrences in `sample` are enough to write the rule, and it's the measurement's
`--min-population` floor that then judges whether the whole population bears out the ratio.
A single occurrence is a precedent, not a convention. Two nearly identical files (a copy of the same
template) count as one occurrence: compare the files before concluding, not after. Do not group
dissimilar cases to reach the threshold: the counted occurrences must share the
same mechanism.

**Criterion 5 — the structuring test.** Would two senior devs coding the same thing without
this rule produce two different, both acceptable, results?
If yes → structuring. If there's only one reasonable way to do it → discard.

**Criterion 7 — consistency of evidence.** Also check the reverse: a **read** file that
contradicts the rule and is missing from `counterExamples` is an inconsistency.

The generator only reads `scope.sample` — so for it, criterion 7 only applies to
the sample. It isn't asked to survey the whole population: measurement (step 4)
runs the probe against the entire population (`scope.glob - scope.exclude`) and **overwrites** `counterExamples` with what it
finds there. A counter-example it hasn't seen isn't its fault, it's the
script's job.

What remains its fault: a counter-example present in its sample and absent from its
`counterExamples`.

The reviewer (step 5), meanwhile, reads wherever they want in the population. It's to them that
criterion 7 applies across the whole population.

Declared counter-examples don't invalidate the rule — they nuance it, except in the
`present` case below.

**Criterion 9 — the probe is owed, its absence doesn't condemn.** Always write the most
honest probe you can: without it, measurement has nothing to run and the rule arrives
unmeasured in front of the reviewer, who will have to survey the scope by hand.

But "inexpressible as a regex" doesn't mean "unverifiable". In dev review, a
semantic rule is read by an **LLM agent** with its `trigger` and `anchor` — no
regex engine is involved. A true and useful rule that no probe can approximate therefore goes to
`a-revoir`, not to the trash: it's step 5 that decides whether it's worth the
manual survey, or whether it's better served by an `automatable` entry in the tooling backlog.

This is the only criterion in this table whose failure doesn't produce a `reason`.

## Writing the probe

Measurement runs the probe against the whole population and proposes `grep` or `semantic`.
The substantive review keeps the final word on static promotions:

| Ratio | Verdict | What the rule becomes |
|---|---|---|
| `== 1` | `STATIC` | candidate for static execution; review confirms the probe is enough to decide the statement |
| `< 1` but above the threshold | `SEMANTIC` | dispatched to an LLM agent, ratio displayed |
| below the threshold | `REFORMULATE` | sent back to `a-revoir` — step 5 decides |

What this means for you: the probe doesn't have to be perfect, it has to be **honest**.
A probe tailored to match exactly the files in your `evidence` produces a false
`STATIC` and lets a wrong rule into an execution engine. A broad,
correlated probe can also produce a ratio of 1. The ratio then proves that the probe matches
the whole population, not that it expresses the whole rule.

For each static candidate, the reviewer asks a question:

> Could a file match the probe while still violating the statement?

If yes, the rule stays retained but its `check` becomes `semantic`. The probe and its measurement
remain valid as a signal; no re-measurement is needed.

**If the rule is conditional, write a `probe.gate`.** A rule that only targets
part of its scope — the owning side of an association, edit handlers,
repositories that write — is counted as wrong on every file it doesn't target.
The `gate` is the regex that selects the relevant files; the ratio is computed
against them alone. Simple rule: if your `trigger` describes a condition that part of the
scope doesn't meet, you need a `gate`. Format and safeguards in
`candidate-schema.md`.

A semantic MUST rule costs **one LLM agent call per run**: it's the only variable
expense of verification. An exact probe, when one truly exists, is therefore worth
more — but never at the price of a rigged ratio.

## What you don't have to check — generator (step 2)

Measurement makes these checks pointless at write time. Don't redo them by hand:

- "do all files in the scope follow the rule?" — that's the ratio
- "have I seen all the counter-examples?" — you've only read a sample, and measurement
  overwrites `counterExamples` with those from the whole population
- "does the probe match the whole population?" — that's the ratio

The reviewer, on the other hand, checks whether a 100% probe is really enough to decide
the statement. An empty `counterExamples` list only proves the probe's result.

`strength`, however, remains your choice, and measurement doesn't correct it: a practice
followed everywhere today remains a `SHOULD` if that's how you intended it. A `SHOULD`
rule stays semantic regardless of its ratio — the matcher counts violations, not
suggestions.

The reviewer, on the other hand, **must** recheck all of this on rules in `a-revoir`: on those,
precisely, the ratio hasn't concluded anything.

## Handling an `a-revoir` — reviewer (step 5)

Measurement only sends a rule back to `a-revoir` on three verdicts, and each raises a
different question. None of them means "wrong".

| Verdict | The question to ask yourself |
|---|---|
| `REFORMULATE` | is the ratio a **fact** or a **scoping artifact**? |
| `INSUFFICIENT` | are the occurrences numerous and **distinct** enough (criterion 4)? |
| `UNMEASURED` | is the rule verifiable **by reading**, without a regex? |

### `REFORMULATE` — first check the scoping

A low ratio has two causes, and they don't look alike:

- **artifact**: the rule is conditional, the probe counted the whole population. The
  files flagged non-compliant aren't violations, they're **off-topic**.
  Signature: the counter-examples have nothing to do with the rule's `trigger`.
  → write the missing `probe.gate`, the rule goes back to step 4.
- **fact**: the counter-examples do fall within the `trigger` and don't follow the
  rule. Two practices genuinely coexist.
  → discard as `incoherent`, or restrict the rule to the area where it holds true.

The deciding test: **open two or three counter-examples**. If they don't meet
the `trigger`'s condition, it's an artifact. Without this reading, you can't know.

These counter-examples come from the whole population, not from the generator's sample:
they are precisely the files it hasn't seen. That's why they need to be opened.

### `INSUFFICIENT` — criterion 4, nothing else

The triggered population is too small for a ratio to prove anything. It's
criterion 4 that decides, with its refinement: two nearly identical files count
as a single occurrence. A single precedent is discarded as `occurrence-unique`; three
genuinely distinct occurrences make a convention.

### `UNMEASURED` — verifiable by reading?

No probe doesn't mean no rule: in dev review, it's an agent that reads.
Keep the rule if its `trigger` and `anchor` are enough for a reviewer to decide
without hesitation. Discard it as `sans-sonde`, with its `automatable`, if deciding
requires judgment every time — then it's a tool-candidate.

### In all three cases

- **Keeping costs a ratio.** A rule kept without re-measurement carries `check: "semantic"` and
  a `measure` you establish by surveying the scope file by file
  (`by: "review"`). No ratio, no rule: Gate 2 refuses otherwise.
- **Keeping costs an agent call on every run.** It's the only variable expense of
  verification. A rule you can't justify at survey time isn't worth that price.
- **Nothing stays `a-revoir`.** Every rule comes out as `retenu` or `ecarte`.

## Constraints on the rule set as a whole

These checks apply to the whole `rules` array, not to a single rule:

- **no duplicates**: two retained rules that say the same thing from two angles
  count as one
- **no corollaries**: a rule is a verifiable fact, not a fact declined into
  negative variants or edge cases. If a rule already delimits its scope,
  cases outside that scope don't get separate rules — the exclusions
  belong inside the rule itself
- **nothing gets deleted**: a discarded rule stays in `rules` with
  `status: "ecarte"`, its `reason` and its `note`. It documents the rejection for
  later runs, and keeps a later run from proposing it again

## What isn't a criterion

A rule's **strength** (`strength`) isn't re-judged under the criteria
above. A practice observed with no counter-example anywhere in the scope remains
a MUST, even if it seems harsh.
