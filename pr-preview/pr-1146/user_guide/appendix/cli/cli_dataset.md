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

<a id="cli-reference-dataset"></a>

# osmo dataset

<!-- CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst -->
<!-- cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=dataset | ref-prefix=cli_reference_dataset | flags=argument-anchor -->
```text
usage: osmo dataset [-h]
                    {info,upload,delete,download,update,recollect,list,tag,label,metadata,rename,query,collect,inspect,checksum,migrate,check}
                    ...
```

<a id="cli-reference-dataset-positional-arguments"></a>

## Positional Arguments

`command`
: Possible choices: info, upload, delete, download, update, recollect, list, tag, label, metadata, rename, query, collect, inspect, checksum, migrate, check

## Sub-commands

<a id="cli-reference-dataset-info"></a>

### info

Provide details of the dataset/collection

```text
osmo dataset info [-h] [--all] [--count COUNT]
                  [--order {asc,desc}]
                  [--format-type {json,text}]
                  name
```

<a id="cli-reference-dataset-info-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket with [bucket/]DS.

<a id="cli-reference-dataset-info-named-arguments"></a>

#### Named Arguments

`--all, -a`
: Display all versions in any state.
  <br/>
  Default: `False`

`--count, -c`
: For Datasets. Display the given number of versions. Default 100.
  <br/>
  Default: `100`

`--order, -o`
: Possible choices: asc, desc
  <br/>
  For Datasets. Display in the given order based on date created
  <br/>
  Default: `'asc'`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset info DS1 –format-type json

<a id="cli-reference-dataset-upload"></a>

### upload

Upload a new Dataset/Collection

```text
osmo dataset upload [-h] [--desc DESCRIPTION]
                    [--metadata METADATA [METADATA ...]]
                    [--labels LABELS [LABELS ...]]
                    [--regex REGEX] [--resume]
                    [--processes PROCESSES] [--threads THREADS]
                    [--benchmark-out BENCHMARK_OUT]
                    name path [path ...]
```

<a id="cli-reference-dataset-upload-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag with [bucket/]DS[:tag].If you want to continue an upload, then the most recent PENDING version is chosen

`path`
: Path where the dataset lies.

<a id="cli-reference-dataset-upload-named-arguments"></a>

#### Named Arguments

`--desc, -d`
: Description of dataset.
  <br/>
  Default: `''`

`--metadata, -m`
: Yaml files of metadata to assign to dataset version
  <br/>
  Default: `[]`

`--labels, -l`
: Yaml files of labels to assign to dataset
  <br/>
  Default: `[]`

`--regex, -x`
: Regex to filter which types of files to upload

`--resume, -r`
: Resume a canceled/failed upload. To resume, there must be atag.
  <br/>
  Default: `False`

`--processes, -p`
: Number of processes. Defaults to 10
  <br/>
  Default: `10`

`--threads, -T`
: Number of threads per process. Defaults to 20
  <br/>
  Default: `20`

`--benchmark-out, -b`
: Path to folder where benchmark data will be written to.

Ex. osmo dataset upload DS1:latest /path/to/file –desc “My description”

<a id="cli-reference-dataset-delete"></a>

### delete

Marks a Dataset version(s) as PENDING_DELETE. If all versions are marked, prompts the user to delete the dataset from storage. Collection are deleted

```text
osmo dataset delete [-h] [--all] [--force]
                    [--format-type {json,text}]
                    name
```

<a id="cli-reference-dataset-delete-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-delete-named-arguments"></a>

#### Named Arguments

`--all, -a`
: Deletes all versions.
  <br/>
  Default: `False`

`--force, -f`
: Deletes without confirmation.
  <br/>
  Default: `False`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset delete DS1:latest –force –format-type json

<a id="cli-reference-dataset-download"></a>

### download

Download the dataset

```text
osmo dataset download [-h] [--regex REGEX] [--resume]
                      [--processes PROCESSES] [--threads THREADS]
                      [--benchmark-out BENCHMARK_OUT]
                      name path
```

<a id="cli-reference-dataset-download-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

`path`
: Location where the dataset is downloaded to.

<a id="cli-reference-dataset-download-named-arguments"></a>

#### Named Arguments

`--regex, -x`
: Regex to filter which types of files to download

`--resume, -r`
: Resume a canceled/failed download.
  <br/>
  Default: `False`

`--processes, -p`
: Number of processes. Defaults to 10
  <br/>
  Default: `10`

`--threads, -T`
: Number of threads per process. Defaults to 20
  <br/>
  Default: `20`

`--benchmark-out, -b`
: Path to folder where benchmark data will be written to.

Ex. osmo dataset download DS1:latest /path/to/folder

<a id="cli-reference-dataset-update"></a>

### update

Creates a new dataset version from an existing version by adding or removing files.

```text
osmo dataset update [-h] [--add ADD [ADD ...]] [--remove REMOVE]
                    [--metadata METADATA [METADATA ...]]
                    [--labels LABELS [LABELS ...]]
                    [--resume RESUME] [--processes PROCESSES]
                    [--threads THREADS]
                    [--benchmark-out BENCHMARK_OUT]
                    name
```

<a id="cli-reference-dataset-update-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-update-named-arguments"></a>

#### Named Arguments

`--add, -a`
: Local paths/Remote URIs to append to the dataset. To specify path in the dataset where the files should be stored, use “:” to delineate local/path:remote/path. Files in the local path will be stored with the prefix of the remote path. If the path contains “:”, use “:” in the path.
  <br/>
  Default: `[]`

`--remove, -r`
: Regex to filter which types of files to remove.

`--metadata, -m`
: Yaml files of metadata to assign to the newly created dataset version
  <br/>
  Default: `[]`

`--labels, -l`
: Yaml files of labels to assign to the dataset
  <br/>
  Default: `[]`

`--resume`
: Resume a canceled/failed update. To resume, specify the PENDING version to continue.

`--processes, -p`
: Number of processes. Defaults to 10
  <br/>
  Default: `10`

`--threads, -T`
: Number of threads per process. Defaults to 20
  <br/>
  Default: `20`

`--benchmark-out, -b`
: Path to folder where benchmark data will be written to.

Ex. osmo dataset update DS1 –add relative/path:remote/path /other/local/path s3://path:remote/path
Ex. osmo dataset update DS1 –remove “.\*.(yaml|json)$”

<a id="cli-reference-dataset-recollect"></a>

### recollect

Add or remove datasets from a collection.

```text
osmo dataset recollect [-h] [--add ADD [ADD ...]]
                       [--remove REMOVE [REMOVE ...]]
                       name
```

<a id="cli-reference-dataset-recollect-positional-arguments"></a>

#### Positional Arguments

`name`
: Collection name. Specify bucket with [bucket/]Collection.

<a id="cli-reference-dataset-recollect-named-arguments"></a>

#### Named Arguments

`--add, -a`
: Datasets to add to collection.
  <br/>
  Default: `[]`

`--remove, -r`
: Datasets to remove from collection. The remove operation happens before the add.
  <br/>
  Default: `[]`

Ex. osmo dataset recollect C1 –remove DS1 –add DS2:4

<a id="cli-reference-dataset-list"></a>

### list

List all Datasets/Collections uploaded by the user

```text
osmo dataset list [-h] [--name NAME] [--user USER [USER ...]]
                  [--bucket BUCKET [BUCKET ...]] [--all-users]
                  [--count COUNT] [--order {asc,desc}]
                  [--format-type {json,text}]
```

<a id="cli-reference-dataset-list-named-arguments"></a>

#### Named Arguments

`--name, -n`
: Display datasets that have the given substring in their name
  <br/>
  Default: `''`

`--user, -u`
: Display all datasets where the user has uploaded to.
  <br/>
  Default: `[]`

`--bucket, -b`
: Display all datasets from the given buckets.
  <br/>
  Default: `[]`

`--all-users, -a`
: Display all datasets with no filtering on users
  <br/>
  Default: `False`

`--count, -c`
: Display the given number of datasets. Default 20. Max 1000.
  <br/>
  Default: `20`

`--order, -o`
: Possible choices: asc, desc
  <br/>
  Display in the given order. asc means latest at the bottom. desc means latest at the top
  <br/>
  Default: `'asc'`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset list –all-users or osmo dataset list –user abc xyz

<a id="cli-reference-dataset-tag"></a>

### tag

Update Dataset Version tags

```text
osmo dataset tag [-h] [--set SET [SET ...]]
                 [--delete DELETE [DELETE ...]]
                 name
```

<a id="cli-reference-dataset-tag-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-tag-named-arguments"></a>

#### Named Arguments

`--set, -s`
: Set tag to dataset version.
  <br/>
  Default: `[]`

`--delete, -d`
: Delete tag from dataset version.
  <br/>
  Default: `[]`

Ex. osmo dataset tag DS1 –set tag1 –delete tag2

<a id="cli-reference-dataset-label"></a>

### label

Update Dataset labels.

```text
osmo dataset label [-h] [--file] [--set SET [SET ...]]
                   [--delete DELETE [DELETE ...]]
                   [--format-type {json,text}]
                   name
```

<a id="cli-reference-dataset-label-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name to update. Specify bucket with [bucket/][DS].

<a id="cli-reference-dataset-label-named-arguments"></a>

#### Named Arguments

`--file, -f`
: If enabled, the inputs to set and delete must be files.
  <br/>
  Default: `False`

`--set, -s`
: Set label for dataset in the form “<key>:<type>:<value>” where type is string or numericor the file-path
  <br/>
  Default: `[]`

`--delete, -d`
: Delete labels from dataset in the form “<key>”or the file-path
  <br/>
  Default: `[]`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset label DS1 –set key1:string:value1 –delete key2

<a id="cli-reference-dataset-metadata"></a>

### metadata

Update Dataset Version metadata. A tag/version is required.

```text
osmo dataset metadata [-h] [--file] [--set SET [SET ...]]
                      [--delete DELETE [DELETE ...]]
                      [--format-type {json,text}]
                      name
```

<a id="cli-reference-dataset-metadata-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-metadata-named-arguments"></a>

#### Named Arguments

`--file, -f`
: If enabled, the inputs to set and delete must be files.
  <br/>
  Default: `False`

`--set, -s`
: Set metadata from dataset in the form “<key>:<type>:<value>” where type is string or numericor the file-path
  <br/>
  Default: `[]`

`--delete, -d`
: Delete metadata from dataset in the form “<key>”or the file-path
  <br/>
  Default: `[]`

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset metadata DS1:latest –set key1:string:value1 –delete key2

<a id="cli-reference-dataset-rename"></a>

### rename

Rename dataset/collection

```text
osmo dataset rename [-h] original_name new_name
```

<a id="cli-reference-dataset-rename-positional-arguments"></a>

#### Positional Arguments

`original_name`
: Old dataset/collection name. Specify bucket with [bucket/][DS].

`new_name`
: New dataset/collection name.

Ex. osmo dataset rename original_name new_name

<a id="cli-reference-dataset-query"></a>

### query

Query datasets based on metadata

```text
osmo dataset query [-h] [--bucket BUCKET]
                   [--format-type {json,text}]
                   file
```

<a id="cli-reference-dataset-query-positional-arguments"></a>

#### Positional Arguments

`file`
: The Query file to submit

<a id="cli-reference-dataset-query-named-arguments"></a>

#### Named Arguments

`--bucket, -b`
: bucket to query.

`--format-type, -t`
: Possible choices: json, text
  <br/>
  Specify the output format type (Default text).
  <br/>
  Default: `'text'`

Ex. osmo dataset query file.yaml

<a id="cli-reference-dataset-collect"></a>

### collect

Create a Collection

```text
osmo dataset collect [-h] name datasets [datasets ...]
```

<a id="cli-reference-dataset-collect-positional-arguments"></a>

#### Positional Arguments

`name`
: Collection name. Specify bucket and with [bucket/][C]. All datasets and collections added to this collection are based off of this bucket

`datasets`
: Each Dataset to add to collection. To create a collection from another collection, add the collection name.

Ex. osmo dataset collect CName C1 DS1 DS2 DS3:latest

<a id="cli-reference-dataset-inspect"></a>

### inspect

Display Dataset Directory

```text
osmo dataset inspect [-h] [--format-type {text,tree,json}]
                     [--regex REGEX] [--count COUNT]
                     name
```

<a id="cli-reference-dataset-inspect-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-inspect-named-arguments"></a>

#### Named Arguments

`--format-type, -t`
: Possible choices: text, tree, json
  <br/>
  Type text is that files are just printed out. Type tree displays a better representation of the directory structure. Type json prints out the list of json objects with both URI and URL links.
  <br/>
  Default: `'text'`

`--regex, -x`
: Regex to filter which types of files to inspect

`--count, -c`
: Number of files to print. Default 1,000.
  <br/>
  Default: `1000`

Ex. osmo dataset inspect DS1:latest –format-type json

<a id="cli-reference-dataset-checksum"></a>

### checksum

Calculate Directory Checksum

```text
osmo dataset checksum [-h] path [path ...]
```

<a id="cli-reference-dataset-checksum-positional-arguments"></a>

#### Positional Arguments

`path`
: Paths where the folder lies.

Ex. osmo dataset checksum /path/to/folder

<a id="cli-reference-dataset-migrate"></a>

### migrate

Migrate a legacy (non-manifest based) dataset to a new manifest based dataset.

```text
osmo dataset migrate [-h] [--processes PROCESSES]
                     [--threads THREADS]
                     [--benchmark-out BENCHMARK_OUT]
                     name
```

<a id="cli-reference-dataset-migrate-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-migrate-named-arguments"></a>

#### Named Arguments

`--processes, -p`
: Number of processes. Defaults to 10
  <br/>
  Default: `10`

`--threads, -T`
: Number of threads per process. Defaults to 20
  <br/>
  Default: `20`

`--benchmark-out, -b`
: Path to folder where benchmark data will be written to.

Ex. osmo dataset migrate DS1:latest

<a id="cli-reference-dataset-check"></a>

### check

Check access permissions for dataset operations

```text
osmo dataset check [-h] [--access-type {READ,WRITE,DELETE}]
                   [--config-file CONFIG_FILE]
                   name
```

<a id="cli-reference-dataset-check-positional-arguments"></a>

#### Positional Arguments

`name`
: Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

<a id="cli-reference-dataset-check-named-arguments"></a>

#### Named Arguments

`--access-type, -a`
: Possible choices: READ, WRITE, DELETE
  <br/>
  Access type to check access to the dataset.

`--config-file, -c`
: Path to the config file to use for the access check.
