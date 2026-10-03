# LaTeX Studio

A local-first LaTeX workspace for writing, compiling, and reviewing documents in one focused interface.

LaTeX Studio combines a CodeMirror editor, live PDF preview, SyncTeX navigation, project-wide search, build diagnostics, project templates, and package checks. It runs on your machine and stores projects in its local `projects/` directory.

![LaTeX Studio landing page and workspace preview](screenshots/landing-page.jpg)


## Features

- Source, split, and PDF-focused workspace layouts
- pdfLaTeX, XeLaTeX, LuaLaTeX, and pLaTeX build selection
- Live preview, PDF navigation/search, and SyncTeX source jumps
- Project and file management, templates, ZIP import/export, and public GitHub repository import
- LaTeX package diagnostics and installation through TeX Live or MiKTeX when available
- BibTeX import and merge workflow for Zotero Better BibTeX exports
- Keyboard shortcuts, autocomplete, outline, symbols, and project-wide search/replace

## Requirements

- Node.js 18 or newer
- npm
- A TeX distribution for PDF compilation: TeX Live or MiKTeX

LaTeX Studio can start without a TeX distribution, but compilation and package installation will be unavailable. Install the TeX packages required by your documents through your distribution's package manager.

## Quick start

```sh
npm install
npm start
```

Open [http://localhost:4180](http://localhost:4180). The landing page links to the workspace at `/studio`. By default the server listens on `0.0.0.0:4180`; set `HOST=127.0.0.1` to limit access to the local machine, or set `PORT` to use another port.

### Cloudflare Pages

For the static frontend, use the repository root as the project root, run `npm ci && npm run build`, and set `client` as the build output directory. The build creates the browser bundle and the PDF.js worker assets in that output directory. Pages can host the landing page and styled workspace shell, but it cannot run this app's Node.js API, local filesystem operations, or TeX subprocesses. Those require a separate Node.js host; the browser frontend currently expects the API on the same origin, so a cross-origin backend needs an API proxy or explicit API-origin configuration before the editor can work remotely.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Integrations](docs/INTEGRATIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security notes](docs/SECURITY.md)
- [Run and verify](RUNNING.md)

## Development

```sh
npm run build
npm run verify
npm run serve
```

`npm run verify` runs the repository's non-destructive application checks. It creates temporary uniquely named projects and removes them afterwards. It does not install TeX packages or prove that every document compiles on every TeX distribution.

## Data and privacy

Projects are stored locally under `projects/`. That directory is intentionally excluded from version control. GitHub import downloads a public repository archive into a new local project; it does not push changes back to GitHub. Zotero support uses BibTeX exports (including Better BibTeX) and does not require an account connection.

LaTeX Studio is published without a license declaration in this initial release. All rights are reserved by default; obtain permission before redistributing or reusing the code.
