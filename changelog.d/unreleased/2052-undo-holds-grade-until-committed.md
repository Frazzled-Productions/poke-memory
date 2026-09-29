---
kind: fixed
issue: 2052
---
- Undo now fully rolls back a signed-in grade: an undoable grade is held on the device and only sent to the cloud once it is committed (next grade, leaving the page, the tab hidden for 30 seconds or closed, or 5 minutes after grading), so an undone grade no longer reappears in your grade history or reverts your card after the next sync. Undo expires, without a message, when the grade is committed.
