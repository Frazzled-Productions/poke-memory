---
kind: added
---
- Replace the `SignInPicker` dropdown with a `SignInSheet` bottom sheet / centred modal that leads with a value-prop heading and a full a11y contract (focus trap, inert backdrop, Escape to close, focus restore). The sheet is the single sign-in surface: the `GuestSignUpNudge` CTA now opens it instead of its own inline provider picker.
