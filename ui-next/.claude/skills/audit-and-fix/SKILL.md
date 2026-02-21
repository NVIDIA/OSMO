# /audit-and-fix

Run the multi-domain enforcer pipeline. Advances one domain per invocation.

---

## What I Do (3 steps, no more)

1. Launch `audit-and-fix-orchestrator` agent via Task tool (foreground — wait for exit report)
2. Parse the exit report (pipeline progress table + overall STATUS)
3. Show the progress table to the user

That is all. No reads, no writes, no loops. All state is managed inside the orchestrator.

---

## How to Invoke

```
subagent_type: audit-and-fix-orchestrator
prompt: Run the next domain in the audit-and-fix pipeline. Read audit-and-fix-pipeline-state.md, find the first active or pending domain, launch its enforcer, update state, and exit with a pipeline progress report.
```

Wait for the orchestrator to return. Then display its progress table verbatim to the user.

---

## Expected Output Format

After the orchestrator returns, display:

```
## Audit-and-Fix Pipeline

| Domain                | Status   | Iterations |
|-----------------------|----------|------------|
| error-boundaries      | DONE     | 3          |
| react-best-practices  | ACTIVE   | 1          |
| nextjs-patterns       | PENDING  | 0          |
| composition-patterns  | PENDING  | 0          |
| tailwind-standards    | PENDING  | 0          |
| design-guidelines     | PENDING  | 0          |

Active domain: react-best-practices — STATUS: CONTINUE
Overall: 1/6 domains complete

Run /audit-and-fix again to continue.
```

If STATUS is PIPELINE_COMPLETE, show the final verification result instead of "Run again".
