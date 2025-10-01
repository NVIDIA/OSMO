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

.. _pod_template_config:

===========================
Pod Template Config
===========================

Each pod template is defined by a name and a Dictionary[String, Any], where the dictionary is a JSON representation of the Kubernetes pod specification.

Example
=======

The following example shows a pod template that adds GPU resources and node selectors:

.. code-block:: json

    {
        "gpu_template": {
            "spec": {
                "nodeSelector": {
                    "accelerator": "nvidia-tesla-v100"
                },
                "containers": [{
                    "name": "main",
                    "resources": {
                        "limits": {
                            "nvidia.com/gpu": "1"
                        }
                    }
                }]
            },
            "metadata": {
                "labels": {
                    "gpu-enabled": "true"
                }
            }
        }
    }

The key here is ``gpu_template``, which is the name of the pod template. The value is a dictionary that contains the Kubernetes pod specification.
When a pool is configured to use this pod template, the Kubernetes pod specification will be merged with the base pod configuration.

A pool can apply this pod template by adding the name to the ``common_pod_template`` array,
and a platform can apply this pod template by adding the name to the ``override_pod_template`` array.

To learn more about pod templates, see :ref:`Pod Template Concepts <pod_template>`.
