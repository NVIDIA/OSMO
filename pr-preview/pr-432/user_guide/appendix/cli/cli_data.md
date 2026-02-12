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

<a id="cli-reference-data"></a>

# osmo data

```default
usage: osmo data [-h] {upload,download,list,delete,check} ...
```

## Positional Arguments

* **command**: 

Possible choices: upload, download, list, delete, check

## Sub-commands

### upload

Upload data to a backend URI

```default
osmo data upload [-h] [--regex REGEX] [--processes PROCESSES]
                 [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                 remote_uri local_path [local_path ...]
```

#### Positional Arguments

* **remote_uri**: 

Location where data will be uploaded to.
* **local_path**: 

Path(s) where the data lies.

#### Named Arguments

* **--regex, -x**: 

Regex to filter which types of files to upload
* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo data upload s3://bucket/ /path/to/file

### download

Download a data from a backend URI

```default
osmo data download [-h] [--regex REGEX] [--resume] [--processes PROCESSES]
                   [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                   remote_uri local_path
```

#### Positional Arguments

* **remote_uri**: 

URI where data will be downloaded from.
* **local_path**: 

Path where data will be downloaded to.

#### Named Arguments

* **--regex, -x**: 

Regex to filter which types of files to download
* **--resume, -r**: 

Resume a download.

Default: `False`
* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo data download s3://bucket/ /path/to/folder

### list

List a data from a backend URI

```default
osmo data list [-h] [--regex REGEX] [--prefix PREFIX] [--recursive]
               [--no-pager]
               remote_uri [local_path]
```

#### Positional Arguments

* **remote_uri**: 

URI where data will be listed for.
* **local_path**: 

Path where list data will be written to.

#### Named Arguments

* **--regex, -x**: 

Regex to filter which types of files to list
* **--prefix, -p**: 

Prefix/directory to list from the remote URI.

Default: `''`
* **--recursive, -r**: 

List recursively.

Default: `False`
* **--no-pager**: 

Do not use a pager to display the list results, print directly to stdout.

Default: `False`

Ex. osmo data list s3://bucket/ /path/with/file_name

### delete

Delete a data from a backend URI

```default
osmo data delete [-h] [--regex REGEX] remote_uri
```

#### Positional Arguments

* **remote_uri**: 

URI where data will be delete from.

#### Named Arguments

* **--regex, -x**: 

Regex to filter which types of files to delete

Ex. osmo data delete s3://bucket/

### check

Check the access to a backend URI

```default
osmo data check [-h] [--access-type {READ,WRITE,DELETE}]
                [--config-file CONFIG_FILE]
                remote_uri
```

#### Positional Arguments

* **remote_uri**: 

URI where access will be checked to.

#### Named Arguments

* **--access-type, -a**: 

Possible choices: READ, WRITE, DELETE

Access type to check access to the backend URI.
* **--config-file, -c**: 

Path to the config file to use for the access check.
