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

```default
usage: osmo dataset [-h]
                    {info,upload,delete,download,update,recollect,list,tag,label,metadata,rename,query,collect,inspect,checksum,migrate,check}
                    ...
```

## Positional Arguments

* **command**: 

Possible choices: info, upload, delete, download, update, recollect, list, tag, label, metadata, rename, query, collect, inspect, checksum, migrate, check

## Sub-commands

### info

Provide details of the dataset/collection

```default
osmo dataset info [-h] [--all] [--count COUNT] [--order {asc,desc}]
                  [--format-type {json,text}]
                  name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket with [bucket/]DS.

#### Named Arguments

* **--all, -a**: 

Display all versions in any state.

Default: `False`
* **--count, -c**: 

For Datasets. Display the given number of versions. Default 100.

Default: `100`
* **--order, -o**: 

Possible choices: asc, desc

For Datasets. Display in the given order based on date created

Default: `'asc'`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset info DS1 –format-type json

### upload

Upload a new Dataset/Collection

```default
osmo dataset upload [-h] [--desc DESCRIPTION]
                    [--metadata METADATA [METADATA ...]]
                    [--labels LABELS [LABELS ...]] [--regex REGEX] [--resume]
                    [--processes PROCESSES] [--threads THREADS]
                    [--benchmark-out BENCHMARK_OUT]
                    name path [path ...]
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag with [bucket/]DS[:tag].If you want to continue an upload, then the most recent PENDING version is chosen
* **path**: 

Path where the dataset lies.

#### Named Arguments

* **--desc, -d**: 

Description of dataset.

Default: `''`
* **--metadata, -m**: 

Yaml files of metadata to assign to dataset version

Default: `[]`
* **--labels, -l**: 

Yaml files of labels to assign to dataset

Default: `[]`
* **--regex, -x**: 

Regex to filter which types of files to upload
* **--resume, -r**: 

Resume a canceled/failed upload. To resume, there must be atag.

Default: `False`
* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo dataset upload DS1:latest /path/to/file –desc “My description”

### delete

Marks a Dataset version(s) as PENDING_DELETE. If all versions are marked, prompts the user to delete the dataset from storage. Collection are deleted

```default
osmo dataset delete [-h] [--all] [--force] [--format-type {json,text}] name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--all, -a**: 

Deletes all versions.

Default: `False`
* **--force, -f**: 

Deletes without confirmation.

Default: `False`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset delete DS1:latest –force –format-type json

### download

Download the dataset

```default
osmo dataset download [-h] [--regex REGEX] [--resume] [--processes PROCESSES]
                      [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                      name path
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].
* **path**: 

Location where the dataset is downloaded to.

#### Named Arguments

* **--regex, -x**: 

Regex to filter which types of files to download
* **--resume, -r**: 

Resume a canceled/failed download.

Default: `False`
* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo dataset download DS1:latest /path/to/folder

### update

Creates a new dataset version from an existing version by adding or removing files.

```default
osmo dataset update [-h] [--add ADD [ADD ...]] [--remove REMOVE]
                    [--metadata METADATA [METADATA ...]]
                    [--labels LABELS [LABELS ...]] [--resume RESUME]
                    [--processes PROCESSES] [--threads THREADS]
                    [--benchmark-out BENCHMARK_OUT]
                    name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--add, -a**: 

Local paths/Remote URIs to append to the dataset. To specify path in the dataset where the files should be stored, use “:” to delineate local/path:remote/path. Files in the local path will be stored with the prefix of the remote path. If the path contains “:”, use “:” in the path.

Default: `[]`
* **--remove, -r**: 

Regex to filter which types of files to remove.
* **--metadata, -m**: 

Yaml files of metadata to assign to the newly created dataset version

Default: `[]`
* **--labels, -l**: 

Yaml files of labels to assign to the dataset

Default: `[]`
* **--resume**: 

Resume a canceled/failed update. To resume, specify the PENDING version to continue.
* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo dataset update DS1 –add relative/path:remote/path /other/local/path s3://path:remote/path
Ex. osmo dataset update DS1 –remove “.\*.(yaml|json)$”

### recollect

Add or remove datasets from a collection.

```default
osmo dataset recollect [-h] [--add ADD [ADD ...]]
                       [--remove REMOVE [REMOVE ...]]
                       name
```

#### Positional Arguments

* **name**: 

Collection name. Specify bucket with [bucket/]Collection.

#### Named Arguments

* **--add, -a**: 

Datasets to add to collection.

Default: `[]`
* **--remove, -r**: 

Datasets to remove from collection. The remove operation happens before the add.

Default: `[]`

Ex. osmo dataset recollect C1 –remove DS1 –add DS2:4

### list

List all Datasets/Collections uploaded by the user

```default
osmo dataset list [-h] [--name NAME] [--user USER [USER ...]]
                  [--bucket BUCKET [BUCKET ...]] [--all-users] [--count COUNT]
                  [--order {asc,desc}] [--format-type {json,text}]
```

#### Named Arguments

* **--name, -n**: 

Display datasets that have the given substring in their name

Default: `''`
* **--user, -u**: 

Display all datasets where the user has uploaded to.

Default: `[]`
* **--bucket, -b**: 

Display all datasets from the given buckets.

Default: `[]`
* **--all-users, -a**: 

Display all datasets with no filtering on users

Default: `False`
* **--count, -c**: 

Display the given number of datasets. Default 20. Max 1000.

Default: `20`
* **--order, -o**: 

Possible choices: asc, desc

Display in the given order. asc means latest at the bottom. desc means latest at the top

Default: `'asc'`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset list –all-users or osmo dataset list –user abc xyz

### tag

Update Dataset Version tags

```default
osmo dataset tag [-h] [--set SET [SET ...]] [--delete DELETE [DELETE ...]]
                 name
```

#### Positional Arguments

* **name**: 

Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--set, -s**: 

Set tag to dataset version.

Default: `[]`
* **--delete, -d**: 

Delete tag from dataset version.

Default: `[]`

Ex. osmo dataset tag DS1 –set tag1 –delete tag2

### label

Update Dataset labels.

```default
osmo dataset label [-h] [--file] [--set SET [SET ...]]
                   [--delete DELETE [DELETE ...]] [--format-type {json,text}]
                   name
```

#### Positional Arguments

* **name**: 

Dataset name to update. Specify bucket with [bucket/][DS].

#### Named Arguments

* **--file, -f**: 

If enabled, the inputs to set and delete must be files.

Default: `False`
* **--set, -s**: 

Set label for dataset in the form “<key>:<type>:<value>” where type is string or numericor the file-path

Default: `[]`
* **--delete, -d**: 

Delete labels from dataset in the form “<key>”or the file-path

Default: `[]`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset label DS1 –set key1:string:value1 –delete key2

### metadata

Update Dataset Version metadata. A tag/version is required.

```default
osmo dataset metadata [-h] [--file] [--set SET [SET ...]]
                      [--delete DELETE [DELETE ...]]
                      [--format-type {json,text}]
                      name
```

#### Positional Arguments

* **name**: 

Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--file, -f**: 

If enabled, the inputs to set and delete must be files.

Default: `False`
* **--set, -s**: 

Set metadata from dataset in the form “<key>:<type>:<value>” where type is string or numericor the file-path

Default: `[]`
* **--delete, -d**: 

Delete metadata from dataset in the form “<key>”or the file-path

Default: `[]`
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset metadata DS1:latest –set key1:string:value1 –delete key2

### rename

Rename dataset/collection

```default
osmo dataset rename [-h] original_name new_name
```

#### Positional Arguments

* **original_name**: 

Old dataset/collection name. Specify bucket with [bucket/][DS].
* **new_name**: 

New dataset/collection name.

Ex. osmo dataset rename original_name new_name

### query

Query datasets based on metadata

```default
osmo dataset query [-h] [--bucket BUCKET] [--format-type {json,text}] file
```

#### Positional Arguments

* **file**: 

The Query file to submit

#### Named Arguments

* **--bucket, -b**: 

bucket to query.
* **--format-type, -t**: 

Possible choices: json, text

Specify the output format type (Default text).

Default: `'text'`

Ex. osmo dataset query file.yaml

### collect

Create a Collection

```default
osmo dataset collect [-h] name datasets [datasets ...]
```

#### Positional Arguments

* **name**: 

Collection name. Specify bucket and with [bucket/][C]. All datasets and collections added to this collection are based off of this bucket
* **datasets**: 

Each Dataset to add to collection. To create a collection from another collection, add the collection name.

Ex. osmo dataset collect CName C1 DS1 DS2 DS3:latest

### inspect

Display Dataset Directory

```default
osmo dataset inspect [-h] [--format-type {text,tree,json}] [--regex REGEX]
                     [--count COUNT]
                     name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--format-type, -t**: 

Possible choices: text, tree, json

Type text is that files are just printed out. Type tree displays a better representation of the directory structure. Type json prints out the list of json objects with both URI and URL links.

Default: `'text'`
* **--regex, -x**: 

Regex to filter which types of files to inspect
* **--count, -c**: 

Number of files to print. Default 1,000.

Default: `1000`

Ex. osmo dataset inspect DS1:latest –format-type json

### checksum

Calculate Directory Checksum

```default
osmo dataset checksum [-h] path [path ...]
```

#### Positional Arguments

* **path**: 

Paths where the folder lies.

Ex. osmo dataset checksum /path/to/folder

### migrate

Migrate a legacy (non-manifest based) dataset to a new manifest based dataset.

```default
osmo dataset migrate [-h] [--processes PROCESSES] [--threads THREADS]
                     [--benchmark-out BENCHMARK_OUT]
                     name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--processes, -p**: 

Number of processes. Defaults to 4

Default: `4`
* **--threads, -T**: 

Number of threads per process. Defaults to 20

Default: `20`
* **--benchmark-out, -b**: 

Path to folder where benchmark data will be written to.

Ex. osmo dataset migrate DS1:latest

### check

Check access permissions for dataset operations

```default
osmo dataset check [-h] [--access-type {READ,WRITE,DELETE}]
                   [--config-file CONFIG_FILE]
                   name
```

#### Positional Arguments

* **name**: 

Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

#### Named Arguments

* **--access-type, -a**: 

Possible choices: READ, WRITE, DELETE

Access type to check access to the dataset.
* **--config-file, -c**: 

Path to the config file to use for the access check.
