# User guide

## Start a project

Open the landing page and choose **Open Studio**, or navigate directly to `/studio`. Use the project
menu to create, rename, duplicate, import, export, or remove a project. A project is a folder in the
local workspace (`LATEX_ROOT`, default `projects/`).

Create or upload files from the Files panel. Select a `.tex` file to edit it. Tabs indicate unsaved
changes; save with **Ctrl+S** or everything at once with **Ctrl+Shift+S**. Choose a main document
from the project menu when the project contains more than one TeX file.

The landing page lists the projects of this installation; each card opens the project's main
document directly. The same links work from anywhere:
`/studio?project=Paper&file=chapters/intro.tex&line=42` opens that project, file and line.

## The workspace

- **Rail panels** (left): Files, Outline, Project search, Symbols, Bibliography, Zotero sources,
  Research. Click a rail icon twice to collapse the sidebar.
- **Layouts**: Source, Split and PDF, plus the console at the bottom and the PDF pane on the right.
  All separators can be dragged; the layout is remembered.
- **Keyboard**: **F1** opens the complete shortcut reference, **Ctrl+Shift+P** the command palette,
  **Ctrl+P** quick open, **Alt+Z** focus mode, **Alt+B** the bibliography manager, **Alt+T** the
  research panel.
- **Theme**: light, dark or follow the system, from the project menu or **Settings**.

## Build and preview

Choose a TeX engine from the Build menu, then select **Build** or press **Ctrl+B** / **F5**. Auto
build recompiles after you stop typing (delay configurable in **Settings**).

The PDF preview supports page navigation, zoom (presets, manual zoom, fit-to-width), text search,
download and opening the file in a new tab.

SyncTeX works in both directions. Depending on the SyncTeX button in the PDF toolbar:

- **Ctrl+click** (default) — Ctrl+click a spot in the PDF to land on the corresponding source line;
  use **Ctrl+Shift+G** to highlight the current source line's rectangle on the page.
- **Always** — every click in the PDF jumps to the source.
- **Off** — no jumps.

If a build reports a missing package, open **Manage packages** in the Build menu to inspect the
diagnostics and install missing packages. Package installation changes the host TeX installation and
may require operating-system administrator privileges.

## Editing

- Autocomplete (**Ctrl+Space**) for commands, environments, labels, references, citation keys and
  file names. Citation completion shows the author, year, title and journal of your real `.bib`
  entries.
- **Ctrl+/** comments or uncomments the selected lines. **Alt+Shift+B / I / E / U / M** wrap the
  selection in `\textbf`, `\textit`, `\emph`, `\underline` or inline math — pressing the same
  shortcut again removes the wrapper.
- Insert wizards (Insert menu or the command palette) generate tables, figures, equations, lists and
  citations. The symbol palette inserts Greek letters, operators, arrows and accents.
- Typing `}` to close `\begin{…}` adds the matching `\end{…}` and indents the body.

## Table of contents and search

The Outline panel is a real table of contents: headings are numbered like the final document, grouped
by file, with hierarchy guides, filter, collapse/expand and a “show current position” button that
follows the cursor.

Project search (**Ctrl+Shift+F**) supports regular expressions, case matching and whole-word search,
and can replace across every file of the project. Results jump to file and line.

## References

### Bibliography manager

Open it with **Alt+B** or the rail icon. It reads every `.bib` file of the project and shows:

- **Entries** with type, author, year, journal and source file.
- **Citation status** — “cited 2×” or “never cited”, computed from every `.tex` file (no build
  required).
- **Missing keys** — citations whose key has no BibTeX entry, listed as warnings.
- **Filters** for type, for cited/never-cited/missing, and a text filter over keys, titles, authors
  and years.

Each row can insert the citation at the cursor (`\cite{…}`, or the biblatex command matching your
main document), copy the raw BibTeX block, or open the `.bib` file at that entry.

### Zotero

Open **Zotero sources** in the sidebar to connect a personal or group library and browse its sources,
abstracts, tags and PDF attachments. Keep the LaTeX Studio tab open for automatic checks every 30
seconds. Select a source to insert its citation or add its BibTeX entry to the active project. The
connection is read-only and stored in the current browser — see [Integrations](INTEGRATIONS.md).

You can also export a `.bib` file from Zotero, preferably with Better BibTeX, and use **Project menu
→ Import Zotero / BibTeX**. That workflow preserves Better BibTeX citation keys and remains useful
for offline libraries. Save any open bibliography edits before importing.

## Keep your work

**Change history** (project menu) keeps every saved version of every file, with a line diff against
the current file and one-click restore. Snapshots, builds, imports and journal entries appear in the
same list. Everything is stored in the current browser profile.

**Snapshots** (project menu) capture all text files of the project so you can return to a known
state. Automatic snapshots run quietly while you work (at most every 20 minutes, the five newest are
kept) and a safety copy is always taken directly before a restore. Switch automatic snapshots off in
**Settings**.

## Writing tools

The **Research** panel (**Alt+T**) holds a per-project word goal with progress across all text files,
the project's `TODO`/`FIXME`/`XXX`/`NOTE`/`HACK` annotations with filters and jumps, and private
project notes.

**Document statistics** (click the word count in the status bar) lists words, characters, lines,
reading time, sections, math blocks, figures, tables, citations, labels and TODOs — for the open file
and for the whole project.

**Document metadata** (project menu) edits `\title`, `\author`, `\date`, the PDF subject and keywords.
The values are written back to the main document, including `\hypersetup`; rebuild the PDF to update
its metadata.

## Templates and examples

Use **Sample projects** to add demonstration documents, or create from a template when starting a
project (article, thesis, beamer, report, letter, mathematics, minimal). Examples are ordinary
editable project files.

## Import and export

ZIP import creates a separate project and does not overwrite existing projects. Export downloads a
project archive. Public GitHub import accepts a public repository URL and copies its archive into a
new project; private repositories and pushing changes to GitHub are not supported.

## Working with others

When two editors are connected to the same project on the same LaTeX Studio server, the status bar
shows how many editors are connected. Saved changes appear in the other window immediately; a file
that you have modified but not saved is never overwritten — LaTeX Studio asks you to save first, and
your local text wins until you do.

This is an early feature: there is no shared cursor, no comment threads and no internet relay. Both
editors must reach the same local server, and the server has no authentication (see
[Security notes](SECURITY.md)).
