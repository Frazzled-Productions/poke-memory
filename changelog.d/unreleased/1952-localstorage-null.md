---
kind: fixed
issue: 1952
---
- Fixed a crash on browsers that block site data or cookies (seen on Windows), where the machine-translation notice and a few other storage reads could throw instead of degrading gracefully.
