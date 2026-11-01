# Repository data and archived validation media

Large build data and optional inputs are versioned release assets instead of Git objects. `assets/data-assets.json` pins each URL, byte count, and SHA-256. Both repositories share the unchanged terrain pack and identical source/media archives. Future data versions must preserve the archived inputs needed by their corresponding source revision.

Frontend build preparation fetches and verifies terrain automatically. Before direct Cargo tests or an offline build, run:

```sh
python3 scripts/fetch_data_assets.py
```

The verified terrain remains cached at `assets/terrain/balanced.cterrain` and is bundled into the installed app. Application startup and terrain rendering require no network. Do not change the archive or terrain underneath an existing release URL: publish a new data version and update the pins.

For optional importable CSVs and generator inputs:

```sh
python3 scripts/fetch_data_assets.py --sources
```

For historical validation captures referenced by reports:

```sh
python3 scripts/fetch_data_assets.py --validation-media
```

Archived image links point to the corresponding downloadable ZIP. Restore the archive locally to view captures alongside the original reports. Optional restoration refuses to overwrite changed local inputs. Downloads and extracted inputs stay ignored. Attribution sidecars, source hashes, textual validation reports, current documentation screenshots, and the historical media-rights ledger remain in Git. An archive preserves its original rights metadata; archiving does not clear any historical rights gap.

Routine new validation captures belong in ignored local output directories. Keep selected current documentation images small. Local source verification enforces a 160 MB tracked-tree budget, an 8 MB per-file limit, and exclusion of the external data and routine captures. Workflows remain manual-only.

The November 2026 history cleanup removes these asset paths across branches and tags. Existing application downloads and their original source/licensing archives are retained unchanged. Historical source checkouts may require restoring the appropriate data asset manually; original-history recovery bundles are retained locally by the maintainer. After the rewrite, reclone or rebase work onto the new main rather than merging old history back in.
