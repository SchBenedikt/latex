# Cloudflare Workers deployment

The hosted app stores each visitor's projects in that browser's IndexedDB. PDF compilation also runs in the browser: TeX Live 2025 is compiled to WebAssembly and served from the app's own domain. TeX source, project assets, and generated PDFs are not posted to a shared API.

## Deploy

From the repository root, install dependencies and deploy:

```sh
npm ci
npm run deploy:cloudflare
```

The deployment command builds the app, downloads the compiler assets from the Siglum TeX Live 2025 distribution, splits files larger than Cloudflare's static asset limit into 20 MiB parts, and deploys those parts with the Worker. The full deployment payload is about 225 MiB. The generated `client/engine-data/` directory is ignored by Git. A fresh deployment download is required after cleaning it.

The Worker only runs for `/engine/*` requests. Other assets are served directly by Cloudflare. Static headers enable cross-origin isolation, which the WebAssembly compiler uses for efficient shared memory. The Worker reassembles whole or byte-range requests from same-origin static parts.

## Browser compilation

- The first build downloads the 31 MiB WebAssembly engine and the package/font bundles that the document needs; browser caches speed up later builds.
- Cloudflare mode supports pdfLaTeX and XeLaTeX. LuaLaTeX, shell escape, SyncTeX, and system TeX-package installation require the local Node.js app (`npm start`).
- Common TeX Live 2025 packages and fonts are included in the bundle set. This static runtime does not run a package-manager process or a CTAN proxy for packages absent from the published bundle index.
- Browser storage and compilation consume the visitor's device storage and memory. The initial compile can take longer on a slower device. Export projects as ZIP files for backups or moving them between browsers.
- Cloudflare's free Workers plan allows 100,000 Worker requests per day. Static asset requests do not count; compiler range requests invoke the Worker. Very high compile traffic can reach that daily limit. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) document the current limits.

The compiler runtime is based on [Siglum](https://github.com/SiglumProject/siglum), distributed under MIT. The bundled TeX Live files retain their respective upstream package licenses.
