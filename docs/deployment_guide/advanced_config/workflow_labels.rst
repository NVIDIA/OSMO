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


.. _workflow_labels_config:

=======================================================
Workflow Labels
=======================================================

Users attach labels to a workflow to record who owns it and what it is for. Label syntax is checked on every submission even when nothing is configured here; a policy adds requirements on top, so you can decide which keys must be present and which values are accepted.

See :ref:`workflow_spec_labels` for how users set labels, and :ref:`workflow_submission` for the CLI flags and list filters. Field definitions are in :ref:`workflow_config`.


Why Configure a Policy?
=======================

✓ **Attribute usage**
  Require a key such as ``team`` or ``cost-center`` so every workflow can be traced back to an owner.

✓ **Keep values consistent**
  An allow-list rejects typos and near-duplicates, which keeps reports and dashboards aligned.

✓ **Roll out gradually**
  Warn before you enforce, so users see what to change while their submissions still succeed.


Enforcement Modes
=================

Each entry in ``policy`` controls one key independently.

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - **Mode**
     - **Behavior when the key is missing, or its value is outside a non-empty allow-list**
   * - ``"off"``
     - Accepted, with no warning. Same as omitting the key from ``policy``.
   * - ``warn``
     - Accepted, and the submit response carries a warning.
   * - ``enforce``
     - Rejected. No workflow row and no stored specification are created.

.. code-block:: yaml

   labels_config:
     policy:
     - key: team
       allow_list:
       - robotics
       - simulation
       enforcement: warn
     - key: cost-center
       allow_list: []
       enforcement: enforce

An empty ``allow_list`` accepts any well-formed value, so the key becomes required without constraining what it holds.

.. note::

   Quote ``"off"``. Unquoted YAML ``off`` parses as boolean false.

The same policy applies to new submissions, resubmission by ID, restart, and validation-only requests. Warnings are recomputed from the stored labels and the current policy, so a workflow always shows the warnings its policy would produce today, including after it completes.


Rolling Out a Requirement
=========================

.. grid:: 3
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Announce** 📣
        ^^^

        Add the key with ``enforcement: warn``

        +++

        Submissions succeed; users see what to add

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **2. Watch** 📊
        ^^^

        Track ``osmo_label_validation_total``

        +++

        The ``missing`` and ``invalid`` outcomes show who is affected

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **3. Enforce** ✅
        ^^^

        Switch to ``enforcement: enforce``

        +++

        Remaining violations are rejected at submission

Changing a policy leaves existing and in-flight workflows untouched. To roll back, set ``enforcement: warn``; to disable the key entirely, set ``enforcement: "off"`` or remove the entry. In ConfigMap mode, an invalid edit is rejected and the previous valid snapshot stays active.

.. warning::

   Removing a value from an allow-list while the key is in ``enforce`` mode rejects every later submission that uses it, including restarts of workflows that were accepted earlier. Soak the change in ``warn`` first.


Prefixing Pod Labels
====================

``pod_label_prefix`` is prepended to every workflow label key when labels are stamped onto task pods, and nowhere else:

.. code-block:: yaml

   labels_config:
     pod_label_prefix: example.com/
     policy:
     - key: team
       enforcement: warn

A workflow submitted with ``team: robotics`` then carries ``example.com/team=robotics`` on its pods. Everywhere else keeps the bare ``team`` key: the stored specification, the workflow API, list filters, the CLI, and the metric attributes below. Users never type or query the prefix.

The prefix is an opaque string, not an assumed DNS prefix: it is joined to the label key, and the merged key is validated as a Kubernetes label key at submission, in the same check as the policy. An invalid merged key is rejected with an error reporting the original key, the prefix, and the result.

.. tip::

   Set a prefix when task pods share a cluster with unrelated workloads. Pod labels are exported by key name, so a short key such as ``team`` can match an identically named label on another pod.


Metrics
=======

Only configured policy keys become workflow-label dimensions on ``osmo_tasks_count``. Attribute names start with ``workflow_label_``. Letters and numbers are unchanged; ``_``, ``-``, ``.``, and ``/`` are encoded as ``__``, ``_dash_``, ``_dot_``, and ``_slash_`` respectively. For example, ``project`` is exported as ``workflow_label_project``.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - **Exported value**
     - **When**
   * - The value itself
     - The value is in the configured allow-list.
   * - ``<other>``
     - The key is present with a value outside that list. An empty allow-list exports every value this way.
   * - ``<missing>``
     - The key is absent.

This bounds the series count to the allow-list plus two sentinels per key, so keep the policy list small to control cardinality.

Admission also emits ``osmo_label_validation_total{key, outcome}``, where ``outcome`` is ``ok``, ``missing``, ``invalid``, or ``rejected``. The counter covers rejected submissions that never create a workflow row.

.. seealso::

   Exporting a Pod label through ``kube_pod_labels`` is a separate kube-state-metrics allow-list decision; see :ref:`adding_observability`.
