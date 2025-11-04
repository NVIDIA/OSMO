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


.. _resource_validation:

=======================================================
Resource Validation
=======================================================

Resource validation acts as a pre-flight check that occurs when workflows are submitted to OSMO.
The validation process prevents common issues such as:

- Requesting more resources than any node can provide
- Submitting workflows with zero or negative resource values

Validation Lifecycle
~~~~~~~~~~~~~~~~~~~~~

When a workflow is submitted to OSMO, the following validation process occurs:

1. **Rule Processing**: OSMO selects applicable validation rules based on pool/platform configuration,
   resolves all validation variables (``{{USER_CPU}}``, ``{{K8_CPU}}``, etc.) using workflow specifications
   and cluster state, then evaluates each rule against the resolved values
2. **Validation Result**: If all rules pass, the workflow proceeds; if any rule fails, the workflow is rejected with the assert message
3. **Resource Allocation**: Validated workflows are queued for execution

Validation Rule Structure
-------------------------

Each validation rule consists of four essential components:

.. code-block:: json

  {
    "operator": "LE",
    "left_operand": "{{USER_CPU}}",
    "right_operand": "{{K8_CPU}}",
    "assert_message": "CPU value {{USER_CPU}} exceeds available node capacity {{K8_CPU}}"
  }


**operator**: Defines the comparison operation (EQ, LT, LE, GT, GE)

**left_operand**: The first value in the comparison (typically user-requested resources)

**right_operand**: The second value in the comparison (limits, node capacity, or static values)

**assert_message**: Error message displayed when validation fails (supports variable substitution)


Configuration Process
---------------------

Resource validation rules are configured using the OSMO CLI with ``RESOURCE_VALIDATION``:

.. code-block:: bash

  osmo config update RESOURCE_VALIDATION --file /path/to/resource_validation_config.json

The configuration file should contain a JSON object where each key represents a validation template name and the value contains an array of validation rules.


Validation Variables
--------------------

Resource validation supports dynamic variable substitution using special tokens enclosed in double curly braces (``{{TOKEN_NAME}}``).
These variables are resolved at validation time based on workflow specifications and cluster state.

User Resource Variables
~~~~~~~~~~~~~~~~~~~~~~~

These variables represent the resources requested by users in their workflow specifications:

.. list-table:: User Resource Variables
   :header-rows: 1
   :widths: 25 75

   * - **Token**
     - **Description**
   * - ``USER_CPU``
     - CPU count value requested by the user (e.g., "4", "8")
   * - ``USER_MEMORY``
     - Memory value requested by the user (e.g., "8Gi", "16Gi")
   * - ``USER_MEMORY_VAL``
     - Numeric value of the memory request without units
   * - ``USER_MEMORY_UNIT``
     - Unit of the memory request (e.g., "Gi", "Mi")
   * - ``USER_MEMORY_<UNIT>``
     - Memory value converted to specified unit (e.g., ``USER_MEMORY_Gi``)
   * - ``USER_STORAGE``
     - Storage value requested by the user (e.g., "100Gi", "1Ti")
   * - ``USER_STORAGE_VAL``
     - Numeric value of the storage request without units
   * - ``USER_STORAGE_UNIT``
     - Unit of the storage request (e.g., "Gi", "Ti")
   * - ``USER_STORAGE_<UNIT>``
     - Storage value converted to specified unit (e.g., ``USER_STORAGE_Gi``)
   * - ``USER_GPU``
     - GPU count requested by the user (e.g., "1", "4", "8")
   * - ``USER_CACHE``
     - Cache size requested for user mounted inputs

Kubernetes Node Variables
~~~~~~~~~~~~~~~~~~~~~~~~~~

These variables represent the actual resources available on Kubernetes nodes:

.. list-table:: Kubernetes Node Variables
   :header-rows: 1
   :widths: 25 75

   * - **Token**
     - **Description**
   * - ``K8_CPU``
     - Available CPU count on Kubernetes nodes
   * - ``K8_MEMORY``
     - Available memory on Kubernetes nodes
   * - ``K8_STORAGE``
     - Available storage on Kubernetes nodes
   * - ``K8_GPU``
     - Available GPU count on Kubernetes nodes

When a resource validation rule uses Kubernetes node variables (``K8_*``), the workflow's resource request is evaluated
against each available node in the cluster.
Validation passes if the rule succeeds for at least one node, ensuring the workflow can be scheduled.

.. warning::

   Workflow-specific variables (``WF_*``) cannot be used in resource validation rules because
   these values are generated after validation passes and the workflow is successfully submitted.

Validation Operators
--------------------

OSMO supports the following comparison operators for resource validation rules:

.. list-table:: Validation Operators
   :header-rows: 1
   :widths: 15 25 60

   * - **Operator**
     - **Description**
     - **Example Usage**
   * - ``EQ``
     - Equal to
     - Ensure exact resource match: ``{{USER_GPU}} EQ 1``
   * - ``LT``
     - Less than
     - Enforce upper bounds: ``{{USER_STORAGE}} LT {{K8_STORAGE}}``
   * - ``LE``
     - Less than or equal to
     - Allow maximum utilization: ``{{USER_CPU}} LE {{K8_CPU}}``
   * - ``GT``
     - Greater than
     - Enforce minimum values: ``{{USER_MEMORY}} GT 0``
   * - ``GE``
     - Greater than or equal to
     - Ensure minimum requirements: ``{{USER_GPU}} GE 0``


Recommended Validation Templates
--------------------------------

The following are recommended resource validation templates that cover common use cases:

**default_cpu**
  Validates CPU requests against node capacity and ensures positive values.

**default_gpu**
  Validates GPU requests against available GPUs and prevents negative allocations.

**default_memory**
  Validates memory requests against node memory capacity with appropriate bounds checking.

**default_storage**
  Validates storage requests against available node storage with safety margins.

Here's the complete recommended configuration:

.. code-block:: json

  {
    "default_cpu": [
      {
        "operator": "LE",
        "left_operand": "{{USER_CPU}}",
        "right_operand": "{{K8_CPU}}",
        "assert_message": "CPU value {{USER_CPU}} exceeds available node capacity {{K8_CPU}}"
      },
      {
        "operator": "GT",
        "left_operand": "{{USER_CPU}}",
        "right_operand": "0",
        "assert_message": "CPU value {{USER_CPU}} must be greater than 0"
      }
    ],
    "default_gpu": [
      {
        "operator": "LE",
        "left_operand": "{{USER_GPU}}",
        "right_operand": "{{K8_GPU}}",
        "assert_message": "GPU value {{USER_GPU}} exceeds available node capacity {{K8_GPU}}"
      },
      {
        "operator": "GE",
        "left_operand": "{{USER_GPU}}",
        "right_operand": "0",
        "assert_message": "GPU value {{USER_GPU}} cannot be negative"
      }
    ],
    "default_memory": [
      {
        "operator": "LT",
        "left_operand": "{{USER_MEMORY}}",
        "right_operand": "{{K8_MEMORY}}",
        "assert_message": "Memory value {{USER_MEMORY}} exceeds available node capacity {{K8_MEMORY}}"
      },
      {
        "operator": "GT",
        "left_operand": "{{USER_MEMORY}}",
        "right_operand": "0",
        "assert_message": "Memory value {{USER_MEMORY}} must be greater than 0"
      }
    ],
    "default_storage": [
      {
        "operator": "LT",
        "left_operand": "{{USER_STORAGE}}",
        "right_operand": "{{K8_STORAGE}}",
        "assert_message": "Storage value {{USER_STORAGE}} exceeds available node capacity {{K8_STORAGE}}"
      },
      {
        "operator": "GT",
        "left_operand": "{{USER_STORAGE}}",
        "right_operand": "0",
        "assert_message": "Storage value {{USER_STORAGE}} must be greater than 0"
      }
    ]
  }

Best Practices
--------------

Validation Rule Design
~~~~~~~~~~~~~~~~~~~~~~

1. **Layered Validation**: Implement multiple layers of validation (basic bounds checking, node capacity).

2. **Clear Error Messages**: Write descriptive error messages that help users understand what went wrong and how to fix it. Include the variable values that caused the validation to fail.

3. **Safety Margins**: Don't allow 100% resource utilization; leave margins for system overhead and unexpected spikes.


Troubleshooting
---------------

Common Issues
~~~~~~~~~~~~~

**Validation Always Fails**
  Check that Kubernetes node variables are being populated correctly and that nodes are properly labeled and available.

**Inconsistent Validation Results**
  Verify that all nodes in the cluster have consistent resource reporting and that no nodes are in unschedulable states.

**Unit Conversion Errors**
  Ensure that resource units are consistent between user requests and validation rules (e.g., Gi vs GB).


Debugging Tips
~~~~~~~~~~~~~~

1. **Test Rules Incrementally**: Start with simple validation rules and add complexity gradually.

2. **Check Node Status**: Verify that Kubernetes nodes are reporting resources correctly using ``kubectl describe nodes``.

3. **Review Logs**: Examine OSMO service logs for validation rule evaluation details and errors.
