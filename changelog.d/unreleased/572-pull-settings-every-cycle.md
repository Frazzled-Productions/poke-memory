---
kind: fixed
---
- Sync: background pull (`pullAndMerge`) now refreshes the JSONB settings blob on every cycle, not just on brand-new devices, using a per-device `lastSettingsPullAt` cursor compared against `user_settings.updated_at`. Theme intensity, mastery threshold, daily caps, practice scope, badges, FSRS weights and TTS prefs now propagate across devices the same way card progress does.
