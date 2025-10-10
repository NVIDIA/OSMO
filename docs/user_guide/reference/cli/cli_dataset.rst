..
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

  SPDX-License-Identifier: Apache-2.0

.. _cli_reference_dataset:

:tocdepth: 3

================================================
osmo dataset
================================================

.. code-block::

   usage: osmo dataset [-h] {info,upload,delete,download,update,recollect,list,tag,label,metadata,rename,query,collect,inspect,checksum,migrate} ...

Positional Arguments
====================

:kbd:`command`
   Possible choices: info, upload, delete, download, update, recollect, list, tag, label, metadata, rename, query, collect, inspect, checksum, migrate

Sub-commands
============

.. _cli_reference_dataset_info:

info
----

Provide details of the dataset/collection

.. code-block::

   osmo dataset info [-h] [--all] [--count COUNT] [--order {asc,desc}] [--format-type {json,text}] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket with [bucket/]DS.


Named Arguments
~~~~~~~~~~~~~~~

--all, -a
   Display all versions in any state.

   Default: ``False``

--count, -c
   For Datasets. Display the given number of versions. Default 100.

   Default: ``100``

--order, -o
   Possible choices: asc, desc

   For Datasets. Display in the given order based on date created

   Default: ``'asc'``

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``


upload
------

Upload a new Dataset/Collection

.. code-block::

   osmo dataset upload [-h] [--desc DESCRIPTION] [--metadata METADATA [METADATA ...]] [--labels LABELS [LABELS ...]] [--regex REGEX] [--resume]
                           [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                           name path [path ...]

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag with [bucket/]DS[:tag].If you want to continue an upload, then the most recent PENDING version is chosen


:kbd:`path`
   Path where the dataset lies.


Named Arguments
~~~~~~~~~~~~~~~

--desc, -d
   Description of dataset.

   Default: ``''``

--metadata, -m
   Yaml files of metadata to assign to dataset version

   Default: ``[]``

--labels, -l
   Yaml files of labels to assign to dataset

   Default: ``[]``

--regex, -x
   Regex to filter which types of files to upload

--resume, -r
   Resume a canceled/failed upload. To resume, there must be atag.

   Default: ``False``

--start-only
   Default: ``False``

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.


delete
------

Marks a Dataset version(s) as PENDING_DELETE. If all versions are marked, prompts the user to delete the dataset from storage. Collection are deleted

.. code-block::

   osmo dataset delete [-h] [--all] [--force] [--format-type {json,text}] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--all, -a
   Deletes all versions.

   Default: ``False``

--force, -f
   Deletes without confirmation.

   Default: ``False``

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``


download
--------

Download the dataset

.. code-block::

   osmo dataset download [-h] [--regex REGEX] [--resume] [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT] name path

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].


:kbd:`path`
   Location where the dataset is downloaded to.


Named Arguments
~~~~~~~~~~~~~~~

--regex, -x
   Regex to filter which types of files to download

--resume, -r
   Resume a canceled/failed download.

   Default: ``False``

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.


update
------

Creates a new dataset version from an existing version by adding or removing files.

.. code-block::

   osmo dataset update [-h] [--add ADD [ADD ...]] [--remove REMOVE] [--metadata METADATA [METADATA ...]] [--labels LABELS [LABELS ...]] [--resume RESUME]
                           [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                           name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--add, -a
   Local paths/Remote URIs to append to the dataset. To specify path in the dataset where the files should be stored, use ":" to delineate local/path:remote/path. Files in the local path will be stored with the prefix of the remote path. If the path contains ":", use "\:" in the path.

   Default: ``[]``

--remove, -r
   Regex to filter which types of files to remove.

--metadata, -m
   Yaml files of metadata to assign to the newly created dataset version

   Default: ``[]``

--labels, -l
   Yaml files of labels to assign to the dataset

   Default: ``[]``

--resume
   Resume a canceled/failed update. To resume, specify the PENDING version to continue.

--start-only
   Default: ``False``

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.


recollect
---------

Add or remove datasets from a collection.

.. code-block::

   osmo dataset recollect [-h] [--add ADD [ADD ...]] [--remove REMOVE [REMOVE ...]] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Collection name. Specify bucket with [bucket/]Collection.


Named Arguments
~~~~~~~~~~~~~~~

--add, -a
   Datasets to add to collection.

   Default: ``[]``

--remove, -r
   Datasets to remove from collection. The remove operation happens before the add.

   Default: ``[]``


list
----

List all Datasets/Collections uploaded by the user

.. code-block::

   osmo dataset list [-h] [--name NAME] [--user USER [USER ...]] [--bucket BUCKET [BUCKET ...]] [--all-users] [--count COUNT] [--order {asc,desc}]
                         [--format-type {json,text}]

Named Arguments
~~~~~~~~~~~~~~~

--name, -n
   Display datasets that have the given substring in their name

   Default: ``''``

--user, -u
   Display all datasets where the user has uploaded to.

   Default: ``[]``

--bucket, -b
   Display all datasets from the given buckets.

   Default: ``[]``

--all-users, -a
   Display all datasets with no filtering on users

   Default: ``False``

--count, -c
   Display the given number of datasets. Default 20. Max 1000.

   Default: ``20``

--order, -o
   Possible choices: asc, desc

   Display in the given order. asc means latest at the bottom. desc means latest at the top

   Default: ``'asc'``

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``

.. _cli_reference_dataset_tag:

tag
---

Update Dataset Version tags

.. code-block::

   osmo dataset tag [-h] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--set, -s
   Set tag to dataset version.

   Default: ``[]``

--delete, -d
   Delete tag from dataset version.

   Default: ``[]``

.. _cli_reference_dataset_label:

label
-----

Update Dataset labels.

.. code-block::

   osmo dataset label [-h] [--file] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] [--format-type {json,text}] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name to update. Specify bucket with [bucket/][DS].


Named Arguments
~~~~~~~~~~~~~~~

--file, -f
   If enabled, the inputs to set and delete must be files.

   Default: ``False``

--set, -s
   Set label for dataset in the form "<key>:<type>:<value>" where type is string or numericor the file-path

   Default: ``[]``

--delete, -d
   Delete labels from dataset in the form "<key>"or the file-path

   Default: ``[]``

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``

.. _cli_reference_dataset_metadata:

metadata
--------

Update Dataset Version metadata. A tag/version is required.

.. code-block::

   osmo dataset metadata [-h] [--file] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] [--format-type {json,text}] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name to update. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--file, -f
   If enabled, the inputs to set and delete must be files.

   Default: ``False``

--set, -s
   Set metadata from dataset in the form "<key>:<type>:<value>" where type is string or numericor the file-path

   Default: ``[]``

--delete, -d
   Delete metadata from dataset in the form "<key>"or the file-path

   Default: ``[]``

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``


rename
------

Rename dataset/collection

.. code-block::

   osmo dataset rename [-h] original_name new_name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`original_name`
   Old dataset/collection name. Specify bucket with [bucket/][DS].


:kbd:`new_name`
   New dataset/collection name.



query
-----

Query datasets based on metadata

.. code-block::

   osmo dataset query [-h] [--bucket BUCKET] [--format-type {json,text}] file

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`file`
   The Query file to submit


Named Arguments
~~~~~~~~~~~~~~~

--bucket, -b
   bucket to query.

--format-type, -t
   Possible choices: json, text

   Specify the output format type (Default text).

   Default: ``'text'``


.. _cli_reference_dataset_collect:

collect
-------

Create a Collection

.. code-block::

   osmo dataset collect [-h] name datasets [datasets ...]

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Collection name. Specify bucket and with [bucket/][C]. All datasets and collections added to this collection are based off of this bucket


:kbd:`datasets`
   Each Dataset to add to collection. To create a collection from another collection, add the collection name.

.. _cli_reference_dataset_inspect:

inspect
-------

Display Dataset Directory

.. code-block::

   osmo dataset inspect [-h] [--format-type {text,tree,json}] [--regex REGEX] [--count COUNT] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--format-type, -t
   Possible choices: text, tree, json

   Type text is that files are just printed out. Type tree displays a better representation of the directory structure. Type json prints out the list of json objects with both URI and URL links.

   Default: ``'text'``

--regex, -x
   Regex to filter which types of files to inspect

--count, -c
   Number of files to print. Default 1,000.

   Default: ``1000``


checksum
--------

Calculate Directory Checksum

.. code-block::

   osmo dataset checksum [-h] path [path ...]

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`path`
   Paths where the folder lies.



migrate
-------

Migrate a legacy (non-manifest based) dataset to a new manifest based dataset.

.. code-block::

   osmo dataset migrate [-h] [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT] name

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`name`
   Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].


Named Arguments
~~~~~~~~~~~~~~~

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.
