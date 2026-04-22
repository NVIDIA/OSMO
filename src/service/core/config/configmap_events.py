"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0

Emits Kubernetes Events attached to the osmo-configs ConfigMap so that
operators see reload failures in the tools they already use — ArgoCD UI,
`kubectl describe configmap`, `kubectl get events`. No Prometheus setup
required. Event exporters (e.g. kubernetes-event-exporter) can route to
Slack/email/PagerDuty without any OSMO-specific integration.
"""

import datetime
import logging
from typing import Protocol

from kubernetes import client, config as kube_config  # type: ignore
from kubernetes.client.exceptions import ApiException  # type: ignore


# Reasons are user-facing in `kubectl get events`. Keep them stable and
# CamelCase per K8s convention.
REASON_RELOAD_FAILED = 'ConfigMapReloadFailed'
REASON_RELOAD_SUCCEEDED = 'ConfigMapReloaded'

# K8s Event messages are capped at ~1KB; truncate with an ellipsis so we
# don't get rejected by the apiserver.
_MAX_MESSAGE_LENGTH = 1000


class EventRecorder(Protocol):
    """Structural interface so tests can substitute a fake recorder."""

    def emit_reload_failed(self, message: str) -> None: ...
    def emit_reload_succeeded(self, message: str) -> None: ...


class ConfigMapEventRecorder:
    """Writes Events to the K8s API, attached to the osmo-configs ConfigMap.

    Failures creating events are logged but never raised — observability
    must not break the service's reload path.

    Uses a deterministic event name per (configmap, reason) so that repeated
    failures dedupe into a single Event with a climbing `count`, matching
    the kubelet pattern for repeated failures like ImagePullBackOff.
    """

    def __init__(self, namespace: str, configmap_name: str,
                 component: str = 'osmo-service-configmap-loader'):
        self._namespace = namespace
        self._configmap_name = configmap_name
        self._component = component
        self._configmap_uid: str | None = None

        try:
            kube_config.load_incluster_config()
        except kube_config.ConfigException:
            # Fall back to kubeconfig for local development. Fail silently
            # if neither works — the recorder becomes a no-op, which is
            # preferable to crashing the service.
            try:
                kube_config.load_kube_config()
            except Exception:  # pylint: disable=broad-exception-caught
                logging.warning(
                    'ConfigMapEventRecorder: no kubeconfig available; '
                    'events will not be emitted')
                self._core_v1 = None
                return
        self._core_v1 = client.CoreV1Api()

    def emit_reload_failed(self, message: str) -> None:
        self._emit('Warning', REASON_RELOAD_FAILED, message)

    def emit_reload_succeeded(self, message: str) -> None:
        self._emit('Normal', REASON_RELOAD_SUCCEEDED, message)

    def _emit(self, event_type: str, reason: str, message: str) -> None:
        """Emit or update the deduplicated Event for (configmap, reason).

        GET the event first: on 404, CREATE; otherwise PATCH with an
        incremented count and refreshed message/timestamp. This matches
        the kubelet pattern and prevents event spam during crash-loops.
        """
        if self._core_v1 is None:
            return

        if len(message) > _MAX_MESSAGE_LENGTH:
            message = f'{message[:_MAX_MESSAGE_LENGTH - 3]}...'

        now = datetime.datetime.now(datetime.timezone.utc)
        event_name = f'{self._configmap_name}.{reason.lower()}'

        try:
            existing = self._core_v1.read_namespaced_event(
                event_name, self._namespace)
        except ApiException as error:
            if error.status != 404:
                logging.warning(
                    'Failed to read K8s Event %s: %s', event_name, error)
                return
            # 404 → create a new event
            event = client.CoreV1Event(
                metadata=client.V1ObjectMeta(
                    name=event_name, namespace=self._namespace),
                involved_object=self._involved_object(),
                reason=reason,
                message=message,
                type=event_type,
                source=client.V1EventSource(component=self._component),
                first_timestamp=now,
                last_timestamp=now,
                event_time=now,
                reporting_component=self._component,
                reporting_instance=self._component,
                action='Reload',
                count=1,
            )
            try:
                self._core_v1.create_namespaced_event(self._namespace, event)
            except Exception as create_error:  # pylint: disable=broad-exception-caught
                logging.warning(
                    'Failed to create K8s Event %s: %s',
                    event_name, create_error)
            return

        # Existing event → patch with incremented count
        patch = {
            'count': (existing.count or 1) + 1,
            'lastTimestamp': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'message': message,
        }
        try:
            self._core_v1.patch_namespaced_event(
                event_name, self._namespace, patch)
        except Exception as patch_error:  # pylint: disable=broad-exception-caught
            logging.warning(
                'Failed to patch K8s Event %s: %s', event_name, patch_error)

    def _involved_object(self) -> client.V1ObjectReference:
        """Build the ObjectReference pointing at the ConfigMap.

        Includes the ConfigMap's UID so events match kubectl's field
        selector and appear in `kubectl describe configmap` output.
        Lazily fetches the UID on first use and caches it — a single
        extra API call over the lifetime of the recorder.
        """
        return client.V1ObjectReference(
            api_version='v1',
            kind='ConfigMap',
            name=self._configmap_name,
            namespace=self._namespace,
            uid=self._get_configmap_uid(),
        )

    def _get_configmap_uid(self) -> str | None:
        if self._configmap_uid is not None:
            return self._configmap_uid
        if self._core_v1 is None:
            return None
        try:
            configmap = self._core_v1.read_namespaced_config_map(
                self._configmap_name, self._namespace)
            self._configmap_uid = configmap.metadata.uid
            return self._configmap_uid
        except Exception as error:  # pylint: disable=broad-exception-caught
            # Missing UID means events still exist but won't appear in
            # `kubectl describe configmap` output. They're still visible
            # via `kubectl get events --field-selector` and ArgoCD UI.
            logging.warning(
                'Failed to fetch ConfigMap UID for event involvedObject: %s',
                error)
            return None
