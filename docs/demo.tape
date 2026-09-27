# Demo GIF for the README — run from the repository root: `vhs docs/demo.tape`
# Requires vhs >= 0.8 (for `Wait`) and TYPESAFE_API_KEY in the environment: the semantic
# rules go to Jev. docs/demo/setup.sh builds a throwaway project whose diff breaks one
# static rule and two semantic ones. Jev is not deterministic: check the GIF before
# committing it.

Output docs/demo.gif

Set Shell bash
Set FontSize 15
Set Width 1400
Set Height 420
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type 'cd "$(docs/demo/setup.sh)" && export PATH="$PWD/bin:$PATH" PS1="\[\e[35m\]demo\[\e[0m\] $ " && clear' Enter
Sleep 1s
Show

Type "git diff" Enter
Sleep 2500ms
Type "clear" Enter

Type "constraint-check" Sleep 500ms Enter
Wait+Screen@2m /"success"/
Sleep 8s
