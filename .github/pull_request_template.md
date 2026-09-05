## What this changes

<!-- A sentence or two. -->

## Why

<!-- What was wrong, or what this makes possible. -->

## Checks

- [ ] `npm run verify` passes: typecheck, lint, tests, build
- [ ] If this adds a package, it is only in `dependencies` if the **main
      process** loads it at runtime, and I built and checked whether it turns
      up in `out/main`

<!--
The dependency box is not boilerplate. A renderer library listed under
dependencies ships a second copy of itself inside the installer, because Vite
has already bundled it into out/renderer. That cost 105 MB before anyone
noticed.
-->
