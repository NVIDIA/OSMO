# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "7.29.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com", "container.googleapis.com", "iam.googleapis.com",
    "sqladmin.googleapis.com", "redis.googleapis.com", "servicenetworking.googleapis.com",
    "storage.googleapis.com", "artifactregistry.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

resource "google_compute_network" "osmo" {
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "osmo" {
  name                     = var.cluster_name
  network                  = google_compute_network.osmo.id
  ip_cidr_range            = "10.40.0.0/20"
  private_ip_google_access = true
  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.44.0.0/14"
  }
  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.48.0.0/20"
  }
}

resource "google_compute_router" "osmo" {
  name    = var.cluster_name
  network = google_compute_network.osmo.id
}

resource "google_compute_router_nat" "osmo" {
  name                               = var.cluster_name
  router                             = google_compute_router.osmo.name
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_global_address" "services" {
  name          = "${var.cluster_name}-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  address       = "10.50.0.0"
  network       = google_compute_network.osmo.id
}

resource "google_service_networking_connection" "services" {
  network                 = google_compute_network.osmo.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.services.name]
}

resource "google_service_account" "nodes" {
  account_id = "${var.cluster_name}-nodes"
  depends_on = [google_project_service.apis]
}

resource "google_project_iam_member" "nodes" {
  for_each = toset([
    "roles/container.defaultNodeServiceAccount",
    "roles/artifactregistry.reader",
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

resource "google_container_cluster" "osmo" {
  name                     = var.cluster_name
  location                 = var.zone
  network                  = google_compute_network.osmo.id
  subnetwork               = google_compute_subnetwork.osmo.id
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = var.deletion_protection
  networking_mode          = "VPC_NATIVE"
  release_channel {
    channel = "REGULAR"
  }
  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }
  private_cluster_config {
    enable_private_nodes = true
  }
  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic = true
    }
    ip_endpoints_config {
      enabled = false
    }
  }
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
  node_config {
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
  }
  depends_on = [google_project_iam_member.nodes, google_compute_router_nat.osmo]
}

resource "google_container_node_pool" "cpu" {
  name       = "cpu"
  location   = var.zone
  cluster    = google_container_cluster.osmo.name
  node_count = 2
  node_config {
    machine_type    = "e2-standard-4"
    disk_size_gb    = 50
    disk_type       = "pd-balanced"
    image_type      = "COS_CONTAINERD"
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "osmo" {
  name                = "${var.cluster_name}-postgres"
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection
  settings {
    tier              = "db-custom-2-7680"
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 20
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.osmo.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }
  }
  depends_on = [google_service_networking_connection.services]
}

resource "google_sql_database" "osmo" {
  name     = "osmo"
  instance = google_sql_database_instance.osmo.name
}

resource "google_sql_user" "osmo" {
  name     = "osmo"
  instance = google_sql_database_instance.osmo.name
  password = random_password.postgres.result
}

resource "google_redis_instance" "osmo" {
  name                    = "${var.cluster_name}-redis"
  tier                    = "BASIC"
  memory_size_gb          = 1
  redis_version           = "REDIS_7_2"
  authorized_network      = google_compute_network.osmo.id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  depends_on              = [google_service_networking_connection.services]
}

resource "random_id" "bucket" {
  byte_length = 4
}

resource "google_storage_bucket" "osmo" {
  name                        = "${var.project_id}-${var.cluster_name}-${random_id.bucket.hex}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  depends_on                  = [google_project_service.apis]
}

resource "google_service_account" "storage" {
  account_id = "${var.cluster_name}-storage"
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "storage" {
  for_each = toset(["roles/storage.objectAdmin", "roles/storage.legacyBucketReader"])
  bucket   = google_storage_bucket.osmo.name
  # GSBackend also uses HeadBucket, which requires storage.buckets.get.
  role   = each.key
  member = "serviceAccount:${google_service_account.storage.email}"
}

# GSBackend currently requires static S3-compatible credentials.
resource "google_storage_hmac_key" "osmo" {
  service_account_email = google_service_account.storage.email
  depends_on            = [google_storage_bucket_iam_member.storage]
}
