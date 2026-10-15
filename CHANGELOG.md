# Changelog

## 1.1.0 — 2026-10-15

### Added

- **Bibliography manager** (rail panel, Alt+B): every entry of the project's `.bib` files with type,
  author, year and source file, filters for type and for cited / never cited / missing, one-click
  citation insertion (`\cite` or the project's biblatex command), copy the raw BibTeX block, and jump
  to the entry in its file. Citations without a matching entry are reported as warnings.
- **Editor text tools**: comment toggle (`Ctrl+/`) and style wrappers for `\textbf`, `\textit`,
  `\emph`, `\underline` and inline math (`Alt+Shift+B / I / E / U / M`), available from the command
  palette and the shortcut reference as well.
- **Deep links**: `/studio?project=Name&file=chapters/intro.tex&line=42` opens a project, file and
  line directly. The landing page lists the projects of the installation and links to their main
  documents.
- **Interactive landing page**: a click-through preview of the real workspace layout (rail panels,
  source/PDF layout switch, SyncTeX jumps, build replay, citation insertion, history diff), a
  light/dark theme toggle that remembers your choice, install tabs for local and Cloudflare setups,
  a privacy panel, project cards and a rewritten feature explorer.
- Change history: every saved version of a file kept locally with a line diff and one-click restore,
  plus a journal of snapshots, builds and imports.
- Snapshots, manual and automatic (quiet backup at most every 20 minutes, always one before a
  restore) with a settings toggle.
- Document metadata editor for title, author, date, PDF subject and keywords, written back to the
  source including `\hyperref` setup.
- Research panel: per-project word goal with progress, project-wide TODO/FIXME tracker with filters,
  private project notes, project totals in the document statistics.
- Insert wizards (tables, figures, equations, lists, citations), symbol palette, focus mode.
- First collaboration features: presence of connected editors per project and live file sync that
  never overwrites unsaved local changes.
- Numbered table of contents in the sidebar: section numbers as in the document, grouped by file,
  hierarchy guides, filter, collapse/expand and a “show current position” action.
- Five-step feature tour and a filterable explorer of every feature on the landing page.
- `npm run verify` now starts a server itself when none is listening, and gained a BibTeX parsing
  check (20 checks in total).

### Fixed

- **BibTeX parser returned empty fields**: titles, authors, years and journals were dropped because
  the entry slice ended one character early and stopped at the first nested brace. Braced (nested),
  quoted and bare values are now read correctly — this affected citation autocomplete details and the
  new bibliography manager.
- Ctrl+Shift+G, Ctrl+Shift+S and Ctrl+Shift+P inside the editor were routed to their unshifted
  commands (for example “Go to line” instead of SyncTeX).
- Style objects in the DOM helper `el()` were never applied, which broke file-tree indentation and
  the SyncTeX highlight rectangle in the PDF.
- Switching projects leaked the previous project's PDF state (404 requests, wrong preview).
- The research panel was unreachable (never initialized) and its styles were missing.
- Activating a panel with a keyboard shortcut twice in a row collapsed the sidebar.
- The landing page loaded fonts from Google Fonts and shipped screenshots; it now uses system fonts
  and a self-contained interactive demo.

## 0.1.0 — 2026-10-03

- First public GitHub release.
- Added an English landing page and English product documentation.
- Documented local setup, package management, GitHub archive import, and Zotero BibTeX workflows.
