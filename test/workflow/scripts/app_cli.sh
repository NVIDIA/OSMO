#####################################################################################
# Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.
#####################################################################################

set -x

APP_NAME="${1:?Error: first argument (APP_NAME) is required}"

echo "[App Create Start] ------------------------------------------------"
if ! output=$(osmo app create ${APP_NAME} -d "This is a test app for integration test." -f "$(dirname "$0")/app_spec.yaml" 2>&1); then
    if echo "$output" | grep -q "already exists"; then
        echo "[App Create Done] App already exists, updating..."

        echo "[App Update Start] ------------------------------------------------"
        osmo app update ${APP_NAME} -f "$(dirname "$0")/app_spec.yaml"
        if [ $? -ne 0 ]; then
            echo "[App Update Failed] Failed to update app"
            exit 1
        fi
        echo "[App Update Done]"
    elif echo "$output" | grep -q "created successfully"; then
        echo "[App Create Done]"
    else
        echo "[App Create Failed] Failed to create app"
        exit 1
    fi
fi

sleep 60

echo "[App List Start] ------------------------------------------------"
osmo app list
if [ $? -ne 0 ]; then
    echo "[App List Failed] Failed to list apps"
    exit 1
fi
echo "[App List Done]"

echo "[App Info Start] ------------------------------------------------"
osmo app info ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Info Failed] Failed to get app info"
    exit 1
fi
echo "[App Info Done]"

echo "[App Show Start] ------------------------------------------------"
osmo app show ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Show Failed] Failed to get app show"
    exit 1
fi
echo "[App Show Done]"

echo "[App Spec Start] ------------------------------------------------"
osmo app spec ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Spec Failed] Failed to get app spec"
    exit 1
fi
echo "[App Spec Done]"

echo "[App Delete Start] ------------------------------------------------"
osmo app delete ${APP_NAME} -a -f
if [ $? -ne 0 ]; then
    echo "[App Delete Failed] Failed to delete app"
    exit 1
fi
echo "[App Delete Done]"

sleep 60

echo "[App Info Start] ------------------------------------------------"
osmo app info ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Info Failed] Failed to get app info"
    exit 1
fi
echo "[App Info Done]"

echo "[App Show Start] ------------------------------------------------"
osmo app show ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Show Failed] Failed to get deleted app show"
else
    echo "[Info] Deleted App Show is still available"
    exit 1
fi
echo "[App Show Done]"

echo "[App Spec Start] ------------------------------------------------"
osmo app spec ${APP_NAME}
if [ $? -ne 0 ]; then
    echo "[App Spec Failed] Failed to get deleted app spec"
else
    echo "[Info] Deleted App Spec is still available"
    exit 1
fi
echo "[App Spec Done]"
