Governor recovery and staged bulk import - Windows validation
Tested source: 43a1743afbb8dd5d47877fc4c37fe2bf8a735183
100k CSV median total import: 7.429 s -> 4.755 s (1.56x, 36.0% less elapsed time).
Million-event total import, one pair: 82.554 s -> 59.759 s.
Rust: 477 passed, 0 failed, 1 ignored. Frontend: 164 passed; TypeScript/production bundle passed. Live browser recovery used the real clock through all capped profiles.

Import measurements (preview + completed commit; process private resident sampled every 200 ms):
100,000 before #1: 7.098 s; import peak private resident 48.8 MiB.
100,000 after #1: 4.711 s; import peak private resident 186.1 MiB.
100,000 after #2: 4.755 s; import peak private resident 183.5 MiB.
100,000 before #2: 7.562 s; import peak private resident 48.8 MiB.
100,000 before #3: 7.429 s; import peak private resident 49.3 MiB.
100,000 after #3: 5.032 s; import peak private resident 186.2 MiB.
1,000,000 before #1: 82.554 s; import peak private resident 50.5 MiB.
1,000,000 after #1: 59.759 s; import peak private resident 301.9 MiB.

The loader completes all indexes before atomic publication. Cancellation and malformed/duplicate input retain the previous workspace. Original attributes, exact query/search behavior, IDs and schema are preserved. Nonempty append and aggregation are not accelerated by this path.
The temporary import cache is larger but bounded (128 MiB main plus 16 MiB TEMP targets); normal targets are restored before publication. TEMP staging spills to disk for large inputs. SQLite durability settings are unchanged.
The governor can recover while meeting its current FPS cap and no longer downshifts for one isolated geometry spike. Sustained cadence/geometry pressure and emergency memory protections remain.

Only Windows was executed here; no macOS build/visual acceptance.
The governor integration test is browser-based; it is not a rebuilt native Tauri package test.
CSV/OS caches are warm; single-host results, three paired 100k repetitions and one paired million-event sample.
Faster ingestion uses a larger bounded cache than the original 32 MiB target; measured process peaks are included.
Source promotion does not publish a new installer or replace existing release assets.
The separate resident GPU VFX prototype remains local and is excluded from this change.
