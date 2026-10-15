# Security notes

LaTeX Studio is designed for a trusted local machine. Its HTTP API has no authentication or per-user access control. Anyone who can reach the server may be able to read or modify workspace projects and request document builds.

The default bind address is `0.0.0.0`, which exposes the service on reachable network interfaces. Use `HOST=127.0.0.1` for local-only access. Do not expose the service to the public internet or an untrusted network without adding authentication, TLS, network restrictions, and appropriate process isolation.

The collaboration channel (`/ws`) has the same trust model: any client that can reach the server and names the same project may join its presence list and receive the file content of saves made in that project. It has no authentication, no per-project access control and no encryption of its own. Use it on a trusted network only, or keep the server bound to `127.0.0.1`. The landing page also exposes the names of the projects in your workspace (and their main files and engines) to anyone who can load it.

Builds run local TeX commands against project content. Treat imported projects as untrusted, and avoid enabling shell escape for documents you do not trust. Public GitHub import validates public repository URLs and imports archives into a new project; it does not execute imported code during download.

The optional Zotero integration uses a read-only Zotero Web API key. The browser stores it in that origin's IndexedDB and sends it directly to `api.zotero.org`; the LaTeX Studio server does not receive it. Anyone with access to the same browser profile and origin can use that stored key, so disconnect the library before sharing the browser profile. Use a key with only the library and file-read permissions you need.
