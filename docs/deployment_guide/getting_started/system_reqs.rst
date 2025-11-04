System Requirements
===================

This section provides the system requirements for deploying OSMO.

Service
----------------------------

.. list-table:: Node Configuration
   :widths: auto
   :header-rows: 1

   * - Compute Node
     - Minimum Requirements
   * - CPU Cores
     - 8 cores
   * - Memory
     - 32 GB
   * - Disk
     - 100 GB
   * - Operating System
     - Ubuntu 22.04+ or equivalent enterprise Linux distribution

.. note::
  The compute node can be a single node or a cluster of nodes. If you are using a cluster of nodes, the nodes cpu cores and memory should add up to the minimum requirements.

.. list-table:: PostgreSQL Configuration
   :widths: auto
   :header-rows: 1

   * - PostgreSQL
     - Minimum Requirements
   * - Version
     - 15.0+
   * - Storage
     - 32 GB
   * - CPU Cores
     - 2 cores
   * - Memory
     - 4 GB

.. list-table:: Redis Configuration
   :widths: auto
   :header-rows: 1

   * - Redis
     - Minimum Requirements
   * - Version
     - 7.0+
   * - Memory
     - 4 GB
   * - CPU Cores
     - 1 core
