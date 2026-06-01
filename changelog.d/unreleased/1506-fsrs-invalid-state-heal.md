---
kind: fixed
---
- Fixed a crash where grading a card with an invalid FSRS state (stability 0 written by an older app version) threw `FSRSValidationError` and permanently bricked the Practice screen. Invalid states are now healed to a clean initial state on load, and the error boundary offers a "Reset local practice data" escape hatch as a last resort.
