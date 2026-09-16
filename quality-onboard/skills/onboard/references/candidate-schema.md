# Structure of a candidates file

One JSON file per analyzed file type, in
`.claude/quality/onboard/candidates/{slug}.json`.

This file is the working state: it carries both retained AND discarded rules, with
their evidence. It is not the deliverable — the deliverable is the markdown generated
from it (see `constraint-format.md`), which is **enforced** by the `quality-constraints`
matcher. The grammar of this markdown is standardized by this plugin's `SPEC.md`:
several fields below exist only to satisfy it.

## Schema

```json
{
  "scope": {
    "slug": "entity",
    "prefix": "ENT",
    "glob": "src/*/Domain/*.php",
    "marker": "#[ORM\\Entity]",
    "population": 52,
    "sample": [
      "src/Catalogue/Domain/TypeRendezVous.php",
      "src/Reservation/Domain/RendezVous.php"
    ]
  },
  "tooling": ["phpstan.dist.neon", ".php-cs-fixer.dist.php", "composer.json"],
  "rules": [
    {
      "id": "ENT-001",
      "status": "retenu",
      "strength": "MUST",
      "probe": {
        "regex": "#\\[ORM\\\\JoinTable\\(name:",
        "sense": "present",
        "gate": { "regex": "#\\[ORM\\\\ManyToMany\\(inversedBy:", "sense": "present" }
      },
      "check": "grep",
      "measure": { "matched": 4, "total": 4, "verdict": "STATIC", "population": 14 },
      "rule": "The owning side of a ManyToMany explicitly names the join table",
      "rationale": "invariant",
      "why": "the name Doctrine derives changes if a class is renamed",
      "evidence": [
        { "file": "src/Catalogue/Domain/TypeSeance.php", "note": "type_rendez_vous_type_seance" },
        { "file": "src/Planning/Domain/ModeleJournee.php", "note": "modele_journee_modele_horaire" }
      ],
      "counterExamples": [],
      "automatable": { "tool": "phpstan", "nature": "rejette", "note": "custom rule on the JoinTable attribute" }
    },
    {
      "id": "ENT-002",
      "status": "retenu",
      "strength": "MUST",
      "rule": "A collection exposed by a getter is returned read-only",
      "probe": { "regex": "function get[A-Za-z]+\\(\\): (array|ReadonlyCollection)", "sense": "present" },
      "trigger": "getter returning a Doctrine Collection",
      "anchor": "->toArray() or a readonly return type",
      "rationale": "invariant",
      "why": "otherwise a caller could mutate the association without going through the entity",
      "check": "semantic",
      "measure": { "matched": 13, "total": 14, "verdict": "SEMANTIC" },
      "evidence": [
        { "file": "src/Catalogue/Domain/TypeRendezVous.php" },
        { "file": "src/Planning/Domain/ModeleJournee.php" }
      ],
      "counterExamples": [
        { "file": "src/Reservation/Domain/RendezVous.php", "note": "returns the raw Collection" }
      ]
    },
    {
      "id": "ENT-003",
      "status": "retenu",
      "strength": "MUST NOT",
      "rule": "An entity does not access the Doctrine registry",
      "probe": { "regex": "->getDoctrine\\(", "sense": "absent" },
      "rationale": "invariant",
      "why": "the entity would then depend on the infrastructure that persists it",
      "via": "phpstan:proj.noRegistryInDomain",
      "check": "grep",
      "measure": { "matched": 14, "total": 14, "verdict": "STATIC" },
      "evidence": [
        { "file": "src/Catalogue/Domain/TypeRendezVous.php" },
        { "file": "src/Planning/Domain/ModeleJournee.php" }
      ],
      "counterExamples": []
    },
    {
      "id": "ENT-008",
      "status": "a-revoir",
      "strength": "MUST",
      "rule": "An entity that timestamps its changes declares HasLifecycleCallbacks",
      "probe": { "regex": "#\\[ORM\\\\HasLifecycleCallbacks\\]", "sense": "present" },
      "trigger": "presence of a #[ORM\\PreUpdate] method or an updatedAt property",
      "anchor": "#[ORM\\HasLifecycleCallbacks] at the class level",
      "rationale": "invariant",
      "why": "without the attribute, the callback is never called and the date silently lies",
      "measure": { "matched": 2, "total": 14, "verdict": "REFORMULATE" },
      "evidence": [
        { "file": "src/Patient/Domain/Patient.php" },
        { "file": "src/Reservation/Domain/RendezVous.php" }
      ],
      "counterExamples": [
        { "file": "src/Planning/Domain/Jour.php", "note": "discrepancy found by the probe" }
      ]
    },
    {
      "id": "ENT-009",
      "status": "ecarte",
      "reason": "maker",
      "rule": "The reciprocal call of a bidirectional ManyToMany is carried by the mappedBy side",
      "note": "exact output of make:entity — a senior dev writes it spontaneously",
      "evidence": [
        { "file": "src/Catalogue/Domain/TypeRendezVous.php" },
        { "file": "src/Planning/Domain/ModeleHoraire.php" }
      ]
    }
  ]
}
```

## `scope`

| Field | Required | Values |
|---|---|---|
| `slug` | yes | short name of the type (`entity`, `handler`…). It is the basename of the produced constraints file, hence the **key** in the `SPEC.md` §1 sense |
| `prefix` | yes | prefix of the rule IDs, `^[A-Z]{2,5}$` (`ENT`, `HDL`, `CTL`) |
| `glob` | yes | file pattern, rendered as-is in the frontmatter's `paths:` — glob grammar imposed by `SPEC.md` §2 |
| `exclude` | no | glob or list of globs subtracted from `glob`, rendered in the frontmatter's `exclude:`. Use only when the glob can't be narrowed enough on its own |
| `marker` | yes | distinctive sign of the type. Used to establish the population, not rendered in the markdown |
| `population` | yes | the number of files in `glob - exclude` — the size of the **population**, counted by the orchestrator at step 1 |
| `sample` | yes | the files the generator reads: a subset of the population, capped at **15** |
| `minPopulation` | no | population floor for measuring this scope, integer ≥ 2 |
| `label` | no | human title of the scope (`Doctrine Entities`), rendered as the title of the constraints file; falls back to `slug` if absent |
| `model` | yes | path of a file in `sample` designated as the **shape model** — the target of the creation skills' model line. Set at step 1, revisable afterward on a `quality-retrospective` proposal. `verify-skills.mjs` refuses a scope without a model |

The population is never enumerated in the JSON: it is `glob - exclude` over the
repository, recomputed by the scripts whenever they need it (`sample ⊆ population`,
`model ∈ population`, cited files in the population). `population` is its size, counted
by the orchestrator from its own glob at step 1, and checked against the expansion before
measurement: a mismatch means the `glob`/`exclude` written down is not the one it looked
at. An enumerated list would give the same signal at a cost proportional to the scope
(6k tokens for 500 files), paid three times: written, re-emitted into the generator
prompt, copied into the candidates JSON. A `scopes.json` written before 4.2 still carries
that list as `files`; the scripts accept it and treat it as the population.

### population and `sample` serve different purposes

| | population | `sample` |
|---|---|---|
| who uses it | `measure-candidates`, via `glob` | the generator (step 2) |
| what it is | the set over which a ratio makes sense | what an agent can read without getting diluted |
| size | the whole scope | ≤ 15 |

A generator reading 52 files doesn't measure better: it **discovers** conventions,
and it's the probe run against the whole population that generalizes them. Its
`counterExamples` are in fact overwritten by measurement. Reading the whole population
would amount to manually tallying what a script tallies better, at the cost of the
attention that discovery needs.

Hence the rule: the generator **reads** `sample`, and cites only what it read.

## `tooling`

The list of tooling configuration files the generator read to apply
criterion 1 — static analyzer, formatter/fixer, dependency manifest, depending on the
project's stack (`phpstan.dist.neon`, `eslint.config.js`, `pyproject.toml`,
`composer.json`, `package.json`…). Written
by the generator, it is rendered at the top of the constraints file ("Tooling checked:
…"): it tells the reviewer that the rules below do not duplicate the tooling.
Cite only files **actually read** — a file absent from the project doesn't appear there.

## `scopes.json`

The scope contract, fixed once at step 1, re-read by every subsequent command.
Path: `.claude/quality/onboard/scopes.json`.

```json
{ "scopes": [ { "slug": "entity", "prefix": "ENT", "glob": "…", "marker": "…",
               "population": 52, "sample": ["…"], "model": "…", "minPopulation": 5 } ] }
```

Each entry is a `scope` object as described above. Two rules specific to this
file, checked by `validate-scopes.mjs`:

- `slug` unique — two identical `slug`s would overwrite the same candidates JSON
- `prefix` unique — `measure` indexes results by `id` alone, two `ENT-001` coming from
  two scopes would collide

An additional rule applies to the `model` field: it must belong to `sample`, hence to the population.
A model outside the scope would show a shape the scope's constraints don't govern;
a model outside `sample` would show a shape the generator hasn't read.

The generator receives its entry as-is and copies it into `scope`. This isn't
redundancy: the candidates JSON must stay readable on its own, without the file that
produced it.

## `rules`

### Common

| Field | Required | Values |
|---|---|---|
| `id` | yes | `{scope.prefix}-{NNN}`, unique in the file. **Durable identity**: renaming it resets the measurement history (`SPEC.md` §5) |
| `status` | yes | `retenu` \| `a-revoir` \| `ecarte`. `a-revoir` is a **transitional** state: measurement sets it, the substantive review (step 5) resolves it. None remains at the end — Gate 2 refuses otherwise |
| `rule` | yes | the rule in one sentence, without the MUST/SHOULD (carried by `strength`) |
| `evidence` | yes | list of objects `{ file, note? }` — **never a number** |

### If `status: "retenu"`

Two families of fields, and they must be distinguished: **the agent writes the first**,
measurement (step 4) sets the second. An agent that fills in `check` or `measure` prejudges
a result it hasn't computed.

Written by the agent:

| Field | Required | Values |
|---|---|---|
| `strength` | yes | `MUST` \| `MUST NOT` \| `SHOULD` \| `SHOULD NOT` |
| `probe` | except criterion 9 | `{ regex, sense, gate? }` — the probe that approximates the rule. `sense` is `present` (the regex MUST appear) \| `absent` (it MUST NOT). `gate` is a **second**, optional probe that restricts measurement to the files the rule targets. Absent when no regex approximates the rule: measurement then classifies it `UNMEASURED` and the substantive review decides. See "Constraints on `probe.regex`" and "The trigger probe" |
| `trigger` | yes | when the rule applies: which call, which type is handled |
| `anchor` | yes | which symbol must appear, and where |
| `rationale` | yes | `invariant` \| `coherence` |
| `why` | if `rationale: invariant` | which failure is avoided, which ambiguity is lifted |
| `counterExamples` | yes | list `{ file, note }` of the scope's files that don't follow the rule (empty if none) |
| `automatable` | no | `{ tool, nature, note? }` — a **rejecting** tool could carry the rule, but doesn't yet. `tool` is the name of the tool the project uses (`phpstan`, `deptrac`, `eslint`, `mypy`…); `nature` here is necessarily `rejette` |
| `via` | no | `<tool>[:<identifier>]` — a rejecting tool **already** carries the rule. It stays in the file but is no longer enforced by the matcher. Set by hand by the dev, never by the agent |

`automatable` and `via` are mutually exclusive: one means "to be written", the other "already written".

`trigger` and `anchor` are required on every rule, not just the ones that will end up
semantic: at the time the agent writes, the verdict doesn't exist yet. They are
rendered only for semantic rules.

Set by measurement:

| Field | Required | Values |
|---|---|---|
| `check` | yes | `grep` \| `semantic` — proposed by measurement, demotable by review |
| `measure` | yes | `{ matched, total, verdict, population?, by? }` — output of `measure-candidates`. `total` is the **triggered** population, not the glob's; `population` appears only when a `gate` distinguishes them. `by` is `probe` (default, the probe counted) \| `review` (the reviewer manually tallied, step 5) |
| `counterExamples` | yes | overwritten by measurement: the files the probe actually found in deviation, across the whole population |

### If `status: "a-revoir"`

State set by measurement (step 4) on `REFORMULATE`, `INSUFFICIENT` and
`UNMEASURED` verdicts. The rule **is not discarded**: the number alone doesn't say whether it's
wrong or whether measurement scoped it poorly. The substantive review (step 5) decides.

The rule keeps **all** its original fields — `strength`, `probe`, `trigger`, `anchor`,
`rationale`, `why`, `evidence`. Nothing is removed: without them, re-examining it would be
impossible, and re-running measurement with a different scoping even more so.

| Field | Required | Values |
|---|---|---|
| `measure` | yes | `{ matched, total, verdict }` — the verdict that triggered the referral |
| `counterExamples` | yes | overwritten by measurement, as for a retained rule |
| `check` | **never** | there is no nature as long as the rule isn't resolved |

Step 5 resolves it into one of these three states, never elsewhere:

| Outcome | What it means | Effect |
|---|---|---|
| **fix and re-measure** | the probe scoped the population poorly — usually a missing `probe.gate` | the rule goes back to step 4, its verdict is recomputed |
| **keep** | the rule is true, measurement just can't establish it | `status: "retenu"`, `check: "semantic"` **mandatorily** |
| **discard** | the rule is genuinely wrong, or the occurrence is unique | `status: "ecarte"` + `reason` + `note`, like any discard |

Two consequences not to be bypassed:

- **keeping without re-measuring forces `check: "semantic"`.** A rule below threshold
  cannot become a mechanically enforced pattern: only a re-measure can produce `STATIC`.
  Determinism keeps the arithmetic, review keeps the scoping.
- **a kept rule always carries a ratio.** On an `UNMEASURED` or an
  `INSUFFICIENT`, the probe couldn't count anything: it's up to the reviewer to tally
  the scope's files one by one and write
  `measure: { matched, total, verdict: "SEMANTIC", by: "review" }`.
  The tally is feasible at 6 or 30 files, not at 500 — beyond that, discard.

### If `status: "ecarte"`

| Field | Required | Values |
|---|---|---|
| `reason` | yes | `outillage` \| `fixer` \| `sans-sonde` \| `maker` \| `une-seule-facon` \| `occurrence-unique` \| `absence` \| `incoherent` \| `hors-perimetre` |
| `note` | yes | a sentence specifying the reason (which fixer, which unique file, which inconsistency) |
| `automatable` | if `reason` is `fixer` or `sans-sonde` | `{ tool, nature, note? }`. `nature` is `rejette` \| `reecrit`; for `fixer`, necessarily `reecrit` (`cs-fixer`, `rector`, `prettier`…) |

A discarded rule keeps its `evidence`: this is what lets a later run
recognize the same rule and not propose it again.

## How measurement classifies

`measure-candidates` runs `probe.regex` against the **triggered** population — the
glob's population, restricted by `probe.gate` if there is one — and never against just the
files cited in `evidence`. The resulting ratio classifies the rule:

| Verdict | Ratio | Consequence |
|---|---|---|
| `STATIC` | `== 1` | `retenu`, `check: grep` proposed. The reviewer confirms the probe is enough to decide the statement; otherwise they demote it to `semantic` |
| `SEMANTIC` | `threshold <= ratio < 1` | `retenu`, `check: semantic`. The probe approximates: the ratio is rendered into the rule, it's dispatched to an agent |
| `REFORMULATE` | `< threshold` | `a-revoir` — the ratio says something is wrong, not what |
| `INSUFFICIENT` | triggered population too small | `a-revoir` — the sample proves nothing, but absence of proof is not proof of absence |
| `UNMEASURED` | no usable probe | `a-revoir` — inexpressible as a regex doesn't mean unverifiable: in review, a semantic rule is read by an LLM, not by an engine |

**A verdict discards nothing.** The last three refer back to the substantive review, which alone
can distinguish a wrong rule from a poorly scoped one. The typical case: a
conditional rule with no `gate`, counted wrong on every file outside its trigger —
`3/9` where the code says `3/3`.

Two consequences that avoid wrong rules, without any agent having to think about it:

- a static candidate necessarily has empty `counterExamples` with respect to its probe. This does not
  yet prove that the probe covers the full meaning of the statement.
- a `SHOULD` or `SHOULD NOT` strength stays `semantic` **regardless of the verdict**. The
  matcher counts violations, not suggestions; and a practice followed everywhere
  today remains a recommendation if that's how it was intended. `strength` is
  an intent, `verdict` is a fact: they don't correct each other.

## The three states of a tool-able rule

A tool that **rejects** (blocking analyzer: phpstan, deptrac, eslint, mypy…) flags and
stops: the convention must stay written down, otherwise the generator stops
applying it and the tool blocks the build behind it. A tool that **rewrites** (formatter/fixer:
cs-fixer, rector, prettier…) restores the convention on its own: the rule has no
reason to exist. The `automatable.nature` field carries this distinction —
the tool is the project's own, never a list maintained by the plugin.

| Situation | In the JSON | In `constraints/{slug}.md` | In `lint-backlog.md` |
|---|---|---|---|
| Rejecting tool, not yet written | `retenu` + `automatable` | rule enforced normally | `to do` |
| Rejecting tool, already written | `retenu` + `via` | kept, marked `via=`, not enforced | `done` |
| Rewriting tool | `ecarte` + `reason: fixer` + `automatable` | absent | `to do` |
| Unverifiable by reading, tool-able | `ecarte` + `reason: sans-sonde` + `automatable` | absent | `to do` |
| Already covered by existing tooling | `ecarte` + `reason: outillage` | absent | absent |

## Constraints on `probe.regex`

The probe is run by JavaScript's `RegExp` engine, **line by line**, on
each file of the population. If the review keeps `check: grep` after a
`STATIC` verdict, it becomes as-is the pattern in the constraints file — validated by
`constraint-lint` with that same library. A pattern that doesn't compile is never
evaluated: it doesn't count as compliant.

A probe doesn't need to be production-executable, just **correlated** to
the rule. This is what makes a so-called "semantic" rule measurable anyway.

- **never the ` | ` sequence** (space, pipe, space): it's the field separator of the
  format. An alternation is written without spaces — `(foo|bar)`, never `(foo | bar)`
- **single-line**: no `\n`, no multi-line lookaround, no cross-line context whatsoever
- **no** atomic group `(?>…)`, possessive quantifier `a++`, `\A` or `\z` —
  accepted by `grep -P`, rejected by the engine
- the pattern is *trimmed*: it cannot rely on a leading or trailing space.
  `^  ` doesn't survive, write `^\s\s`
- POSIX classes (`[[:upper:]]`), simple quantifiers and lookaround are safe

## The trigger probe (`probe.gate`)

Many rules don't target their whole scope: "the **owning** side of a
ManyToMany names its join table" says nothing about entities without a ManyToMany. Measured
without care, it comes out at `3/9` — 3 compliant, and 6 unrelated files counted as
violations. The number is wrong, and it's enough to sink a true rule.

`probe.gate` fixes this. It's a second regex, with the same grammar as
`probe.regex`, that **selects** the relevant files without judging their compliance:

```json
"probe": {
  "regex": "#\\[ORM\\\\JoinTable\\(name:",
  "sense": "present",
  "gate": { "regex": "#\\[ORM\\\\ManyToMany\\(inversedBy:", "sense": "present" }
}
```

What this changes in measurement:

- a file outside the trigger is **neither compliant nor a counter-example**: it drops out of the calculation;
- the ratio is `conform / triggered`, and `measure.total` carries `triggered`;
- the `--min-population` floor also applies to the triggered population.

When to write it: as soon as the rule's `trigger` describes a condition that part of the
scope doesn't meet. If the `trigger` applies to the whole scope, no `gate`.

What it doesn't do: **the `gate` doesn't exist to make a rule pass.** A `gate`
tailored to keep only the `evidence` files manufactures a false `STATIC`,
exactly like a purpose-built probe. It exists to make the number true.

Where it goes next: the `gate` doesn't stop at measurement. Rendering copies it as a suffix
`gate=` into the constraint file, and the matcher runs it on every check to
select the same population. This is what keeps things consistent: the rule is
judged on the files that made it pass `STATIC`, not on a broader scope.
A dishonest `gate` therefore doesn't just produce a wrong number at step 4 — it installs
a rule that never looks at most of its own scope.

## Invariants guaranteed by the structure

These checks become mechanical — a script, not an agent:

- an announced count can't be wrong: it equals `len(evidence)`
- `scope.glob - scope.exclude` matches exactly `scope.population` files (or, on a pre-4.2
  JSON, exactly the enumerated `scope.files`)
- `scope.sample` is a non-empty subset of the population, without duplicates, ≤ 15
- a rule can't be both retained and discarded: `status` is unique
- an `a-revoir` rule carries a `measure` and **no** `check`: its nature isn't decided
- a `probe.gate`, if it exists, compiles and obeys the same constraints as `probe.regex`
- a retained rule necessarily has a valid strength: `strength` is an enum
- a retained rule necessarily has ≥ 2 distinct files in `evidence`
- an `id` matches `^{scope.prefix}-[0-9]{3}$` and is unique in the file
- a retained rule necessarily has a `trigger` and an `anchor`; its `probe` can be missing
  (criterion 9), but if it exists, it is complete
- a `probe.regex` compiles, and does not contain the ` | ` sequence
- `check: grep` implies a `probe`: a grep is an executed pattern, it needs one
- a `probe.sense` is `present` or `absent`
- a retained rule necessarily has a `check` and a `measure` — their absence doesn't signal
  an incomplete rule but a rule **never measured**, which Gate 2 refuses
- no `a-revoir` rule remains at the end of the run: a surviving transitional state
  is a silent gap, which Gate 2 also refuses
- `check: grep` implies `measure.verdict: STATIC` and `strength` being `MUST` or
  `MUST NOT`; any other combination is a contradiction, not an edge case
- a rule retained on a `REFORMULATE`, `INSUFFICIENT` or `UNMEASURED` verdict necessarily has
  `check: semantic`: only a re-measure can produce a `grep`
- `check: grep` implies empty `counterExamples`: that's what `ratio == 1` means
- an `automatable.nature` is consistent with its status: `rejette` if the rule is
  live, `reecrit` if it is discarded as `fixer`
- `automatable` and `via` do not coexist on the same rule
- a `retenu` rule with `rationale: invariant` necessarily has a `why`
- every file cited in `evidence` or `counterExamples` belongs to the population

The judgment criteria — what deserves to be a rule — are not here:
see `criteria.md`.
