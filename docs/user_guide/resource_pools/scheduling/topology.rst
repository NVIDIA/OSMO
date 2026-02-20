..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _concepts_topology:

===========================
Topology-Aware Scheduling
===========================

Overview
--------

Topology-aware scheduling ensures that tasks requiring high-bandwidth communication are
placed on nodes that are physically co-located—such as the same NVLink rack, spine switch,
or availability zone.

This is critical for performance-sensitive workloads like multi-node NVLink training, where
all shards of a model must communicate with each other at full NVLink bandwidth. Without
topology-aware scheduling, the scheduler may place tasks on nodes in different racks, causing
a severe drop in cross-node communication performance.

Topology Keys
-------------

Topology keys are configured by pool administrators and represent the levels of physical
hierarchy in the cluster. Each key has:

- A **user-friendly name** (e.g., ``rack``, ``zone``, ``gpu-clique``) that you reference in
  your workflow spec
- A **Kubernetes node label** (e.g., ``nvidia.com/gpu-clique``,
  ``topology.kubernetes.io/rack``) that identifies nodes at that level

Keys are ordered from coarsest to finest granularity. For example:

  ``zone`` → ``spine`` → ``rack`` → ``gpu-clique``

.. note::

  Topology-aware scheduling is only available on pools backed by the KAI scheduler with
  topology keys configured. Contact your OSMO administrator to confirm which topology keys
  are available for your pool.

Required vs. Preferred
----------------------

Each topology requirement has a ``requirementType`` that controls scheduling behavior:

.. list-table::
  :header-rows: 1
  :widths: 25 75

  * - ``requirementType``
    - Behavior
  * - ``required`` (default)
    - The workflow will **not** be scheduled unless the constraint can be satisfied. Use this
      for NVLink workloads where co-location is mandatory for correctness or performance.
  * - ``preferred``
    - OSMO will try to satisfy the constraint but will schedule the workflow even if it
      cannot. Use this when co-location improves performance but is not strictly required.

Topology Groups
---------------

The ``group`` field in a topology requirement controls which tasks must share the same value
for a given topology key.

- Tasks with the **same** topology key and group will be co-located together (e.g., placed
  on the same rack).
- Tasks with **different** group names for the same key can land on separate instances of
  that topology level (e.g., different racks).

This enables patterns like 2× data parallel + 4× tensor parallel, where each model
instance's shards are grouped together but the two model instances can run on separate racks.

If ``group`` is not specified it defaults to ``default``, meaning all tasks using that
resource spec will be required to share the same topology value.

Uniform Topology Keys
---------------------

All tasks in a workflow that use topology requirements must specify the **same set of
topology keys**. Tasks cannot use different topology levels from one another (for example,
one task with ``zone`` + ``rack`` and another with only ``zone`` is not allowed).

This is validated at workflow submission time; a clear error is returned if violated.

.. seealso::

  To add topology requirements to your workflow spec, see :ref:`workflow_spec_resources`.

Examples
--------

The following examples assume a pool with these topology keys configured:

.. code-block:: yaml

  topology_keys:
  - key: zone
    label: topology.kubernetes.io/zone
  - key: spine
    label: topology.kubernetes.io/spine
  - key: rack
    label: topology.kubernetes.io/rack
  - key: gpu-clique
    label: nvidia.com/gpu-clique

Single NVL72 Rack
~~~~~~~~~~~~~~~~~

A 4-task tensor-parallel training workflow where all shards must communicate via NVLink and
must therefore be scheduled on the same ``gpu-clique``.

.. note::

  To properly use multi-node NVLink, confirm with your OSMO admin that the pool is
  configured to enable NVLink.

.. code-block:: yaml

  workflow:
    name: single-nvl72-rack
    groups:
    - name: group1
      tasks:
      - name: model1-shard1
        lead: true
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard3
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard4
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
  resources:
    default:
      gpu: 8
      topology:
      - key: gpu-clique

Because all tasks share the same resource spec and ``group`` defaults to ``default``, they
will all be required to land on the same ``gpu-clique``.

Multiple NVL72 Racks
~~~~~~~~~~~~~~~~~~~~

An 8-task workflow with 2× data parallel × 4× tensor parallel. Each model instance's shards
must share a ``gpu-clique``, but the two model instances can be placed on separate racks.

.. code-block:: yaml

  workflow:
    name: multiple-nvl72-racks
    groups:
    - name: group1
      tasks:
      - name: model1-shard1
        resource: model-1
        lead: true
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard2
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard3
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard4
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard1
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard2
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard3
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard4
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
  resources:
    model-1:
      gpu: 8
      topology:
      - key: gpu-clique
        group: model-1-group
    model-2:
      gpu: 8
      topology:
      - key: gpu-clique
        group: model-2-group

By assigning different ``group`` names (``model-1-group`` and ``model-2-group``), the
scheduler co-locates each model instance's shards on one ``gpu-clique`` while allowing the
two model instances to land on different racks.

Multiple NVL72 Racks in Same Zone
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Extends the previous example by additionally requiring the entire workflow to land in the
same availability zone, for example when cross-zone latency would degrade data-parallel
communication between model instances.

.. code-block:: yaml

  workflow:
    name: multiple-nvl72-same-zone
    groups:
    - name: group1
      tasks:
      - name: model1-shard1
        resource: model-1
        lead: true
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard2
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard3
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard4
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard1
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard2
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard3
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard4
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
  resources:
    model-1:
      gpu: 8
      topology:
      - key: gpu-clique
        group: model-1-group
      - key: zone
        group: workflow-group
    model-2:
      gpu: 8
      topology:
      - key: gpu-clique
        group: model-2-group
      - key: zone
        group: workflow-group

The ``gpu-clique`` requirements keep each model instance's shards on the same rack. The
shared ``zone`` requirement with ``group: workflow-group`` ensures both model instances are
placed in the same availability zone.

Best-Effort Topology
~~~~~~~~~~~~~~~~~~~~

An 8-task workflow on a cluster with InfiniBand but without NVLink. Co-locating tasks on
the same rack or spine still improves performance, but the workflow should run even if the
constraints cannot be met.

.. code-block:: yaml

  workflow:
    name: best-effort-topology
    groups:
    - name: group1
      tasks:
      - name: model1-shard1
        resource: model-1
        lead: true
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard2
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard3
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model1-shard4
        resource: model-1
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard1
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard2
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard3
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
      - name: model2-shard4
        resource: model-2
        image: nvcr.io/nvidia/pytorch:24.03-py3
        ...
  resources:
    model-1:
      gpu: 8
      topology:
      - key: rack
        group: model-1-group
        requirementType: preferred
      - key: spine
        group: workflow-group
        requirementType: preferred
    model-2:
      gpu: 8
      topology:
      - key: rack
        group: model-2-group
        requirementType: preferred
      - key: spine
        group: workflow-group
        requirementType: preferred

Using ``requirementType: preferred`` tells the scheduler to attempt co-location but not
block scheduling if the constraints cannot be satisfied.
