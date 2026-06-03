#!/bin/bash
# Auto-save: commit and push any tracked changes in the working tree.
# Invoked by launchd every 30 minutes. Never stages .env files.

REPO="/Users/swapneelpremchand/Tulips.edu"
cd "$REPO" || exit 1

# Bail if nothing tracked has changed
if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

TIMESTAMP=$(date "+%Y-%m-%d %H:%M")
git add -u                            # tracked modified files only
git reset HEAD -- "*.env" .env 2>/dev/null  # defensive: never include .env
git commit -m "auto-save: $TIMESTAMP" --no-verify
git push origin main
