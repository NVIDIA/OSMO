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

:tocdepth: 3

.. _cli_reference_data:

================================================
osmo data
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=data | ref-prefix=cli_reference_data | flags=argument-anchor

.. code-block:: text

   [1;34musage: [0m[1;35mosmo data[0m [[32m-h[0m] [32m{upload,download,list,delete,check} ...[0m

.. _cli_reference_data_positional_arguments:

Positional Arguments
--------------------

``command``
    Possible choices: upload, download, list, delete, check

Sub-commands
------------

.. _cli_reference_data_upload:

upload
~~~~~~

Upload data to a backend URI

.. code-block:: text

   [1;34m[0m[1;35mosmo data upload[0m [[32m-h[0m] [[36m--regex [33mREGEX[0m] [[36m--processes [33mPROCESSES[0m]
                    [[36m--threads [33mTHREADS[0m]
                    [[36m--benchmark-out [33mBENCHMARK_OUT[0m]
                    [32mremote_uri[0m [32mlocal_path [local_path ...][0m

.. _cli_reference_data_upload_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``remote_uri``
    Location where data will be uploaded to.

``local_path``
    Path(s) where the data lies.

.. _cli_reference_data_upload_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--regex, -x``
    Regex to filter which types of files to upload

``--processes, -p``
    Number of processes. Defaults to 10

    Default: ``10``

``--threads, -T``
    Number of threads per process. Defaults to 20

    Default: ``20``

``--benchmark-out, -b``
    Path to folder where benchmark data will be written to.


Ex. osmo data upload s3://bucket/ /path/to/file

.. _cli_reference_data_download:

download
~~~~~~~~

Download a data from a backend URI

.. code-block:: text

   [1;34m[0m[1;35mosmo data download[0m [[32m-h[0m] [[36m--regex [33mREGEX[0m] [[36m--resume[0m]
                      [[36m--processes [33mPROCESSES[0m] [[36m--threads [33mTHREADS[0m]
                      [[36m--benchmark-out [33mBENCHMARK_OUT[0m]
                      [32mremote_uri[0m [32mlocal_path[0m

.. _cli_reference_data_download_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``remote_uri``
    URI where data will be downloaded from.

``local_path``
    Path where data will be downloaded to.

.. _cli_reference_data_download_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--regex, -x``
    Regex to filter which types of files to download

``--resume, -r``
    Resume a download.

    Default: ``False``

``--processes, -p``
    Number of processes. Defaults to 10

    Default: ``10``

``--threads, -T``
    Number of threads per process. Defaults to 20

    Default: ``20``

``--benchmark-out, -b``
    Path to folder where benchmark data will be written to.


Ex. osmo data download s3://bucket/ /path/to/folder

.. _cli_reference_data_list:

list
~~~~

List a data from a backend URI

.. code-block:: text

   [1;34m[0m[1;35mosmo data list[0m [[32m-h[0m] [[36m--regex [33mREGEX[0m] [[36m--prefix [33mPREFIX[0m]
                  [[36m--recursive[0m]
                  [32mremote_uri[0m [[36m--no-pager[0m | [32mlocal_path[0m]

.. _cli_reference_data_list_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``remote_uri``
    URI where data will be listed for.

``local_path``
    Path where list data will be written to.

.. _cli_reference_data_list_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--regex, -x``
    Regex to filter which types of files to list

``--prefix, -p``
    Prefix/directory to list from the remote URI.

    Default: ``''``

``--recursive, -r``
    List recursively.

    Default: ``False``

``--no-pager``
    Do not use a pager to display the list results, print directly to stdout.

    Default: ``False``


Ex. osmo data list s3://bucket/ /path/with/file_name

.. _cli_reference_data_delete:

delete
~~~~~~

Delete a data from a backend URI

.. code-block:: text

   [1;34m[0m[1;35mosmo data delete[0m [[32m-h[0m] [[36m--regex [33mREGEX[0m] [32mremote_uri[0m

.. _cli_reference_data_delete_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``remote_uri``
    URI where data will be delete from.

.. _cli_reference_data_delete_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--regex, -x``
    Regex to filter which types of files to delete


Ex. osmo data delete s3://bucket/ 

.. _cli_reference_data_check:

check
~~~~~

Check the access to a backend URI

.. code-block:: text

   [1;34m[0m[1;35mosmo data check[0m [[32m-h[0m] [[36m--access-type [33m{READ,WRITE,DELETE}[0m]
                   [[36m--config-file [33mCONFIG_FILE[0m]
                   [32mremote_uri[0m

.. _cli_reference_data_check_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``remote_uri``
    URI where access will be checked to.

.. _cli_reference_data_check_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--access-type, -a``
    Possible choices: READ, WRITE, DELETE

    Access type to check access to the backend URI.

``--config-file, -c``
    Path to the config file to use for the access check.
