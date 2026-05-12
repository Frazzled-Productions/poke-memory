---
kind: fixed
---
- CI agents are prevented from invoking slash-command skills (e.g. `fewer-permission-prompts`) when a permission denial fires; `--disable-slash-commands` and `--disallowed-tools Skill` are now passed to all 12 `claude-code-action@v1` invocations across 10 workflow files.
