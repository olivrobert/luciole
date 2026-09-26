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

- **Onboarding:** agents propose rules from a sample of files, scripts measure their regex
  probes across each scope's full file list, a review keeps or drops each rule.
- **Verification:** static rules run as regex, without an LLM. Semantic rules are assessed
  by one of two [engines](#verification-engines): Claude Code agents, or Jev.
- **Retrospective:** past reports point to dead scopes and rules worth revisiting or moving
  into existing tooling.

Nothing is tied to a language: scopes come from the repository, static checks operate on
text. The examples use Symfony because that is where the kit was developed.

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

Static rules run as a regex, line by line. Semantic rules are assessed by the selected
engine; SHOULD findings never block. A `via=` annotation declares that your own tooling
handles the rule, so the checker skips it. [`SPEC.md`](quality-constraints/SPEC.md) defines
the format; `constraint-lint` checks it.

## Verification engines

Static rules always run locally, in the matcher. Only the semantic rules change engine:

| | `agent` (default) | `jev` |
|---|---|---|
| Who judges | Claude Code: the verify skill inlines small groups and dispatches `quality-constraints-checker` agents for the rest | Jev, through the TypeSafe API — one request per file, one question per rule |
| Entry point | `/quality-constraints:quality-constraints-verify` | the same skill with `--engine=jev`, or the standalone `constraint-check` CLI |
| Needs | a Claude Code session | `TYPESAFE_API_KEY`; no agent, usable in CI from a plain shell |
| Sends out | files to the Claude session | semantic rules and file contents to TypeSafe |
| Limits | agent context | files over `--max-chars` (60,000) are not sent: the check is incomplete |

The verify skill uses `QUALITY_VERIFY_ENGINE` (see [Configuration](#configuration)),
overridable per run with `--engine=agent|jev`. `constraint-check` always uses Jev. Both
engines produce the same report and the same `json:verdict`.

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

`TYPESAFE_API_KEY` comes from the environment, or else from the project's `.env.local`.

The gate passes only when verification is complete and there are no MUST violations. The
CLI exits `0` on success, `1` on violations, `2` on an incomplete check (API errors,
missing answers, unreadable or oversized files).

```
## Constraints Check: FAILED ❌
Files: 12 | Static: 31 | Semantic: 4 | Violations: 1 | Warnings: 0 | Errors: 0

- src/Controller/InvoiceController.php:42 CTL-002 (MUST): MUST NOT use ->getDoctrine()
```

The report ends with a `json:verdict` block. In CI, gate on `success` (or the exit
status), not on `violations`: an incomplete check fails with zero violations.

```json
{"success": false, "violations": 0, "warnings": 0, "errors": 1}
```

## Configuration

Artifacts live under `QUALITY_ROOT` (default `.ia/quality`): `code/` for the constraints,
`onboard/` for onboarding state. Onboarding asks for it once and writes it to
`.luciole.env` at the project root, to commit:

```bash
QUALITY_ROOT=.ia/quality
QUALITY_VERIFY_ENGINE=agent   # or jev
```

A developer who needs different values puts them in `.luciole.local.env`.
Precedence: process environment, `.luciole.local.env`, `.luciole.env`.

## Applying constraints

Three ways, combinable:

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

Develop without the skills, then run `/quality-constraints:quality-constraints-verify`.

### 3. Let Claude select skills from their descriptions

Each generated skill's description names the files it applies to, so Claude Code can load
it on its own. Not guaranteed: name the skill explicitly, or verify afterward.

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
checked, clean or not. Keep the reports (`--reports=<dir>`): they are the only archive.
`rule-stats report --reports=<glob>` turns them into per-rule statistics. A retrospective
uses them to flag globs matching no files, rules that never fire, and rules better moved
into your own tooling.

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

- Claude Code
- Node.js
- Git

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
