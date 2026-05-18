---
kind: fixed
---
- Evolution and reverse-evolution card reveals no longer show a brief sprite pop-in. `handleReveal()` now runs a GPU decode step on the reveal-face sprite before flipping the card, matching the decode-ahead that `handleGrade()` already performs.
