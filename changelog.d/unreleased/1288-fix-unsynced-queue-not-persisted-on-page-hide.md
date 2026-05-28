---
kind: fixed
---
- Fixed a rare sync gap where grades made near the end of a short mobile session could fail to reach cloud storage. The pending-grade queue is now written to localStorage before the unload beacon fires, ensuring the recovery path has the correct cards even if the beacon fails and the OS kills the page before the debounce timer runs.
