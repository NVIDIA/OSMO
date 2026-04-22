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


class EventRecorder(Protocol):
    """Structural interface so tests can substitute a fake recorder."""

    def emit_reload_failed(self, message: str) -> None: ...
    def emit_reload_succeeded(self, message: str) -> None: ...


class ConfigMapEventRecorder:
    """Writes Events to the K8s API, attached to the osmo-configs ConfigMap.

    Failures creating events are logged but never raised — observability
    must not break the service's reload path.
    """

    def __init__(self, namespace: str, configmap_name: str,
                 component: str = 'osmo-service-configmap-loader'):
        self._namespace = namespace
        self._configmap_name = configmap_name
        self._component = component

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

        A deterministic name (`<configmap>.<reason-lowercase>`) means every
        emit for the same reason targets one Event object. GET it first:
        if it exists, PATCH to update the message and bump the count; if
        not (404), CREATE a fresh one. This matches the kubelet pattern
        for repeated failures like ImagePullBackOff and prevents event
        spam during crash-loops.
        """
        core_v1 = self._core_v1
        if core_v1 is None:
            return

        # K8s Event messages are capped at ~1KB; truncate with an
        # ellipsis so we don't get rejected by the apiserver.
        max_message_length = 1000
        truncated_message = (
            message
            if len(message) <= max_message_length
            else f'{message[:max_message_length - 3]}...')

        now = datetime.datetime.now(datetime.timezone.utc)
        event_name = f'{self._configmap_name}.{reason.lower()}'

        try:
            existing = core_v1.read_namespaced_event(
                event_name, self._namespace)
        except ApiException as error:
            if error.status == 404:
                self._create_event(
                    core_v1, event_name, event_type, reason,
                    truncated_message, now)
            else:
                logging.warning(
                    'Failed to read K8s Event %s: %s', event_name, error)
            return
        except Exception as error:  # pylint: disable=broad-exception-caught
            logging.warning(
                'Failed to read K8s Event %s: %s', event_name, error)
            return

        self._patch_event(
            core_v1, event_name, existing, truncated_message, now)

    def _create_event(self, core_v1: client.CoreV1Api, event_name: str,
                      event_type: str, reason: str, message: str,
                      now: datetime.datetime) -> None:
        event = client.CoreV1Event(
            metadata=client.V1ObjectMeta(
                name=event_name,
                namespace=self._namespace,
            ),
            involved_object=client.V1ObjectReference(
                api_version='v1',
                kind='ConfigMap',
                name=self._configmap_name,
                namespace=self._namespace,
            ),
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
            core_v1.create_namespaced_event(self._namespace, event)
        except Exception as error:  # pylint: disable=broad-exception-caught
            logging.warning(
                'Failed to create K8s Event %s: %s', event_name, error)

    def _patch_event(self, core_v1: client.CoreV1Api, event_name: str,
                     existing: client.CoreV1Event, message: str,
                     now: datetime.datetime) -> None:
        patch = {
            'count': (existing.count or 1) + 1,
            'lastTimestamp': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'message': message,
        }
        try:
            core_v1.patch_namespaced_event(
                event_name, self._namespace, patch)
        except Exception as error:  # pylint: disable=broad-exception-caught
            logging.warning(
                'Failed to patch K8s Event %s: %s', event_name, error)
