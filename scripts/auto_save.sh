#!/bin/bash
# Auto-save: commit and push any tracked changes in the working tree.
# Invoked by launchd every 30 minutes. Never stages .env files.

REPO="/Users/swapneelpremchand/Tulips.edu"
cd "$REPO" || exit 1

# Bail only if there is genuinely nothing to save. `git status --porcelain`
# includes UNTRACKED (new) files, so a tree with only new files still saves —
# the old `git diff` check missed those, which is how new modules fell out of git.
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

TIMESTAMP=$(date "+%Y-%m-%d %H:%M")
git add -A                            # ALL changes incl. NEW + deleted files (.gitignore excludes junk/.env)
git reset HEAD -- "*.env" .env 2>/dev/null  # defensive: never include .env
git commit -m "auto-save: $TIMESTAMP" --no-verify
git push origin main
