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

.. _resource_validation_config:

===========================
Resource Validation Config
===========================

Resource validation configurations define rules to validate resource requests against available cluster resources.

Each resource validation set is defined by a name and an Array[`Resource Validation Rule`_].

Operator
========

The following table shows the default resource validation rules:

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - **Type**
     - **Description**
   * - ``LE``
     - Less than or equal to (≤)
   * - ``GE``
     - Greater than or equal to (≥)
   * - ``LT``
     - Less than (<)
   * - ``GT``
     - Greater than (>)
   * - ``EQ``
     - Equal to (=)
   * - ``NE``
     - Not equal to (≠)

Resource Validation Rule
========================

.. list-table::
   :header-rows: 1
   :widths: 25 15 60

   * - **Field**
     - **Type**
     - **Description**
   * - ``operator``
     - `Operator`_
     - The comparison operator to use for validation.
   * - ``left_operand``
     - String
     - The left side of the comparison, typically a user-requested value or template variable.
   * - ``right_operand``
     - String
     - The right side of the comparison, typically a cluster resource limit or template variable.
   * - ``assert_message``
     - String
     - Error message to display when the validation rule fails.

Example
=======

The following example shows a CPU validation rule that ensures user-requested CPU does not exceed available cluster CPU:

.. code-block:: json

    {
        "default_cpu": [
            {
                "operator": "LT",
                "left_operand": "{{USER_CPU}}",
                "right_operand": "{{K8_CPU}}",
                "assert_message": "CPU value {{USER_CPU}} too high"
            },
            {
                "operator": "GT",
                "left_operand": "{{USER_CPU}}",
                "right_operand": "0",
                "assert_message": "CPU value {{USER_CPU}} needs to be greater than 0"
            }
        ]
    }

The key here is ``default_cpu``, which is the name of the resource validation set. The value is an array of resource validation rules.
When a pool is configured using this resource validation set, the resource validation rules will be applied to workflows submitted to the pool.

A pool can apply this resource validation set by adding the name to the ``common_resource_validations`` array,
and a platform can apply this resource validation set by adding the name to the ``override_resource_validations`` array.

To learn more about resource validation, see :ref:`Resource Validation Concepts <resource_validation>`.
