---
kind: changed
---
- The FSRS optimiser now surfaces the actual failure when it can't optimise: server errors include the HTTP status (and prompt you to file an issue) and a connection failure is reported as such, instead of a single catch-all "try again later" message.
