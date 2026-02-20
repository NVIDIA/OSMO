<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="training-reschedule"></a>

# Fault-Tolerant Training with Rescheduling

This tutorial demonstrates how to implement fault-tolerant training that can
automatically reschedule tasks when backend errors occur. This is particularly
useful for long-running training jobs that may encounter transient failures
(e.g. NCCL errors).

The complete workflow example is available [here](https://github.com/NVIDIA/OSMO/tree/main/workflows/dnn_training/torchrun_reschedule).
For other elastic training examples, please visit [here](https://github.com/NVIDIA/OSMO/tree/main/workflows/dnn_training).

## Resume Training When Tasks Rerun

In order to automatically reschedule the training job when backend errors occur,
you need to first make sure the training script can both start from scratch and resume from checkpoints:

```python
class Trainer:
    def __init__(self, model: torch.nn.Module, snapshot_path: str):
        self.model = model
        self.epochs_run = 0
        if os.path.exists(snapshot_path):
            print("Loading snapshot")
            self._load_snapshot()

    def _load_snapshot(self, snapshot_path):
        loc = f"cuda:{self.local_rank}"
        snapshot = torch.load(snapshot_path, map_location=loc)
        self.model.load_state_dict(snapshot["MODEL_STATE"])
        self.epochs_run = snapshot["EPOCHS_RUN"]

    def _save_snapshot(self, epoch):
        snapshot = {
            "MODEL_STATE": self.model.module.state_dict(),
            "EPOCHS_RUN": epoch,
        }
        torch.save(snapshot, self.snapshot_path)
```

In the workflow spec, you can load and checkpoint the snapshots with [checkpointing](../../workflows/specification/checkpointing.md#workflow-spec-checkpointing).
Checkpointing snapshots regularly so that when the task fails and has to be rescheduled,
the training can take the last checkpoint as input and resume from there:

```jinja
tasks:
- name: master
  inputs:
  - url: {{upload_location}}/models
  checkpoint:
  - path: /tmp/models
    url: {{upload_location}}
    frequency: 5m
```

Now you can also make sure the entry script can both start from scratch and resume from checkpoints:

```bash
# Copy the training checkpoint if it exists
mkdir -p /tmp/models
if [ -f "{{input:0}}/snapshot.pth" ]; then
    echo "Found snapshot file, copying..."
    cp {{input:0}}/snapshot.pth /tmp/models
    echo "Snapshot copied successfully"
else
    echo "Warning: snapshot.pth not found at {{input:0}}/snapshot.pth"
fi
```

## Catch Reschedulable Failures

Not all errors are resolvable by rescheduling the task.
The best practice is to isolate the errors that we want to reschedule,
and only reschedule when these errors occur:

In Python script:

```python
# Catch NCCL related errors and write to error logs
except (torch.distributed.DistBackendError, ChildFailedError) as err:
    error_message = f"Training error occurred: {err}\n"
    error_log_path = f"{args.error_log}.rank_{global_rank}"
    with open(error_log_path, 'a') as error_file:
        error_file.write(error_message)
```

In workflow launch script:

```bash
# Check if there are any errors that require task rescheduling
if ls /tmp/training_errors.log.* 1> /dev/null 2>&1; then
    echo "Error: Training error log files found at /tmp/training_errors.log.*"
    echo "Exiting with code {{ reschedule_code }} and rescheduling the task"
    exit {{ reschedule_code }}
fi
```

## Configure Reschedule Actions

Lastly, you need to configure the workflow to reschedule the task when it exists with the specified exit code
as defined in the block above.

```yaml
exitActions:
  RESCHEDULE: {{ reschedule_code }}
```

By default, if a non-lead task reschedules, the other tasks in the group will not be affected.
Therefore, you need to set `ignoreNonleadStatus` to `false` to make sure the other tasks can be restarted.

```yaml
groups:
- name: training
  ignoreNonleadStatus: false
```

See more about `ignoreNonleadStatus` in [Group](../../workflows/specification/index.md#workflow-spec-group) and actions on exit codes in [Exit Actions](../../workflows/specification/exit_actions.md#workflow-spec-exit-actions).
