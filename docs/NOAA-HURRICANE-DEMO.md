# Atlantic hurricanes, 2016–2025

Open [the portable sample](../samples/atlantic-hurricanes-2016-2025.chronoscope) in Chronoscope. It starts in 2D heat-map mode and includes four saved views under **Views**: tracks, heat-map, bloom and space-time-heat. Each retains the same 3,568 source events from 83 hurricanes. The [CSV](../samples/public/atlantic-hurricanes-2016-2025.csv) is also available for importing independently.

The sample uses the ten completed seasons 2016–2025. It contains original best-track coordinates and UTC times from [NOAA NHC HURDAT2](https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt), including non-hurricane lifecycle phases of storms that reached hurricane strength in the Atlantic. [NOAA IBTrACS](https://www.ncei.noaa.gov/products/international-best-track-archive) BASIN tags exclude Pacific portions of crossover storms. Bonnie 2022 is excluded because its hurricane phase occurred in the Pacific. No positions or intermediate times were invented. Records are unique by storm ID and time.

Counts by season are 7, 10, 8, 6, 14, 7, 8, 7, 11 and 5. Wind values are knots; pressure is millibars, with missing sentinel values blank. Six-hourly events and additional original landfall/status records retain their source timing. The trail gap setting is 720 minutes so the ordinary six-hourly reports can connect. These lines connect recorded positions; they are not measured continuous trajectories.

Heat uses event counts and automatic influence, with view-relative colors. It shows approximate concentration of recorded track positions, not wind strength, damage risk, storm probability or calibrated climatological density. Extra original records and differing storm duration affect counts. Bloom shows compact additive points at source/grid-summary positions. The space-time view keeps heat on the ground and events at their UTC time heights. Axes include the year when the displayed range crosses calendar years.

The NASA GIBS BlueMarble_ShadedRelief WMTS is enabled at matrix level 4, covering the Atlantic and surrounding coasts. It is static shaded imagery, not imagery of the individual storms. This basin-wide example loads no DTED elevation. The portable file contains map settings, not downloaded tiles; opening its basemap requires provider access or an existing local cache.

[Current screenshot gallery](screenshots/current/README.md)

[Current screenshot gallery](screenshots/current/README.md)

[Current screenshot gallery](screenshots/current/README.md)

The demonstration fetched 24 unique public map tiles at concurrency 1 with a one-second minimum request-start interval. Final screenshots reused the cache in offline mode. Actual Rust import, browser rendering, year-label assertions and portable reopening were checked; see [capture metadata](validation/noaa-hurricanes-2016-2025/capture-report.json) and [the log](validation/noaa-hurricanes-2016-2025/capture.log). Rendering used Chromium WebGL2/SwiftShader on Linux. Source and basin-reference digests are included in the metadata. No GitHub runners were used.

## Five-season tracks: 2021–2025

Open [the five-season tracks workspace](../samples/atlantic-hurricanes-2021-2025-tracks.chronoscope) to see 38 hurricanes and 1,604 original positions. Saved views include the full Atlantic 2D map, space-time, and a closer western Atlantic map. Each storm is its own entity, including its season to distinguish recurring names. The original ten-season CSV above is filtered to seasons 2021–2025; no new positions are added. Counts by season are 7, 8, 7, 11 and 5.

To show connecting tracks in the app, choose **Display → Events → Individual points**, with Heat map and Bloom off. In **Advanced display settings**, set **Break trails at gaps / minutes** to **720** for these six-hourly reports. The sample uses **Trail tolerance / pixels = 0** to retain every recorded vertex. Summary displays suppress source trails rather than connecting cluster centroids. Lines connect successive reports of the same storm; they do not imply a continuously observed path.

[Current screenshot gallery](screenshots/current/README.md)

[Current screenshot gallery](screenshots/current/README.md)

The actual renderer emitted **1,566 track segments** in both views, matching the independent source-record adjacency count, with all 1,604 positions present and no summary aggregation or geometry budget truncation. The three bookmarks and Points/trail settings survived portable reopening. [Capture evidence](validation/noaa-hurricanes-2021-2025-tracks/capture-report.json). The captures reused all 24 existing NASA tiles in offline mode, with zero public WMTS requests. No application code changes were needed.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
