---
kind: added
---
- Added a snapshot-based scheduler evaluation harness in `lib/srs/eval.ts`. Five fixture review lives are replayed through `nextReview` and their traces are pinned with `toMatchSnapshot`, so any future scheduler change surfaces as a reviewable diff.
