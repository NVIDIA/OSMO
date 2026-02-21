# Next.js Patterns Skipped Files

## Skipped Items (require human review or out-of-scope)

src/app/api/[...path]/route.impl.ts — Turbopack aliasing target; implementation varies by build mode; not directly audited (the wrapper route.ts re-exports it with absolute @/ import — correct)
