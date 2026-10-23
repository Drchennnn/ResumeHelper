# Third-party notices

## PDF.js

- Package: pdfjs-dist 6.4.299
- Upstream: https://github.com/mozilla/pdf.js
- License: Apache-2.0; full text in extension/vendor/pdfjs/LICENSE.
- Vendored components: browser module and worker, CMaps, standard fonts, OpenJPEG and JBIG2 JavaScript fallbacks.
- Additional font and decoder notices remain alongside those assets, including `cmaps/LICENSE`, `standard_fonts/LICENSE_*`, and `wasm/LICENSE_*`.
- Reproduce with `npm ci --ignore-scripts && npm run vendor:pdfjs`; package and lockfile pin the version.
- No original extension source or brand assets are included.

## Development fixtures

@napi-rs/canvas 1.0.13 (MIT) is a development dependency used only to generate and render fictional test fixtures. It is not included in the Chrome extension package. Its license is distributed in the npm package.

## Region catalogue

`extension/data/regions.json` is normalized from china-division 2.7.0 / modood/Administrative-divisions-of-China commit 6fb5380de7e6c961869dcd1629df4adc088fa9bb. Mainland data is dated 2023-06-30; HK/MO/TW supplements have coverage limitations. Upstream source LICENSE is WTFPL v2 (its npm metadata disagrees and says MIT). The actual license text is retained at extension/data/LICENSE-regions.txt; source details and hashes are documented in docs/region-data.md.

## Major catalogue and field guidance

Category path labels are factual classification data observed in the public reference site's shipped menu constants on 2026-10-23; no original site business code is distributed. Field guidance is concise original wording informed by the observed labels/help. See docs/major-data.md for snapshot scope.
