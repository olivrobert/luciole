---
name: constraint-update
description: Update quality constraint files based on changes made in the conversation or a prompt describing the new rule.
allowed-tools: Read, Glob, Edit, Write, Bash(git diff --name-only), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-lint *), Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/measure-candidates *)
---

# Constraint Update

Two modes:
- **From conversation** (no argument): `git diff --name-only`, read the changed files, identify the new pattern or convention.
- **From prompt**: a description of the rule to add/update (e.g. "controllers must use RoutePrefix constants").

Modifies only `.claude/quality/code/constraints/` and, when it exists, the matching `.claude/quality/onboard/candidates/{key}.json`. Never source code, never skill files, never a new constraint file (that is `onboard`'s job, or the user's following `SPEC.md`).

## Step 1: Find the target constraint file

```
.claude/quality/code/constraints/*.md                # onboarded projects: flat {slug}.md files
.claude/quality/code/constraints/conventions/*.md    # hand-maintained layout
.claude/quality/code/constraints/decisions/*.md
```

Match the rule on the `paths` frontmatter, the `# ... Constraints` title and the existing rules. If no file matches, **ASK the user** whether to create one or add to an existing one.

## Step 2: Read the target — and check for a candidates JSON

Read the whole constraint file: sections (`## Semantic Rules`, `###` subsections), severity convention (`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`).

Then check whether `.claude/quality/onboard/candidates/{key}.json` exists, `{key}` being the constraint file's extensionless basename. **If it exists, the markdown is a GENERATED projection**: `quality-onboard` regenerates it from that JSON, so a change made only in the markdown is erased at the next regeneration and the JSON never learns the rule existed. Every change then lands in BOTH files (Step 6). Without the JSON, the markdown is the only source of truth.

## Step 3: Formulate the rule

Same format as its neighbors: severity first, one line, **what** — **why** separated by ` — `, concrete classes/constants/patterns, placed in the right section.

**A rule already enforced by a tool never reaches the checker.** The tool's nature decides:

| Tool | Behaviour | Outcome |
|---|---|---|
| CS Fixer, Rector, any auto-fixing formatter | rewrites the code | **DROP the rule** and record it in the tooling backlog: onboarded project → candidates JSON (`status: "ecarte"`, `reason: "fixer"`, `automatable`, Step 6bis; `quality-onboard:render` projects it into `lint-backlog.md`, which is regenerated — never append to it by hand); otherwise append to `.claude/quality/code/tool-candidates.md`. The fixer restores the convention at zero cost; keeping the rule only inflates the generation prompt. |
| PHPStan, Deptrac, Psalm, any blocking analyser | rejects the code without fixing it | **KEEP the rule, marked** — static: `ID \| present\|absent \| regex \| message \| via=phpstan:<identifier>`, semantic: `- MUST [via=phpstan]: text`. The checker skips it, but the file is also injected into scaffolding prompts: drop it and the generator stops applying the convention, the build breaks, and nothing says what the correct form was. |

Use the tool's own name in the marker (`via=cs-fixer:<fixer>`, `via=deptrac:<layer>`); any `via=` is recognised.

Outside these two cases, **never delete a rule because a tool now covers it**. Deletion is reserved for rules that are FALSE (they misdescribe the codebase).

## Step 4: Check for duplicates or conflicts

Same intent under different wording = duplicate. A contradiction with an existing rule → **ASK the user** which prevails.

## Step 5: Propose, then wait

**DO NOT modify files yet.** Show: the file(s) touched (markdown, and candidates JSON when it exists), the exact rule, its position (section, neighbors). Wait for approval.

## Step 6: Apply and lint

Edit the constraint file, then run `node ${CLAUDE_PLUGIN_ROOT}/bin/constraint-lint <target constraint file>`. The format is normative in `${CLAUDE_PLUGIN_ROOT}/SPEC.md`: fix every lint error before confirming, rather than trusting visual resemblance to a neighboring rule.

## Step 6bis: Mirror into the candidates JSON (when it exists)

Skip if Step 2 found no JSON. Otherwise **follow the shape of the existing entries** — same fields, same conventions; the file's own entries are the in-context example (authoritative schema: `references/candidate-schema.md` of the `quality-onboard` plugin).

- **Edited rule** → update `rule` (and `strength`, `trigger`, `anchor`, `why`…) on the matching entry. Keep its `id`: renaming an id resets the rule's measurement history.
- **Tool-portable rule** (e.g. a retrospective TOOL PROMOTION) → set `automatable: { tool, nature: "rejette", note? }`; rule and markdown stay untouched.
- **Rule marked `via=`** → set `via` and remove `automatable` (exclusive). **Rule dropped for a rewriting tool** → `status: "ecarte"`, `reason: "fixer"`, one-sentence `note`, `automatable: { tool, nature: "reecrit" }`. Never delete the entry: it documents the decision for the next onboard run.
- **New rule** → next free `{PREFIX}-{NNN}` id, `status: "retenu"`, `strength`, `rule` (one sentence, without MUST/SHOULD), `trigger`, `anchor`, `rationale` (+ `why` if `invariant`), `evidence` (≥ 2 distinct files following the rule), `counterExamples: []`, and a `probe` when a single-line regex approximates the rule.
- **New rule with a probe — measure it, never guess the numbers.** Write `.claude/quality/onboard/measure-input.json` (format: `node ${CLAUDE_PLUGIN_ROOT}/bin/measure-candidates --schema`), run `node ${CLAUDE_PLUGIN_ROOT}/bin/measure-candidates <that file>`, then delete the input file (left behind, it looks like onboard state to the next run). Map the verdict as onboard does:
  - `STATIC` + `MUST`/`MUST NOT` → `check: "grep"`, `measure: { matched, total: triggered, verdict }`
  - `SEMANTIC`, or any `SHOULD*` → `check: "semantic"`, same `measure`; the markdown bullet carries the `({matched}/{total})` ratio; copy the measured `counterexamples` into `counterExamples` as `{ file, note }`
  - `REFORMULATE` / `INSUFFICIENT` → **stop and tell the user**: the rule is false on the population, or the sample proves nothing. Never add it as `retenu` with invented numbers.
- **New rule without a probe** → add it without `check`/`measure` and say so: it fails the onboard gate until the next measure pass classifies it — intended pressure, not a defect.

Show the final result.
