# Architecture

## Runtime modes

LaTeX Studio has two storage/runtime modes. The local Node.js application uses Express APIs, the user's workspace filesystem, installed TeX engines, and pdf.js. On Cloudflare hosting, the browser client detects the missing API and uses a per-browser IndexedDB workspace for project and file operations. PDF compilation uses TeX Live WebAssembly (pdfLaTeX or XeLaTeX) inside that browser; a Cloudflare Worker serves same-origin, range-readable static compiler assets. The browser does not send project sources to the Worker. LuaLaTeX, SyncTeX, local TeX package tools, and GitHub import use the local Node.js server. Zotero's read-only Web API integration runs in the browser, stores its API key and source cache in that browser's IndexedDB, and requests library data directly from Zotero; the app server does not proxy those requests. ZIP export/import provides portable project transfer. The browser client is plain JavaScript with CodeMirror 6 and pdf.js. `build.mjs` bundles the browser modules, project templates, and PDF.js assets into `client/`.

The server keeps projects below the configured `LATEX_ROOT` (default: the repository's `projects/` directory). Builds invoke the selected TeX engine in the project directory and expose build output and diagnostics to the workspace. Package inspection and installation use TeX Live or MiKTeX command-line tools when detected. The landing page reads the same server state (`/api/state`, `/api/project/config`, `/api/projects/files`) to list the local projects and link into the workspace with `?project=…&file=…&line=…`.

## Server channel

Besides the HTTP API, the server exposes one WebSocket endpoint, `/ws`. The editor already used it for build progress; it now also carries collaboration messages: a client announces itself with `hello` (project + anonymous display name), the server answers with the list of connected editors per project (`presence`) and relays a `file:save` message with the saved content to the other editors of that project. Editors never relay through a third party — messages stay on the machine that runs the server.

## Client-side storage

Several features are intentionally browser-local and never touch the server: change history (saved versions with diffs), project snapshots, word goals, project notes, the Zotero connection plus cache, and the remembered workspace layout. They live in `localStorage` or IndexedDB of the browser profile that uses them, which is why they are described as “stored in this browser”. Browser-local data is not synchronized between machines or browsers.

## Parsing

Bibliography data is parsed twice, deliberately: the server parses `.bib` files for the citation autocomplete and the project metadata endpoint, and the client parses the project's `.bib` files for the bibliography manager so it works before a build and in the browser-only workspace. Both readers handle braced (including nested), quoted and bare field values.

The app has no LaTeX Studio user accounts or GitHub write integration. GitHub import downloads public archives only. Zotero access is read-only; private libraries require a user-provided Zotero API key.
