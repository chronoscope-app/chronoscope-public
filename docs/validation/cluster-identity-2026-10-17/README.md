# Entity-preserving visual clusters — local validation, 2026-10-17

Visual clusters now group matching located events within each entity and use the same theme-aware or custom color as that entity's markers and tracks. Count affects cluster size and its label. Selection adds an amber outline without recoloring the cluster fill.

The coherent view snapshot retains bounded underlying observations while clustering is active; the renderer hides ordinary event glyphs independently from track geometry. Tracks and vertical trails retain their own switches and opacity settings. Track lines follow observations, not connections between unrelated cluster centroids. Existing rendering/simplification budgets still apply.

Visual clustering always uses entity partitions, so the advanced panel no longer offers a partition selector that would mix identities. The public `display_data` query still supports all/entity/source partitions. Heat, bloom, and density retain their count-based presentation. If entity partitions cannot fit within the 4,000-cell budget, the scene falls back to ordinary budgeted events instead of failing or merging entity identities.

## Verification

- `cargo test --locked -p chronoscope --test display_lod --test views_layers`: 13 tests passed, including per-entity cell membership, filter consistency, retained observations, budget limits, and a 4,001-entity fallback.
- TypeScript and Vite production build passed.
- `npm --prefix frontend run test:cluster-identity`: 9 hardware Chromium/Cesium groups passed with the actual Rust bridge and Atlantic hurricanes (3,568 events, 83 entities).
- Space-time, 2D, and Globe retained all 166 track/ground-line polylines and matched every cluster's fill to the corresponding event color. Space-time retained 3,568 vertical stems.
- Selection preserved fills; changing an entity's custom color repainted cached clusters and tracks. Both themes, independent line toggles, and time filtering passed with no page/render errors.

- Native ad hoc-signed bundle built, signature verified, and launched. Attached CLI confirmed 166 track/ground-line polylines before/after clustering across Space-time → Globe → 2D → Space-time, 3,568 retained observations, 3,568 Space-time stems, and zero rendering errors. Native UI visually verified; left on hurricanes with clustering enabled.

All verification runs locally. No hosted workflows were dispatched. Native bundle verification is recorded in the workspace QA directory alongside the build log and live CLI responses.
