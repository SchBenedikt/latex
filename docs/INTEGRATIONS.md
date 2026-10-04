# Integrations

## Zotero and Better BibTeX

### Browse and sync a Zotero library

Open **Zotero sources** in the workspace sidebar, then choose **Connect Zotero**. Select a personal or group library, enter its numeric ID, and optionally provide a Zotero API key for a private library. Use a read-only key; enable file access only if you want to preview attached PDFs. Public libraries can be browsed without a key.

The app stores the key and a local source cache in this browser's IndexedDB. It sends read-only API requests directly to `api.zotero.org`; the LaTeX Studio server does not receive the key or library contents. While the app tab is open, it checks Zotero for changes every 30 seconds and fetches only updated sources. Zotero's Web API contains the online library, so new desktop items appear after Zotero itself has synced them to zotero.org. Disconnecting removes the key and cached library data from this browser.

Select a source to inspect its metadata, abstract, tags, Zotero page, and available attachments. PDF, image, and saved HTML snapshot attachments can be previewed inline; other files can be downloaded, and linked URLs open in a separate tab. PDF/file preview requires file-read access on the API key. **Insert citation** offers basic, natbib, and common biblatex citation commands. It also adds the Zotero BibTeX entry to the project and ensures the configured main TeX file has a bibliography resource/output command. **Add to project bibliography** adds the entry without inserting a citation. You can also copy its BibTeX entry. Existing citation keys are never overwritten; resolve a duplicate key in Zotero or the project's `.bib` file first.

In the browser compiler, classic `\\bibliography{...}` projects get a local `.bbl` generated from the project's saved `.bib` files before LaTeX runs. This resolves ordinary Zotero/BibTeX citekeys without contacting a compiler service. Common biblatex source commands are adapted to a numeric plain/natbib bibliography for browser builds; advanced Biber features and custom bibliography styles are not reproduced there. The local Node.js workflow uses the installed TeX tools and their normal BibTeX/Biber support.

The Web API returns Zotero's BibTeX translator key. If a document depends on Better BibTeX-specific citation keys, keep using the Better BibTeX auto-export workflow below and ensure those keys match the Zotero export.

1. Install [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex) in Zotero.
2. Export a collection in Better BibLaTeX or Better BibTeX format. Enable **Keep updated** and select the project's `references.bib` file as the destination.
3. In LaTeX Studio, choose **Project menu → Import Zotero / BibTeX**. New citation keys are added. When keys already exist, the editor asks before replacing those entries.
4. Citation-key completion is available in `\cite{...}` and compatible citation commands.

Zotero writes the export file directly; the editor does not watch external file changes. Reload an open bibliography tab after Zotero updates it. Better BibTeX can automatically re-export on change when **Keep updated** is enabled. Review Better BibTeX citation-key settings before importing if your document already uses keys.

## GitHub

Choose **Project menu → Import public GitHub repository** and enter a repository URL. The default branch is used, or include a branch in a URL such as `https://github.com/owner/repository/tree/branch`. The archive is imported as a new project; an existing project is never overwritten.

This version imports public repositories only. It does not authenticate to GitHub, clone private repositories, push changes, or keep a repository synchronized. Use Git on the local project folder if you need full version control.

## TeX packages

Open **Build settings → Manage packages** to scan the main document and included source files for `\usepackage`, `\RequirePackage`, and document-class declarations. Installed `.sty` and `.cls` files are resolved by the local TeX installation. Missing items can be installed individually or together through a supported TeX package manager.

The available packages depend on the operating system's TeX distribution and its administrator permissions. LaTeX Studio does not bundle or mirror TeX packages.
