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

.. _concepts_wf_timeouts:

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
    - Maximum execution time for a workflow before the service cleans it up. This is the time since
      the **workflow status** is set to ``READY``.
  * - ``queue_timeout``
    - Maximum queue time for a workflow in the workflow queue before the service cleans it up.
      This is the time calculated after the **workflow status** is set to ``PENDING`` and until
      the **workflow status** is set to ``READY``.

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

If a running workflow is timed out, the workflow status is set to ``FAILED_EXEC_TIMEOUT``.
If a workflow stays in the pending state it is timed out and the workflow status is set to
``FAILED_QUEUE_TIMEOUT``.

The timeout values are defined in the format ``<integer><unit>``. The units supported are:

* ``s (seconds)``
* ``m (minutes)``
* ``h (hours)``
* ``d (days)``

.. note::

  The timeout value does **NOT** support a mix and match of units, like ``10h5m``.
