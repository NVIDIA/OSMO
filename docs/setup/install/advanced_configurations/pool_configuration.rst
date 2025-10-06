.. _pool_configuration:

=======================
Pool Configuration
=======================

.. TODO:
  Add a section of how to configure the custom pool with heterogeneous nodes.


Configure Pool Platform
---------------------------------------

A platform is a set of resources within a pool defined by the labels and tolerations set in the pool and platform pod template.

OSMO is configured to handle resources which are referenced by multiple platforms within the same pool, but it is recommended that each resource matches a single platform within a pool.

Refer to :ref:`pool_config` for more information on the platform configuration.

.. note::

  Pod templates override the field prior to it unless it is a list. If the field is a list, the
  latter pod template will append to the list. If the field is a list of dictionaries, the
  dictionary is merged if the ``name`` field is the same. Otherwise, it is appended.

  The starting pod template is the one defined in the pool config.

.. note::

  Fields like ``tolerations``, ``labels``, and ``priority`` in the the platform/pool configs
  are derived from the pod template and therefore do not need to be set. If specified in the
  platform configs, they will be ignored in favor for the ones defined in the pod template.


Create the platform configuration using the OSMO CLI. A default platform config is shown below:

.. code-block:: bash

  echo '{
    "default_platform": "<default_platform>",
    "platforms": {
      "<default_platform>": {
        "description": "my nodes",
        "host_network_allowed": false,
        "privileged_allowed": false,
        "default_variables": {},
        "resource_validations": [],
        "override_pod_template": [],
        "allowed_mounts": []
      }
    }
  }' > /tmp/pool_platform_config.json

Then, update the platform configuration using the OSMO CLI.

.. code-block:: bash

  POOL_NAME=...
  osmo config update POOL $POOL_NAME --file /tmp/pool_platform_config.json


.. TODO:
  Add a section of how to give access to a pool to a user with roles.
