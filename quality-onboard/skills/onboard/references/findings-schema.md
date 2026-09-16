# Findings schema

The JSON written by the `scope-reviewer` (step 5) and read by the `finding-applier` (step 6).

It exists for a precise reason: **to take judgment out of the orchestrator's context.**
Before, the reviewer would return its prose and the orchestrator would edit the candidates
itself — so it had to load every JSON, every finding, for every scope. Disk holds this
role better than a context, and it holds it from one command to the next.

Path: `.claude/quality/onboard/findings/{slug}.json`.

## Structure

```json
{
  "slug": "entity",
  "findings": [
    {
      "id": "ENT-004",
      "kind": "fix",
      "criterion": 7,
      "why": "AdresseEmbeddable does not carry #[ORM\\Entity] yet appears in evidence",
      "change": { "field": "evidence", "value": ["src/Catalogue/Domain/TypeRendezVous.php"] }
    }
  ]
}
```

## `findings[]`

| Field | Required | Values |
|---|---|---|
| `id` | yes | the `id` of the targeted rule, as it appears in the candidates JSON |
| `kind` | yes | `fix` \| `keep` \| `discard` \| `reprobe` |
| `criterion` | no | the number of the failing criterion from `criteria.md` — required on a `discard` motivated by a criterion |
| `why` | yes | the justification, one sentence. On an `a-revoir`, it cites the open files |
| `change` | depends on `kind` | what needs to be written — see below |

An `id` appears **only once**. Two findings on the same rule would be two competing
judgments, and nothing in the file says which one wins.

## `change` by `kind`

| `kind` | `change` | What the applier does with it |
|---|---|---|
| `fix` | `{ field, value }` | writes `value` into `field` |
| `keep` | `{ measure: { matched, total, verdict } }` | sets `status: retenu`, `check: semantic`, and this `measure` with `by: "review"` |
| `discard` | `{ reason, note }` | sets `status: ecarte`, the rule **stays** in `rules` |
| `reprobe` | `{ probe: { regex, sense, gate? } }` | writes the probe and **removes** `measure` |

`reason` belongs to the enum from `candidate-schema.md`. A `keep` without `measure` is
invalid: keeping a rule costs a ratio, and Gate 2 refuses an unmeasured rule.

### Demoting a static candidate

When the probe matches the whole population but isn't enough to decide the statement:

```json
{
  "id": "ENT-002",
  "kind": "fix",
  "why": "The presence of an ORM attribute doesn't prove that all required properties are promoted.",
  "change": {
    "field": "check",
    "value": "semantic"
  }
}
```

This change doesn't require re-measuring: the probe and its ratio haven't changed.

## What is not a finding

- **a rewording of a rule.** Correcting a fact, a status, a counter-example: yes.
  Rewriting the statement: no — a rewritten rule is no longer the one that was measured
- **a change of `strength`.** An ill-fitting strength is flagged as a `fix` with its
  justification, it isn't simply decreed
- **a deletion.** No `kind` removes a rule from `rules`

## Invariants

- every rule in `a-revoir` in the candidates JSON has **exactly one** finding
- an `id` appears only once in `findings`
- a cited `id` exists in the candidates JSON of the same `slug`
- a `keep` carries a complete `measure`
- a `discard` carries a `reason` from the enum
- a `reprobe` carries a `probe` whose `regex` compiles and does not contain the
  ` | ` sequence
