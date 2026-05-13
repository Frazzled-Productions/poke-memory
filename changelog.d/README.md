# Changelog fragments

Instead of editing `CHANGELOG.md` directly, each PR drops a small fragment file here. `auto-release.yml` assembles them into the next release section and deletes them after promoting.

## Format

Create a file named `<issue-or-pr-number>-<short-slug>.md`, e.g. `228-changelog-fragments.md`.

The file must have YAML front-matter with a `kind` field, followed by one or more Markdown bullet lines:

```markdown
---
kind: added
---
- Your changelog bullet here.
```

Valid `kind` values (maps to Keep-a-Changelog subsection):

| `kind`       | Section in CHANGELOG |
|---|---|
| `added`      | Added |
| `changed`    | Changed |
| `removed`    | Removed |
| `deprecated` | Deprecated |
| `fixed`      | Fixed |
| `security`   | Security |
| `minor-bump` | *(no bullet — requests a minor version bump instead of the default patch)* |

## Requesting a minor version bump

Add a fragment with `kind: minor-bump` (no bullet body needed):

```markdown
---
kind: minor-bump
---
```

**Approval required.** Patch is the only fully-automatic bump. PRs that add a `kind: minor-bump` (or future `kind: major-bump`) fragment must also carry the `version-bump:approved` label — the `version-bump-gate.yml` workflow fails otherwise. Only the repo owner applies that label; agents must not add `minor-bump` fragments without explicit user direction.

## Rules

- One fragment per PR is typical, but you can add multiple files if the PR spans several changelog subsections.
- Fragments are deleted from this directory in the same release commit that adds them to `CHANGELOG.md`.
- `changelog.d/unreleased/.gitkeep` keeps the directory tracked by git after all fragments are deleted.
- The `README.md` lives at `changelog.d/README.md` (not inside `unreleased/`) so the release step never deletes it.
