# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

{
  imageRegistry: ($image | split("/")[0]),
  imageRepository: ($image | split("/")[1:] | join("/")),
  imageTag: $tag,
  runtimeImage: {tag: $tag},
  externalDependencies: {
    postgresql: {host: .postgres_host, database: .postgres_database, username: .postgres_username},
    valkey: {host: .redis_host, port: .redis_port},
    objectStorage: {locations: {
      workflows: ("gs://" + .bucket + "/workflows"),
      logs: ("gs://" + .bucket + "/logs"),
      apps: ("gs://" + .bucket + "/apps")
    }}
  },
  secrets: {
    postgresql: {rolloutNonce: $nonce},
    valkey: {rolloutNonce: $nonce},
    objectStorage: {rolloutNonce: $nonce}
  }
}
