---
kind: changed
---
- Stats and Journey pages now share a single memoised DashboardSnapshot computation via a React context provider, eliminating redundant work when both pages are mounted simultaneously.
