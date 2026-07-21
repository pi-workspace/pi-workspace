# Renderer bundle budget

The production build enforces budgets for the renderer so dependency or configuration changes do not silently increase startup and package cost.

## Baseline

With Bun 1.3.14 and Vite 8.1.5, the renderer entry is 0.80 MiB minified and all renderer assets total 10.47 MiB. The packaged application input under `dist/` is 11.49 MiB before electron-builder creates the platform-specific artifact.

The budgets are:

- Initial JavaScript: 900 KiB, measured from the generated `index-*.js` entry.
- Total renderer assets: 13 MiB, measured from all files under `dist/renderer/assets`.

## Validation and overrides

`bun run build` runs `scripts/check-renderer-bundle.mjs` after producing `dist/renderer`. If a deliberate product or dependency change requires an increase, update the constants in that script and this baseline together, explain the reason in the change description, and keep the override as small as practical.
