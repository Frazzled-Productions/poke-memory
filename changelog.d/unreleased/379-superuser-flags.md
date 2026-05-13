---
kind: changed
---
- Superuser mode now exposes per-behaviour flags via a Developer section on the Settings page. The first flag, `pretendAllMastered`, correctly renders the Pasture, Stats (mastery bar, generation breakdown, trainer level, type breakdown), Records & milestones, and the mastered-Pokémon theme picker as fully mastered — previously these surfaces ignored superuser. While any flag is on, sync to the cloud is paused so QA state can't leak into real data; turning off the last flag restores cloud state.
