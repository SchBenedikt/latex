# Run and verify

The server listens on `0.0.0.0:4180` by default. Open `http://localhost:4180` for the landing page or `/studio` for the workspace. Set `HOST`, `PORT`, or `LATEX_ROOT` to change the bind address, port, or project storage directory.

## Verification

```sh
npm run build
npm run verify
```

The verification script creates uniquely named temporary projects and removes them afterwards. It checks project and file management, saving, search and replace, package diagnostics, available TeX engines, bibliography merging, error handling, and ZIP import/export. It does not trigger package installations. Browser interactions and successful compilation of every possible TeX package/document combination require separate checks.
