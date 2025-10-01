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

.. _concepts_wf_specification:

================================================
Specification
================================================

A workflow is defined using a workflow specification. The workflow specification is a YAML file
that describes a list of tasks to run. The workflow format is:

.. code-block:: yaml

  workflow:
    name: my_workflow   # Workflow name
    tasks:              # List of tasks to run
    - name: task1       # Name of task
      image: ubuntu     # Docker image to use as the task container
      command: [echo]   # Command to run
      args: ["Task1!"]  # Arguments to use in the command
      inputs:           # Inputs to load into the task container (optional)
      - ...             # Input 1
      - ...             # Input 2
      outputs:          # Outputs to upload after completion (optional)
      - ...             # Output 1
      files:            # Files to mount into the task container
      - ...             # File 1
      resources:         # Hardware resource required to run the task
      ...
    - name: task2
      image: ubuntu
      command: [echo]
      args: ["Task2!"]
      inputs:
      - task1
      - ...
      outputs:
      - ...
      files:
      - ...
      resources:

Tasks are defined in a list under the **tasks** keyword in the workflow spec. The following fields can be used to describe a task in the workflow spec:

..  list-table::
    :header-rows: 1
    :widths: 30, 60

    * - **Field**
      - **Description**
    * - name (required)
      - A string to identify the task
    * - image (required)
      - The URL and tag of the docker image to use
    * - command (required)
      - The command to run inside the Docker image. It overrides the default entrypoint. The command is interpreted as a list. You must turn your commands into a list using square brackets or bullet points.
    * - lead (required)
      - Boolean value to set a task as a group leader. Each group must have one task that has lead set to True. Required if ``groups`` are used.
    * - args (optional)
      - A list of arguments to pass to the program inside the Docker image. The ‘args’ field is only permitted if the ‘command’ field is provided. Args is interpreted as a list. You must turn your commands into a list using square brackets or bullet points.
    * - files (optional)
      - A file is a feature used to add new files into a container at runtime. It requires two parameters: path and contents. ``Path`` is where to create this file inside the container. ``Content`` has all the commands and file content required for the file. ``localpath`` is relative to the workflow YAML's location. You can add a file with content in a different file and the contents are mounted into the task’s container.
    * - resource (optional)
      - Set the resource spec to match to. If no value is set, the value is set to ‘default’.
    * - inputs (optional)
      - An input is a source of data to be placed in the input directory.
    * - outputs (optional)
      - An output specifies a location to store files from the task’s output directory after it has completed.
    * - privileged (optional)
      - Boolean value to set privileged mode. The default value is False, and only tasks running on certain nodes that have privileged mode enabled can set privileged to True.
    * - hostNetwork (optional)
      - Boolean value to set host network. The default value is False, and only tasks running on certain nodes that have host network enabled can set it to True.
    * - environment (optional)
      - A list of key-value pairs of environment variables to pass to the Docker container.
    * - volumeMounts (optional)
      - A list of host mounts to add to the task container. Only certain paths can be mounted on certain nodes.
    * - credentials (optional)
      - A list of credentials to use for this task. Credentials are required to pull images from different registries, and push data from workflow to |data_solution| data buckets. See the Credentials section for more information.

Inputs
--------
An input is a source of data to be placed in the input directory. There are 3 types of inputs supported.

* ``task``:  Specifies the task that the current task depends on. The task dependency implies that the upstream task must finish successfully before the current task can be scheduled. All files from the upstream tasks' output directory are shared to the current task’s input directory before it starts to run.
* ``dataset``: Downloads the files from the dataset into the task's input location.
* ``url``: Downloads files from an external object storage bucket (such as |data_solution|) into the task’s input location.

.. note::

  ``dataset`` also supports the ``localpath`` attribute which can be used to upload files/directories
  to a dataset so it can be used as an input by tasks. For more information, see :ref:`ds_localpath`.

For example:

.. code-block:: yaml

  workflow:
    name: "input-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
    - name: task2
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      inputs:
      - task: task1
      - url: s3://bucket/path
      - dataset:
          name: workflow_example

All inputs types also allow for regex filtering on what to include. For example, a filter to only
include ``.txt`` files:

.. code-block:: yaml

  workflow:
    name: "input-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      inputs:
      - task: task1
        regex: .*\.txt$
      - url: s3://bucket/path
        regex: .*\.txt$
      - dataset:
          name: workflow_example
          regex: .*\.txt$

For more information of what can be specified for datasets, refer to :ref:`ds_workflow`.

On how to view a specific input file, go to :ref:`concepts_special_tokens`.

.. _concepts_mounting:

Mounting Input Data
-------------------

Inputs to the task are mounted or download by default as specified by the admins.

Mounting a **single file** will **NOT** work. Please mount the directory containing the file.

Users can override the default type by using the field ``downloadType``:

.. code-block:: yaml

  workflow:
    name: my_workflow
    tasks:
    - name: task1
      downloadType: mountpoint-s3
      ...

The available download types are:

* download
* mountpoint-s3

The mounted data are cached in the task so the second fetch of the data will be faster than
the first.

.. note::

  If a mount fails, the workflow will **NOT** fallback to download.

If a mount operation is successful, the workflow logs show:

.. code-block::

  Mounting DS
  Mounted DS to {{input:0}}

If a mount operation has failed, the workflow logs show:

.. code-block::

  Mounting DS
  All Mounts for DS failed

If a mount operation has failed because the input was a URL to a file, the workflow logs show:

.. code-block:: bash
  :substitutions:

  Mounting |data_prefix|url/file
  Cannot mount a file, falling back to download
  Downloaded |data_prefix|url/file to {{input:0}}


.. _concepts_mounting_cache:


Cache Size
^^^^^^^^^^

OSMO supports cache eviction for the inputs. By default, the cache size is 90% of the user
specified storage, but will **NOT** take into account any storage outside the cached folders. This
means that if the user is using 50% of the specified storage, their task may be evicted if they
read too much data in the inputs.

Users can modify the cache size per task and specify either the size amount or the percentage:

.. code-block:: yaml

  workflow:
    name: my_workflow
    resources:
      my_resource:
        cpu: 1
        memory: 4Gi
        storage: 10Gi
    tasks:
    - name: task1
      resource: my_resource
      downloadType: mountpoint-s3
      cacheSize: 2Gi
      ...
    - name: task2
      resource: my_resource
      downloadType: mountpoint-s3
      cacheSize: 50%
      ...

If the task has multiple inputs, each input will have an independent cache and the cache size
will be evenly split. For example:

.. code-block:: yaml

  workflow:
    name: my_workflow
    resources:
      my_resource:
        cpu: 1
        memory: 4Gi
        storage: 10Gi
    tasks:
    - name: previous_task
      ...
    - name: task1
      resource: my_resource
      downloadType: mountpoint-s3
      cacheSize: 3Gi
      inputs:
      - task: previous_task # 1Gi Cache Size
      - url: s3://my_bucket # 1Gi Cache Size
      - dataset:            # 1Gi Cache Size
        name: my_DS
      ...

Outputs
---------

An output specifies a location to store files from the task’s output directory after it has finished. To define a task output, use the **outputs** field when defining a task. There are two types of supported output:

* ``url``
* ``dataset``

For example:

.. code-block:: yaml

  workflow:
    name: "output-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      outputs:
      - url: s3://bucket/path
      - dataset:
          name: workflow_example

All output types also allow for regex filtering on what to include. For example, a filter to only
include ``.txt`` files:

.. code-block:: yaml

  workflow:
    name: "output-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      outputs:
      - url: s3://bucket/path
        regex: .*\.txt$
      - dataset:
          name: workflow_example
          regex: .*\.txt$

For more information of what can be specified for datasets, refer to :ref:`ds_workflow`.

On how to specify which files to be uploaded, go to :ref:`concepts_special_tokens`.

Data Sharing
-------------

The following is an example workflow that shares data between two tasks using a dataset:

.. code-block:: yaml

  workflow:
    name: "data-sharing"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      outputs:
      - dataset:
          name: workflow_example
    - name: task2
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      inputs:
      - task: task1
      - dataset:
          name: workflow_example

In this example, `task2` depends on `task1`'s output dataset. For more information about using datasets in the workflow, see the :ref:`dataset workflow <ds_workflow>` section.

Files (Inline)
---------------

Files can be mounted to a task's container image before the task is started. You can define file contents inline or pass a relative path. The file path must be relative to the where the spec resides.

* Use the ``files`` field to mount files.
* Use the ``contents`` field to define the contents of the file under ``files``.
* Use the ``path`` field to designate where to create this file in the task's container.

The following example defines a file inline. The workflow would run ``sh /tmp/run.sh``, which executes the file as a shell script.

.. code-block:: yaml

  workflow:
    name: "inline-files"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          echo "Hello from task1!"
        path: /tmp/run.sh


Files (Localpath)
------------------

The following example defines a file with its relative path on the host machine.

You can use the ``localpath`` field to provide the path of a file relative to the workflow spec. This example defines a file by passing the relative path of the file on your host machine:

.. code-block:: yaml

  workflow:
    name: "localpath-files"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - localpath: files/my_script.sh
        path: /tmp/run.sh


In this example, a folder named ``files`` is in the same directory as the workflow spec, and contains the file ``my_script.sh``. The ``path`` field here also designates where this file lives in the task's container.

Host Mounts
------------

Host directories can be mounted to a task's container image before the task is started.

The following example defines a host mount using ``volumeMount``. The ``/dev/shm`` directory from the host machine will be accessible in the task container,
allowing it to use shared memory.

.. code-block:: yaml

  workflow:
    name: "host-mount"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          echo "Hello from task1!"
        path: /tmp/run.sh
      volumeMounts:
      - /dev/shm

Here is another example which defines a host mount but remaps the destination path:

.. code-block:: yaml

  workflow:
    name: "host-mount"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          ls /home/opt
        path: /tmp/run.sh
      volumeMounts:
      - /opt:/home/opt

To define this kind of volume mount, use the format ``<source path>:<destination path>``, where the source path is
the host directory, and destination path is where you want that host directory to be mounted in your task container.

.. note::

  Your admin configures the list of host directories that are allowed to be mounted in your container
  for each type of pool and platform. Contact the admin to add a certain host directory to be
  whitelisted on a machine of interest, if the resource targeted in your workflow spec does not allow
  that host mount.


.. _concepts_groups:

Groups
-------

Groups are defined for the list of tasks that need to be started simultaneously.
Use the ``groups`` field to include the tasks in a group.
You must identify one task as a group leader by setting the ``lead`` field to ``true``.
The status of the lead task will propagate to all other tasks in the group.

.. code-block:: yaml

  workflow:
    name: sample-group
    groups:
    - name: my_group
      tasks:
      - name: task1
        image: ubuntu
        command: [echo]
        args: ["Hello!"]
        lead: true
      - name: task2
        image: ubuntu
        command: [sleep]
        args: ["1000"]

A tutorial of a group workflow that has multiple tasks is in :ref:`workflow_examples`.

Group status is determined by the status of the lead task.

However, if you want the group to be restarted or failed when a non-lead task is failed or rescheduled,
please set ``ignoreNonleadStatus`` to ``false``.

.. code-block:: yaml

  workflow:
    name: sample-group
    groups:
    - name: my_group
      ignoreNonleadStatus: false
      tasks:
      - name: task1
        image: ubuntu
        command: [echo]
        args: ["Hello!"]
        lead: true
      - name: task2
        image: ubuntu
        command: [sleep]
        args: ["1000"]

.. _concepts_special_tokens:

Special Tokens
---------------

Special tokens are values denoted by ``{{identifier}}`` in the workflow specification that are substituted with relevant values by the service.

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Token**
      - **Description**
    * - ``{{input:<#>}}``
      - The directory within the container where input files from the given input task are placed. This might be used in command line parameters or environment variables to direct the container where to get input files from. ``<#>`` is the index of an input, starting at 0.
    * - ``{{output}}``
      - The directory within the container where output files are placed. Any files present in this directory when the task completes are sent to any output locations listed in the output field, and are downloaded to the input directory of any downstream tasks before they are started.
    * - ``{{workflow_id}}``
      - Indicates to substitute OSMO generated Workflow ID.
    * - ``{{host:<task_name>}}``
      - This token evaluates to the hostname of a currently running task.

The following example uses the special tokens ``input``, ``output``, and ``workflow_id``:

.. code-block:: yaml

  workflow:
    name: special-tokens
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      inputs:
      - dataset:
          name: first_input
      - dataset:
          name: second_input
      outputs:
      - dataset:
          name: my_dataset
      files:
      - contents: |
          echo "Hello from {{workflow_id}}" # Prints out the workflow ID
          cat {{input:0}}/file.txt # Reads a file called file.txt in first_input
          cat {{input:1}}/file2.txt # Reads a file called file2.txt in second input
          echo "Data from task 1: {{workflow_id}}" > {{output}}/my_file.txt # Write workflow ID to output dataset
        path: /tmp/run.sh

You can use the ``{{output}}`` special token to get the path to the output folder, and write outputs to it. The contents of ``{{output}}`` are uploaded to the source defined in the ``outputs`` section of the task.

The following example uses the special token ``{{host:<task_name>}}``. In this example, both tasks are part of a group and can communicate over the private network. The tasks are printing out each other's hostnames. The hostname values are useful if one task needs to connect to another running task in a group. Hostname values allow two running tasks in the same group to pass or retrieve information between them. For example, a simulation can send sensor data to a robot and receive a control signal back.

.. code-block:: yaml

  workflow:
    name: identify-ip
    groups:
    - name: my_group
      tasks:
      - name: task1
        image: ubuntu
        command: [sh]
        args: [/tmp/run.sh]
        files:
        - contents: |
            echo "Hostname of task2 -> {{host:task2}}"
          path: /tmp/run.sh
      - name: task2
        image: ubuntu
        command: [sh]
        args: [/tmp/run.sh]
        files:
        - contents: |
            echo "Hostname of task1 -> {{host:task1}}"
          path: /tmp/run.sh

.. _concepts_resources:

Resources
---------------

A resource spec is a definition of the type of resources required to run the task. Resources can be assigned to a task or an entire workflow. The following fields are used to describe a resource spec:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - cpu
      - Specify the amount of cores to request
    * - memory
      - Specify the amount of memory (RAM) to use.
    * - storage
      - Specify the amount of disk space to use.
    * - gpu
      - Specify the amount of GPUs to request
    * - platform
      - Specify the platform to target. If no platform is specified, the default platform for the pool is used if the admins have specified a default platform. Learn more at :ref:`Pool List <wf_pool>`.


Multiple resource specs can be defined in the same workflow and assigned individually to tasks. To define a resource spec in the workflow, use the ``resources`` field under ``workflow``. To assign the resource to each task, use the ``resource`` field under ``tasks``.

.. code-block:: yaml

  workflow:
    name: my_workflow
    resources:
      default:                    # define default cpu resource
        cpu: 1
        memory: 16Gi
        storage: 1Gi
        platform: ovx-a40
      x86_gpu:                    # define gpu resource
        cpu: 4
        gpu: 1
        memory: 16Gi
        storage: 1Gi
        platform: dgx-a100
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      resource: default           # assign default resource
      ...
    - name: task2
      image: ubuntu
      command: [sh]
      resource: x86_gpu           # assign gpu resource
      ...

Using an undefined resource name results in a validation error. If the resource field is
left blank, the `default` resources are used.

See :ref:`wf_resource` for available resources before building the resource spec.

To exclude nodes in a pool, you can use the ``nodesExcluded`` field in the resource spec:

.. code-block:: yaml

  resources:
    default:
      cpu: 1
      memory: 16Gi
      storage: 1Gi
      nodesExcluded:
      - worker1
      - worker2

To see which nodes to potentially exclude, refer to :ref:`wf_resource`.

.. note::

  Improper use of node exclusion can lead to tasks PENDING forever!

.. _wf_templates:

Templates
---------------

You can use templates to define variables inside a workflow that can have default values or be overridden on the command line before workflow submission.
To utilize templates, replace areas of interest with variables identified by two open and closed curly braces ``{{ }}``. These variables can be initialized in the spec and overridden during the ``submit`` command. Workflows submitted with no default values for templated variables in the spec or on the command line result in submission failure.

For example:

.. code-block:: yaml

  version: 2
  workflow:
    name: {{ workflow_name }}
    tasks:
    - name: ros
      environment:
        ISAAC_ROS_OVERRIDE_DATASET_ROOT: "{{input:0}}/{{ dataset_name }}"
        ISAAC_ROS_OVERRIDE_LOG_FILE: "{{output}}/kpi.json"
      image: "nvcr.io/nvidian/isaac-ros/aarch64-build:latest"
      command: ["/workspaces/isaac_ros-dev/docker/scripts/benchmark-entrypoint.sh"]
      args: ["{{ task_arg }}"]
      kpis:
        - index: isaac_ros_benchmarks
          path: "kpi.json"
      inputs:
        - dataset:
            name: {{ dataset_name }}
    resources:
      default:
        cpu: 7
        gpu: 1
        mem: 28Gi
        disk: 1Gi
        platform: agx-orin-jp6

  default-values:
    workflow_name: isaac_ros_bi3d_stereo_node_test
    dataset_name: isaac_ros_benchmark_bi3d_dataset
    task_arg: isaac_ros_bi3d_test.py


There are three templated variables named ``workflow_name``, ``dataset_name``, and ``task_arg`` with have default initial values of ``isaac_ros_bi3d_stereo_node_test``, ``isaac_ros_benchmark_bi3d_dataset``, and ``isaac_ros_bi3d_test.py`` respectively. These values can also be overridden in the submit command:

.. code-block:: bash

  $ osmo workflow submit /path/my_workflow.yaml --set workflow_name=another_workflow dataset_name=another_dataset task_arg=another_script.py

Variable naming conventions follow the PEP8 style guide. Workflows support `Jinja Templating Design <https://jinja.palletsprojects.com/en/3.1.x/>`_.

.. code-block:: jinja

  workflow:
    name: {{ workflow_name }}
    groups:
    - name: group1
      tasks:
      {% for item in range(3) %}
      - name: "task_{{idx}}"
        image: my_container
        command: ["python3"]
        {% if item == 0 %}
        lead: true
        {% endif %}
        args: ["{{ task_arg }}"]
        inputs:
          - dataset:
              name: {{ dataset_name }}
      {% endfor %}

  default-values:
    workflow_name: my_workflow
    dataset_name: my_dataset
    task_arg: my_script.py

In the example above, the Jinja for loop creates four tasks inside the group.
With the Jinja conditional statement, Jinja adds ``lead: true`` to the first task.

.. _concepts_wf_generic_creds:

Generic Credentials
--------------------

Registry and data credentials are automatically applied when the workflow is submitted.
In addition, you can submit other generic credentials and securely dereference them inside the
workflow as environment variables or mount them as a secret file with a specific path.

.. code-block:: yaml

  workflow:
    name: use-generic-creds
    tasks:
    - name: task_generic_creds_usage
      image: ubuntu
      command: ['bash']
      credentials:
        omni_cred:
          OMNI_USER: omni_user
          OMNI_PASS: omni_pass
        aws_keys: /root/.osmo

In the example above, ``credentials`` is a list of credential names that are configured using :ref:`credentials_generic`.

``omni_cred`` and ``aws_keys`` are two generic credentials.
Each generic credential is associated with a list of environment variables or a credential path that is mounted to a container.
In the example above, the keys in omni_cred are mapped to environment variables ``OMNI_USER`` and
``OMNI_PASS``. ``aws_keys`` is mapped as a file mounted to the path /root/.osmo, from which you can retrieve the credentials.

.. note::

  Credentials are MASKED in the workflow logs and error logs if they are 8 characters or more. Do **NOT** use
  credentials less that 8 characters or they can be subject to being leaked.


Workflow Timeouts
-----------------

There are two types of timeouts:

* ``exec_timeout``  - Maximum execution time for a workflow before the service cleans it up.
* ``queue_timeout`` - Maximum queue time for a workflow in the workflow queue before the service cleans it up.

You can set the timeout values per workflow and it can be defined in a workflow using the ``timeout`` field. To define an execution timeout, use the ``exec_timeout`` field; for queue timeout, use the ``queue_timeout`` field.

If a running workflow is timed out, the status of the workflow query shows ``FAILED_EXEC_TIMEOUT``. If a workflow stays in the pending state it is timed out and the status of the workflow query shows ``FAILED_QUEUE_TIMEOUT``.

You can define timeout values with the format ``<integer><unit>``. The units supported are ``s (seconds), m (minutes), h (hours), and d (days)``. The timeout value does **NOT** support a mix and match of units, like ``10h5m``.

The following is an example of a running workflow that can stay in the pending queue for a maximum of 6hrs and in execution for a maximum of 8hrs. All workflows use a default timeout as set by the admin to protect the backend resource shares.

.. code-block:: yaml

  workflow:
    name: my_workflow
    timeout:
      exec_timeout: 8h
      queue_timeout: 6h
    tasks:
    ...

.. _concepts_wf_task_reschedule_restart:

Task Reschedule and Restart
---------------------------

When a task is rescheduled, it means that the old task is cleared from the backend, and a new task is created with the same spec as the old one.
The new task can land on any available node that satisfies its resource requirement, not necessarily the same as the old.

When a task is restarted, it means that the user command is re-executed. Different from rescheduling, restarting doesn't create a new task.
Therefore, the restarted task will run on the same node, doesn't require a second time input downloading, and has access to any intermediate data.

Currently, :ref:`Preflight Test <concepts_preflight>` is disabled for both rescheduling and restarting.

See :ref:`Actions <concepts_wf_actions>` for more information.
