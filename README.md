<h1 align="center">Luciole</h1>

Derive constraint files from an existing codebase and check changes against them.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin_marketplace-d97757.svg)](#quick-start)
[![Stack-agnostic](https://img.shields.io/badge/stack-agnostic-success.svg)](#why)

luciole uses coding agents to identify candidate conventions in a repository, scripts
to measure their regex probes, and a review step to select rules for constraint files.
You can then run checks against a diff, files, or a directory: scripts evaluate static rules,
and agents assess semantic requirements. Verification records observations that can inform
later rule changes.

## Why

Project conventions can be implicit or documented without a corresponding check. Examples
include handlers returning the modified entity or controllers using `RoutePrefix::`
constants. luciole provides a way to record and check such conventions alongside
the project's existing linters and analysers.

- **Onboarding:** agents propose rules from a sample of files. Scripts run the available
  regex probes across each scope's full file list; review examines the evidence and exceptions.
  A probe's match ratio is evidence about a pattern, not proof of the full semantic rule.
- **Verification:** static rules use line-by-line regex checks without LLM evaluation.
  Semantic requirements are assessed by one of two [engines](#verification-engines):
  harness agents, or Jev.
- **Retrospective:** recorded results help identify unused scopes and rules worth revisiting
  or moving into existing tooling. Rule changes require a separate update and approval.

The matcher derives the file types in scope from the constraints, and onboarding derives
its scopes from the repository. The engine has no fixed language list; its static checks
operate on text, and semantic checks use the selected engine's judgment. The examples below use
Symfony because that is where the kit was developed.

Paths below use `QUALITY_ROOT`, a harness-independent artifact root. Onboarding asks for
it once and writes the choice to the project-root `.luciole.env`, meant to be committed.
An uncommitted `.luciole.local.env` beside it overrides that file key by key for one
developer; the process environment overrides both, and `.ia/quality` is the fallback.
It relocates the `code/` deliverables and `onboard/` state together.

`.luciole.env` also records the default [verification engine](#verification-engines).

## What a constraint looks like

One plain Markdown file per file type, in `${QUALITY_ROOT}/code/constraints/`:

````markdown
---
paths:
  - "src/**/Controller/**/*.php"
---

## Static Rules

```rules
CTL-001 | present | #\[Route\(      | MUST have a #[Route] attribute
CTL-002 | absent  | ->getDoctrine\( | MUST NOT use ->getDoctrine()
CTL-004 | present | RoutePrefix::   | MUST use RoutePrefix constants | via=phpstan:proj.routePrefix
```

## Semantic Rules

- MUST: Inject the domain repository interface — not the infrastructure implementation
- SHOULD: Return the entity (created or modified)
````

Static rules run as a regex, line by line, in a script. Semantic rules are assessed by
the selected engine; SHOULD findings never block. Constraints containing only semantic
SHOULD rules stay advisory and are not sent to either engine. A `via=` annotation declares that your
own tooling handles the rule, so the checker skips it. [`SPEC.md`](quality-constraints/SPEC.md)
defines the format, and `constraint-lint` checks constraint files for format errors.

## Verification engines

Static rules always run locally, in the matcher. Only the semantic rules change engine:

| | `agent` (default) | `jev` |
|---|---|---|
| Who judges | Claude Code: the verify skill inlines small groups and dispatches `quality-constraints-checker` agents for the rest | Jev, through the TypeSafe API — one request per file, one question per rule |
| Entry point | `/quality-constraints:quality-constraints-verify` | the same skill with `--engine=jev`, or the standalone `constraint-check` CLI |
| Needs | a Claude Code session | `TYPESAFE_API_KEY`; no agent, usable in CI from a plain shell |
| Sends out | files to the Claude session | semantic rules and file contents to TypeSafe |
| Limits | agent context | files over `--max-chars` (60,000) are not sent: the check is incomplete |

Selection order for the verify skill: `--engine=agent|jev` for one run, then the process
`QUALITY_VERIFY_ENGINE`, then `QUALITY_VERIFY_ENGINE` in `.luciole.local.env`, then in
`.luciole.env`, then `agent`. `constraint-check` ignores this setting and always uses Jev.
Both engines produce the same report, the same `json:constraints-run` block and the same
`json:verdict` contract.

## Quick start

In Claude Code:

```
/plugin marketplace add olivrobert/luciole
/plugin install quality-constraints@olivier-robert
/plugin install quality-onboard@olivier-robert
```

Then, inside your project:

```
/quality-onboard:onboard
```

Onboarding proposes and reviews rules, then writes the constraint files for you to inspect:

- `${QUALITY_ROOT}/code/constraints/` — one constraint file per file type, derived from your
  code

After you approve those files, it generates:

- `.claude/skills/quality-{slug}/` — one scaffolding skill per scope. Each routes to its
  constraints file and to a reference file in the repository; the constraints take
  precedence over the reference file
- `.claude/skills/skill-mapping.md` — the file → skill map a technical plan consumes

See [Applying constraints](#applying-constraints) for ways to use them during development
or review.

Run verification when you want to check a change against the applicable constraints:

```
/quality-constraints:quality-constraints-verify              # current git diff
/quality-constraints:quality-constraints-verify src/Invoice  # a directory
/quality-constraints:quality-constraints-verify --reports=var/reports  # save reports
/quality-constraints:quality-constraints-verify --engine=jev         # override the configured engine
/quality-constraints:quality-constraints-verify --engine=agent       # use agent verification
```

For an agent-free semantic check, install the optional binaries with
`/quality-constraints:install`, then run the TypeSafe-backed CLI:

```bash
constraint-check                          # current git diff
constraint-check src/Invoice              # a file or directory
constraint-check --dry-run --stdout        # inspect requests without calling the API
```

Static rules still use the same local matcher. Semantic rules and the relevant file
contents are sent to TypeSafe System One and require `TYPESAFE_API_KEY`. Export it in the
shell or CI secret store; for local use the CLI also reads `TYPESAFE_API_KEY=...` from the
checked project's `.env.local` when the variable is absent. Never commit that file—ensure
the target project ignores it.

The gate passes only when verification is complete and there are no MUST violations;
SHOULD findings remain warnings with either engine. The CLI exits `0` on success, `1`
on constraint violations, and `2` on an incomplete check (API errors, missing answers,
unreadable or oversized files). Files exceeding `--max-chars` (60,000 by default) are
not sent partially: raise the limit or select the agent engine. Incomplete runs return
`success: false` with an `errors` count in the verdict.

```
## Constraints Check: FAILED ❌
Files: 12 | Static: 31 | Semantic: 4 | Violations: 1 | Warnings: 0 | Errors: 0

- src/Controller/InvoiceController.php:42 CTL-002 (MUST): MUST NOT use ->getDoctrine()
```

The report ends with a `json:verdict` block for a caller to parse. To use it in CI, configure
the job to invoke the verification workflow and act on the verdict:

```json
{"success": false, "violations": 1, "warnings": 0}
```

An incomplete check has an `INCOMPLETE` report header and blocks even without a detected
violation. CI must use `success` (or the CLI exit status), not only the violation count:

```json
{"success": false, "violations": 0, "warnings": 0, "errors": 1}
```

## Applying constraints

You can use constraints in three ways, depending on how you work. These approaches can
also be combined: using skills during development still leaves room for a review afterward.

### 1. Use the skill mapping in the plan

Ask the planning agent to read `.claude/skills/skill-mapping.md` and associate each file to
create or modify with its applicable `quality-{slug}` skill. The implementing agent then
loads those skills, which point to the constraints and a repository reference file.

Add this to your task prompt or project instructions, such as `CLAUDE.md`:

```text
Read .claude/skills/skill-mapping.md before planning changes.
For each file to create or modify, include the applicable skill in the plan.
Load and follow that skill before implementing the change.
If no mapping applies, say so and follow the project's existing conventions.
```

For example, a plan entry could be: “Modify `src/Controller/InvoiceController.php` using
`quality-controller`.” Use the skill names actually listed in your project's mapping.

### 2. Review after development

You can develop without using the generated skills and check the result against the
constraint files afterward with `/quality-constraints:quality-constraints-verify`.

### 3. Let Claude select skills from their descriptions

The generated skills live in `.claude/skills/quality-{slug}/`. Their descriptions identify
the file type and pattern, and state that the skill applies when matching files are added
or modified. Claude Code uses descriptions to decide which skills to load for a task; see
the [Claude Code skills documentation](https://code.claude.com/docs/en/slash-commands).

You can give Claude the development task without explicitly naming a skill or consulting
the mapping. Selection depends on Claude's assessment of the task; a matching description
does not guarantee the skill will be used. You can request it explicitly or run the review
command afterward when you want to check the result.

## How onboarding works

`/quality-onboard:onboard` coordinates five steps, with approval before skill generation.
You can also run the steps separately. State is stored on disk, so you can `/clear` between
calls to manage context on larger projects.

| Step | Command | What it does | Writes |
|---|---|---|---|
| 1 | `/quality-onboard:scope` | selects the file types and records the files in each scope | `scopes.json` |
| 2 | `/quality-onboard:generate` | proposes rules per type, validates their format, and measures available probes across each scope | `candidates/{slug}.json` |
| 3 | `/quality-onboard:review [slug]` | a read-only reviewer judges one scope, an applier applies its findings | `findings/{slug}.json` |
| 4 | `/quality-onboard:render` | renders the constraints and the tooling backlog, runs the gate, asks for your approval | `constraints/{slug}.md`, `approval.json` |
| 5 | `/quality-onboard:skills` | after approval, one skill per scope, plus the mapping | `.claude/skills/` |

After `render`, you are asked to read and approve the constraint files before skills are
generated. Approval is tied to their contents; editing a constraint invalidates it.
Validation failures or unresolved candidates can also stop the run.

A generator reads a diverse sample of at most 15 files per scope. Scripts then measure
available probes across the scope's full file list. Review checks whether those probes
express the proposed rules and investigates candidates that measurement could not resolve.

## The measurement loop

Every verification report carries a `json:constraints-run` block: one verdict per rule
checked, clean or not. `rule-stats report --reports=<glob>` projects those blocks (plus the
`json:constraints-annotations` of past retrospectives) into per-rule statistics — nothing
is stored anywhere else, the reports are the archive, and where they live is the caller's
business. A retrospective uses this projection and a repository scan to flag globs matching
no files, rules with no recorded violations, and candidates for checks in your own tooling.
These are review signals: a rule with no violations may still be useful, and moving a
semantic rule to a regex requires checking that the regex expresses it adequately.

```
/quality-constraints:quality-retrospective   # proposes improvements — never applies them
/quality-constraints:constraint-update       # applies a rule change, with your approval
```

## Plugins

| Plugin | What it brings |
|---|---|
| **quality-constraints** | The engine: [`SPEC.md`](quality-constraints/SPEC.md) (normative grammar), the matcher, the format linter (`constraint-lint`), the optional TypeSafe CLI (`constraint-check`), the candidate measurer (`measure-candidates`), the measurement projection (`rule-stats`), the verify/review skill, `constraint-update` and `quality-retrospective`. |
| **quality-onboard** | The onboarding layer: `/scope`, `/generate`, `/review`, `/render`, `/skills` (or `/onboard` for the whole run). Generates constraints and scaffolding skills from the project. Depends on `quality-constraints`. |

## Requirements

- Claude Code for the plugin commands shown above; other agent harnesses need to load the
  skills and resolve their script paths
- Node.js (the engine's scripts and the tests)
- Git (repository file discovery and diff checks)

Installing the engine commands on your PATH is optional when using the plugins.

<details>
<summary>How <code>quality-onboard</code> finds the engine binaries</summary>

`quality-onboard` needs the `quality-constraints` engine binaries (`constraint-lint`,
`measure-candidates`). Its scripts resolve them on their own, in this order: the
`CONSTRAINT_KIT_BIN` environment variable (a directory), the sibling
`quality-constraints/bin` of a repository clone, the plugin cache, then the PATH. The first
onboarding step (`/quality-onboard:scope`) checks this before any agent runs.

Optional: `/quality-constraints:install` puts `constraint-check`, `constraint-lint`,
`rule-stats` and `measure-candidates` on your PATH, for terminal and CI use, or when none
of the locations above applies.

</details>

## Tests

```bash
node --test '*/tests/*.test.mjs'
```

## License

MIT — see [LICENSE](LICENSE).
