# Cloudflare Workers deployment

The hosted app stores each visitor's projects in that browser's IndexedDB. PDF compilation also runs in the browser: TeX Live 2025 is compiled to WebAssembly and served from the app's own domain. TeX source, project assets, and generated PDFs are not posted to a shared API.

## Deploy

From the repository root, install dependencies and deploy:

```sh
npm ci
npm run deploy:cloudflare
```

The regular `npm run build` command builds the app and prepares the compiler assets from the Siglum TeX Live 2025 distribution before deployment. This matters for Cloudflare Workers Builds too: its default `npm run build` must include the ignored runtime files or the Worker will return `503 Compiler runtime manifest not found`. The build splits files larger than Cloudflare's static asset limit into 20 MiB parts and reuses a complete local payload when available. A clean CI checkout downloads the runtime (about 225 MiB) before Wrangler snapshots the assets. The generated `client/engine-data/` directory remains ignored by Git.

The Worker only runs for `/engine/*` requests and package requests that are not present as static files. Other assets are served directly by Cloudflare. The default compiler manifests, JavaScript, gzip-compressed WebAssembly file, and common packages are published under `/engine-static/` and `/api/texlive/` as static assets. Static headers enable cross-origin isolation, which the WebAssembly compiler uses for efficient shared memory. Larger optional bundles remain split into same-origin parts and the Worker reassembles their whole or byte-range requests.

## Browser compilation

- The first build downloads the 31 MiB WebAssembly engine and the package/font bundles that the document needs; browser caches speed up later builds. The gzip-compressed engine, manifests, regular bundles, and common package archives load without consuming Worker requests.
- Cloudflare mode supports pdfLaTeX and XeLaTeX. LuaLaTeX, shell escape, SyncTeX, and system TeX-package installation require the local Node.js app (`npm start`).
- Common TeX Live 2025 packages and fonts are included in the bundle set. This static runtime does not run a package-manager process or a CTAN proxy for packages absent from the published bundle index.
- Browser storage and compilation consume the visitor's device storage and memory. The initial compile can take longer on a slower device. Export projects as ZIP files for backups or moving them between browsers.
- Cloudflare's free Workers plan allows 100,000 Worker requests per day. Static asset requests do not count; requests for large optional bundles and packages not prepublished as static files can invoke the Worker. Those requests may be blocked if the account reaches its daily limit. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) document the current limits.

The compiler runtime is based on [Siglum](https://github.com/SiglumProject/siglum), distributed under MIT. The bundled TeX Live files retain their respective upstream package licenses.
