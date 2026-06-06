---
kind: fixed
issue: 1676
---
- Added iOS PWA splash screens for four common iPhone form-factors that previously cold-launched to a black screen (390×844, 428×926, 414×896 @2× and @3×, covering iPhone 12/13/14, the Pro Max line, XR/11, and XS Max/11 Pro Max). The device table is now a single source of truth (`lib/pwa/splashDevices.ts`) shared by the PNG generator and the layout metadata, with a CI guard asserting every device has correctly-sized PNGs and a matching media query.
