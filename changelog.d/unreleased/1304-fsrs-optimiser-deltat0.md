---
kind: fixed
---
- Fixed a crash in the FSRS optimiser that caused a 500 error for any user with at least one card seen only once. Cards with a single review are now excluded from the optimiser input before the native binding is called, preventing the Rust WASI process-level panic (#1304).
- The optimiser eligibility count shown on the Settings page now excludes single-review cards, matching what the server actually feeds to the binding.
- Optimiser error messages now include the HTTP status code for any unmapped server failure, making opaque errors diagnosable from a screenshot alone (#1305).
