#!/usr/bin/env bash
# Prune stale Claude Code background-job worktrees.
#
# Background jobs each get an isolated git worktree under .claude/worktrees/.
# The harness only auto-removes a worktree if it is *unchanged* — but any job
# that commits work leaves a "changed" worktree behind, so they accumulate
# indefinitely (57 GB / ~95 worktrees observed before this hook existed).
#
# Runs at SessionStart. Removes a worktree only when it is BOTH:
#   - not locked   — a locked worktree belongs to a running job; never touched.
#   - stale        — its branch's last commit is > 3 days old (grace period to
#                    inspect or continue a finished job before reclaiming it).
# Branches and pushed PRs are untouched — only the on-disk worktree is removed.
set -u

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
wt="$root/.claude/worktrees"
[ -d "$wt" ] || exit 0

cd "$root" || exit 0
git worktree prune 2>/dev/null

# Snapshot worktree metadata once; abort if the listing fails — we cannot
# safely determine what is locked.  sub(/^worktree /,"") captures the full
# remainder so paths with spaces are not truncated.
wt_listing="$(git worktree list --porcelain 2>/dev/null)" || exit 0
locked="$(printf '%s\n' "$wt_listing" | awk '/^worktree /{sub(/^worktree /,""); p=$0} /^locked/{print p}')"
tracked="$(printf '%s\n' "$wt_listing" | awk '/^worktree /{sub(/^worktree /,""); print}')"

now=$(date +%s)
cutoff=$((3 * 86400))   # 3 days
removed=0

for d in "$wt"/*/; do
  d="${d%/}"
  [ -d "$d" ] || continue
  printf '%s\n' "$locked" | grep -qxF "$d" && continue

  # Age = time since the worktree branch's last commit; fall back to dir mtime.
  ts="$(git -C "$d" log -1 --format=%ct 2>/dev/null)"
  if [ -z "$ts" ]; then
    ts="$(stat -f %m "$d" 2>/dev/null || stat -c %Y "$d" 2>/dev/null)"
  fi
  [ -n "$ts" ] || continue
  [ $((now - ts)) -ge "$cutoff" ] || continue

  if git worktree remove --force "$d" 2>/dev/null; then
    removed=$((removed + 1))
  elif ! printf '%s\n' "$tracked" | grep -qxF "$d"; then
    # Pre-loop snapshot confirms git no longer tracks this dir — safe to remove.
    rm -rf "$d" && removed=$((removed + 1))
  fi
done

git worktree prune 2>/dev/null
[ "$removed" -gt 0 ] && echo "[prune-worktrees] removed $removed stale worktree(s)"
exit 0
