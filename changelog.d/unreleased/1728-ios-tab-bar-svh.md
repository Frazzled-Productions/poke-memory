---
kind: fixed
issue: 1728
---
- Fixed the iOS bottom tab bar detaching from the screen bottom on cold load and snapping into place after the first scroll. Changed `min-h-dvh` to `min-h-[100svh]` on `<body>`: `svh` (URL-bar-expanded height) is correct at first paint, whereas `dvh` (URL-bar-collapsed height) resolved to the wrong value before any scroll reconciled the viewports (#1728).
