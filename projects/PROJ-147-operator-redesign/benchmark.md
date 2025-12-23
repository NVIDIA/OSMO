<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
-->

# Operator Redesign Benchmarks

## Python + WebSocket vs Go + gRPC

### Overview

This section presents comprehensive performance benchmarks comparing Python WebSocket implementation against Go gRPC implementation across different message volumes.

**Test Configuration:**
- Client sends message of type `UpdatePod`, Service receives the message and ACKs immediately
- Test scenarios: 50, 100, and 500 messages

### Benchmark Results

| #Messages | Language (Protocol) | Total Time | Avg Latency | Min Latency | Max Latency | Throughput (msg/sec) | Speed Improvement | Latency Improvement |
|-----------|---------------------|------------|-------------|-------------|-------------|---------------------|-------------------|---------------------|
| **50** | Python (WebSocket) | 172.44 ms | 1.29 ms | 811.66 µs | 1.92 ms | 289.96 | - | - |
| | Go (gRPC) | 72.82 ms | 308.60 µs | 203.72 µs | 1.08 ms | 686.67 | **2.37x** | **4.19x** |
| **100** | Python (WebSocket) | 267.45 ms | 1.48 ms | 986.87 µs | 2.42 ms | 373.90 | - | - |
| | Go (gRPC) | 56.03 ms | 292.65 µs | 201.75 µs | 1.17 ms | 1784.70 | **4.77x** | **5.06x** |
| **500** | Python (WebSocket) | 886.92 ms | 1.55 ms | 921.82 µs | 2.97 ms | 563.75 | - | - |
| | Go (gRPC) | 195.52 ms | 297.40 µs | 160.89 µs | 1.34 ms | 2557.24 | **4.54x** | **5.20x** |
