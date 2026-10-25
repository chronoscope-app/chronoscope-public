# Demo hero thumbnails

These twelve JPEGs are rendered from the actual bundled demo workspaces using their saved **Space-time tracks** and **2D tracks** views. The picker labels these views **Time** and **Map**. Clicking a thumbnail opens its corresponding saved view. No synthetic observations or AI artwork are used.

The background is the bundled **Natural Earth public-domain** reference image. Event source URLs, source licenses/attribution, saved view scenes and image SHA-256 hashes are recorded in `manifest.json`. Source and license details are also available on every demo card in the app. The wildlife data retains its CC BY 4.0 attribution there and in the manifest.

The wildlife previews visualize and downsample observations from **Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project**, [source dataset](https://doi.org/10.5441/001/1.652), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Other data-specific licenses and credits are recorded alongside each image in the manifest.

To regenerate locally, build the CLI and frontend, then run `npm --prefix frontend run capture:demo-thumbnails`. The script uses isolated temporary profiles and blocks public HTTP requests. This is an explicit asset-generation command, not part of normal builds or hosted CI.
