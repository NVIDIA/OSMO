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

.. _cli_reference_data:

:tocdepth: 3

================================================
osmo data
================================================

.. code-block::

   usage: osmo data [-h] {upload,download,list,delete} ...

Positional Arguments
====================

:kbd:`command`
   Possible choices: upload, download, list, delete

Sub-commands
============

upload
------

Upload data to a backend URI

.. code-block::

   osmo data upload [-h] [--regex REGEX] [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT]
                        remote_uri local_path [local_path ...]

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`remote_uri`
   Location where data will be uploaded to.


:kbd:`local_path`
   Path(s) where the data lies.


Named Arguments
~~~~~~~~~~~~~~~

--regex, -x
   Regex to filter which types of files to upload

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.


download
--------

Download a data from a backend URI

.. code-block::

   osmo data download [-h] [--regex REGEX] [--resume] [--processes PROCESSES] [--threads THREADS] [--benchmark-out BENCHMARK_OUT] remote_uri local_path

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`remote_uri`
   URI where data will be downloaded from.


:kbd:`local_path`
   Path where data will be downloaded to.


Named Arguments
~~~~~~~~~~~~~~~

--regex, -x
   Regex to filter which types of files to download

--resume, -r
   Resume a download.

   Default: ``False``

--processes, -p
   Number of processes. Defaults to 8

   Default: ``8``

--threads, -T
   Number of threads per process. Defaults to 20

   Default: ``20``

--benchmark-out, -b
   Path to folder where benchmark data will be written to.


list
----

List a data from a backend URI

.. code-block::

   osmo data list [-h] [--regex REGEX] [--prefix PREFIX] [--recursive] [--no-pager] remote_uri [local_path]

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`remote_uri`
   URI where data will be listed for.


:kbd:`local_path`
   Path where list data will be written to.


Named Arguments
~~~~~~~~~~~~~~~

--regex, -x
   Regex to filter which types of files to list

--prefix, -p
   Prefix/directory to list from the remote URI.

   Default: ``''``

--recursive, -r
   List recursively.

   Default: ``False``

--no-pager
   Do not use a pager to display the list results, print directly to stdout.

   Default: ``False``


delete
------

Delete a data from a backend URI

.. code-block::

   osmo data delete [-h] [--regex REGEX] remote_uri

Positional Arguments
~~~~~~~~~~~~~~~~~~~~

:kbd:`remote_uri`
   URI where data will be delete from.


Named Arguments
~~~~~~~~~~~~~~~

--regex, -x
   Regex to filter which types of files to delete
