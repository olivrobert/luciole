# Evals

Measures how reliably the semantic checks of luciole judge code, per batch size, model and engine.

```
pnpm eval --dry-run                              # plan and number of calls, free
pnpm eval                                        # haiku, sonnet × lots of 1/2/5/10 × 3 runs
pnpm eval --configs=haiku,agent:claude-sonnet-5-5 --sizes=1,10 --repeat=1
```

- `fixtures/project/`: an anonymised Symfony project, a fictional library (4 constraint files,
  23 PHP files, 3 of them over 400 lines). Frozen: the eval owns this code. The 10 handlers come
  first, so a lot of 10 is one checker call on 10 files.
- `fixtures/expected.json`: the violations seeded in the fixtures (`rule` is a unique substring of
  the rule text, `level` is `obvious` or `subtle`), and `traps`: compliant code that looks wrong.
  Any MUST rule not listed is expected to pass. `pnpm test` checks every entry resolves.
- Engine `agent`: the prompt of `luciole/agents/checker.md` through `claude -p --model`, one call per
  matcher group, as the verify skill dispatches them (no inline). Engine `jev`: `constraint-check`,
  with `TYPESAFE_API_KEY` from the environment or the repo `.env.local`. Jev judges one file per
  request, so batch size does not change its input.
- Only MUST rules are scored. Results go to `results/` (git-ignored): a table, and the missed or
  invented findings with their frequency.
