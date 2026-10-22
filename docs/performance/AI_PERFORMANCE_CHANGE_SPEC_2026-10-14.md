# AI implementation specification: Chronoscope performance, 2026-10-14

## Execute these instructions, not a generic rewrite

1. Work on separate branches/worktrees. **First C01 failed-read preservation, C02 raw-row IDs, C03 latest range intent**, each with its regression. One independently reviewable change per commit; do not bundle actor/IPC/renderer rewrites with correctness fixes.
2. All source anchors, patches and measurements target **0.5.2, 7400b55220c25da714df93be1157f1ad3b990427**. Documentation branch started at db26487b95e64759236ee3b6f20564566d6ae65c; its source files are not authoritative for citations. Parent verified newer upstream main **8e7ca1c556b4b5d399585f2fc8196b588650c33b, UNBENCHMARKED**. Inspect/adapt current code; do not blindly apply frozen patches or claim newer main measured.
3. Preserve JSON/CLI/MCP and portable formats unless explicitly introducing a versioned additive boundary. No generic framework rewrite, duplicate schema cache, arbitrary SQL endpoint, hidden LOD, approximate queries/statistics, silently reduced terrain resolution, hidden stems/MSAA/backing-scale change, or PRAGMA durability weakening.
4. Preserve fallback until exact correctness and matched native tests pass. Small prototypes prove only their narrow fixture, not larger architecture. **Proposed APIs below are UNCOMPILED/UNTESTED**, except actual attached tested patches. Goals are acceptance thresholds, not measured results.
5. Preserve decimal-string u64 IDs (never JS Number), WGS84/geodesics, UTC minute canonical times and original timestamp text in attrs, exact source/evidence/attribute text, missing/null/inequality semantics, selection/undo/review/privacy. Render representatives are not the exact corpus.

**Dependency DAG:** C01→C02→C03 first correctness gate. Then C02→C04 and C01→C05 independently. C03→C06→C07→C09→C10/C12/C20; C06→C11→C12; C06+C09→C08 ownership; C09→C23 retained-terrain exploration. C01+C02→C13→C14→C15; C13→C16→C17; C15→C18 full stream. C01→C19; C09+C13+C14→C21; C06→C22; C01→C24 before attribute expansion. Do not make prepared inserts wait for actor migration. Every substep separately revertible.

Status: **VALIDATED-NARROW** = exact attached implementation tested only within stated scope; **EXPLORATORY** = implemented CPU/scaffold with incomplete native/production semantics; **UNTESTED** = design contract; **REJECTED** = do not ship as claimed optimization. **24 consolidated tickets C01–C24: 6 VALIDATED-NARROW, 1 EXPLORATORY, 17 UNTESTED.** Rejected alternatives are in R0, not additional implementation tickets.

## Prioritized index

| ID | Status | Frozen file/function | Actual matched metric / fixture |
|---|---|---|---|
| C01 P0 | VALIDATED-NARROW | engine.rs invoke rollback | Failed read fail→pass; joint2fail→2pass / demo |
| C02 P0 | VALIDATED-NARROW | stream_import.rs ingest/import.rs convert | accepted1000/store999→1000 / rejected first row batch boundary |
| C03 P0 | VALIDATED-NARROW | main.ts timeWindow/range handlers | Native rapid20→40 lost3/3→0/3; extracted blocked writes[2000,6000] |
| C04 P1 | VALIDATED-NARROW | store.rs insert |100k10.015960→7.955307s;1m119.586398→97.690667s / genuine engine CSV |
| C05 P1 | VALIDATED-NARROW | store.rs time_bounds/where_sql | endpoints100k28.539→0.047ms;1m284.871→0.055ms; sorted numeric38.05%/42.24% |
| C06 P1 | UNTESTED | engine.rs snapshot/render_data; main.ts refresh | Coherent result/every-await guard; no measured gain |
| C07 P1 | UNTESTED | store.rs summary/projected_page; main.ts table | Dependency caches/sections/50-row projection; no measured gain |
| C08 P1 | VALIDATED-NARROW | view.ts setTerrain |18 immutable reused setters below1ms;baseline repeat medians354/421/329ms |
| C09 P1 | UNTESTED | view.ts rebuild/setRasters | Dirty retained groups/ownership; no measured gain |
| C10 P1 | UNTESTED | view.ts setSelection | Selection identity/capacity; selectedAll100k unmeasured |
| C11 P1 | UNTESTED | types.ts decode; bridge.ts/Tauri dispatch | Shape checks/optional native ArrayBuffer; no transport speed proof |
| C12 P2 | UNTESTED | view.ts pos/setData/rebuild | SoA/local GPU attributes; no measured gain |
| C13 P1 | UNTESTED | jobs.rs/operation.rs; engine.rs post-check | Progress/cancel/commit receipts; no measured architecture gain |
| C14 P2 | UNTESTED | jobs.rs start; engine.rs gate | Bounded writer queue; no actor speed proof |
| C15 P2 | UNTESTED | store.rs TEMP caches/query_stamp | Two pinned reader owners; no concurrency speed proof |
| C16 P1 | UNTESTED | store.rs save_as/open_copy; engine.rs export | Staged durable persistence/privacy/open validation |
| C17 P2 | UNTESTED | engine.rs import_commit/store.rs copy_into | Clone-before-ingest; copy92.40% NOT append gain |
| C18 P2 | UNTESTED | analysis.rs run/engine.rs analyze | Compact rows/budgets/full-stream Gaps+Speed; no measured gain |
| C19 P1 | UNTESTED | terrain.rs mesh/cache | Exact LRU/cancel; real129x129 DTED unbenchmarked |
| C20 P1 | UNTESTED | view.ts initialize/draw/fallback | Explicit disposal; no measured leak attribution |
| C21 P1 | UNTESTED | engine.rs wmts;wmts.rs fetch | Resource worker preserving existing bounds/auth |
| C22 P1 | UNTESTED | native startup/main refresh/view draw | Traces/physical blank/explicit quality+budget;diagnostic gains not equivalent |
| C23 P2 | EXPLORATORY | view.ts pick/retained terrain | Node picking13.37% CPU;33x33 terrain13.49% CPU p95 variable |
| C24 P0/P1 | UNTESTED | store.rs where_sql/rust_number;model.rs matches | Invalid RHS wrong bind; stored -0 Contains48 vs0; fixes separate |

## Evidence and measurement contract

[Bundle README](ai-20261014/README.md) indexes all portable files. [Manifest](ai-20261014/evidence/manifest.json) records original SHA256 and sanitized-file SHA256; sanitized evidence removes addresses/host paths/PIDs, not measurements. Frozen GitHub links are authoritative, not branch-relative source.

Backend: fresh private process/store each run, reused fixture, **OS page cache uncontrolled/warm**, not cold-cache/randomized/thermal-controlled.100k driver pairs baseline then variant per repeat. Million driver schedules **baseline,prepared,indexed per repeat1..3**; comparisons reuse SAME THREE baselines, not six independent baselines. Compilation excluded. Three operations justify median/mean/range, **operation p95/p99 NULL**. Harness forces SQLite save/open, not default100k auto-format ZIP. PSS snapshot is final not peak; summed RSS not unique memory.

| Intended target | baseline r1/r2/r3 | variant r1/r2/r3 | Median reduction |
|---|---|---|---|
| C04 ingest100k s |9.055692/10.533866/10.015960|7.955307/7.864895/8.037054|20.57%|
| C04 ingest1m s |129.938313/119.586398/119.232263|97.455965/98.406716/97.690667|18.31%|
| C05 bounds100k ms |28.539082/29.702147/27.293436|0.047179/0.048158/0.045981|99.83%, endpoints ONLY|
| C05 bounds1m ms |3592.957041/284.870838/284.100230|0.057748/0.047151/0.054510|99.98%, retain outlier|
| C05 numeric ORDER100k ms |51.565172/51.095784/48.887969|31.654355/30.309032/34.318844|38.05%|
| C05 numeric ORDER1m ms |517.376024/517.994070/517.846655|301.310166/240.811159/299.083290|42.24%|

C04 ingest ranges100k9.055692–10.533866 vs7.864895–8.037054s;1m119.232263–129.938313 vs97.455965–98.406716s. Copy medians improve20.59%/17.32%. C05 sorted category medians39.016966→31.794589ms100k and406.909909→316.609502ms1m. **Sorted numeric still scans events_time plus temporary ordering** in bundled SQLite3.50.2. Count-only VM7000912→1814 is another query, not sorted scan elimination; endpoint factor never describes whole query.

Four completed Rust suites correctness/prepared/indexed/serialized **109 passed each, 0 failed** (104 existing + 5 new), with C01+C02 gates alongside variants. [Suite proof](ai-20261014/evidence/suite-proof.json) retains original log hashes. Joint runtime C01-C02 patch SHA256 **6d5454fb3980e4bc941db18b9f9e9f54502a8110938b763b874555421ece0abd**. Separate E01/E02 have byte-identical component hunks, **not independently run binaries**. Passing predicate oracle excludes stored negative-zero and invalid attribute numeric RHS; C24 is not covered by “all predicates pass.”

Native actual CSV import accepted/stored/query100000; default frontend20000 representatives. Explicit schema-supported max_points100000 yields100000 unique IDs/instances,800000 marker triangles,100000 stems,99980 trails. Current full submission interval p50 **80/78/78ms**,p95 **88/88/86ms**; default20k35/35/35ms. Not older0.5.1 synthetic31fps, not100k simultaneously visible pixels.12 matched native runs all complete with exact100k, meaningful pixels and advancing per-process **amdgpu PCI0000:3a:00.0 /1002:6987**; misleading WebKit “Apple GPU” label is not hardware proof. Process-local DMABUF-disabled X11 path,1382x704,DPR1,elapsed-time camera,≥6.5s matched samples. GPU elapsed/physical presents/true first-upload completion **NULL**. Baseline-full PSS peak621.65MiB; max single-client residentVRAM317952KiB is not unique whole-app VRAM. Original unmodified physical blank5/20s,18colors; exact original Xvfb functional demo1237colors works. Original physical startup remains unresolved.

## C01 — Failed READ must preserve metadata (VALIDATED-NARROW)

**Source:** [Engine::invoke397–407/538–555](ai-20261014/SOURCE_ANCHORS.md#s1). BEFORE captures empty Project for nonmutation; error unconditionally restores it, losing name/filter/selection/scene while192 stored rows/revision remain. AFTER tested capture always clones real metadata (not full event corpus):

~~~rust
// BEFORE
if mutation { s.project.clone() } else { Project::new(Dataset::default()) }
// AFTER tested E01, existing error restore retained
s.project.clone()
// Follow-up UNCOMPILED/UNTESTED
let rollback: Option<(Project, Preferences)> = mutation.then(|| (s.project.clone(),s.preferences.clone()));
// Restore only Some; mutation savepoint/previous_store/selection rollback stays explicit.
~~~

[Exact E01 patch](ai-20261014/patches/engine-E01.patch),SHA256 **1c6325edbc3131d760491e9b755c6ad322f715cfe70038928f835f7da528bb89**. Bundled existing failed_read_stale_cursor_preserves_metadata_and_store fails baseline/passes joint fix; compare whole compact snapshot/store count/revision. Run RUST-GATES; add proposed cancellation/malformed projection/map-error tests preserving preferences/TEMP selection. **Steps:** adapt tested clone first; only then optimize mutation-only Option after rollback parity. **Goal:**0metadata changes on failed read;≤5% read-heavy clone-cost regression, no measured speedup. **Deps:**none. **Rollback:**safe real clone if Option optimization fails; never remove mutation rollback broadly.

## C02 — Reserve IDs by consumed raw rows (VALIDATED-NARROW)

**Sources:** [ingest111–130](ai-20261014/SOURCE_ANCHORS.md#s2),[convert345–350/505](ai-20261014/SOURCE_ANCHORS.md#s3),[insert575–588](ai-20261014/SOURCE_ANCHORS.md#s4). BEFORE batch offset accepted, convert assigns first_id+raw index; rejected row creates next-batch replacement collision. AFTER:

~~~rust
// BEFORE / tested AFTER E02
first_id.checked_add(accepted as u64)
first_id.checked_add((accepted + rejected) as u64)
// Explicit checked raw_seen adaptation, UNCOMPILED/UNTESTED
let batch_first=first_id.checked_add(raw_seen).ok_or("Event ID capacity exhausted")?;
let next=raw_seen.checked_add(u64::try_from(batch.rows.len()).map_err(|_| "Row capacity")?)
 .ok_or("Event ID capacity exhausted")?;
// convert at batch_first; after successful batch/accounting raw_seen=next.
~~~

[E02 patch](ai-20261014/patches/engine-E02.patch),SHA256 **bbcbc71e423030c338e630695152a1bd7515cfd78d678f7b2bde14bb6f5f8e08**. Existing rejected_first_row_cross_batch_count_and_identity:accepted1000/store999→1000,both boundary labels retained. Extend invalid-last/multiple/all-invalid/4MiB flush/Excel/append-after-gaps/high-u64 overflow. IDs keep raw gaps; never renumber saved projects/change edit replacement semantics to hide ingest collision. **Steps:**offset fix, exact count+ID/source oracle, then explicit counter hardening. **Goal:**accepted==COUNT(*),no lost evidence, no speed claim. **Deps:**C01 gate. **Rollback:**do not restore known-unsafe ingestion; fail affected path closed if parity fails.

## C03 — Latest intent capture/drain (VALIDATED-NARROW, range only)

**Source:** [main.ts refresh142–209](ai-20261014/SOURCE_ANCHORS.md#s5),timeWindow964–972,debounce1398–1407. BEFORE timer rereads DOM after observer overwrites slider. Tested [latest-intent patch](ai-20261014/patches/render-latest-intent.patch),SHA256 **aeac7882837dfab69e70f3c263c756db39d1612ceff097989b02d79fde35d687** captures version/start/end/bounds synchronously, protects pending sliders, serializes range writes newest last. Native rapid20→40 lost3/3→0/3,actual==expected1750164180; extracted observer2000 retained,blocked20→40→60 writes[2000,6000]. No latency gain.

~~~ts
// BEFORE: delayed DOM read. AFTER tested immediate capture
const a=Number(input("#window-start"))/1000,b=Number(input("#window-end"))/1000;
captureRangeIntent(Math.min(a,b),Math.max(a,b));
rangeTimer=setTimeout(()=>drainRangeIntent().catch(error=>toast(String(error),true)),150);
// General coordinator contract UNCOMPILED/UNTESTED
interface FilterCoordinator {
 enqueue(delta:Partial<Filter>):Promise<AppliedRevision>;
 idle():Promise<AppliedRevision>; reconcileExternal(filter:Filter,revision:string):void;
}
~~~

**Steps:**capture first; desiredFilter independent of snapshot; merge pending deltas against external accepted revision; return same active drain Promise to all callers; error resolves/rejects waiters and offers retry without infinite slider protection. Selection adds/removes/toggles/edits FIFO, never coalesce. **Audit source risks, not reproduced failures:**spread snapshot.filter can clobber external writer; second timeWindow during drain returns already-resolved Promise; errors leave appliedVersion behind. Mandatory proposed tests filter_external_race,drain_join_await,retry_after_error,playback/search/entity/exact-time/capture_barrier. Capture waits mutation/refresh/assets. Run NODE-INTENT/UI-GATES. **Goal:**0lost final inputs across30deterministic bursts/control,no accepted mutation lost. **Deps:**C01/C02,C06 before general claim. **Fallback:**FIFO all filters,not shorter debounce. Playback shares range path by source; dedicated native playback validation absent.

## C04 — Reuse prepared insertion SQL (VALIDATED-NARROW)

**Source:** [DataStore::insert575–627](ai-20261014/SOURCE_ANCHORS.md#s6). BEFORE Connection.execute prepares lookup/canonical/FTS/RTree per event; EAV already cached. AFTER prepare_cached exact same SQL/binds:

~~~rust
// BEFORE self.connection.execute(SQL, params![...]); AFTER pattern
self.connection.prepare_cached(SQL).map_err(err)?.execute(params![/* identical bindings */]).map_err(err)?;
self.connection.prepare_cached("SELECT r FROM events WHERE id=?").map_err(err)?
 .query_row([e.id.to_string()],|r|r.get::<_,i64>(0)).ok(); // tested lookup behavior unchanged
~~~

[Complete patch including all18bindings](ai-20261014/patches/engine-prepared.patch),SHA256 **6516435ea81efd57a253ddfb4994e3fcec3c164d2abcc382fd373a8034aa9c12**. Keep validation/payload/replacement/EAV trimmed sort/search/RTree; no schema/PRAGMA change. **Steps:**cache lookup/canonical/search/spatial,scope handles before checkpoint,keep errors. RUST-GATES+ENGINE-BENCH100k/1m; verify canonical/attrs/highIDs/copy/save/reopen/privacy. **Measured:**intended ingest/copy above,not unrelated save/open fluctuation. **Goals:**≥10%ingest median both scales,no correctness loss or>5%peakRSS/disk regression. **Deps:**C02. **Rollback:**uncached statements,never durability trade.

## C05 — Exact SQL endpoints/canonical predicates (VALIDATED-NARROW)

**Source:** [time_bounds683/where_sql762–920](ai-20261014/SOURCE_ANCHORS.md#s7). BEFORE combined MIN/MAX scan,wrapped column functions; AFTER:

~~~sql
-- BEFORE
SELECT coalesce(min(time),0),coalesce(max(t_end),0) FROM events;
-- AFTER tested, existing independent indexes
SELECT coalesce((SELECT min(time) FROM events),0),coalesce((SELECT max(t_end) FROM events),0);
-- canonical nonnull TEXT only: e.category = ?
-- canonical finite REAL RHS: e.value > ?
-- missing NotEquals: (e.value IS NULL OR e.value <> ?)
~~~

[Exact indexed patch](ai-20261014/patches/engine-indexed.patch),SHA256 **d215adada739cd345487b3a1105b0d78e504e42f932556b70bdf8c29626485fd**. Whitelist entity/category/source/id Equals/NotEquals and finite numeric value/lat/lon; bind external values,never interpolate external field/operator. Preserve hi=max(lo+1),missing and padded id_key comparisons,no Float IDs. Contains/IsEmpty/invalid/nonfinite RHS/attrs retain domain functions. attributes.num trims text, **not valid** for untrimmed numeric predicate. Do not duplicate existing indexes.

**Steps:**endpoint change,canonical safe paths,exact domain oracle/plan then performance. RUST-GATES+ENGINE-BENCH. Oracle8fields×6ops×9RHS covers Unicode/missing/whitespace/high IDs,excludes C24 defects. Add empty/single/interval endpoints. **Goal:**≥20%intended sorted median,exact results; current sorted plan still time-index+temp-order. Later nonempty attribute Equals→indexed EXISTS /NotEquals→NOT EXISTS is **UNCOMPILED/UNTESTED**,missing!=nonempty preserved,empty RHS legacy; benchmark actual existing key/text index. C24 atomic binds first. **Deps:**C01. **Fallback:**old functions per unsupported case;no whole-query endpoint multiplier.

## C06 — Coherent snapshot, staged refresh, every-await guard (UNTESTED)

**Sources:** [main.ts142–209](ai-20261014/SOURCE_ANCHORS.md#s5),[engine.rs637–704/863–935](ai-20261014/SOURCE_ANCHORS.md#s8),[schema.rs342–363](ai-20261014/SOURCE_ANCHORS.md#s9). BEFORE snapshot→inspector/table→packet→terrain→selection separate calls; guards only after initial snapshot/packet, not every continuation; torn revision/stale DOM possible. AFTER proposed typed API:

~~~ts
interface ViewStamp {store_id:string;revision:string;data_revision:string;selection_revision:string;
 filter_signature:string;dictionary_version:string|null;scene_generation:string;
 section_signatures:Partial<Record<ViewSection,string>>}
type ViewSection='header'|'catalog'|'histogram'|'selected_histogram'|'stats'|'selection'|'render'|'page';
interface ViewRequestV1 {version:1;scene_generation:string;sections:ViewSection[];since?:ViewStamp;
 render?:{max_points:number;bounds?:[number,number,number,number];selected_only:boolean};
 page?:{kind:'query'|'attribute_table';source?:string;apply_filter:boolean;offset:number;limit:number;sort_by:string;descending:boolean;fields:string[]};selection_ids?:string[]}
// ViewResultV1 = {version:1,stamp,unchanged:ViewSection[], optional requested typed sections}.
async function refreshScene():Promise<void>{
 const generation=++serial;const model=await readCoherentView();if(generation!==serial)return;
 const panels=await loadPanelModels(model);if(generation!==serial)return;
 const candidate=await buildSceneCandidate(model);if(generation!==serial){candidate.dispose();return;}
 commitTogether(model,panels,candidate); // no DOM mutations inside awaited model helpers
}
~~~

**Steps:**first add after-every-await guards to inspector/table/setData/rebuildTerrain/selection_contains including helper-internal writes. Interim snapshot+packet compare revision, bounded≤2retry then coalesced followup, no busy retry. Preferred Engine::view_snapshot_v1 acquires gate/state once, extracts locked helpers, never recursively invokes engine. Return same-state requested sections, store identity and existing query_stamp counters (do not duplicate counters). Header broad revision; render signature includes effective filter,budget,bounds,selected reserve,dictionary; selected_only makes selection a data dependency. Section unchanged only when actual dependency signature matches, never across store replacement. Selection membership aligns to exact requested ID hash/bitset, not bounded snapshot list. Caps:≤8unique sections,selection IDs≤100k,page≤1000/512fields,render100..100000,generation≤64chars;reject unknowns.

Register internal schema command separately: current OnceLock validator initialization iterates COMMANDS; add INTERNAL_COMMANDS to initialization without exposing new endpoint through MCP advertised COMMANDS. **Existing schema OnceLock already caches compilation; do not add another cache.** Old commands unchanged. **Tests proposed:** ai_view_contracts view_result_is_one_store_and_revision,unchanged_dependency_keys,internal_command_not_mcp; frontend coherent-refresh-qa.mjs deferred old selection/terrain/table/inspector,external mutation/store replacement,endless edits bounded retry,capture barrier. Commands PROPOSED-GATES. **Goal:**zero torn response/stale publication,render only accepted generation;≥15%relevant refresh p95 if performance claimed. **Deps:**C03. **Rollback:**old calls with revision checks and strict guards. Patch SHA:null,new endpoint not implemented.

## C07 — Lazy sections, dependency caches, projected UI pages (UNTESTED)

**Sources:** [summary1314–1403](ai-20261014/SOURCE_ANCHORS.md#s10),[projected_page348–419](ai-20261014/SOURCE_ANCHORS.md#s11),[table394–451/inspector472–495](ai-20261014/SOURCE_ANCHORS.md#s12). BEFORE compact discards histograms after full summary; selection invalidates too much; normal table already **50rows**,not100k DOM. AFTER proposed:

~~~rust
struct SummarySections {counts:bool,catalog:bool,histogram:bool,selected_histogram:bool,stats:bool}
fn summary_parts(&self,f:&Filter,sections:SummarySections)->Result<SummaryParts,String>;
// legacy summary assembles ALL parts, same exact median/Welford/histogram semantics.
struct DatasetKey {store_id:String,data_revision:u64}
struct FilterKey {dataset:DatasetKey,filter_signature:String,selection_revision:Option<u64>}
// selection_revision only for selected_only; selected histogram always includes selection.
~~~

**Steps:**split header/catalog/filter counts/histograms/stats,cache≤4entries/8MiB combined; layer total global but visible/enabled filter-dependent,never data-only cache. Header/selection-only avoids numeric sort/scan; preserve exact median/stddev/no approximation. Do not ship rejected lazy compact/full cache split R0. Panel requests only open/dirty sections; absence≠zero. Normal table requests id,time,entity,category,lat,lon,value,label; coordinate_formats only UTM/MGRS when requested,retain mgrs_precision. Engine events projection uses scalar projected_page without decoding full attrs,full inspector unchanged. Attribute schema discovery keyed store/data/source;50rows×explicit32column window,all source columns (including 512-column input) remain accessible; consume flat attribute:key fields,not e.attrs. Exact per-page selection_contains,not selected.includes on limited summary.

**Tests proposed:**ai_view_contracts section_results_equal_legacy_summary,header_zero_numeric_scans,selection_only_stats_reuse,equal_times_valid_bin,events_projection_no_unrequested_payload;ai-table-qa.mjs wide512/access-last-column/null/missing/Unicode/highID/MGRS/selectedID outside20k. Test-only QueryTrace verifies zero unintended numeric sorts/conversions. PROPOSED-GATES+UI-GATES. **Goals:**≥15%relevant refresh/projection p95,compact+next-full total≤5%regression;bytes/alloc/PSS reported,none measured. **Deps:**C06;fallback legacy summary/full table per section. Patch SHA:null.

## C08 — Immutable terrain setter no-op (VALIDATED-NARROW)

**Source:** [setTerrain787–791](ai-20261014/SOURCE_ANCHORS.md#s13). BEFORE same terrain object triggers complete100k rebuild. AFTER tested:

~~~ts
async setTerrain(terrain:Terrain|null){await this.ready;
 if(this.terrain===terrain)return; // inserted tested guard
 this.terrain=terrain;this.rebuild();}
// Production ownership extension UNCOMPILED/UNTESTED:
interface TerrainSnapshot {readonly key:string;readonly catalogRevision:string;readonly mesh:Terrain}
~~~

[Guard patch](ai-20261014/patches/render-terrain-guard.patch),SHA256 **1cc3eab8cf6d14a8460d2e12836904c3536c719d62d12b6f458e8ebcfd8082fb**.3native paired repeats6same-object calls each:baseline7rebuilds including initial,variant1;all18variant calls0ms **below1ms resolution**,not infinite speedup. Baseline repeat medians354/421/329ms,p95 392/510/333. Orbit p95 unchanged86/87/86;no FPS claim. New object/null invalidates in source-extracted test. Backend requery normally returns fresh objects: **not cache hits**. Steps guard first;explicit immutable/version owner in C06/C09 before promising user benefit;invalidate source/bounds/resolution/mode/elevation changes,never mutate shared mesh in place. NODE-TERRAIN+UI-GATES;proposed immutability/version invalidation tests. **Goal:**0redundant rebuild for same immutable snapshot,exact counts/surface/picks. **Deps:**guard independent;production reuse C06/C09. **Rollback:**full rebuild on uncertain ownership;no deep-freeze enforcement proved.

## C09 — Retained dirty groups and explicit shared ownership (UNTESTED)

**Sources:** [view.ts502–721](ai-20261014/SOURCE_ANCHORS.md#s14),setRasters896–1009;main.ts terrain844–877/time-height1314–1318. BEFORE root disposal recreates static terrain/map/axes/event buffers;orbit already retained—do not claim missing orbit caching. AFTER proposed:

~~~ts
enum Dirty {None=0,Frame=1,Terrain=2,Imagery=4,Events=8,TimeAxes=16,Selection=32,Materials=64,Picking=128}
interface SceneInput {packet:Packed;snapshot:Snapshot;frame:Frame;terrain:TerrainSnapshot|null;
 rasterKey:string|null;theme:Theme;mode:Mode;timeHeight:number;selected:readonly string[];intentVersion:number}
interface SceneOwner {update(input:SceneInput):Promise<AppliedReceipt>;invalidate(bits:Dirty):void;
 flushScene(generation:number):Promise<AppliedReceipt>;dispose():void}
// groups: terrain,imagery,events,stems,trails,selection,axes. Build replacements before swapping.
~~~

**Dirty routing:**camera/focus redraw+screen-pick invalidation only;packet/filter same frame→events/stems/trails/selection/pick;frame/mode→all dependent topology;terrain/exaggeration→surface+ground bases/stems/pick+mapping,retain decoded tiles;timeHeight→temporal marker Y/stem/trail/axes/pick,not static terrain;theme→materials/background/labels,not positions;selection→highlight only. Map mode time-height unchanged. One scheduled rAF flush merges immutable newest input,checks generation after all awaits. Packet signature includes selected reserve/effective time/filter,not broad revision alone.

Atlas owned once by bounded imagery cache≤4atlases/64MiB decoded estimate;materials borrow,never dispose shared map. Resource keys include mode/projection/bounds/catalog/content/auth-scope opaque fingerprint,style/time/matrix/tile identity,not credentials. Late image success/error discarded when key/generation stale;candidate disposed exactly once. Keep CPU immutable atlas/source bytes across WebGPU→WebGL recreation. **Tests proposed:**scene-transaction-qa.mjs counters/UUIDs on100camera/selection/theme cycles;bounds/exaggeration/voids/timeHeight/all4modes;late raster after unload/auth switch;fallback;dispose once. UI-GATES+native matched20k/full100k. **Goals:**≥15%changed-data rebuild p95,0static allocations on unrelated changes,orbit≤5%regression. **Deps:**C06/C07;fallback full rebuild(reason) for unknown dependency,never stale surface. Patch SHA:null;C23 scaffold not broad proof.

## C10 — Selection identity and highlight capacity (UNTESTED)

**Source:** [setSelection722–755](ai-20261014/SOURCE_ANCHORS.md#s15),main195–199. BEFORE O(n)filter+dispose/recreate every refresh even same IDs. AFTER proposed:

~~~ts
private selected=new Set<string>();private selectionGeometryGeneration=-1;
private displayedById=new Map<string,number>();private selectionCapacity=0;
setSelection(ids:readonly string[],geometryGeneration=this.generation):void;
// Compare deduped membership+geometryGeneration; identical→no allocation/draw.
// Map exact IDs to active source slots; ensureCapacity(pow2ceil(count)), active count separate.
~~~

**Steps:**rebuild ID map once/event geometry;reuse existing10×8wireframe sphere/material;grow only,update active matrix ranges;zero hides object (no zero-sized GPU binding);same IDs/new geometry recompute positions;theme edits material only. Undisplayed selected IDs remain exact backend selected_count/selection_limited,not drawn-count surrogate. **Tests proposed:**selection-capacity-qa.mjs reordered/dedup/noop/grow/shrink/zero/highu64/selected reserve/selected_only/terrain/globe/theme/fallback/late selection response. Native selectedAll100k is required **not previously measured**. **Goal:**noop0allocation,relevant event CPU/p95≥15%lower,no count/pick drift;no unselected-orbit FPS claim. **Deps:**C06/C09;fallback current setSelection. Patch SHA:null.

## C11 — Validate packets; optional native raw ArrayBuffer (UNTESTED)

**Sources:** [types.ts58–115](ai-20261014/SOURCE_ANCHORS.md#s16),[bridge11–30](ai-20261014/SOURCE_ANCHORS.md#s17),[Tauri dispatch8–18](ai-20261014/SOURCE_ANCHORS.md#s18). BEFORE base64→atob→Uint8Array.from callback→Point[];shape errors late. Native100k once decode135/137ms,not isolated callback proof. AFTER proposed:

~~~ts
function checkedBytes(p:Packed):Uint8Array {
 const raw=atob(p.data),expected=p.ids.length*32;
 if(p.stride!==32||raw.length!==expected||p.rendered_count!==p.ids.length)throw Error('Invalid render packet');
 const bytes=new Uint8Array(expected);for(let i=0;i<expected;i++)bytes[i]=raw.charCodeAt(i);return bytes;
}
// DataView little-endian lon@0 f64,lat@8 f64,time@16 f64,entity@24 u32,value@28 f32.
// optional native invoke<ArrayBuffer>('view_packet_v1',{request})
~~~

**Steps:**validate decimal string unique IDs/entity index/finite GIS-time/value/byte lengths before view change;preserve prior valid view on error;benchmark copy loop instead of assuming faster. Optional native endpoint returns tauri::ipc::Response::new(Vec<u8>) from ONE C06 snapshot. Locked Tauri2.12.3 raw API exists,actual platform runtime/speed **untested**,not zero-copy. Frame LE:ASCII CSP1,meta_len u32@4,payload_len@8,reserved0@12,strictUTF8 JSON@16,zero-pad8alignment,32byte rows. Caps frame16MiB,metadata8MiB,raw3.2MiB;validate arithmetic overflow/offset/alignment/magic/version/length/dictionary/count before access. Metadata same coherent revision,not second invoke.

Keep legacy JSON/base64 CLI/MCP/browser path;100k raw3,200,000bytes→base64 4,266,668 **already>4MiB** before dictionary/envelope. MCP4MiB/job4MiB+8MiB aggregate stay;job_start render_data currently not allowed. Fallback only unsupported version/API,**not corrupted frame**. **Tests proposed:**ai-packet-qa.mjs zero/100/20k/100k/golden endian/highIDs/negative epochs/malformed base64/NaN/overflow/length/entity/native ArrayBuffer/browser parity/MCP explicit RESOURCE_LIMIT. PROPOSED-GATES+native runtime gate. **Goal:**≥15%IPC+decode p95 with exact bytes/counts,no>5%end-to-end/PSSregression. **Deps:**C06;C22 stage spans before speed claim;fallback JSON. Patch SHA:null.

## C12 — Immutable columns/local GPU attributes (UNTESTED)

**Sources:** [view.ts238–313](ai-20261014/SOURCE_ANCHORS.md#s19),617–680;types58–115;engine863–934. BEFORE100k Point objects+64byte matrices+RGB coexist with packet. AFTER proposed:

~~~ts
interface SceneColumns {ids:readonly string[];entities:readonly string[];lon:Float64Array;lat:Float64Array;
 epochSeconds:Float64Array;entity:Uint32Array;value:Float32Array;revision:string}
interface LocalGeometry {originMercator:[number,number];timeOriginSeconds:number;xy:Float32Array;
 ground:Float32Array;fraction:Float32Array;sourceIndex:Uint32Array;palette:Uint8Array;activeCount:number}
function decodeColumns(packet:Packed):SceneColumns;
function buildLocalGeometry(cols:SceneColumns,frame:Frame,terrain:Terrain|null,mode:Mode):LocalGeometry;
async function setColumns(cols:SceneColumns,state:SceneState):Promise<UpdateReceipt>;
~~~

**Steps:**one immutable master ArrayBuffer/DataView or stride-aware SoA decode,never reinterpret strided AoS as contiguous lon array. Keep globalGIS/epoch inFloat64,string IDs;subtract double Mercator/time origins **before**Float32local upload. First space-time adapter only;fraction=(epoch-lo)/(hi-lo)double→Float32normalized,never absolute epoch float. GPU marker shared primitive+local translation,stems ground/event endpoint bit;trails retain entity/time/ID adjacency/dateline exclusions. Keep globe/calendar existingCPU path initially. Bounds include all endpoints;capacity grow/shrink.activeCount separate. Master packet never transferred away while main reads;worker uses dedicated scratch and generation gate. LocalGPUshader/TSL/WebGLfallback bounding math needs real tests;finite f64→f32overflow explicit error/scaling-policy decision,never silent clamp.

**Tests proposed:**compact-scene-qa.mjs independent GIS reference equator/60°/poles/dateline,terrain holes/exaggeration,highu64,negative epochs/minute boundaries,selected reserve/dictionary reorder,timeHeight no terrain upload,device loss,zero capacity,stale worker/no detached master,same marker silhouette/colors/trails. RUST+UI/native20k/full100k gates. **Goal:**≥15%decode+geometry p95/peaklive-byte reduction,no GIS/pick/count error,orbit≤5%regression;no measured result yet. **Deps:**C06/C09/C11;fallback Point[]adapter+existing InstancedMesh,migrate one consumer/commit. Patch SHA:null.

## C13 — Typed job progress and irreversible commit receipts (UNTESTED)

**Sources:** [jobs14–147](ai-20261014/SOURCE_ANCHORS.md#s20),[operation1–58](ai-20261014/SOURCE_ANCHORS.md#s21),engine446–449/1081–1125/1388–1440/1499–1541. BEFORE freeform progress/thread-per-job,post-invoke cancellation can label already-renamed save/export cancelled. Source risk,not runtime-reproduced. AFTER proposed:

~~~rust
enum Phase {Queued,Validating,Reading,Converting,Indexing,Staging,Committing,Completed,Cancelled,Failed}
struct ProgressEvent {phase:Phase,completed:u64,total:Option<u64>,unit:Unit,sequence:u64}
struct CommitReceipt {operation_id:String,kind:String,store_id:String,revision_before:u64,
 revision_after:u64,committed:bool,cancel_requested:bool,output_sha256:Option<String>}
enum Outcome {Read(Value),WorkspaceCommit{value:Value,receipt:CommitReceipt},ExternalCommit{value:Value,receipt:CommitReceipt}}
~~~

**Steps:**explicit final cancellation check before workspace swap/file rename;after irreversible commit never convert success→CANCELLED,return committed receipt+late cancel flag. Stage metadata/store/terrain,ticket consumed only after success. Registry stores compact≤4KiBreceipt independently of oversized payload;keep result4MiB/job/8MiBtotal and16active/64retained. Scope+operation tombstones≤128/512KiB,receipts≤256KiB aggregate;late worker cannot recreate released handle/second commit. Session-local,not crash-durable. UI long action uses existing allowed job_start,typed progress,≥250msbackoff status,terminal receipt before saying cancelled,releases handle. No new commands implicitly allowed.

**Tests proposed:**ai_jobs cancel_before_swap_retains_ticket_workspace_terrain,cancel_after_rename_reports_committed,oversized_result_keeps_receipt,idempotency_same_receipt,release_late_worker_no_resurrection. Deterministic barriers not sleeps;existing bundled job test proves status0.0216ms/cancel0.0151ms under held gate,not actor gain.0.4096msstate queue sample released immediately,not long-job latency. **Goal:**unambiguous terminal commit/no partial files,no receipt loss;no throughput claim. **Deps:**C01/C02;fallback sync execution+receipt first. Patch SHA:null.

## C14 — One bounded typed writer, not more waiting threads (UNTESTED)

**Sources:** [engine76–87/341–379](ai-20261014/SOURCE_ANCHORS.md#s22),jobs28–91,Tauri15. BEFORE up to16job threads wait shared operation mutex,queue wait invisible;replacing Mutex with RwLock is wrong for Connection/RefCell/TEMP caches. AFTER proposed:

~~~rust
struct RequestContext {operation_id:String,scope:Option<PathBuf>,cancel:Arc<AtomicBool>,
 progress:Arc<dyn Fn(ProgressEvent)+Send+Sync>}
enum WriteCommand {Filter(Filter),Select{ids:Vec<String>,mode:SelectionMode},Edit(Edit),Batch(Batch),
 InstallStaged(StagedInstall),Undo,Redo,Save(SaveRequest)}
struct WriterRequest {command:WriteCommand,controls:MutationControls,context:RequestContext,
 reply:std::sync::mpsc::SyncSender<Result<Outcome,String>>}
// sync_channel::<WriterRequest>(16); one named writer owns State/writable Connection.
~~~

**Steps:**typed parse adapters first,writer lifecycle second,individual mutation families third,staged install fourth. Engine::invoke stays sync adapter,Tauri spawn_blocking waits;job enqueue no thread/job. try_send full→RESOURCE_LIMIT before side effect;FIFO admitted writes,CAS/idempotency/dry-run at dequeue within transaction;cancel admission/dequeue,operation::with_context preserves scope/TLS. Status/cancel/result/capture-response bypass queue. Never hold registry/state while waiting/callback;shutdown resolves all waiters. Keep original gate for reads until C15,do not delete it prematurely. **Tests proposed:**ai_writer fifo_capacity17,cancel_queued_no_revision,concurrent_retry_one_commit,batch_dryrun_oneundo,panic_shutdown_resolves. **Goal:**bounded16admission,no deadlock,queue wait/max reported,writer throughput≤5%regression,not achieved. **Deps:**C06/C13;fallback original writer/gate behind feature flag. Patch SHA:null.

## C15 — Two revision-pinned readonly connection owners (UNTESTED)

**Sources:** [store110–225](ai-20261014/SOURCE_ANCHORS.md#s23),selection707/ordered920–1008/query_stamp1047–1056. BEFORE single connection owns TEMP selection/order/render_positions and mutable caches;WAL exists but global gate serializes. AFTER proposed:

~~~rust
struct ReadManifest {store:Arc<StoreLease>,project:Arc<Project>,preferences:Arc<Preferences>,
 revision:u64,data_revision:u64,selection_revision:u64}
struct ReadHandle {connection:rusqlite::Connection,orders:OrderLru,summary:SummaryLru,
 selection_revision:u64,store_id:String}
// EXACTLY TWO reader threads/handles; writer publishes manifest after commit.
~~~

**Steps:**persist working meta commit stamp atomically with writer changes;open READ_ONLY|NO_MUTEX per owner,BEGIN DEFERRED and first persistent read pins WAL snapshot;compare persisted store/revision to manifest in same SQL snapshot,max3retries thenCONFLICT. Never immutable=1 for changing WAL;not query_only=ON if own TEMP writes required. Register same functions/limits/progress without mutating persistent main PRAGMAs. TEMP selection/order per reader,≤4order entries,16MiBpage cache/handle,global TEMP byte/disk budgets. Cursor retains store+query_stamp+filter/order signature. Pin StoreLease directory until last reader ends across open/undo/replacement. Interactive lease≤5s,long analysis20sboundedchunks/explicit continuation;WAL growth/backpressure/checkpoint busy policy,no TRUNCATE while pinned. Cancel only own connection,not writer. Saved portable file excludes transient caches/stamps/tokens.

**Tests proposed:**ai_snapshots rows_metadata_one_commit,readonly_main_temp_allowed,selection_highID_concurrent,pinned_old_store_survives_replace,cancel_reader_writer_unaffected,WAL_growth_timeout.100deterministic races,exact evidence/counts. **Goal:**header warmed p95<250ms during writer phase,writer≤5%regression,bounded memory/WAL,no torn snapshots. **Deps:**C07/C14;fallback serialized reads. Patch SHA:null;no measured concurrency improvement.

## C16 — Durable staged save/export and unchanged open validation (UNTESTED)

**Sources:** [save_as1065–1120](ai-20261014/SOURCE_ANCHORS.md#s24),[open_copy236/verify_events436](ai-20261014/SOURCE_ANCHORS.md#s25),engine1388–1440/export1499–1541,project268. BEFORE save mutates working resources/meta,backup then privacy compact/sync/persist;postcheck can mislabel late cancel. AFTER proposed:

~~~rust
enum SavePhase {PrepareResources,BackupPages,RemoveHistory,CompactSearch,Vacuum,Sync,Rename,Committed}
struct SaveProgress {phase:SavePhase,pages_remaining:i32,page_count:i32}
fn prepare_portable(&self,metadata:&Project,path:&Path,ctx:&OperationContext)->Result<PreparedSave,String>;
fn commit(prepared:PreparedSave)->Result<CommittedSave,String>;
// PreparedSave owns isolated destination; only commit owns atomic rename and committed receipt.
~~~

**Steps:**backup validated readonly pinned source to isolated destination,stage resources/meta on destination not live DB;Backup::step(1024),progress/cancel between pages,BUSY/LOCKED deadline with condition wait. Preserve secure_delete,history deletion,FTS optimize,VACUUM;no deleted/history/token/private path data in exported bytes. File sync_all,cancel once pre-rename,atomic persist,sync parent directory where supported;after rename committed=true even if notification fails. CSV/JSON export iterator Result<Event,String> end-to-end:decode error prevents persist,never filter_map away corrupt rows. Open retains quick_check/hardened schema/root/type/resource caps and **full canonical verification**,reject malicious triggers/views/tamper/checksum errors;do not bypass O(n)validation for speed.

Profiler phase numbers are aggregate Rust+SQL wall, not Btree CPU fractions; raw phase spans are not bundled here, so they do not support a standalone optimization claim. One profiler aggregates 200k inserts (100k ingest plus 100k copy) and two opens, not one import. Preserve validation/privacy work and instrument a matched save/open case before targeting it. **Tests proposed:**ai_persistence cancel_before_rename_old_bytes,cancel_after_rename_committed,deleted_payload_absent,export_decode_error_no_replace,trigger_view_reject,canonical_tamper,resource_checksum. RUST-GATES existing privacy/highID portable tests. **Goal:**zero partial/false-cancel/privacy regression,phase progress/cancel bounded;no weakening for a numeric target. **Deps:**C13;C15 optional read lease. **Fallback:**current persistence+explicit commit disclosure,never skip scrub/verify. Patch SHA:null.

## C17 — Clone current store BEFORE append ingestion (UNTESTED)

**Sources:** [engine1081–1125](ai-20261014/SOURCE_ANCHORS.md#s26),[copy_into1121](ai-20261014/SOURCE_ANCHORS.md#s27). BEFORE appends new rows into stage THEN copy_into old decoded events. Empty-target SQLite backup prototype cannot replace this nonempty target. AFTER proposed:

~~~rust
fn clone_current_for_append(&self,ctx:&OperationContext)->Result<StagedStore,String>;
// stage=clone_current_for_append(); assert source store validated and target empty initially.
// pending.ingest(...,&stage,max_id.checked_add(1)?); old+new source count budgets checked.
// review/cancel before single install; old store retained for undo; ticket consumed last.
~~~

[Rejected direct backup patch](ai-20261014/patches/engine-backup.patch),SHA256 **60d4c1fd3240ea1d8874d8b941e880e429ba324181508893c16425fd60bdc09e**. Copy-only median10.313181→0.784156s92.40% for empty destination,NOT append throughput. **Steps:**clone-before-ingest reorder,connection/TEMP selection initialization,store revision/cache invalidation,review/cancel/no-swap,undo/redo,then optimize copy primitive. Backup may copy history/freelist in working stage;portable export C16 must scrub. New input still full validation,old validated source trust bounded by lease;canonical/attrs/FTS/RTree exact. **Tests proposed:**append100k_plus1k_exact_provenance,rejected_review_no_swap,cancel_partial_clone_no_swap,append_undo_redo,temp_selection_consistency,oldnew_count_budget. **Goal:**measure end-to-end append not copy,≥15%median if claimed,no correctness/durability loss. **Deps:**C01/C02/C13/C16. **Fallback:**old decoded copy_into,no live patch substitution.

## C18 — Compact analysis rows, explicit budgets, limited full streaming (UNTESTED)

**Sources:** [analysis69–228](ai-20261014/SOURCE_ANCHORS.md#s28),engine1138–1168/storecompact_page421. BEFORE every pattern allocates tracks;proximity allocates unused parents;compact Event still allocates strings/tags before cap. AFTER proposed:

~~~rust
struct AnalysisRow {id:u64,time:i64,end:Option<i64>,lat:Option<f64>,lon:Option<f64>,entity_index:u32}
struct AnalysisBudget {max_input:usize,max_comparisons:u64,max_findings:usize,max_evidence_ids:usize}
fn run_rows(rows:&[AnalysisRow],entities:&[String],pattern:Pattern,p:&Parameters,b:AnalysisBudget)->AnalysisReport;
// Report retains count/limited/findings, adds actual evaluated/comparison/evidence counters + stopped_reason.
~~~

**Steps:**tracks only Gaps|Speed|Stationary;union-find parents only Clusters;DataStore::analysis_page projects typed rows,no attrs/label/note/tags/source. Keep WGS84 geodesics,ECEF candidate safety/transitive clustering/exact deterministic evidence/order;current5mcomparisons/10kfindings budgets retained,partial never exhaustive. Optional full_stream only Gaps+Speed after C15:entity,time,id_key order,page carry previous interval event per entity,exact selected_only;finding10kstop reports evaluated<input and input_limited. Unsupported full_stream patterns reject explicitly,not silently prefix. Default bounded200k/override1m unchanged,label evaluatedXofY in UI.

**Tests proposed:**ai_analysis all_patterns_old_oracle,dense100k_proximity_budget,dateline_poles_same_entity,transitive_budget,highID_selected100k;full_stream page sizes1/7/1000 equal small uncapped oracle,200001last-row finding,10001findingstop explicit,concurrent edit pinned/cancel. **Goal:**bounded memory by page+findings for1m stream,exact IDs/metric/order;≥15%relevant alloc/p95 only if demonstrated. Dense100k analysis **not run**. **Deps:**C01;C15 for stream. **Fallback:**existing bounded Event path with explicit limits. Patch SHA:null.

## C19 — Exact terrain mesh LRU and row cancellation (UNTESTED)

**Sources:** [TerrainCatalog148/sample247/mesh304](ai-20261014/SOURCE_ANCHORS.md#s29),engine1698. BEFORE decoded tile cache4 exists,each mesh up to257²samples under terrain mutex,no mesh result cache. AFTER proposed:

~~~rust
#[derive(Eq,PartialEq,Hash)]
struct MeshKey {catalog_revision:u64,bounds_bits:[u64;4],resolution:usize}
fn mesh_cached(&mut self,key:MeshKey,ctx:&OperationContext)->Result<Arc<TerrainMesh>,String>;
// <=2 entries /16MiB combined, row-level operation::check/progress, unchanged exact sampling.
~~~

**Steps:**catalog generation/file metadata/checksum invalidation;key exact bounds bits/resolution/projection,catalog ownership pinned;exaggeration frontend not key unless output changes. Preserve void holes/DTED registration/below-sea-level/triangle sampler/no resolution drop. Start memoization under terrain lock;later bounded terrain worker outside workspace gate uses immutable request,C21 generation rules. **Tests proposed:**ai_terrain exact_void_mesh_cache,reload_invalidates,cancel_each_row,257_grid_reference,terrain_unload_race;real129×129DTED native+selectedAll100k mandatory **not measured**. **Goal:**cache hit0resampling,bounded16MiB,no exact-value/void change,cancel cooperatively each row. **Deps:**C01,C13 for worker;fallback current sampler. Patch SHA:null.

## C20 — View lifecycle disposal (UNTESTED)

**Sources:** [initialize109–163/fallback175–215](ai-20261014/SOURCE_ANCHORS.md#s30),draw1169–1178/raster896–1009. BEFORE singleton has disposed bool but ResizeObserver not retained/full dispose absent;not proof of leak. AFTER proposed:

~~~ts
private resizeObserver:ResizeObserver;private renderFrame:number|null=null;
private canvasAbort=new AbortController();private ownedTextures=new Set<Texture>();
dispose():void; // set disposed, generation++,terrainGeneration++,cancel rAF,disconnect observer,
// controls.dispose,abort listeners,remove owned DOM,clear owned groups/textures once,renderer.dispose.
~~~

**Steps:**retain rAF ID,draw checks disposed||recovering;pending renderer/image promise generation checks dispose candidate;fallback abort old listener scope,recreate new only if live;shared earth/atlas material borrowing C09 ownership prevents double dispose. **Tests proposed:**view-disposal-qa.mjs dispose_before_raf,late_texture_once,repeated_mount_listeners,loss_while_disposed,WebGPU→WebGLsameIDs,100cyclesPSS/geometry plateau after idle. **Goal:**0post-dispose attachments/callbacks,double-dispose0,resource plateau,no claimed leak percentage. **Deps:**C09;fallback singleton unchanged until lifecycle parity. Patch SHA:null.

## C21 — WMTS outside workspace gate, existing security/bounds unchanged (UNTESTED)

**Sources:** [engine1587–1653](ai-20261014/SOURCE_ANCHORS.md#s31),[wmts615–755/803–850](ai-20261014/SOURCE_ANCHORS.md#s32),[native94–143](ai-20261014/SOURCE_ANCHORS.md#s33). BEFORE workspace gate includes throttle/network wait despite separate map mutex.0.5.2 ALREADY has response/native subprocess deadlines and origin/auth scoped cache;do not propose adding missing timeout protections that exist. AFTER proposed:

~~~rust
struct AssetRequest {scene_generation:String,frame_signature:String,catalog_generation:u64,
 auth_scope_hash:String,config:MapConfig,bounds:GeoBounds,resolution:usize}
struct AssetResult<T> {request_key:String,value:T}
// Capture immutable request under short metadata lock; one map worker/one terrain worker,
// at most one pending latest request each; no writer/State lock across resource I/O.
~~~

**Steps:**scope/schema/root checks still run;carry operation::with_context;auth mutation writer-owned and invalidates generation. Existing TileService gate1inflight/≥1s spacing/16tiles,429cooldown/noauto-retry,response4MiB,tile4096/atlas2048/cache512MiB,CRS/matrixlimits/native helper deadline preserved. Use cancellation-token condition wait for throttle/cooldown,retain reserved scheduler slot/deadline,no bypass or provider parallelism. Publish only when full key still current incl auth/mapenable/mode,both success/error;stale correctly scoped cache may remain,but cannot poison lastRaster/mapUnavailable. Native PIN/private keys never request/log/project;Linux explicit PKCS#11/macOSWindows automatic selection unchanged.

**Tests proposed:**ai_assets local delayedHTTP2s revision_responsive,429retry_after300_cancel_requests1,authA_late_afterB_no_display,miss_dedupe_origin_scope,1s_spacing,size_dim_reject,terrain_unload_pin. No public WMTS/network benchmark. **Goal:**cooperative cancel<250ms,state/status<50ms under2s localdelay,no auth/rate/bounds regression;unmeasured. **Deps:**C09/C13/C14;fallback old serialized calls with frontend generation guards. Patch SHA:null.

## C22 — Trace native stages, diagnose startup, expose quality/budget explicitly (UNTESTED product changes)

**Sources:** [Tauri59–120](ai-20261014/SOURCE_ANCHORS.md#s34),main142–209/1536–1548/1601,view109–198/1149–1178,schema163. BEFORE queue timing starts after gate,packet wall/decode/build not full pipeline;physical original blank unresolved;refresh hardcodes20k. AFTER proposed:

~~~ts
interface TraceSpan {traceId:string;span:'queued'|'gate-enter'|'query-done'|'pack-done'|'dispatch-result'|
 'ipc-response'|'decode-start'|'decode-end'|'build-end'|'first-submit';instantNs:string;
 counts:{stored:number;located:number;rendered:number;triangles:number;stems:number;trails:number};revision:string}
interface DisplayState {renderBudget:20000|100000;renderMode:'representative'|'full-requested';lodPolicy:'uniform-time'}
interface DisplayQuality {antialias:boolean;renderScale:1|0.75|0.5;stems:'full'|'hidden';diagnosticLabel:string|null}
~~~

**Steps:**compile-gated task traces/no rows/labels/attrs/args/credentials;clock calibration ping RustInstant↔performance.now,no raw same-clock assumption. Trace queue wait before acquisition,hold through drop,pack/transport/atob/copy/objects/build/uploadenqueue/firstmatching-submit. First-submit≠present;GPUtimer optional disjoint checked,firstupload/presentation NULL absent real instrument;never production gl.finish. on_page_load Started/Finished origin-only marks plus DOM/module/error/renderer.ready/snapshot stage instrumentation identify physical blank before stage-specific small fix. No asset polling loop,sandbox disable,config reset,host restart/sudo. Untouched binary functional3launches plus pixels/hardware required to resolve startup,not instrumented-success substitution.

Central renderBudget owner for every observer/manual path,default20kbackward-compatible,explicit full100krequest retained across selection/theme/scene_sync. Corpus>100k still representatives;labels exact located/rendered/budget/limited,no promise all. Scene migration defaults20k/antialiastrue/scale1/fullstems. Quality settings require owner's explicit visual acceptance,restore full quality export/release,CSS-pixel picks unchanged. No automatic reduction disguised as speed.

**Measured DIAGNOSTIC only:**hide stems retains100kmarkers+99980trails:p50 32/32/32 vsfull80/78/78ms;hide trails76/77/77. RequestedMSAAoff baseline p95 86/86/86→43/44/42ms,allcounts/features/canvas same but coverage changes,targetsample count unavailable. Scale1p95 86/88/87→scale.5 39/41/39ms at691×352 vs1382×704;scale.75p95 68/66/65 at1036×528. **QUALITY_CHANGED**,not equivalent optimization or isolated GPU bottleneck proof. [MSAA diagnostic patch](ai-20261014/patches/render-msaa-off-DIAGNOSTIC.patch)SHA256 **b344dec82559f0d7839a3fd51ff88fd89000eff35fc21ad2bd0604fe6d05e12f** must not silently ship. Initial resize-sweep0draw phases rejected;fresh-process retained records authoritative.

**Tests proposed:**trace_order_no_private_keys,first_submit_generation,native_startup_original_release_3_repeats,display-budget-qa.mjs100kdefault20k/explicit100kpersists/>100klimited/fallback/save-migration;stem-qa.mjs dense overlap/occlusion/theme/endpoints visual contract. Offscreen segment culling only if both ground/event extents proven outside viewport and pixels invariant;blend/depth alternatives not assumed equivalent. **Goal:**allstage durations or explicitNULL,0hidden quality/count changes,trace-disabled negligible work;no measured product gain. **Deps:**C06;fallback current default/high-quality rendering. Product patch SHA:null;diagnostic SHA above.

## C23 — Picking cache and retained terrain scaffolds (EXPLORATORY, not broad native proof)

**Sources:** [pick1180–1236](ai-20261014/SOURCE_ANCHORS.md#s35),rebuild502–721/terrain787–895. Two independent commits/experiments,never combine percentages:

~~~ts
// Picking BEFORE this.pos(point)+new Vector3 every bucket rebuild; tested candidate AFTER
private pickWorld=new Float64Array(0);private pickWorldGeneration=-1;private pickScratch=new THREE.Vector3();
// Fill xyz double cache only if geometryGeneration changes; camera only reprojects scratch.
// Retained-terrain scaffold BEFORE root clear destroys mesh; AFTER detach matching immutable
// terrain keyed mode/bounds/theme/exaggeration,clear root,reattach,skip buildTerrain.
~~~

[Picking patch](ai-20261014/patches/render-picking-world-cache.patch)SHA256 **d3f96ca9bb168a82e34d90c4fb6f8c7301720634c057981021ddd68226ab9b41**.Source-extracted Node warm repeat medians66.897/69.957/65.777→57.955/58.065/57.842ms;median66.897→57.955 **13.37%CPU-only**,controlled sameID88127,not native hover/GIS/FPS.2.4MBcache+scratch,initial fill cost;retain9CSSpxradius/.5pxdepthtie/globehemisphere. All geometry-changing paths must invalidate generation.

[Static-terrain patch](ai-20261014/patches/render-static-terrain.patch)SHA256 **836a2b4a3a649ecbdeec8b1a03ee059cb871620f99942663ff937ea7a9aea883** includes C08guard.33×33synthetic same-frame changed-data baseline p95 415/444/356ms→452/354/359;median415→359 **13.49%CPU**,firstpairworse,variable—not steadyorbitFPS or realDTED/atlas ownership proof.3variant repeats retain same mesh,pixels/Radeon/count gates pass. Broad ownership/mode/exaggeration/late-load correctness remains UNTESTED.

**Steps:**picking cache alone then independent random native pick oracle(all modes,dateline/poles/voids/box IDs/timeHeight/exaggeration/filter);retained terrain only after C09 ownership+dirty graph. Proposed picking-gis-qa.mjs and scene-transaction-qa.mjs;NODE-PICK CPU benchmark separate from native. **Goals:**same exact picked/boxIDs,≥10%native firsthoverp95 only if proved;retained topology identity correct and≥15%buildp95 target,not achieved robustly. **Deps:**C09 for retention,C06forstale commits. **Fallback:**current pick/worldprojection/fullterrain rebuild per feature flag.

## C24 — Fix invalid attribute binds; decide signed-zero compatibility separately (UNTESTED fixes)

**Sources:** [where_sql851–916/rust_number185](ai-20261014/SOURCE_ANCHORS.md#s36),[Predicate::matches165–225](ai-20261014/SOURCE_ANCHORS.md#s37). Two independent baseline defects;passing C05oracle deliberately excludes them.

**C24a P0:**BEFORE attribute key bind pushed before invalid Greater/Less RHS becomes constant0=1;SQLexpects0binds,args1→Wrong number of parameters. AFTER proposed atomic predicate builder:

~~~rust
struct PredicateSql {sql:String,binds:Vec<rusqlite::types::Value>}
fn compile_predicate(p:&Predicate)->Result<PredicateSql,String>;
// Parse finite numeric RHS BEFORE attribute expression/key bind;invalid numeric comparison
// returns PredicateSql{sql:"0=1".into(),binds:vec![]};append SQL+binds together only once.
~~~

Implement/commit first;tests proposed ai_predicate_errors invalid_attr_rhs_empty_result over empty/banana/NaN/inf/whitespace plus compound before/after predicates ensure no shifted binds. Normal count0,no metadata reset C01. Do not trim numeric RHS/source texts to shortcut semantics. **Goal:**0SQLbindmismatch,exact domain IDset;depsC01,fallback old expression only with corrected atomic binding. PatchSHA:null.

**C24b compatibility:**BEFORE stored REAL -0 roundtrips+0 but canonical payload/domain lexical Contains -0 retains sign;runtime domain48IDs vsSQL0. AFTER choose explicitly:preserve canonical lexical numeric rendering in dedicated TEXT column(derive payload,versioned portable migration) for Contains/IsEmpty/non-numeric equality while REAL stays numeric;OR formally version domain/API formatting to normalize signedzero everywhere. **Do not silently normalize as performance patch.** Proposed tests ai_signed_zero domain_sql_contains_sign,numeric_signedzero_equality,json_save_reopen_sign,Unicode/missing/rawattrs. Existing independent negativezero repro retained,not claimedfixed. **Goal:**declared versioned lexical equivalence,no accidental schema/data loss;needs compatibility decision before implementation. PatchSHA:null;fallback preserve behavior/report defect,not hidden normalization.

## R0 — Rejected performance recommendations (retain evidence, do not ship claims)

- **Lazy compact/full cache split REJECTED:**compact407.299→332.760ms butnextfull0.062→216.470ms. Sum of medians407.361→549.229ms **34.83%slower** (NOT median of per-run summed observations).C07different dependency cache design remainsUNTESTED. [lazy patch](ai-20261014/patches/engine-lazy.patch)SHA256 **d27ba039e625ec28d7f12c9b6aeaccf7c6036b3e007c744f93f7f8b2fd26e749**.
- **Indexed glyph REJECTED as performance priority:**6vs24positions,same8triangles/winding/RGB;matched native baselinep95 86/87/86→87/87/87ms,median86→87,no improvement. [glyph patch](ai-20261014/patches/render-indexed.patch)SHA256 **4aedd8f67ca8bbf64717394770a77b317c6de09036f96945e5d0bb0ca6cc214b**. Geometry test passes;vertex ratio≠FPS multiplier.
- **Serialization-only REJECTED as speed priority:**100kingest9.826107→9.715554s **1.13%noise-sized**. [serialized patch](ai-20261014/patches/engine-serialized.patch)SHA256 **d9bfad831961bdfd680d7632a7cb072acddf4ed6ba0f52276f3c7fcdb09b5eed** removes ONE ofthreepasses,notall. Future private CheckedEvent{event,payload} immutable transfer/ID-beforecheck/2MiBUTF8budget isUNTESTED;never cache payload across mutable edit. Need phase/allocation proof first.
- **Empty-target backup direct append replacement REJECTED:**C17details;92.40%copyonly unsafe nonemptytarget. No million lazy/serialized/backup data;do not invent absent pairs.

## Portable reproduction: commands vs proposed tests

Run only in NEW isolated frozen worktree,never reset/rebase/cherry-pick main. These are implementer instructions;**consolidation executed no heavy test/GPU/build**. Set absolute DOCS to this documentation checkout before changing directory,ROOT to task-owned output,LOCK to a host-shared lock chosen by benchmark coordinator. Existing locked dependencies required;do not silently install/upgrade.

~~~sh
DOCS="$PWD"
BASE=7400b55220c25da714df93be1157f1ad3b990427
BUNDLE="$DOCS/docs/performance/ai-20261014"
ROOT="$(mktemp -d)"; export ROOT
LOCK="$ROOT/performance.lock" # replace with ONE shared host lock if other heavy workers exist
# Choose an unused path and branch name; do not reuse/reset another worktree.
git worktree add -b ai/perf-correctness-20261014 "$ROOT/source" "$BASE"
cd "$ROOT/source"
git apply --check "$BUNDLE/patches/engine-test-reproducers.patch"
git apply "$BUNDLE/patches/engine-test-reproducers.patch"
# RUST-GATES baseline: EXPECT TWO FAILURES, not successful baseline regression test.
flock -x "$LOCK" cargo test --locked --release -p chronoscope --test ai_engine_regressions -- --nocapture
# Adapt current source in production branch; these frozen experiment steps reproduce exact joint patch.
git apply --check "$BUNDLE/patches/engine-C01-C02.patch"
git apply "$BUNDLE/patches/engine-C01-C02.patch"
flock -x "$LOCK" cargo test --locked --release -p chronoscope --test ai_engine_regressions -- --nocapture
flock -x "$LOCK" cargo test --locked --release -p chronoscope
# ENGINE-BENCH baseline and EACH independent prepared/indexed arm in its OWN new worktree.
# Apply correctness+test patch in each; apply ONLY that arm's application patch, build:
flock -x "$LOCK" cargo build --locked --release -p chronoscope --example ai_engine
flock -x "$LOCK" target/release/examples/ai_engine 100000 "$ROOT/engine-fixtures"
flock -x "$LOCK" target/release/examples/ai_engine 1000000 "$ROOT/engine-fixtures"
~~~

Existing bundled ai_engine harness generates the **actual measured engine fixture** when absent (100tracks,integer minute epochs,7columns,80xlabel suffix),asserts accepted/store/query/selective count,3event equality,copy/save/reopen,compact/full equality and actual100kpacket;noGPU. Native generator is different actual measured20track/8column CSV. Do not compare native/import-engine numbers as identical fixture.

~~~sh
# Native CSV generator: portable output-only adaptation; syntax checked, NOT rerun at scale here.
ROOT="$ROOT/native-fixtures" python3 "$BUNDLE/reproducers/make-native-fixtures.py"
# For EACH renderer candidate, independent frozen worktree with locked frontend deps:
git apply "$BUNDLE/patches/render-intent-test.patch"
# NODE-INTENT baseline intentionally asserts observed lost input; reports pass:false for observer case.
node frontend/scripts/ai-intent-regression.mjs
git apply "$BUNDLE/patches/render-latest-intent.patch"
node frontend/scripts/ai-intent-regression.mjs
# NODE-TERRAIN: switch to its separate baseline worktree before these commands; 3 vs1 rebuilds:
git apply "$BUNDLE/patches/render-terrain-test.patch"
node frontend/scripts/ai-terrain-regression.mjs
git apply "$BUNDLE/patches/render-terrain-guard.patch"
node frontend/scripts/ai-terrain-regression.mjs
# NODE-GLYPH: separate baseline worktree; geometry equivalence, not native performance:
git apply "$BUNDLE/patches/render-glyph-test.patch"
node frontend/scripts/ai-render-regression.mjs
# NODE-PICK: separate baseline worktree, heavy CPU benchmark, no native proof:
git apply "$BUNDLE/patches/render-ai-picking-bench-test.patch"
flock -x "$LOCK" node frontend/scripts/ai-picking-bench.mjs
# Compare to independent worktree with render-picking-world-cache.patch;3interleaved repeats.
# UI-GATES EXISTING frozen package scripts, correctness/control only:
flock -x "$LOCK" npm --prefix frontend run build
flock -x "$LOCK" npm --prefix frontend run test:gis
CHRONOSCOPE_CLI="$PWD/target/release/chronoscope" CHRONOSCOPE_QA_PUBLIC_WMTS=0 \
 CHRONOSCOPE_QA_DATA_DIR="$ROOT/ui-data" CHRONOSCOPE_QA_SCREENSHOTS="$ROOT/ui-screenshots" \
 flock -x "$LOCK" npm --prefix frontend run test:ui
~~~

Existing test:ui needs built CLI and Playwright/browser setup already provided by locked project;build CLI separately via cargo build --locked --release -p chronoscope. Existing baseline browser suite passed themes/filter/analysis/selection/edit-undo/importCSV-Excel-MGRS/DTED/manual mapping/GIS/globe/rasters/device-loss correctness in SwiftShader,**not native Radeon perf for every patch**. No public WMTS. Native rerun requires platform private display/no-network preferences,unmodified binary functional gate,in-app PCI/counter/pixels/count gate;this bundle deliberately excludes host-specific Xauthority/session/cache/binaries/screens and private transport harness. Native raw records are reviewable;no claim one portable Node command certifies hardware.

**PROPOSED-GATES (NOT existing files):** implement tests first, then cargo test --locked -p chronoscope --test TEST_TARGET. Targets: ai_view_contracts, ai_jobs, ai_writer, ai_snapshots, ai_persistence, ai_analysis, ai_terrain, ai_assets, ai_predicate_errors, ai_signed_zero; frontend scripts coherent-refresh-qa.mjs,ai-table-qa.mjs,scene-transaction-qa.mjs,selection-capacity-qa.mjs,ai-packet-qa.mjs,compact-scene-qa.mjs,view-disposal-qa.mjs,display-budget-qa.mjs,stem-qa.mjs,picking-gis-qa.mjs. Paths are target locations,not claimed existing/passed. Keep test:gis/test:ui baseline plus native invariants;MCP schema/root/cap/privacy tests remain mandatory.

### Acceptance record per change

Retain source/patch/binary/fixtureSHA,build/backend,cache definition,actualdriver order,rawperrepeat,exactcount/ID/GIS/attribute/privacy results,queue/stage/bytes/resources and NULL reasons.≥3interleaved matched native repeats at SAME features/quality/viewport/camera trajectory,frames/actions raw distributions for p95/p99;do not make operationn3tails. Include outliers/firstpairregressions. Reject semantics loss or unintendedp95/PSS>5%regression;fallback explicit,not silent LOD. Missing parser-vs-mapping/allocation/prepare/fsync/tempWAL/nativeupload/GPUtimer/presentation/longleak data remainNULL. Fit-normalized dense/dispersed geography is not controlled projected-overlap evidence. Denseanalysis/selectedAll100k/real129DTED/localdelayWMTS/nativeplayback are required new gates,not completed experiments.

This spec consolidates overlapping engine15/render16/architecture15 contracts into24tickets;architecture-only designs retain UNTESTED identity. Parent independent audit P0notes incorporated:exact joint/individual patch identity,narrow range race limits,nonempty append rejection,invalid-RHS/signedzero exclusion,millionsharedbaselines,quality/native-path/privacy caveats. No production source changes or deployment/push by this writer.


Live session metadata verified openai/gpt-6.1-sol with thinkingLevel high during consolidation.

Standalone known-defect reproduction, isolated baseline worktree only: copy BUNDLE/reproducers/attribute-invalid-numeric-repro.rs to tests/ai_attribute_invalid_numeric.rs; cargo test --locked --release -p chronoscope --test ai_attribute_invalid_numeric (expected failure). In another baseline worktree copy signed-zero-repro.rs to tests/ai_signed_zero_baseline.rs and run matching cargo test target (expected failure). Exact retained defect sources, not newly fixed tests.

[Fixture hashes](ai-20261014/evidence/fixture-hashes.json), [driver protocol](ai-20261014/evidence/protocol.json), [startup receipts](ai-20261014/evidence/native/startup-summary.json), [source hashes](ai-20261014/evidence/source-anchors.json) and [light validation](ai-20261014/evidence/validation.json) complete the portable proof index.

[Reduced experiment/binary identity ledger](ai-20261014/evidence/experiment-identities.json) binds selected native records to script, application-patch and binary hashes without including executables or measurement hooks.
