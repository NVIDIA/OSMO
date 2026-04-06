# SPDX-FileCopyrightText: Copyright (c) 2024-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

{{/*
Gateway component name prefix. All gateway resources are named
<prefix>-<component>, e.g. osmo-gateway-envoy.
*/}}
{{- define "osmo.gateway-name" -}}
{{- .Values.gateway.name | default "osmo-gateway" }}
{{- end }}

{{/*
Gateway component labels. Pass a dict with "component" and "context" keys.
*/}}
{{- define "osmo.gateway-component-labels" -}}
app.kubernetes.io/name: {{ include "osmo.gateway-name" .context }}
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}
