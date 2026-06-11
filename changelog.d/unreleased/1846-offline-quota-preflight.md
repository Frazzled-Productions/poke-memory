---
kind: fix
issue: 1846
title: "Offline download: pre-flight storage-quota check before starting"
---

Before the offline pack download begins, the app now reads `navigator.storage.estimate()` and compares the available headroom against the pack's expected size (about 166 MB) plus a 20 MB buffer for concurrent progress saves. When space is tight a low-storage warning dialog appears with "Cancel" and "Download anyway" options, so the user can decide rather than letting the download silently fill the origin quota and disrupt card-progress saves. If the Storage API is unavailable the download proceeds as before.
