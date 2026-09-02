# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

locals {
  single_plane_storage_account_name = format(
    "%s%s",
    substr(lower(replace("st${local.name}", "/[^0-9a-z]/", "")), 0, 19),
    random_string.suffix.result,
  )
  single_plane_service_accounts = toset([
    "osmo-api",
    "osmo-worker",
    "osmo-workflow",
  ])
}

resource "azapi_resource" "single_plane_storage_account" {
  count     = var.single_plane_workload_identity_enabled ? 1 : 0
  type      = "Microsoft.Storage/storageAccounts@2023-05-01"
  name      = local.single_plane_storage_account_name
  parent_id = data.azurerm_resource_group.main.id
  location  = data.azurerm_resource_group.main.location
  tags      = local.tags

  body = {
    kind = "StorageV2"
    sku = {
      name = "Standard_LRS"
    }
    properties = {
      allowBlobPublicAccess = false
      allowSharedKeyAccess  = false
      minimumTlsVersion     = "TLS1_2"
    }
  }
}

resource "azapi_resource" "single_plane_storage_container" {
  count     = var.single_plane_workload_identity_enabled ? 1 : 0
  type      = "Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01"
  name      = "osmo-workflows"
  parent_id = "${azapi_resource.single_plane_storage_account[0].id}/blobServices/default"

  body = {
    properties = {
      publicAccess = "None"
    }
  }
}

resource "azurerm_user_assigned_identity" "single_plane_blob" {
  count               = var.single_plane_workload_identity_enabled ? 1 : 0
  name                = "${local.name}-blob"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "single_plane_blob" {
  for_each = var.single_plane_workload_identity_enabled ? local.single_plane_service_accounts : toset([])

  name                      = each.value
  user_assigned_identity_id = azurerm_user_assigned_identity.single_plane_blob[0].id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = azurerm_kubernetes_cluster.main.oidc_issuer_url
  subject                   = "system:serviceaccount:osmo:${each.value}"
}

resource "azurerm_role_assignment" "single_plane_blob" {
  count                            = var.single_plane_workload_identity_enabled ? 1 : 0
  scope                            = azapi_resource.single_plane_storage_account[0].id
  role_definition_name             = "Storage Blob Data Contributor"
  principal_id                     = azurerm_user_assigned_identity.single_plane_blob[0].principal_id
  skip_service_principal_aad_check = true
}
