---
description: Install the constraint-check, constraint-lint, rule-stats and measure-candidates shims into ~/.local/bin — for terminal and CI use, and as the PATH fallback of the onboarding scripts.
allowed-tools: Bash(mkdir *), Bash(printf *), Bash(chmod *), Bash(command *), Bash(echo *), Bash(test *), Read
---

# Install luciole shims

This plugin's own skills call their binaries through `${CLAUDE_PLUGIN_ROOT}` and need no
installation. These shims make `constraint-lint`, `rule-stats` and `measure-candidates`
available on the PATH — for direct terminal use, CI jobs, and as the last resort of the
onboarding scripts, which look for the engine in `CONSTRAINT_KIT_BIN`, then in the
plugin's `bin/`, then on the PATH.

Run:

```bash
mkdir -p ~/.local/bin
printf '#!/usr/bin/env bash\nexec node "%s/bin/constraint-check" "$@"\n' "${CLAUDE_PLUGIN_ROOT}" > ~/.local/bin/constraint-check
printf '#!/usr/bin/env bash\nexec node "%s/bin/constraint-lint" "$@"\n' "${CLAUDE_PLUGIN_ROOT}" > ~/.local/bin/constraint-lint
printf '#!/usr/bin/env bash\nexec node "%s/bin/rule-stats" "$@"\n' "${CLAUDE_PLUGIN_ROOT}" > ~/.local/bin/rule-stats
printf '#!/usr/bin/env bash\nexec node "%s/bin/measure-candidates" "$@"\n' "${CLAUDE_PLUGIN_ROOT}" > ~/.local/bin/measure-candidates
chmod +x ~/.local/bin/constraint-check ~/.local/bin/constraint-lint ~/.local/bin/rule-stats ~/.local/bin/measure-candidates
```

Then verify all four resolve:

```bash
command -v constraint-check constraint-lint rule-stats measure-candidates
```

If they don't, `~/.local/bin` is missing from the PATH — tell the user to add
`export PATH="$HOME/.local/bin:$PATH"` to their shell profile. Never edit shell profiles
yourself.

Report what was installed and where. Mention that `constraint-check` needs
`TYPESAFE_API_KEY` for semantic checks; it may be exported by the shell/CI or stored as
`TYPESAFE_API_KEY=...` in the checked project's ignored `.env.local` file.
