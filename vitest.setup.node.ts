// Polyfill IndexedDB for the node environment (no DOM).
// fake-indexeddb/auto installs FDBFactory, FDBDatabase, etc. on globalThis
// so idb and lib/idb/db.ts can open and query IndexedDB in vitest node tests.
import "fake-indexeddb/auto";
