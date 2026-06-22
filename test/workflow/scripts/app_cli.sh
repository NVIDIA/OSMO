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
if output=$(osmo app create ${APP_NAME} -d "This is a test app for integration test." -f "$(dirname "$0")/app_spec.yaml" 2>&1); then
    echo "[App Create Done]"
elif echo "$output" | grep -q "already exists"; then
    echo "[App Create Done] App already exists, updating..."
    echo "[App Update Start] ------------------------------------------------"
    if ! osmo app update ${APP_NAME} -f "$(dirname "$0")/app_spec.yaml"; then
        echo "[App Update Failed] Failed to update app"
        exit 1
    fi
    echo "[App Update Done]"
else
    echo "[App Create Failed] Failed to create app"
    exit 1
fi

sleep 60

echo "[App List Start] ------------------------------------------------"
if ! osmo app list; then
    echo "[App List Failed] Failed to list apps"
    exit 1
fi
echo "[App List Done]"

echo "[App Info Start] ------------------------------------------------"
if ! osmo app info ${APP_NAME}; then
    echo "[App Info Failed] Failed to get app info"
    exit 1
fi
echo "[App Info Done]"

echo "[App Show Start] ------------------------------------------------"
if ! osmo app show ${APP_NAME}; then
    echo "[App Show Failed] Failed to get app show"
    exit 1
fi
echo "[App Show Done]"

echo "[App Spec Start] ------------------------------------------------"
if ! osmo app spec ${APP_NAME}; then
    echo "[App Spec Failed] Failed to get app spec"
    exit 1
fi
echo "[App Spec Done]"

echo "[App Delete Start] ------------------------------------------------"
if ! osmo app delete ${APP_NAME} -a -f; then
    echo "[App Delete Failed] Failed to delete app"
    exit 1
fi
echo "[App Delete Done]"

sleep 60

# Post-delete probes: OSMO soft-deletes, so info/show/spec continue to
# return the app with a DELETED-status version. Log the output for
# diagnostic value but don't treat success as an error — exercising the
# CLI commands is the point, not asserting hard-delete semantics.
echo "[App Info Start] ------------------------------------------------"
osmo app info ${APP_NAME} || echo "[Info] info on deleted app exited non-zero (also fine)"
echo "[App Info Done]"

echo "[App Show Start] ------------------------------------------------"
osmo app show ${APP_NAME} || echo "[Info] show on deleted app exited non-zero (also fine)"
echo "[App Show Done]"

echo "[App Spec Start] ------------------------------------------------"
osmo app spec ${APP_NAME} || echo "[Info] spec on deleted app exited non-zero (also fine)"
echo "[App Spec Done]"
