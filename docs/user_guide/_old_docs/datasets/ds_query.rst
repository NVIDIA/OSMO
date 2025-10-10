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

.. _ds_query:

================================================
Query
================================================

Query is used to filter dataset versions based on metadata or datasets and collections based on the labels.
A YAML file is required to describe the query parameters.


.. code-block:: bash

  $ osmo dataset query -h
  usage: osmo dataset query [-h] [--format-type {json,text}] file

  positional arguments:
    file                  The Query file to submit

  options:
    -h, --help            show this help message and exit
    --bucket BUCKET, -b BUCKET
                          bucket to query.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).


Fields
-------

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Field**
      - **Description**
    * - name
      - Can use String comparison operators
    * - id
      - Can use String comparison operators
    * - created_date
      - Uses Datetime comparison operators
    * - is_collection
      - Uses Boolean comparison operators
    * - user
      - Can use String comparison operators
    * - label
      - Use the label field by specifying fields like label.<field1>.<field2>
    * - metadata
      - Use the label field by specifying fields like metadata.<field1>.<field2>


Comparison Operators
--------------------
..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Operator**
      - **Type**
      - **Description**
    * - =
      - ALL
      - Matches values that are equal to a specified value.
    * - IN
      - String
      - Matches any of the values specified in an array.
    * - CONTAINS
      - String []
      - Matches values that contain a specified string or arrays that contain an array of elements. For example, metadata.array_field CONTAINS [4].
    * - CONTAINS KEY
      - String
      - Matches the metadata or label and their respective keys, if the key is within the JSON.
    * - LEN()
      - Array
      - Matches the length of an array with a numerical value; that is, LEN(label.cars) <= 15.
    * - <
      - Numeric Datetime
      - Matches values that are less than a specified value.
    * - >
      - Numeric Datetime
      - Matches values that are greater than a specified value.
    * - <= or =<
      - Numeric Datetime
      - Matches values that are less than or equal to a specified value.
    * - >= or =>
      - Numeric Datetime
      - Matches values that are less than or equal to a specified value.
    * - !=
      - ALL
      - Matches values that are not equal to a specified value.


Logical Operators
------------------

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Operator**
      - **Description**
    * - AND
      - Joins query clauses with a logical AND returns all datasets that match the conditions of both clauses.
    * - OR
      - Joins query clauses with a logical OR returns all documents that match the conditions of either clause.
    * - NOT
      - Reverses the result of the next expression.
    * - ( )
      - Use parentheses to separate clauses.


Filter Operators
--------------------
..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Operator**
      - **Type**
      - **Description**
    * - ORDER BY
      - Field
      - Orders the output by name, user, or created_date. Select DESC or ASC to specify list ordering.
    * - LIMIT
      - Numeric
      - Limits the number of results to be a maximum of the value. Grabs results starting from the top.


Sample Queries
--------------

* Query datasets with metadata where:

  * colors are blue or green
  * width of object is more than 1000
  * label height is 150

  AND is assumed, but can also be specified.

.. code-block:: bash

  metadata.color.car.door IN ["blue", "green"] AND label.width > 1000 AND label.height = 150


* Query datasets with name contains 'DS' or created_date before ``2023-03-23 16:28:44``.

.. code-block:: bash

  name CONTAINS "DS" OR created_date < "2023-03-23 16:28:44"


* Query datasets with name contains 'DS' and have created_date before ``2023-03-23 16:28:44`` or has a dataset version created by 'user'.

.. code-block:: bash

  name CONTAINS "DS" AND (created_date < "2023-03-23 16:28:44" OR user = "user")

* Some datasets might have periods in the key. To query with key 'car.color' equal to 'red':

.. code-block:: bash

  label."car.color" = "red"

* To query datasets that have the key 'car' with a dictionary that has a key 'color' that has a value 'red' or the key 'car.color' equal to 'red', you can use this query:

.. code-block:: bash

  label."car.color" = "red" OR label.car.color = "red"


Comments
--------------

The query file supports comments using ``#``. For example:

.. code-block:: bash

  # Comment 1
  label."car.color" = "red # Not a comment" OR label.car.color = "red" # Comment 2
