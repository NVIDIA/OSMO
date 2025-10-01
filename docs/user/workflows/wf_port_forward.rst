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

.. _wf_port_forward:

============
Port-Forward
============

Users can port-forward from a running task in the workflow through the browser or the CLI.

Browser
-------

Forwarding a port through the browser is useful when your task has a web service running that
listens on a single port and serves http traffic, such as a :ref:`Jupyter Notebook <workflow_examples>`,
a :ref:`VSCode Server <workflow_examples>` or a :ref:`Ray dashboard <workflow_examples>`.

You can forward a port from **a running workflow task** in the browser using the ``Port Forward``
option in the ``Task Details`` menu for that task. You may select the task, enter the port number
and click on ``Start`` to forward the port.

.. note::

  The browser port-forward feature can be disabled by administrators.
  In such case you will not see the option to forward ports for a running task.

.. image:: wf-port-forward.gif
  :width: 800
  :alt: Browser Port-Forward

CLI
---

Forward ports from a running task of your workflow to your local host or browser using ``port-forward`` command

.. code-block:: bash

  $ osmo workflow port-forward -h
  usage: osmo workflow port-forward [-h] [--host HOST] --port PORT [--udp] [--connect-timeout CONNECT_TIMEOUT] workflow_id task

  positional arguments:
    workflow_id           The ID or UUID of the workflow to port forward from
    task                  Name of the task in the workflow to port forward from

  options:
    -h, --help            show this help message and exit
    --host HOST           The hostname used to bind the local port. Default value is localhost.
    --port PORT           Port forward from task in the pool. Input value should be in format local_port[:task_port], or in range port1-port2,port3-port4
                          (right end inclusive). e.g. "8000:2000", "8000", "8000-8010:9000-9010,8015-8016". If using a single port value or range, the client
                          will use that port value for both local port and task port.
    --udp                 Use UDP port forward.
    --connect-timeout CONNECT_TIMEOUT
                          The connection timeout period in seconds. Default is 60 seconds.

  Ex. osmo workflow port-forward wf-1 sim-task --port 47995-48012,49000-49007 --udp

If your workflow is hosting a web application, you can go to the URL provided after running port forwarding to view
the application through your web browser.

For example, you can run Foxglove, a visualization platform for robotics, in a workflow and port forward the data from
the workflow to the browser on your local machine.

To run Foxglove in a workflow, your workflow spec might contain the following:

.. code-block:: yaml

  workflow:
    name: foxglove
    resources:
      default:
        cpu:
          count: 1
        storage: 1Gi
        memory: 1Gi
        labels:
          kubernetes.io/arch: amd64
    tasks:
    - name: foxglove_task
      image: ghcr.io/foxglove/studio:latest
      command: ['/bin/sh', '/entrypoint.sh']
      args: ["caddy", "file-server", "--listen", ":8080"]


After submitting this workflow, Foxglove will start listening at port 8080 in the workflow once the workflow starts
running. To start the port forwarding process, you can run the following:

.. code-block:: bash

  osmo workflow port-forward --port 8080 <workflow_id> foxglove_task

The data will now be forwarded to your local port at 8080. You should see the following message:

.. code-block:: bash

  Port forwarding from <workflow_id>:foxglove_task to localhost:8080 started.
  Please visit http://localhost:8080 if a web application is hosted by the workflow.

.. image:: foxglove_portforward.png
  :width: 800
  :align: center

More examples can be found at :ref:`workflow_examples`.
