#####################################################################################
# Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
#####################################################################################

set -x

echo "[Profile List Start] ------------------------------------------------"
osmo profile list
if [ $? -ne 0 ]; then
    echo "[Profile List Failed] Failed to list profile"
    exit 1
fi
echo "[Profile List Done]"

echo "[Workflow List Start] ------------------------------------------------"
osmo workflow list
if [ $? -ne 0 ]; then
    echo "[Workflow List Failed] Failed to list workflows"
    exit 1
fi
echo "[Workflow List Done]"

echo "[Workflow Query Start] ------------------------------------------------"
osmo workflow query {{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Workflow Query Failed] Failed to query workflow"
    exit 1
fi
echo "[Workflow Query Done]"

echo "[Workflow Tag Start] ------------------------------------------------"
osmo workflow tag --workflow {{workflow_id}} --add test
if [ $? -ne 0 ]; then
    echo "[Workflow Tag Failed] Failed to add tag to workflow"
    exit 1
fi

echo "[Workflow Tag] Remove 'test' tag from workflow"
osmo workflow tag --workflow {{workflow_id}} --remove test
if [ $? -ne 0 ]; then
    echo "[Workflow Tag Failed] Failed to remove tag from workflow"
    exit 1
fi
echo "[Workflow Tag Done]"

echo "[Workflow Spec Start] ------------------------------------------------"
osmo workflow spec {{workflow_id}}
if [ $? -ne 0 ]; then
    echo "[Workflow Spec Failed] Failed to query workflow spec"
    exit 1
fi

echo "[Workflow Spec] Query workflow spec with template"
osmo workflow spec {{workflow_id}} --template
if [ $? -ne 0 ]; then
    echo "[Workflow Spec Failed] Failed to query workflow spec with template"
    exit 1
fi
echo "[Workflow Spec Done]"

echo "[Pool List Start] ------------------------------------------------"
osmo pool list
if [ $? -ne 0 ]; then
    echo "[Pool List Failed] Failed to query pool list"
    exit 1
fi
echo "[Pool List Done]"

echo "[Resource List Start] ------------------------------------------------"
osmo resource list
if [ $? -ne 0 ]; then
    echo "[Resource List Failed] Failed to query resources list"
    exit 1
fi
echo "[Resource List Done]"

echo "[Task List Start] ------------------------------------------------"
osmo task list
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list"
    exit 1
fi

echo "[Task List] Query task list with all users"
osmo task list --all-users
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with all users"
    exit 1
fi

osmo task list -a
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with all users"
    exit 1
fi

echo "[Task List] Query task list with verbose"
osmo task list --verbose
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with verbose"
    exit 1
fi

osmo task list -v
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with verbose"
    exit 1
fi

echo "[Task List] Query task list with summary"
osmo task list --summary
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with summary"
    exit 1
fi

osmo task list -S
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list with summary"
    exit 1
fi

echo "[Task List] Query task list aggregated by workflow"
osmo task list --aggregate-by-workflow
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list aggregated by workflow"
    exit 1
fi

osmo task list -W
if [ $? -ne 0 ]; then
    echo "[Task List Failed] Failed to query task list aggregated by workflow"
    exit 1
fi

echo "[Task List Done]"
