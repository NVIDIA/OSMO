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

==================================
/api/configs/resource_validation
==================================

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
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``operator``
     - `Operator`_
     - The comparison operator to use for validation.
     - Required field
   * - ``left_operand``
     - String
     - The left side of the comparison, typically a user-requested value or template variable.
     - Required field
   * - ``right_operand``
     - String
     - The right side of the comparison, typically a cluster resource limit or template variable.
     - Required field
   * - ``assert_message``
     - String
     - Error message to display when the validation rule fails.
     - Required field

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

Rules Breakdown
~~~~~~~~~~~~~~~

In the first rule, we are comparing the values of two dynamic variables: ``{{USER_CPU}}`` and ``{{K8_CPU}}``.
If a variable that starts with ``K8_`` is used, this validation check will be performed against **all available**
resource nodes in the pool.

In the second rule, we are comparing the values of one dynamic variable (``{{USER_CPU}}``) and a static value: ``0``.
This **static validation check** will be performed **once**.

.. note::

  The static validation check can compare values with units. For example:

  .. code-block:: json

    {
        "operator": "GT",
        "left_operand": "{{USER_STORAGE}}",
        "right_operand": "5Gi",
        "assert_message": "Storage value {{USER_STORAGE}} needs to be greater than 5Gi"
    }

  For static values, resource validation supports units ``B``, ``Ki``, ``Mi``, ``Gi`` and ``Ti``.

  Users can pick any unit specified above for the static value, and the resource validation check will
  perform unit conversion to compare ``{{USER_STORAGE}}`` with the static value.

  .. dropdown:: Does static validation support the ``m`` unit for comparing CPU?
    :color: info
    :icon: code

    Currently, CPU validation does not support the ``m`` unit. For your static value, you will need to
    use an integer instead.

A pool can apply this resource validation set by adding the name to the ``common_resource_validations`` array,
and a platform can apply this resource validation set by adding the name to the ``override_resource_validations`` array.

To learn more about resource validation, see :ref:`Resource Validation Concepts <resource_validation>`.
