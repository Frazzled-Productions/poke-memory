---
kind: added
---
- Card grading now triggers brief haptic feedback on Android (Vibration API) and iOS 17.4+ (system haptic via the checkbox switch technique). Feedback is skipped when the OS reduced-motion preference is active, and no-ops cleanly on browsers that support neither path.
