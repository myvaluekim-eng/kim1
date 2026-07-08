#!/bin/bash
# Push app changes to origin/main after agent sessions (when on main branch).

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
[ "$branch" = "main" ] || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0

paths=(index.html css js .github)
status="$(git status --porcelain -- "${paths[@]}" 2>/dev/null)"

if [ -n "$status" ]; then
  git add "${paths[@]}"
  git commit -m "chore: auto-push app updates $(date +%Y-%m-%d-%H%M%S)" || exit 0
fi

git push origin main 2>/dev/null || true
exit 0
