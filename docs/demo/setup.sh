#!/usr/bin/env bash
# Builds a throwaway demo project for docs/demo.tape and prints its path.
# The project is committed clean, then the working tree gets a change breaking
# one static rule (CTL-002) and two semantic rules — the diff constraint-check sees.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dir="$(mktemp -d "${TMPDIR:-/tmp}/luciole-demo.XXXXXX")"

cp -R "$here/project/." "$dir/"
mkdir -p "$dir/bin"
ln -s "$here/../../luciole/bin/constraint-check" "$dir/bin/constraint-check"

cd "$dir"
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm "Initial"
git config diff.context 0
git config core.pager cat
cp -R "$here/change/." "$dir/"

echo "$dir"
