# Architecture

LaTeX Studio is a local Node.js application. Express serves the landing page, workspace, static client assets, and JSON APIs. The browser client is plain JavaScript with CodeMirror 6 and pdf.js. `build.mjs` bundles the browser modules into `client/dist/`.

The server keeps projects below the configured `LATEX_ROOT` (default: the repository's `projects/` directory). Builds invoke the selected TeX engine in the project directory and expose build output and diagnostics to the workspace. Package inspection and installation use TeX Live or MiKTeX command-line tools when detected.

The app currently has no user accounts, authentication layer, or GitHub write integration. GitHub import downloads public archives only. Zotero interoperability is file-based through BibTeX/Better BibTeX.
