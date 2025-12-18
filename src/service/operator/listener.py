"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
"""
import asyncio
import datetime
import enum
import json
import logging
import os
import time
import uuid
from collections import defaultdict
from typing import Dict, List
from urllib.parse import urlparse

import fastapi
import pydantic
import uvicorn  # type: ignore


# Hardcoded message structures to avoid external dependencies
class MessageType(enum.Enum):
    """Message types for backend communication."""
    ACK = 'ack'
    UPDATE_POD = 'update_pod'


class MessageBody(pydantic.BaseModel):
    """Message structure for backend communication."""
    type: MessageType
    body: Dict
    uuid: str = pydantic.Field(default_factory=lambda: uuid.uuid4().hex)
    timestamp: datetime.datetime = pydantic.Field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc)
    )

    class Config:
        extra = pydantic.Extra.forbid


class AckBody(pydantic.BaseModel):
    """Acknowledgment message body."""
    uuid: str

    class Config:
        extra = pydantic.Extra.forbid


class ListenerServiceConfig(pydantic.BaseSettings):
    """Config settings for the workflow listener service"""
    host: str = pydantic.Field(
        default='http://0.0.0.0:8080',
        env='OSMO_LISTENER_HOST',
        description='Host and port for the listener service')

    log_level: str = pydantic.Field(
        default='INFO',
        env='OSMO_LOG_LEVEL',
        description='Logging level')

    results_dir: str = pydantic.Field(
        default='src/results',
        env='OSMO_RESULTS_DIR',
        description='Directory to save benchmark results')

    implementation: str = pydantic.Field(
        default='python',
        env='OSMO_IMPLEMENTATION',
        description='Implementation type (python or go)')

    class Config:
        env_prefix = ''


class PodStatusChange(pydantic.BaseModel):
    """Record of a pod status change"""
    timestamp: str
    status: str
    message: str = ''


class PodMetrics(pydantic.BaseModel):
    """Metrics for a single pod"""
    workflow_uuid: str
    task_uuid: str
    retry_id: int
    backend: str
    status_changes: List[PodStatusChange] = []
    first_seen: str
    last_seen: str


class BenchmarkMetrics:
    """Collects metrics for benchmarking"""
    def __init__(self):
        self.pods: Dict[str, PodMetrics] = {}
        self.start_time = datetime.datetime.now(datetime.timezone.utc)
        self.message_count = 0
        self.lock = asyncio.Lock()

    def _get_pod_key(self, workflow_uuid: str, task_uuid: str, retry_id: int) -> str:
        return f"{workflow_uuid}:{task_uuid}:{retry_id}"

    async def record_pod_update(self, body: Dict):
        """Record a pod status update"""
        async with self.lock:
            self.message_count += 1
            workflow_uuid = body.get('workflow_uuid', '')
            task_uuid = body.get('task_uuid', '')
            retry_id = body.get('retry_id', 0)
            status = body.get('status', '')
            message = body.get('message', '')
            backend = body.get('backend', '')

            pod_key = self._get_pod_key(workflow_uuid, task_uuid, retry_id)
            now = datetime.datetime.now(datetime.timezone.utc).isoformat()

            if pod_key not in self.pods:
                self.pods[pod_key] = PodMetrics(
                    workflow_uuid=workflow_uuid,
                    task_uuid=task_uuid,
                    retry_id=retry_id,
                    backend=backend,
                    first_seen=now,
                    last_seen=now
                )

            pod_metrics = self.pods[pod_key]
            pod_metrics.last_seen = now
            pod_metrics.status_changes.append(
                PodStatusChange(
                    timestamp=now,
                    status=status,
                    message=message
                )
            )

    async def save_results(self, results_dir: str, implementation: str):
        """Save metrics to JSON file"""
        async with self.lock:
            os.makedirs(results_dir, exist_ok=True)
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = os.path.join(results_dir, f'benchmark_{implementation}_{timestamp}.json')

            results = {
                'implementation': implementation,
                'start_time': self.start_time.isoformat(),
                'end_time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'total_messages': self.message_count,
                'total_pods': len(self.pods),
                'pods': {key: pod.dict() for key, pod in self.pods.items()}
            }

            with open(filename, 'w') as f:
                json.dump(results, f, indent=2)

            logger.info(f'Saved benchmark results to {filename}')
            return filename


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = fastapi.FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# Global metrics collector
metrics = BenchmarkMetrics()


@app.get('/health')
async def health():
    """Health check endpoint for readiness and liveness probes."""
    return {'status': 'OK'}


@app.websocket('/api/agent/listener/pod/backend/{name}')
async def workflow_listener_communication(websocket: fastapi.WebSocket, name: str):
    """
    WebSocket endpoint for workflow backend communication.

    Receives messages from the client and sends ACK responses.
    Continues to listen for the next message after each ACK.

    Args:
        websocket: FastAPI WebSocket connection
        name: Backend name from URL path
    """
    await websocket.accept()
    logger.info(f'Opening workflow websocket connection for backend {name}')

    try:
        while True:
            # Receive message from client
            try:
                message_json = await websocket.receive_json()
                message = MessageBody(**message_json)

                # Calculate latency from message timestamp
                try:
                    # Ensure msg_time is timezone-aware
                    msg_time = message.timestamp if message.timestamp.tzinfo else message.timestamp.replace(tzinfo=datetime.timezone.utc)
                    latency_ms = (datetime.datetime.now(datetime.timezone.utc) - msg_time).total_seconds() * 1000
                except (ValueError, AttributeError):
                    latency_ms = 0

                logger.info(
                    f'Received message from backend {name}: type={message.type.value}, '
                    f'uuid={message.uuid}, latency_ms={latency_ms:.2f}'
                )

                # Record metrics for UPDATE_POD messages
                if message.type == MessageType.UPDATE_POD:
                    await metrics.record_pod_update(message.body)
            except fastapi.WebSocketDisconnect:
                logger.info(f'WebSocket disconnected for backend {name}')
                break
            except Exception as err:
                logger.error(f'Error receiving message from backend {name}: {err}')
                continue

            # Send ACK response using the same structure as in helpers.py
            try:
                ack_body = AckBody(uuid=message.uuid)
                ack_message = MessageBody(
                    type=MessageType.ACK,
                    body=ack_body.dict(),
                    timestamp=message.timestamp  # Echo back the original timestamp
                )
                await websocket.send_text(ack_message.json())
                logger.info(f'Sent ACK to backend {name}')
            except Exception as err:
                logger.error(f'Error sending ACK to backend {name}: {err}')
                break

    except Exception as err:
        logger.error(f'Unexpected error for backend {name}: {err}')
    finally:
        logger.info(f'Closing workflow websocket connection for backend {name}')


async def save_metrics_on_shutdown(config: ListenerServiceConfig):
    """Save metrics when server is shutting down"""
    try:
        filename = await metrics.save_results(config.results_dir, config.implementation)
        logger.info(f'Benchmark results saved to {filename}')
    except Exception as err:
        logger.error(f'Error saving metrics: {err}')


def main():
    """Main entry point for the workflow listener service."""
    config = ListenerServiceConfig()

    # Set logging level
    logging.getLogger().setLevel(config.log_level)

    # Parse host and port
    parsed_url = urlparse(config.host)
    host = parsed_url.hostname if parsed_url.hostname else '0.0.0.0'
    if parsed_url.port:
        port = parsed_url.port
    else:
        port = 8080

    logger.info(f'Starting workflow listener service ({config.implementation}) on {host}:{port}')
    logger.info(f'WebSocket endpoint: /api/agent/listener/pod/backend/{{name}}')
    logger.info(f'Results directory: {config.results_dir}')
    logger.info('Press Ctrl+C to stop')

    # Create and run uvicorn server
    uvicorn_config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=config.log_level.lower()
    )
    uvicorn_server = uvicorn.Server(config=uvicorn_config)

    # Run the server
    try:
        asyncio.run(uvicorn_server.serve())
    except KeyboardInterrupt:
        logger.info('Server stopped by user (Ctrl+C)')
    except Exception as err:
        logger.error(f'Server error: {err}')
    finally:
        # Save metrics on shutdown
        asyncio.run(save_metrics_on_shutdown(config))


if __name__ == '__main__':
    main()
