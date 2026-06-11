---
kind: fixed
issue: 1885
---
- Play cry on reveal is now independent of the Cry cards setting: the toggle is no longer greyed out or labelled as disabled when cry cards are off.
- Cry audio served from the offline pack now plays on WebKit (Safari): the service worker honours range requests with a 206 response, fixing a silent stall that played no cry and added a delay when grading (#1886).
