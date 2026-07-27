{{- /*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/ -}}
{{- define "osmo-install.fullname" -}}
{{- printf "%s-osmo" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osmo-install.hook-annotations" -}}
"helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
{{- end -}}

{{- define "osmo-install.retained-hook-annotations" -}}
"helm.sh/hook-delete-policy": before-hook-creation
{{- end -}}
