# Modules

Each folder in `app/modules/` is a **deep module**: a lot of behaviour behind a small interface. Its interface is its **entry points**, the files at the module's root. Everything in a subfolder is private.

```
app/modules/
  <name>/
    index.server.ts   ← an entry point. Import this from outside.
    client.ts         ← another entry point, if the module needs one.
    lib/              ← implementation: private, files import each other freely.
    tests/            ← tests and fixtures: private, and test through entry points.
```

`instructor-analytics/` is the reference module: copy its shape.

**Don't write barrel files.** An entry point that re-exports a whole subtree makes every internal part of the interface. Expose a few small entry points instead, each exporting only what callers need. Adding an entry point means adding a root file; no config change is needed.

Use the `.server.ts` suffix on entry points that touch the database or other server-only code, so React Router keeps them out of the client bundle.

## The rules

`npm run lint:boundaries` (dependency-cruiser, configured in `.dependency-cruiser.cjs`) enforces these. `npm run check` runs it with typecheck and tests. Type-only imports count.

**Entry-point boundary.** Code outside a module (routes, components, `app/lib`, other modules) imports only that module's root files, never anything in its subfolders.

**Internal freedom.** A module's own files import each other freely.

**Tests through the entry points.** Files in `<module>/tests/` may import any module's entry points and their own fixtures, but no module's internals, not even their own. If a test needs to reach past the interface, the module is the wrong shape. Pass dependencies such as the database through the entry point instead.

**No cycles.** No dependency cycles anywhere in `app/`. Cycles made only of `import type` edges are allowed, because TypeScript erases them.
