# Integrations

## Zotero and Better BibTeX

1. Install [Better BibTeX](https://github.com/retorquere/zotero-better-bibtex) in Zotero.
2. Export a collection in Better BibLaTeX or Better BibTeX format. Enable **Keep updated** and select the project's `references.bib` file as the destination.
3. In LaTeX Studio, choose **Project menu → Import Zotero / BibTeX**. New citation keys are added. When keys already exist, the editor asks before replacing those entries.
4. Citation-key completion is available in `\cite{...}` and compatible citation commands.

Zotero writes the export file directly; the editor does not watch external file changes. Reload an open bibliography tab after Zotero updates it. Review Better BibTeX citation-key settings before importing if your document already uses keys.

## GitHub

Choose **Project menu → Import public GitHub repository** and enter a repository URL. The default branch is used, or include a branch in a URL such as `https://github.com/owner/repository/tree/branch`. The archive is imported as a new project; an existing project is never overwritten.

This version imports public repositories only. It does not authenticate to GitHub, clone private repositories, push changes, or keep a repository synchronized. Use Git on the local project folder if you need full version control.

## TeX packages

Open **Build settings → Manage packages** to scan the main document and included source files for `\usepackage`, `\RequirePackage`, and document-class declarations. Installed `.sty` and `.cls` files are resolved by the local TeX installation. Missing items can be installed individually or together through a supported TeX package manager.

The available packages depend on the operating system's TeX distribution and its administrator permissions. LaTeX Studio does not bundle or mirror TeX packages.
