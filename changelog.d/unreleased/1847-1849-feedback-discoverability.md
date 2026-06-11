---
kind: fixed
---

- Lifted the "Send feedback" entry to the top of Settings (above all accordions) so it is reachable without scrolling (#1849). The buried bottom link has been removed.
- Added feedback/bug/report/contact/support synonyms to the Settings search index so searching "feedback", "bug", or "report" surfaces the entry (#1849).
- Added an optional "Which page is this about?" selector to the feedback form; the stored page now reflects the user-stated route (or null), so the Discord bug notification no longer shows a constant "Page: /settings" (#1847).
