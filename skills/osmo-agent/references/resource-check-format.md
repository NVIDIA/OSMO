# Resource Check Output Format

Required output format for the "Check Available Resources" use case.

## `osmo pool list` column meanings

| Column | Meaning |
|---|---|
| Quota Limit | Max GPUs the user can claim at HIGH/NORMAL priority |
| Quota Used | GPUs currently consumed by the user's workflows |
| Quota Free | GPUs the user can still allocate |
| Total Capacity | All GPUs on nodes in the pool |
| Total Usage | GPUs used by everyone in the pool |
| Total Free | GPUs physically free on nodes |

`Effective availability = min(Quota Free, Total Free)` — both limits apply.

## Header line

Open with a one-line summary:

> "You have access to `<N>` pools, `<M>` ONLINE. Here are the highlights by GPU
> type:"

## Grouping

Group pools by GPU type with section headers like `GB200 Pools`, `H100 Pools`,
`L40S Pools`, `L40 Pools` (use `Other Pools` for anything that doesn't match a
known type). Do not enforce a fixed ordering across sections — use whatever order
is most readable for the current result set (typically: group with most free
capacity first).

Derive GPU type from each pool's name:

| Pool name contains | GPU type |
|---|---|
| `gb200` | `GB200` |
| `h100` | `H100` |
| `l40s` | `L40S` |
| `l40` (and not `l40s`) | `L40` |
| anything else | `Other` |

## Tables

Render one table per GPU type. Box-drawing style is preferred for readability;
markdown table is an acceptable fallback when the renderer doesn't support
box-drawing.

Columns (in order):

| Column | Source / formula |
|---|---|
| `Pool` | Pool name. Append `(default)` to the user's default pool. |
| `Quota Free` | `resource_usage.quota_free` |
| `Physically Free` | `resource_usage.total_free`. Preserve markers like `(shared)` if present in the source. |
| `Effective` | `min(Quota Free, Total Free)` |

Sort rows within each section by `Effective` descending.

Optional inline annotations:
- Mark the top pool in a section with `✅ Most available`.
- Use `(default)` next to the user's default pool name.

## Callouts (after the grouped tables)

Add short callouts for any of these conditions present in the result set:

- **Pools at capacity** — list any pool with `Effective = 0`.
- **LOW-priority opportunity** — list any pool with `Quota Free = 0` and
  `Total Free > 0`. State that submitting with `--priority LOW` will bypass quota
  on idle capacity, with a note that LOW jobs may be preempted.

## Example skeleton

```text
You have access to 5 pools, 4 ONLINE. Here are the highlights by GPU type:

H100 Pools
┌──────────────────────┬────────────┬─────────────────┬───────────┐
│ Pool                 │ Quota Free │ Physically Free │ Effective │
├──────────────────────┼────────────┼─────────────────┼───────────┤
│ h100-east (default)  │ 8          │ 12              │ 8 ✅      │
│ h100-west            │ 4          │ 4               │ 4         │
└──────────────────────┴────────────┴─────────────────┴───────────┘

GB200 Pools
…

(callouts)
```
