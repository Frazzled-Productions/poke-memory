---
kind: fixed
issue: 1837
---
- Fix Higher-or-Lower Next/Play-again button pushed below the fold on mobile: adopt the flex-1 min-h-0 shrinkable sprite row plus flex-none pinned footer layout so the action button is always visible without scrolling, and remove the scrollIntoView workaround from #1447.
