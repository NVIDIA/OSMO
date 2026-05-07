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

Group pools by GPU type, with one section per type. Use the GPU model
identifier as the section header (e.g. `GB200 Pools`, `H100 Pools`, `L40S
Pools`, `A100 Pools`, `B200 Pools`, `RTX 5090 Pools`). Do not enforce a fixed
ordering across sections — use whatever order is most readable for the current
result set (typically: section with most free capacity first).

### Deriving the GPU type from the pool name

Find an NVIDIA GPU model identifier embedded in each pool name and use it
(uppercased) as the section header. Cover the common families and remain open
to identifiers you haven't seen before:

- **Data center**: `A100`, `H100`, `H200`, `B100`, `B200`, `GB200`, `GB300`,
  `V100`, `T4`, `L4`, `L40`, `L40S`, `A40`, `A30`, `A10`
- **Workstation / RTX**: e.g. `RTX 6000`, `RTX A6000`, `RTX 5090`
- **Embedded / Jetson**: e.g. `Orin`, `Thor`, `Xavier`

Match the **longest** identifier when multiple substrings could fit (e.g. a
pool name containing `l40s` is `L40S`, not `L40`; `gb200-shared` is `GB200`,
not `B200`). Matching is case-insensitive but the section header should be
uppercase.

For unfamiliar names, treat any case-insensitive token matching the pattern
`[A-Z]+\d+[A-Z]*` (e.g. a future `B300`, `GH200`, or new `H300`) as a
plausible model identifier — use it as the section header rather than dumping
the pool into `Other`. The goal is that a new hardware generation should not
require updating this skill to render correctly.

If no model identifier is recognizable in the pool name, place the pool under
`Other Pools`.

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
