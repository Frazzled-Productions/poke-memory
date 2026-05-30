---
kind: fixed
---
- Streak protection tokens now bridge a multi-day absence in a single app open. Previously, the auto-spend logic only covered a one-day gap, so a user ill for several consecutive days would lose their streak despite holding enough tokens. The fix walks back across the full run of missed days and spends one token per day in a single pass (all-or-nothing: if the gap is longer than the balance no tokens are spent and the balance is preserved).
