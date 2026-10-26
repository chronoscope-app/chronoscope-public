# Demo hero thumbnails

These 26 JPEGs are 480 × 300 previews of the 13 bundled demo workspaces. Each card selects its own saved views: Time/Map, Globe/Map, heat/detections, count cells, or historical years. Clicking a thumbnail opens the corresponding scene **and filter**. No synthetic observations or AI artwork are used.

The background is the bundled **Natural Earth public-domain** reference image. Event source URLs, source licenses/attribution, saved view scenes visible record counts, filters, and image SHA-256 hashes are recorded in `manifest.json`. Source and license details are also available on every demo card in the app. The wildlife data retains its CC BY 4.0 attribution there and in the manifest.

The wildlife previews visualize and downsample observations from **Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project**, [source dataset](https://doi.org/10.5441/001/1.652), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Other data-specific licenses and credits are recorded alongside each image in the manifest.

To regenerate locally, build the CLI and frontend, then run `npm --prefix frontend run capture:demo-thumbnails`. The script uses isolated temporary profiles and blocks public HTTP requests. This is an explicit asset-generation command, not part of normal builds or hosted CI.

The new earthquake, fire, electricity-access and COVID source interpretation and limits are documented in [the demo guide](../../../docs/PRIORITY-DEMOS.md). Numeric legends are captured with the real app scene. Thumbnails are letterboxed to preserve the scene aspect ratio.
