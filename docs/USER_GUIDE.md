# User guide

## Start a project

Open the landing page and choose **Open workspace**, or navigate directly to `/studio`. Use the project menu to create, rename, duplicate, import, export, or remove a project. A project is a folder in the local workspace.

Create or upload files from the Files panel. Select a `.tex` file to edit it. Tabs indicate unsaved changes; save with **Ctrl+S**. Choose a main document from the project menu when the project contains more than one TeX file.

## Build and preview

Choose a TeX engine from the Build menu, then select **Build** or press **Ctrl+B**. The PDF preview supports page navigation, zoom, text search, download, and SyncTeX jumps between source and PDF. Open **Problems** or **Latest log** in the lower panel for compiler diagnostics.

If a build reports a missing package, open **Manage packages** to inspect the diagnostic and install missing packages when a supported package manager is available. Package installation changes the host TeX installation and may require operating-system administrator privileges.

## Search and editing

Use the sidebar for project files, document outline, project-wide search, and symbols. Search supports regular expressions, case matching, whole-word matching, and replacement. The command palette and keyboard-shortcut reference are available from the workspace toolbar.

## Templates and examples

Use **Sample projects** to add demonstration documents, or create from a template when starting a project. Examples are ordinary editable project files.

## Import and export

ZIP import creates a separate project and does not overwrite existing projects. Export downloads a project archive. Public GitHub import accepts a public repository URL and copies its archive into a new project; private repositories and pushing changes to GitHub are not supported.

## Zotero bibliography workflow

Export a `.bib` file from Zotero, preferably with Better BibTeX, then use the bibliography import action in a project. New citation keys are added; matching keys are shown for confirmation before replacement. Save any open bibliography edits before importing. See [Integrations](INTEGRATIONS.md) for details.
