# OSMO Cookbook Reference

When generating a workflow spec, find the closest example below and fetch its YAML via
WebFetch as a starting point. Adapt it to the user's request rather than generating
from scratch.

**Full cookbook README:** https://github.com/NVIDIA/OSMO/tree/main/cookbook

---

## Lookup Table

| Category | Workflow | Raw YAML URL |
|---|---|---|
| **Synthetic Data Generation** | Isaac Sim SDG | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/synthetic_data_generation/isaac_sim/isaac_sim_sdg.yaml |
| **Synthetic Data Generation** | Gazebo SDG | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/synthetic_data_generation/gazebo/gazebo_sdg.yaml |
| **Reinforcement Learning** | Single GPU | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/single_gpu/train_policy.yaml |
| **Reinforcement Learning** | Multi-GPU | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/multi_gpu/train_policy.yaml |
| **Reinforcement Learning** | Multi-Node | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/reinforcement_learning/multi_node/train_policy.yaml |
| **GR00T** | Fine-tuning | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/groot/groot_finetune/groot_finetune.yaml |
| **GR00T** | Imitation learning (MimicGen) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/groot/groot_mimic/groot_mimic.yaml |
| **GR00T** | Interactive notebook | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/groot/groot_notebook/groot_notebook.yaml |
| **DNN Training** | TorchRun single-node | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/dnn_training/single_node/train.yaml |
| **DNN Training** | TorchRun multi-node | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/dnn_training/torchrun_multinode/train.yaml |
| **DNN Training** | TorchRun elastic (rescheduling) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/dnn_training/torchrun_elastic/train.yaml |
| **DNN Training** | TorchRun with reschedule | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/dnn_training/torchrun_reschedule/train.yaml |
| **DNN Training** | DeepSpeed multi-node | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/dnn_training/deepspeed_multinode/train.yaml |
| **Cosmos** | Video generation (video2world) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/cosmos/predict/cosmos_video2world.yaml |
| **Cosmos** | Video reasoning | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/cosmos/reason/cosmos_reason.yaml |
| **Cosmos** | Video transfer | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/cosmos/transfer/cosmos_transfer.yaml |
| **ROS2** | Multi-node communication | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/ros/comm/ros2_comm.yaml |
| **ROS2** | TurtleBot simulation (Foxglove) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/ros/turtlebot/turtlebot_demo.yaml |
| **Remote Dev** | JupyterLab | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/jupyterlab/jupyter.yaml |
| **Remote Dev** | VSCode | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/vscode/vscode.yaml |
| **Remote Dev** | Ray cluster | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/ray/ray.yaml |
| **Remote Dev** | Weights & Biases | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/wandb/train.yaml |
| **Remote Dev** | Isaac Sim livestream | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/isaacsim/sim.yaml |
| **Remote Dev** | Filebrowser | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/filebrowser/filebrowser.yaml |
| **Remote Dev** | GitHub integration | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/integration_and_tools/github/github.yaml |
| **NIMs** | NVIDIA NIM inference | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nims/use_nim.yaml |
| **Nut Pouring Pipeline** | Step 1 — MimicGen data generation | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/01_mimic_generation.yaml |
| **Nut Pouring Pipeline** | Step 2 — HDF5 to MP4 conversion | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/02_hdf5_to_mp4.yaml |
| **Nut Pouring Pipeline** | Step 3 — Cosmos augmentation | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/03_cosmos_augmentation.yaml |
| **Nut Pouring Pipeline** | Step 4 — MP4 to HDF5 conversion | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/04_mp4_to_hdf5.yaml |
| **Nut Pouring Pipeline** | Step 5 — LeRobot conversion | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/05_lerobot_conversion.yaml |
| **Nut Pouring Pipeline** | Step 6 — GR00T fine-tuning | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/nut_pouring/06_groot_finetune.yaml |
| **Tutorials** | Hello world | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/hello_world.yaml |
| **Tutorials** | Serial workflow | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/serial_workflow.yaml |
| **Tutorials** | Parallel tasks | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/parallel_tasks.yaml |
| **Tutorials** | Group tasks | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/group_tasks.yaml |
| **Tutorials** | Group tasks with communication | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/group_tasks_communication.yaml |
| **Tutorials** | Data download | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/data_download.yaml |
| **Tutorials** | Data upload | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/data_upload.yaml |
| **Tutorials** | Dataset download | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/dataset_download.yaml |
| **Tutorials** | Dataset upload | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/dataset_upload.yaml |
| **Tutorials** | Resource config (basic) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/resources_basic.yaml |
| **Tutorials** | Resource config (multiple) | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/resources_multiple.yaml |
| **Tutorials** | Platform targeting | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/resources_platforms.yaml |
| **Tutorials** | Robot simulation | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/robot_simulation.yaml |
| **Tutorials** | Token example | https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/tutorials/token_example.yaml |

---

## Fallback

If no example closely matches the user's request, use expert agents to generate the contents of the script
and generate the workflow spec from scratch.
