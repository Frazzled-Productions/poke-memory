---
kind: fixed
---
- Practice page now refreshes when a sign-in or visibility pull lands cloud progress that wasn't on this device yet. Previously cold-loading the PWA after completing cards on Safari would show "all cards new" until the user navigated away and back; the fix dispatches a targeted event from `pullAndMerge` only when the merge actually transitioned a card's `lastReview` or `firstSeen`, so no-op pulls stay silent and the reload cannot loop.
