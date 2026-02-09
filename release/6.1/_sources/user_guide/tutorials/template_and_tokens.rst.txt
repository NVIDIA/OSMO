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

.. _tutorials_template_and_tokens:

====================
Templates and Tokens
====================

This tutorial introduces two key concepts for flexible workflows: **templates** (variables
you define) and **special tokens** (values OSMO provides automatically).

Templates
=========

Templates let you customize workflows at submission time without editing the YAML file.
Variables are denoted by double curly braces ``{{ }}`` with default values defined in
the ``default-values`` section.

**Hello World with template variables example:**

Here's the Hello World example with template variables: :download:`template_hello_world.yaml <../../../workflows/tutorials/template_hello_world.yaml>`.

.. literalinclude:: ../../../workflows/tutorials/template_hello_world.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

Submit with defaults:

.. code-block:: bash

  $ osmo workflow submit template_hello_world.yaml
  Workflow ID - hello-osmo-1

Override values at submission:

.. code-block:: bash

  $ osmo workflow submit template_hello_world.yaml --set \
      workflow_name=greetings \
      ubuntu_version=24.04 \
      message='Custom message!'

  Workflow ID - greetings-1

.. tip::

  You can reuse the same workflow with different values - no file editing needed!

Special Tokens
==============

Besides templates, OSMO provides **special tokens** - reserved variables that are
automatically set by the system. Unlike templates, you **cannot** override them with ``--set``.

.. include:: ../workflows/specification/tokens_table.in.rst

**Token example:**

The ``{{workflow_id}}`` token is useful for tracking workflow runs and creating unique
identifiers.

.. literalinclude:: ../../../workflows/tutorials/token_example.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

Each submission gets a unique ``{{workflow_id}}`` (e.g., ``my-experiment-1``,
``my-experiment-2``), even with the same ``experiment_name``.

.. seealso::

  The other tokens (:kbd:`{{input:N}}`, :kbd:`{{output}}`, :kbd:`{{host:task_name}}`) are covered
  in later tutorials when you learn about :ref:`Working with Data <tutorials_working_with_data>` and
  :ref:`Task Communication <tutorials_parallel_workflows_task_communication>`.

Next Steps
==========

Now that you understand templates and special tokens, continue to :ref:`Requesting Resources <tutorials_requesting_resources>`
to learn how to specify CPU, GPU, memory, and storage requirements for your workflows.

.. seealso::

  - :ref:`workflow_spec_templates_and_special_tokens` - Reference for templates and special tokens
  - :ref:`tutorials_advanced_patterns_jinja` - Advanced patterns for workflow templating with Jinja
