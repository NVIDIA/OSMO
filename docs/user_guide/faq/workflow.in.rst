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

.. _faq_workflow:

Workflow
========

What pools and platforms are available?
---------------------------------------

For pool/platform availability, refer to :ref:`cli_reference_pool`.

How to fix 403 error when accessing OSMO UI?
--------------------------------------------

Try to clear your browser cache and cookies. If the problem persists, contact the admin to verify
your role mapping.

How to fix 403 error when submitting a workflow?
------------------------------------------------

403 errors mean that the user does not have access to submit workflows to the specified pool.
To fix this, the user needs to do a couple of things:

1. Contact the admin to add the user to the corresponding role mapping for the pool.

2. Once the admin has given the user access, the user has to completely
   :ref:`logout from the UI <logout_ui>`.

3. The user can then login through the UI or the CLI and be able to see the pool in their profile.

.. image:: ui_profile.png
  :width: 1100

.. code-block:: bash
  :substitutions:

  $ osmo profile list
  user:
    name: <user>
    email: <user>@email.com
  notifications:
    email: False
    slack: True
  bucket:
    default: <bucket>
  pool:
    default: <pool>
    accessible:
    - <pool>
    - <new_pool>

How to pause and debug a workflow?
----------------------------------

Typically, when debugging a workflow that crashes or misbehaves, forcing the workflow to ``pause``
can help you diagnose the problem. Pausing the process gives developers a chance to get a remote
shell into the workflow, look inside the container, determine or fix the issue, and then ``unpause``
the workflow when ready.

To pause a workflow, add the following command to the top of the script running inside your workflow:

.. code-block:: bash

  while ! [ -f /done.txt ] ; do sleep 1 ; done

This causes the workflow to halt, and wait until the file ``/done.txt`` is created, after which it
resumes.

For example, your workflow might contain the following:

.. code-block:: yaml

  workflow:
    tasks:
    - name: my_task
      command: bash
      args: ["/tmp/script.sh"]
      files:
      - path: "/tmp/script.sh"
        contents: |
          while ! [ -f /done.txt ] ; do sleep 1 ; done
          # The rest of script here ...


After the workflow starts and halts, this should give you a chance to use the workflow dash or CLI
to get a shell into the workflow, look around inside the task, and potentially modify files.
After you are finished with the shell, you can resume the workflow by creating the /done.txt
file with the following command:

.. code-block:: bash

  $ touch /done.txt

.. raw:: html

  <video width="640" height="360" controls>
        <source src="https://swiftstack-maglev.ngc.nvidia.com/v1/AUTH_team-osmo-svc/osmo/dev-flow/WF_Debug_Demo.mp4" type="video/mp4">
  </video>


How to restart a failed a workflow?
-----------------------------------

If you have a workflow which has failed and you want to rerun the same workflow without rerunning
all the completed tasks, use the workflow restart CLI. This reran workflow will grab the outputs
from the parent workflow as inputs to the reran tasks.

.. code-block:: bash

  $ osmo workflow restart <workflow_id>

.. image:: wf_restart1.gif
  :width: 1100

.. note::

  Restarting workflows restarts at the **group level**. If a COMPLETED task is in a FAILED group,
  the COMPLETED task is still restarted. To learn more about the restart CLI, go to :ref:`cli_reference_workflow_restart`.

How to force cancel a workflow?
--------------------------------

When a cancel request for a workflow is submitted, it is canceled asynchronously.
If the resources associated with the workflow are not cleaned up properly on the backend,
the incoming workflows are in a ``PENDING`` state.
Forcing a *cancel* frees the resources instantaneously.

To force cancel a workflow, use the ``--force`` flag:

.. code-block:: bash

  $ osmo workflow cancel --force <workflow_id>

.. note::

  To learn more about the cancel CLI, go to :ref:`cli_reference_workflow_cancel`.

How to stop a hanging workflow without canceling it?
----------------------------------------------------

In cases your workflow is hanging and you want to stop it but still have OSMO upload your output data,
you can use the `osmo exec` command. For example:

.. code-block:: bash

  $ osmo workflow exec <workflow_id> <task_id> --entry "/bin/sh -c \"kill -9 \\\$( ps aux | grep '[p]ython' | head -n1 | awk '{print \\\$2}' )\""

This command will kill the first python process running in the workflow and allow OSMO to upload the output data.

It is equivalent to first shell into the task and then run the command manually:

.. code-block:: bash

  $ osmo workflow exec <workflow_id> <task_id>

.. code-block:: bash

  $ /bin/sh -c "kill -9 $( ps aux | grep '[p]ython' | head -n1 | awk '{print $2}' )"

How to determine the resource usage of a workflow?
--------------------------------------------------

Follow the ``grafana_url`` for your workflow fetched using the :ref:`cli_reference_workflow_query` CLI to determine the resource usage of your workflows.

Users can click on the ``Resource Usage`` button in the UI on the detailed workflow information page.

.. image:: workflow_ui_with_resource_usage_highlighted.png
  :width: 1200
  :alt: Alternative text
  :align: center

On the dashboard, review the stats, such as the memory, disk, CPU and GPU utilization & Memory.
Note that the data on grafana has a retention limit of up to 2 weeks.

.. image:: grafana.png
  :width: 1200
  :alt: Alternative text
  :align: center


How to browse previously submitted workflows?
---------------------------------------------

Go to the `OSMO Workflows Page <osmo_ui_workflows_>`_.

How to mount datasets inside the workflow?
------------------------------------------

Mounting inputs inside a workflow is not supported.

How to update datasets inside the workflow?
-------------------------------------------

Multiple tasks of a workflow or multiple workflows can operate and update the same dataset. See :ref:`concepts_ds_update`.

How to Handle Failed Tasks?
---------------------------

To manually rerun tasks in a workflow that have failed, see :ref:`cli_reference_workflow_restart`

To have your workflow automatically reschedule and retry failed tasks, see  :ref:`concepts_wf_actions`

For a practical example of rescheduling training workflows for backend errors, see :ref:`Reschedule Training for Backend Errors <workflow_examples>`.

My workflow is stuck, how can I save my data?
---------------------------------------------

You can save your data in the workflow by running the OSMO CLI while exec'd into the workflow.

The tutorial :ref:`workflow_examples` shows how to perform this operation.

How to access a private GitHub repository from a workflow?
----------------------------------------------------------

1. Create an access token

Log into GitHub and create a `classic personal access token <https://github.com/settings/tokens/new>`_ if you don't already have one.
Be sure to give the token all **repo** permissions.

2. Verify that the token is valid by cloning the repo locally

.. code-block:: bash

  git clone https://token:ghp_xxxxxxxxxxxx@g<token>@github.com/<user>/<repo>.git

3. Create an osmo secret for the token

.. code-block:: bash

  export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
  osmo credential set github-pat --type GENERIC --payload "github-pat=$GITHUB_TOKEN"

4. Use the secret in a workflow

First, add the credential to any tasks in the workflow that need to access GitHub.

.. code-block:: yaml

  workflow:
    name: my_workflow
    tasks:
    - name: my_task
      credentials:
        github-pat: /tmp/github

Then, run the following code in the workflow to authenticate and clone the repo.

.. code-block:: bash

  # Configure git to use the token for all requests to GitHub
  GITHUB_PAT=$(cat /tmp/github/github-pat)
  git config --global credential.helper store
  echo "https://token:${GITHUB_PAT}@github.com" > ~/.git-credentials
  git config --global credential.helper 'store --file ~/.git-credentials'

  # Clone the repo
  git clone https://github.com/<user>/<repo>.git


How to find a task's IP address from another task within the same group?
------------------------------------------------------------------------

Tasks in the same group can communicate with each other through network.
OSMO token ``{{host:<task_name>}}`` (see :ref:`concepts_special_tokens`) can be used as the hostname of a task.
In case you need to find the IP address of a task, you can use the following command to resolve the hostname to an IP address:

.. code-block:: bash

  TASK_IP=$(nslookup {{host:<task_name>}} | grep -oP \
    'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}' | head -n1)


How to upload a file/directory as an input to a workflow?
---------------------------------------------------------

To upload a file/directory as an input to a workflow, you can use a ``dataset`` input with the
``localpath`` field. For more information, see :ref:`ds_localpath`.

How to debug when preemption occurs?
------------------------------------

When a task is preempted, it will have the status ``FAILED_PREEMPTED`` and exit code ``3006``.
You can also check task events to see preemption events from the scheduler.

If you need to automatically retry preempted tasks, you can configure exit actions to reschedule the task when it receives exit code ``3006``.
See :ref:`concepts_wf_exit_codes` for more information.

Admin can configure the default exit action to ``RESCHEDULE`` the task when it receives exit code ``3006``.
The preempted task will be rescheduled with the same priority up to maximum time limit before it fails with status ``FAILED_PREEMPTED``.
Check with the admin about current configurations.

Why is my workflow not getting scheduled quickly?
-------------------------------------------------

There are several reasons why your workflow might be stuck in a ``PENDING`` state.
Here are the most common causes and how to investigate them:

1. **Resource Availability**

   - Check if the requested resources (CPU, GPU, memory) are available in your pool

   - Use the :ref:`cli_reference_resource` command to see current resource utilization

   - Consider if both total resources and resource per node are available in your pool

   - Consider adjusting your resource requests if they're too high

2. **Pool Quotas and Sharing**

   - Use the :ref:`cli_reference_pool` command to check if your pool has reached its quota limit

   - You can not exceed the quota for non-preemptible workflows (HIGH/NORMAL priority)

   - Submit preemptible workflows if you want to use shared quotas.

   For example, if you submit a normal/high priority workflow to this pool with 10 GPUs:

   .. code-block:: bash

                                                            Quota Used   Quota Limit   Total Usage   Total Capacity
    ============================================================================================================
    example-pool   Join role: access-osmo       ONLINE      96           100           96            200
    ============================================================================================================
                                                            96           100           96            200

   Because the current quota used is 96 GPUs, and quota limit is 100 GPUs, a workflow with 10 GPUs would go over the
   quota limit (96 + 10 = 106), causing the workflow to be pending.

3. **Workflow Priority**

   - Higher priority workflows get scheduled first within the pool quota (See :ref:`concepts_priority`)

   - Check your workflow's priority setting

   - Consider adjusting priority if appropriate

4. **Initializing**

   - Sometimes workflows show ``PENDING`` status because they are initializing.

   - Check the task status and events to see detailed information.

5. **More Information**

   - Workflow and task events can provide more information about status and scheduling details.

   - Use the :ref:`cli_reference_workflow_query` command for verbose task information. This is useful for checking rescheduling actions.

What is the difference between quota limit and total capacity?
--------------------------------------------------------------

The quota limit is the number of GPUs that can be used by normal/high priority workflows.

The total capacity is the total number of GPUs that can be used by all workflows in the pool, including low priority (preemptible) workflows.

For example, if the total capacity is greater than the quota limit:

.. code-block:: bash

                                                          Quota Used   Quota Limit   Total Usage   Total Capacity
  ============================================================================================================
  example-pool   Join role: Access-osmo       ONLINE      96           100           96            200
  ============================================================================================================
                                                          96           100           96            200

This usually means that the pool is sharing resources with another pool.
The quota limit for each pool guarantees that users of that pool always has access to those GPUs through normal/high priority workflows.
The difference between total capacity and quota limit (200 - 100 = 100) is the number of GPUs that can be used by low priority workflows
when the other pool is not using its quota limit. But when the other pool is using its quota limit, the low priority workflows will be preempted.
