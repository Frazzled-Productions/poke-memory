---
kind: changed
---
- Auto-review CI now surfaces divergent verdicts: if the review sub-agent posts two `<!-- auto-review:N -->` comments for the same cycle and one of them is missing the SHA marker, the workflow fails the check with the orphan URLs so the inconsistency is forced into the open instead of silently shipping conflicting reviews.
