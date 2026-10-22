# Synthetic terrain fixture

`synthetic-n43.dt0` is generated entirely by `scripts/generate_commercial_fixtures.py` under the repository MIT license. No elevation samples or header bytes are copied from a real DEM.

The 121 × 121 point grid covers 43–44°N, 80–79°W solely to exercise geographic registration. Height at integer post `(x,y)` is `75 + floor(((x-60)^2 + (y-60)^2)/30)` metres: a fictional bowl with a 75 m centre and 315 m corners. The WGS84/MSL header is a test declaration, not a claim about real terrain or a geoid. Checksums are generated per DTED record.

`gis-reference.json` retains its independently generated PROJ/GEOTRANS coordinate and distance vectors. Its terrain expectations come from this defining polynomial and bilinear interpolation, independently of the app decoder. Decoder corruption, void, datum, offset, registration, boundary and interpolation tests remain active. The older OSGeo sample was removed because its exact permission chain was unresolved.
