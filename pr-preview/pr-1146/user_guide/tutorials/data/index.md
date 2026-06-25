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

<a id="tutorials-working-with-data"></a>

# Working with Data

OSMO makes it easy to upload and download data for your workflows. This tutorial will cover:

* How data is used [inside a workflow](#tutorials-working-with-data-inside-a-workflow).
* How to work with [storage URLs](#tutorials-working-with-data-storage-urls)
* How to work with [datasets](#tutorials-working-with-data-datasets)

> **Prerequisites**
>
> # Prerequisites

> Before you start, please make sure you have configured your data credentials.
> See [Data](../../getting_started/credentials.md#credentials-data) for more details.

> **Hint**
>
> The examples below demonstrate reading and writing from remote storage. Please replace any URLs
> with your own storage URLs.

<a id="tutorials-working-with-data-inside-a-workflow"></a>

## Inside a Workflow

OSMO provides two directories for data management in every task:

```text
/osmo/
├── input/              ← Read input data here
│   ├── 0/
│   └── 1/
└── output/             ← Write results here
    └── (user outputs)
```

**How it works:**

1. **Before task starts** → OSMO downloads data specified in `inputs:` to `/osmo/input/`
2. **During task execution** → Your code reads from `{{input:#}}/`
3. **After task completes** → OSMO uploads `/osmo/output/` to locations specified in `outputs:`

**Example:**

```yaml
tasks:
- name: process
  command: ["bash", "-c"]
  args:
  - |
    cat {{input:0}}/data.txt                # Reads the first input
    echo "Result" > {{output}}/result.txt   # Write output

  inputs:
  - dataset: {name: my_data}     # ← Downloads here
  outputs:
  - dataset: {name: my_results}  # ← Uploads here
```

#### SEE ALSO
The above explains the fundamentals of how a workflow can read/write data. For more details on
how **data flows between tasks** in a workflow, see [Serial Workflows](../serial_workflows/index.md#tutorials-serial-workflows).

<a id="tutorials-working-with-data-storage-urls"></a>

## Storage URLs

### URL Patterns

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

| Storage Providers                                                              | URL Pattern                             |
|--------------------------------------------------------------------------------|-----------------------------------------|
| [AWS S3](https://aws.amazon.com/s3)                                            | `s3://<bucket>/<path>`                  |
| [GCP Google Storage](https://cloud.google.com/storage/docs/buckets)            | `gs://<bucket>/<path>`                  |
| [Azure Blob Storage](https://azure.microsoft.com/en-us/products/storage/blobs) | `azure://<account>/<container>/<path>`  |
| [Torch Object Storage](https://docs.byteplus.com/en/docs/tos)                  | `tos://<endpoint>/<bucket>`             |
| [OpenStack Swift](https://docs.openstack.org/swift/latest/)                    | `swift://<endpoint>/<account>/<bucket>` |

### Uploading Data

Upload data directly to cloud storage (S3, GCS, Azure) using URLs:

```yaml

workflow:
  name: upload-to-s3

  tasks:
  - name: save-to-cloud
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      mkdir -p {{output}}/results
      echo "Model checkpoint" > {{output}}/results/model.pth
      echo "Upload complete"

    outputs:
    - url: s3://my-bucket/models/ # (1)
```

1. Files from `{{output}}` are uploaded to the S3 bucket after task completion.

### Downloading Data

Download data directly from cloud storage using URLs:

```yaml

workflow:
  name: download-from-s3

  tasks:
  - name: load-from-cloud
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      echo "Loading data from S3..."
      ls -la {{input:0}}/ # (1)
      echo "Download complete"

    inputs:
    - url: s3://my-bucket/data/ # (2)
```

1. Access downloaded files at `{{input:0}}/`.
2. Files are downloaded from S3 before the task starts.

<a id="tutorials-working-with-data-datasets"></a>

## Datasets

#### SEE ALSO
Before you start, please make sure you have set a [Default Dataset Bucket](../../getting_started/profile.md#profile-default-dataset-bucket).

### What is a Dataset?

> **Important**
>
> A **dataset** is a versioned collection of files managed by OSMO. Datasets persist beyond
> workflow execution and can be shared across workflows and teams.

**Key characteristics:**

* Datasets are versioned - each upload creates a new version
* Content-addressed for efficient storage and deduplication
* Accessible via CLI, workflows, and Web UI
* Support filtering and metadata

### Dataset Naming Convention

Datasets use the pattern `dataset_name:version`:

* `training_data` - Latest version
* `training_data:v1` - Specific version
* `training_data:baseline` - Named version

### Uploading a Dataset

To upload a dataset from a workflow task, write files to the `{{output}}` directory and
specify a `dataset` in the outputs:

```yaml

workflow:
  name: create-dataset

  tasks:
  - name: generate-data
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      echo "Generating data..."
      mkdir -p {{output}}/data
      for i in {1..10}; do
        echo "Sample data $i" > {{output}}/data/file_$i.txt
      done
      echo "Data generation complete"

    outputs:
    - dataset:
        name: my_dataset # (1)
```

1. Everything in `{{output}}` is uploaded to `my_dataset` after the task completes successfully.

Once uploaded, you can download a dataset to your local machine using the CLI:

```bash
# Download latest version
$ osmo dataset download my_dataset /tmp

# Download specific version
$ osmo dataset download my_dataset:1 /tmp
```

### Downloading a Dataset

To download a dataset in a workflow, add it to the task’s inputs. To reference the dataset, use the
[Special Tokens](../../workflows/specification/templates_and_tokens.md#workflow-spec-special-tokens) `{{input:#}}` where # is the zero-based index of the input.

```yaml

workflow:
  name: read-dataset

  tasks:
  - name: process-data
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      echo "Reading dataset..."
      ls -la {{input:0}}/my_dataset/ # (1)
      cat {{input:0}}/my_dataset/data/file_1.txt
      echo "Processing complete"

    inputs:
    - dataset:
        name: my_dataset # (2)
```

1. Access the dataset at `{{input:0}}/my_dataset/` where `{{input:0}}` is the first input.
2. The dataset is downloaded before the task starts.

## Combining URLs and Datasets

You can mix URLs and datasets in the same workflow:

```yaml

workflow:
  name: mixed-storage

  tasks:
  - name: process-multiple-sources
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args:
    - |
      echo "Processing data from multiple sources..."
      cat {{input:0}}/my_dataset/data.txt
      cat {{input:1}}/s3_data.txt

      # Generate outputs
      echo "Processed results" > {{output}}/results.txt

    inputs:
    - dataset:
        name: my_dataset # (1)
    - url: s3://my-bucket/raw-data/ # (2)

    outputs:
    - dataset:
        name: processed_data # (3)
    - url: s3://my-bucket/outputs/ # (4)
```

1. Download from OSMO dataset at `{{input:0}}/my_dataset/`.
2. Download from S3 at `{{input:1}}/`.
3. Upload to OSMO dataset.
4. Also upload to S3 bucket.

## Filtering Data

Filter which files to download or upload using regex patterns:

```yaml

workflow:
  name: filtered-io

  tasks:
  - name: selective-download
    image: ubuntu:24.04
    command: ["bash", "-c"]
    args: ["ls -la {{input:0}}/"]

    inputs:
    - dataset:
        name: large_dataset
        regex: .*\.txt$ # (1)

    outputs:
    - dataset:
        name: output_dataset
        regex: .*\.(json|yaml)$ # (2)
```

1. Only download `.txt` files from the input dataset.
2. Only upload `.json` and `.yaml` files to the output dataset.

## Next Steps

Now that you understand data management, you’re ready to build more complex workflows.
Continue to [Serial Workflows](../serial_workflows/index.md#tutorials-serial-workflows) to learn about task dependencies.

#### SEE ALSO
- [Inputs and Outputs Reference](../../workflows/specification/inputs_and_outputs.md#workflow-spec-inputs-and-outputs)
- [File Injection](../../workflows/specification/file_injection.md#workflow-spec-file-injection)
