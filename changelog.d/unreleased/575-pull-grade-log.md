---
kind: fixed
---
- Sync: background pull (`pullAndMerge`) now pulls `grade_log` from cloud and union-merges with local. Previously the accuracy sparkline, grade-breakdown bar, heatmap, and rolling-7-day on Stats were local-only — grades on another device never appeared until that other device itself opened Stats.
