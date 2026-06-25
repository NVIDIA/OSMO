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

.. _cli_reference_app:

================================================
osmo app
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=app | ref-prefix=cli_reference_app | flags=argument-anchor

Apps are reusable workflow files that can be shared with other users.

.. code-block:: text

   usage: osmo app [-h]
                   {create,update,info,show,spec,list,delete,rename,submit}
                   ...

.. _cli_reference_app_positional_arguments:

Positional Arguments
--------------------

``command``
    Possible choices: create, update, info, show, spec, list, delete, rename, submit

Sub-commands
------------

.. _cli_reference_app_create:

create
~~~~~~

If file is not provided, the app will be created using the user's editor.

.. code-block:: text

   osmo app create [-h] --description DESCRIPTION [--file FILE] name

.. _cli_reference_app_create_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app.

.. _cli_reference_app_create_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--description, -d``
    Description of the app.

``--file, -f``
    Path to the app file.


Ex. osmo app create my-app --description "My app description"

.. _cli_reference_app_update:

update
~~~~~~

Update a workflow app using the user's editor.

.. code-block:: text

   osmo app update [-h] [--file FILE] name

.. _cli_reference_app_update_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Can specify a version number to edit from a specific version by using <app>:<version> format.

.. _cli_reference_app_update_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--file, -f``
    Path to the app file.


Ex. osmo app update my-app

.. _cli_reference_app_info:

info
~~~~

Show app and app version information.

.. code-block:: text

   osmo app info [-h] [--count COUNT] [--order {asc,desc}]
                 [--format-type {json,text}]
                 name

.. _cli_reference_app_info_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Specify version to get info from a specific version by using <app>:<version> format.

.. _cli_reference_app_info_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--count, -c``
    For Datasets. Display the given number of versions. Default 20.

    Default: ``20``

``--order, -o``
    Possible choices: asc, desc

    Display in the given order. asc means latest at the bottom. desc means latest at the top

    Default: ``'asc'``

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``


Ex. osmo app info my-app

.. _cli_reference_app_show:

show
~~~~

Show app parameters.

.. code-block:: text

   osmo app show [-h] name

.. _cli_reference_app_show_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Specify version to get info from a specific version by using <app>:<version> format.

.. _cli_reference_app_spec:

spec
~~~~

Show app spec.

.. code-block:: text

   osmo app spec [-h] name

.. _cli_reference_app_spec_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Specify version to get info from a specific version by using <app>:<version> format.

.. _cli_reference_app_list:

list
~~~~

Lists all apps you created, updated, or submitted by default. If --user is specified, it will list all apps owned by the user(s).

.. code-block:: text

   osmo app list [-h] [--name NAME] [--user USER [USER ...]]
                 [--all-users] [--count COUNT] [--order {asc,desc}]
                 [--format-type {json,text}]

.. _cli_reference_app_list_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--name, -n``
    Display apps that have the given substring in their name

``--user, -u``
    Display all app where the user has created.

``--all-users, -a``
    Display all apps with no filtering on users

    Default: ``False``

``--count, -c``
    Display the given number of apps. Default 20.

    Default: ``20``

``--order, -o``
    Possible choices: asc, desc

    Display in the given order. asc means latest at the bottom. desc means latest at the top

    Default: ``'asc'``

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

.. _cli_reference_app_delete:

delete
~~~~~~

Delete a workflow app version you created.

.. code-block:: text

   osmo app delete [-h] [--all] [--force] name

.. _cli_reference_app_delete_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Specify version to delete a specific version by using <app>:<version> format.

.. _cli_reference_app_delete_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--all, -a``
    Delete all versions of the app.

    Default: ``False``

``--force, -f``
    Delete the app without user confirmation.

    Default: ``False``


Ex. osmo app delete my-app

.. _cli_reference_app_rename:

rename
~~~~~~

Rename a workflow app from the original name to a new name.

.. code-block:: text

   osmo app rename [-h] [--force] original_name new_name

.. _cli_reference_app_rename_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``original_name``
    Original name of the app.

``new_name``
    New name for the app.

.. _cli_reference_app_rename_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--force, -f``
    Rename the app without user confirmation.

    Default: ``False``


Ex. osmo app rename original-app-name new-app-name

.. _cli_reference_app_submit:

submit
~~~~~~

Submit a workflow app version you created.

.. code-block:: text

   osmo app submit [-h] [--format-type {json,text}]
                   [--set SET [SET ...]]
                   [--set-string SET_STRING [SET_STRING ...]]
                   [--set-env SET_ENV [SET_ENV ...]] [--dry-run]
                   [--pool POOL] [--local-path LOCAL_PATH]
                   [--rsync RSYNC] [--priority {HIGH,NORMAL,LOW}]
                   name

.. _cli_reference_app_submit_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``name``
    Name of the app. Specify version to submit a specific version by using <app>:<version> format.

.. _cli_reference_app_submit_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

``--set``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable

    Default: ``[]``

``--set-string``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string

    Default: ``[]``

``--set-env``
    Assign environment variables to the workflow. The value should be in the format <key>=<value>. Multiple key-value pairs can be passed. If an environment variable passed here is already defined in the workflow, the value declared here will override the value in the workflow.

    Default: ``[]``

``--dry-run``
    Does not submit the workflow and prints the workflow into the console.

    Default: ``False``

``--pool, -p``
    The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

``--local-path, -l``
    The absolute path to the location for where local files in the workflow file should be fetched from. If not specified, the current working directory will be used.

``--rsync``
    Start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow. The value should be in the format <local_path>:<remote_path>. The daemon process will automatically exit when the workflow is terminated.

``--priority``
    Possible choices: HIGH, NORMAL, LOW

    The priority to use when scheduling the workflow. If none is provided, NORMAL will be used. The scheduler will prioritize scheduling workflows in the order of HIGH, NORMAL, LOW. LOW workflows may be preempted to allow a higher priority workflow to run.
