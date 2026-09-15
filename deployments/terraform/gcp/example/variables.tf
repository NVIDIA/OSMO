# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

variable "project_id" {
  description = "Existing Google Cloud project with billing enabled."
  type        = string
}

variable "cluster_name" {
  description = "Name prefix for this isolated OSMO deployment."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,18}[a-z0-9]$", var.cluster_name))
    error_message = "Use 2-20 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "zone" {
  description = "Single-zone development cluster; must belong to region."
  type        = string
  default     = "asia-southeast1-b"
  validation {
    condition     = startswith(var.zone, "${var.region}-")
    error_message = "zone must belong to region."
  }
}

variable "deletion_protection" {
  description = "Protect GKE and Cloud SQL from accidental Terraform deletion."
  type        = bool
  default     = true
}
