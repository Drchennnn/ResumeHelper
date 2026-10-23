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
