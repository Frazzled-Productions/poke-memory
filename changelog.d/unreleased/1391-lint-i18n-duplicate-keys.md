---
kind: fixed
---
- Fixed a silent bug where duplicate keys in a message catalogue (e.g. `practice.todayNew` appearing twice with different values) were invisible to the lint gate - JSON.parse kept only the last value, so the first was dead code. The `lint:i18n` gate now scans the raw text before parsing and fails with the full dot-path and both line numbers for any duplicate found in any locale file.
