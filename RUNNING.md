# Run and verify

The server listens on `0.0.0.0:4180` by default. Open `http://localhost:4180` for the landing page or
`/studio` for the workspace. Set `HOST`, `PORT`, or `LATEX_ROOT` to change the bind address, port, or
project storage directory.

## Development

```sh
npm install
npm run build     # bundle the browser app into client/dist/app.js
npm run serve     # start the server
npm run dev       # esbuild in watch mode + server
```

## Verification

```sh
npm run build
npm run verify
```

`npm run verify` is non-destructive: it reuses a server that is already listening, or starts one for
the run and stops it again. It creates uniquely named disposable projects and removes them
afterwards. Set `STUDIO_URL` to verify a server on another host (then nothing is started locally).

The suite covers HTML/JavaScript assets, project and template management, file operations, saving and
exact readback, search and replace, package diagnostics, the Zotero/BibTeX merge workflow, BibTeX
parsing (nested braces, quoted and bare values), build completion over the WebSocket for every
detected engine (pdfLaTeX, XeLaTeX, LuaLaTeX), PDF and log access, metadata, SyncTeX in both
directions, compile-error reporting and recovery, ZIP export/import, project duplicate/rename, and
rejection of invalid regular expressions, unknown engines and path traversal.

It does not install TeX packages, does not modify your own projects, and cannot prove that every
document compiles on every TeX distribution. Browser interaction (editor shortcuts, panels, dialogs,
the PDF preview, the landing page) is covered by separate headless-browser checks that drive the real
UI against a running server.
