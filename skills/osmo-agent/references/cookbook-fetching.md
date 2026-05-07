# Fetching Cookbook Examples + Sizing Submission Count

Procedure for generating a workflow spec by adapting an existing OSMO cookbook
example, and for deciding how many copies of the workflow to submit.

## Locate and fetch a cookbook example

1. Fetch the cookbook README to browse available examples:
   ```
   https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/README.md
   ```
2. Pick the closest match to the user's request. Each entry links to a
   per-workflow README under `cookbook/<path>/README.md`.
3. Fetch that per-workflow README. Read it to find the actual workflow YAML
   filename — do not assume it is `workflow.yaml`. Workflows often use
   descriptive filenames like `isaac_sim_sdg.yaml`.
4. Construct the workflow YAML URL as
   `<per-workflow README directory URL>/<filename>` and fetch it.
5. Adapt the fetched YAML rather than rewriting from scratch. Summarize the
   per-workflow README and add the summary as a comment at the top of the
   generated spec so future readers know its origin.

## Preserve Jinja template variables

If the cookbook YAML contains `{{variable}}` placeholders (e.g. `{{num_gpu}}`),
**do not replace or hardcode them in the YAML.** Keep them as-is and pass the
user's values via `--set` at submit time. Multiple variables are
space-separated after a single `--set`:

```
osmo workflow submit workflow.yaml --pool <pool_name> --set num_gpu=4 other_var=value
```

Do not manually scale `resources` values to match the user's requested GPU
count — the template substitutions handle that.

## Decide submission count

After fetching the README and YAML, look for throughput / constraint metadata
(e.g. "produces 60 images per run", "trains 1 epoch in 4 hours"). Use it to
decide whether to submit once or many times.

- **Throughput figure + user has a target quantity:**
  ```
  num_submissions = ceil(target / throughput_per_run)
  ```
  Submit the same YAML that many times — do not duplicate the YAML file.
- **Resource spec uses Jinja variables:** scale by passing larger `--set`
  values, not by submitting more workflows.
- **Resource spec uses constants only:** scale by submitting more workflows,
  not by editing the resources block.
- **No throughput metadata in the README:** submit a single workflow unless
  the user says otherwise.

## Example sizing math

User wants ~1000 synthetic images. Cookbook README states the chosen workflow
produces 60 images per run with constants in the resources block.

```
num_submissions = ceil(1000 / 60) = 17
```

Submit `workflow.yaml` 17 times with the chosen pool. Total expected output:
17 × 60 = 1020 images.

## Scaffold template (fallback when no cookbook example matches)

When no cookbook example is close to what the user wants, generate a workflow
spec from this scaffold and adapt it. Write the output to `workflow.yaml`.

```yaml
workflow:
  name: <workflow-name>
  tasks:
  - name: <task-name>
    image: <container-image>
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    environment:
      <ENV VARIABLE>: <VALUE>
    files:
    - contents: |
        <shell script to run>
      path: /tmp/entry.sh
    outputs:
    - dataset:
        name: <output-dataset-name>
  resources:
    default:
      cpu: <N>
      gpu: <N>
      memory: <NGi>
      storage: <NGi>
```

Use `{{output}}` as a placeholder in the entry script wherever the task should
write its output data — OSMO replaces this at runtime with the output dataset
path. Do not use `{{outputs}}` (plural); only `{{output}}` is substituted.
