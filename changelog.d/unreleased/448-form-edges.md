---
kind: added
---
- Seed pipeline now emits form-aware evolution edges: `evolution_details[].region` tags in the PokéAPI chain JSON produce additional chain nodes using form pokemon IDs (e.g. Hisuian Quilava → Hisuian Typhlosion alongside the default Quilava → Typhlosion edge). Edges dedup on `(fromId, toId)`.
