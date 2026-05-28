---
kind: fixed
---
- Fixed app language and Pokémon name language being controlled by a single selector: they are now independent settings (#1260). A user can keep the app UI in English while practising Japanese Pokémon names, or vice versa.
- Fixed evolution cards showing stale English names after switching Pokémon name locale: names are now resolved at render time so in-flight cards update immediately without a session rebuild (#1260).
