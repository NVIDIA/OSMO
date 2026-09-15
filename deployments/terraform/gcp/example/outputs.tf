# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

output "deployment" {
  description = "Deployment-script contract. Includes credentials; never print or commit this output."
  sensitive   = true
  value = {
    project_id        = var.project_id
    cluster_name      = google_container_cluster.osmo.name
    region            = var.region
    zone              = var.zone
    postgres_host     = google_sql_database_instance.osmo.private_ip_address
    postgres_database = google_sql_database.osmo.name
    postgres_username = google_sql_user.osmo.name
    postgres_password = random_password.postgres.result
    redis_host        = google_redis_instance.osmo.host
    redis_port        = google_redis_instance.osmo.port
    redis_password    = google_redis_instance.osmo.auth_string
    redis_ca          = join("\n", [for ca in google_redis_instance.osmo.server_ca_certs : ca.cert])
    bucket            = google_storage_bucket.osmo.name
    access_key_id     = google_storage_hmac_key.osmo.access_id
    access_key        = google_storage_hmac_key.osmo.secret
  }
}
