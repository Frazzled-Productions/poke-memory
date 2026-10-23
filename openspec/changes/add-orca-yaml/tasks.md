## 1. The file (ops orca-shell: Repo config in a checked-in orca.yaml; Same file everywhere)

- [x] 1.1 Add root `orca.yaml` with one "Agent" default tab running `claude "/start"`, no `issueCommand`, no `scripts`. Verify: `ruby -ryaml -e 'exit(YAML.load_file("orca.yaml")=={"defaultTabs"=>[{"title"=>"Agent","command"=>"claude \"/start\""}]} ? 0 : 1)'` exits 0.
- [x] 1.2 CI green on the PR into `qa`, "OpenSpec required" included. Verify: the PR's checks.
- [ ] 1.3 Merge only after ops#79 task 1.3 (the live recheck of one tab, one pane, which ticks ops#36 task 6.6) passes. Verify: 6.6 ticked in ops#36 with Fraser's yes before the merge.

## 2. After the next promotion (tracked in ops)

- [x] 2.1 ~~Check the file on `main` after the next qa-to-main promotion~~ Moved to ops#79 task 6.3 (2026-10-23), which diffs each repo's `orca.yaml` on its default branch.
