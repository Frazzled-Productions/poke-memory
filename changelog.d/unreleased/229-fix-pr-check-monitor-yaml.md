---
kind: fixed
---
- Fixed `pr-check-monitor.yml` failing at workflow-file load time due to a YAML block-scalar indentation error in the heredoc body; the workflow now runs on its 15-minute schedule as intended.
