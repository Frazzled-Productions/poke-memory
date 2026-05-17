---
kind: fixed
---
- Fixed an invalid `aria-controls` reference in the badge gallery toggle: the locked-badge list is now always present in the DOM (toggled with the `hidden` attribute) so the ARIA relationship is valid whether the panel is collapsed or expanded.
