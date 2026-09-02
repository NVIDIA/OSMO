# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

(if $image_pull_secret == "" then [] else [{
  name: "runtime-image-pull-secret",
  mountPath: ("/etc/osmo/secrets/" + $image_pull_secret),
  readOnly: true
}] end) as $image_pull_secret_volume_mounts |
(if $image_pull_secret == "" then [] else [{
  name: "runtime-image-pull-secret",
  secret: {secretName: $image_pull_secret}
}] end) as $image_pull_secret_volumes |
{
  imageRepository: $image_repository,
  imageTag: $image_tag,
  imagePullSecrets: (if $image_pull_secret == "" then [] else [{name: $image_pull_secret}] end),
  services: {
    api: {
      extraVolumeMounts: $image_pull_secret_volume_mounts,
      serviceAccount: {annotations: {"azure.workload.identity/client-id": $workload_identity_client_id}},
      pod: {extraVolumes: $image_pull_secret_volumes}
    },
    worker: {
      extraVolumeMounts: $image_pull_secret_volume_mounts,
      serviceAccount: {annotations: {
        "azure.workload.identity/client-id": $workload_identity_client_id
      }},
      pod: {extraVolumes: $image_pull_secret_volumes}
    },
    agent: {
      extraVolumeMounts: $image_pull_secret_volume_mounts,
      pod: {extraVolumes: $image_pull_secret_volumes}
    },
    logger: {
      extraVolumeMounts: $image_pull_secret_volume_mounts,
      pod: {extraVolumes: $image_pull_secret_volumes}
    }
  },
  externalDependencies: {
    postgresql: {host: $postgres_host, database: $postgres_database, username: $postgres_username},
    valkey: {host: $redis_host, port: ($redis_port | tonumber)},
    objectStorage: {locations: {
      workflows: ("azure://" + $storage_account + "/" + $storage_container + "/workflows"),
      logs: ("azure://" + $storage_account + "/" + $storage_container + "/logs"),
      apps: ("azure://" + $storage_account + "/" + $storage_container + "/apps")
    }}
  },
  configuration: {workflow: {backend_images:
    (if $image_pull_secret == "" then {} else {credential: {
      secretName: $image_pull_secret,
      secretKey: ".dockerconfigjson"
    }} end)
  }}
}
