---
kind: fixed
---
- Fixed offline sprite cache being progressively culled during a long offline session. The sprite cache entry cap was raised from 1,300 to 12,000 to accommodate the full offline-download pack (~9,225 URLs across all species and width variants), preventing broken images when practising offline after completing an offline download.
