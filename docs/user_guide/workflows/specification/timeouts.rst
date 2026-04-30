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

.. _workflow_spec_timeouts:

================================================
Timeouts
================================================

There are two types of timeouts a workflow can have. You can view the default timeout values in the
UI pool information.

..  list-table::
  :header-rows: 1
  :widths: 40 160

  * - **Field**
    - **Description**
  * - ``exec_timeout``
    - Maximum execution time for **each group** in the workflow. The clock starts when a group's
      status transitions to ``RUNNING`` and applies independently per group, so a long-running
      group does not affect the budget of other groups in the same workflow.
  * - ``queue_timeout``
    - Maximum queue time for **each group**, measured from when the group enters
      ``SCHEDULING`` (submitted to the backend k8s queue) until it is assigned a
      node and enters ``INITIALIZING``. A group still in ``SCHEDULING`` past this
      window is marked ``FAILED_QUEUE_TIMEOUT``. Image pull and preflight time in
      ``INITIALIZING`` is governed separately by the start timeout, not this one.
      Each group has its own clock.

.. note::

  The default timeout values can be configured but requires service-level configuration.
  If you have administrative access, you can enable this directly. Otherwise, contact someone
  with workflow administration privileges.

For example:

.. code-block:: yaml

  workflow:
    name: my_workflow
    timeout:
      exec_timeout: 8h
      queue_timeout: 6h
    ...

If a running group exceeds ``exec_timeout``, that group is marked ``FAILED_EXEC_TIMEOUT`` and
its downstream groups cascade to ``FAILED_UPSTREAM``. Sibling groups that are still within their
own ``exec_timeout`` window continue running. The workflow status aggregates to
``FAILED_EXEC_TIMEOUT`` once all groups have finished and at least one timed out.

If a group stays in ``SCHEDULING`` (waiting for a node assignment) longer than
``queue_timeout``, that group is marked ``FAILED_QUEUE_TIMEOUT``. The workflow status
aggregates to ``FAILED_QUEUE_TIMEOUT`` once all groups have finished and at least one
hit the queue timeout.

The timeout values are defined in the format ``<integer><unit>``. The units supported are:

* ``s (seconds)``
* ``m (minutes)``
* ``h (hours)``
* ``d (days)``

.. note::

  The timeout value does **NOT** support a mix and match of units, like ``10h5m``.
