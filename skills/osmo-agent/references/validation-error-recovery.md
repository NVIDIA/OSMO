# Validation-Error Resource Recovery

When `osmo workflow submit` fails with a capacity-assertion validation error, the
error response includes a table of node capacity values. Use that table to rewrite
the hard-coded values in the `resources` section of `workflow.yaml` and resubmit.

> Do **not** touch Jinja template variables like `{{num_gpu}}` — those are resolved
> at runtime via `--set`, not in the YAML.

## Sizing rules

- **Storage / Memory**
  - If node capacity ≥ 50, use `floor(capacity * 0.9)`.
  - Otherwise, use `capacity - 2`.
- **CPU**
  - If node capacity ≥ 30, use `floor(capacity * 0.9)`.
  - Otherwise, use `capacity - 2`.
- **GPU**
  - Always use a multiple of 2.
  - Do not adjust based on node capacity — pick a multiple that the user wants.

## Proportionality after sizing

After setting GPU count, scale memory and CPU proportionally to the ratio of
requested GPUs to total allocatable GPUs on the node.

Example: a node with 8 allocatable GPUs and 256Gi memory after the size cap.
Requesting 2 GPUs → use 25% of the cap → 64Gi memory.

## Example walkthrough

The error table reports a node has:
- 64 GPU
- 192 CPU
- 1500Gi memory
- 1024Gi storage

The user's workflow asks for 4 GPUs.

1. **Storage cap**: 1024 ≥ 50 → `floor(1024 * 0.9)` = 921Gi.
2. **Memory cap**: 1500 ≥ 50 → `floor(1500 * 0.9)` = 1350Gi.
3. **CPU cap**: 192 ≥ 30 → `floor(192 * 0.9)` = 172.
4. **GPU**: 4 (already an even multiple of 2 — fine).
5. **Proportionality**: requesting 4/64 = 6.25% of node:
   - memory = `floor(1350 * 4 / 64)` = 84Gi
   - CPU = `floor(172 * 4 / 64)` = 10
   - storage = `floor(921 * 4 / 64)` = 57Gi

Final `resources` block to write back into `workflow.yaml`:
```yaml
resources:
  default:
    cpu: 10
    gpu: 4
    memory: 84Gi
    storage: 57Gi
```

Resubmit with the same `osmo workflow submit` command.
