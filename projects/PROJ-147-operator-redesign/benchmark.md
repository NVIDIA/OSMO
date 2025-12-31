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
- Client sends random message of type `UpdatePod`, Service receives the message and ACKs immediately
- Test scenarios: 50, 100, and 500 messages

**Benchmark Results**

| #Messages | Language (Protocol) | Total Time | Avg Latency | Min Latency | Max Latency | Throughput (msg/sec) | Speed Improvement | Latency Improvement |
|-----------|---------------------|------------|-------------|-------------|-------------|---------------------|-------------------|---------------------|
| **50** | Python (WebSocket) | 172.44 ms | 1.29 ms | 811.66 µs | 1.92 ms | 289.96 | - | - |
| | Go (gRPC) | 72.82 ms | 308.60 µs | 203.72 µs | 1.08 ms | 686.67 | **2.37x** | **4.19x** |
| **100** | Python (WebSocket) | 267.45 ms | 1.48 ms | 986.87 µs | 2.42 ms | 373.90 | - | - |
| | Go (gRPC) | 56.03 ms | 292.65 µs | 201.75 µs | 1.17 ms | 1784.70 | **4.77x** | **5.06x** |
| **500** | Python (WebSocket) | 886.92 ms | 1.55 ms | 921.82 µs | 2.97 ms | 563.75 | - | - |
| | Go (gRPC) | 195.52 ms | 297.40 µs | 160.89 µs | 1.34 ms | 2557.24 | **4.54x** | **5.20x** |

## k8s Library - Python vs Go

### Overview

This section presents comprehensive performance benchmarks comparing Python and Go k8s libraries with cache implementation.

### Startup Perfomance

**Test Configuration:**
- 85 Pods exist in **osmo-prod** namespace in Isaac cluster with no status changes
- Service receives the message and ACKs immediately

**Benchmark Results**

```
================================================================================
METRIC 1: INTER-MESSAGE LATENCY
(Time gap between receiving consecutive pod update messages)
--------------------------------------------------------------------------------

Metric              | Python        | Go
--------------------|---------------|---------------
Average gap         | 13.38ms       | 0.09ms
Median gap          | 10.47ms       | 0.09ms
Min gap             | 2.31ms        | 0.05ms
Max gap             | 82.28ms       | 0.13ms
Std deviation       | 9.62ms        | 0.02ms
Total time          | 1124.19ms     | 7.77ms

Comparison:
  Python gaps are 144.7x larger than Go gaps
  Go is 144.7x faster at processing message streams

================================================================================
METRIC 2: CROSS-IMPLEMENTATION DETECTION LATENCY
--------------------------------------------------------------------------------

2A. INITIAL POD DISCOVERY
    (Who detected existing pods first when starting up)

  Detection Statistics:
    Total pods:            85
    Go detected first:     85 times (100.0%)
    Python detected first: 0 times (0.0%)

  Time Difference Statistics:
    Average:         2099.05ms (Go faster)
    Median:          2103.15ms
    Min:             1534.20ms (smallest Go advantage)
    Max:             2650.62ms (largest Go advantage)
    Std deviation:    341.30ms

  Distribution of Go's advantage:
        0-1.5s:   0 pods (  0.0%)
      1.5-2.0s:  35 pods ( 41.2%)
      2.0-2.5s:  36 pods ( 42.4%)
      2.5-3.0s:  14 pods ( 16.5%)
         3.0s+:   0 pods (  0.0%)
```

### Status Update Perfomance

**Test Configuration:**
- 49 workflows with 55 pods submitted to the given namespace and run until finished
- Service receives the message and ACKs immediately

**Benchmark Results**

```
================================================================================
METRIC 2: CROSS-IMPLEMENTATION DETECTION LATENCY
--------------------------------------------------------------------------------

2B. STATUS TRANSITION DETECTION
    (Who detected actual status changes first, e.g., Pending → Running)

  ✓ Status transitions detected!
    Python pods with transitions: 55
    Go pods with transitions:     55
    Matched transitions analyzed: 55

  Detection Statistics:
    Go detected first:     55 times
    Python detected first: 0 times

  Time Difference Statistics:
    Average:           29.42ms
    Median:            24.48ms
    Min:                4.76ms
    Max:               99.13ms
    Std deviation:     17.57ms
```

### Large Scale Cluster

**Test Configuration:**
- Cluster with 1000+ nodes
- Service receives the message and ACKs immediately

**Benchmark Results**

```
================================================================================
UNIQUE POD EVENT DETECTION ANALYSIS
================================================================================

Benchmark Duration:  Python: 64.4s  |  Go: 62.6s

EVENT COVERAGE:
  Total unique events:     951
  Python detected:         951 events (drop rate: 0.0%)
  Go detected:             951 events (drop rate: 0.0%)
  Common to both:          951 events

DETECTION SPEED (for 951 common events):
  Go detected first:       951 events (100.0%)
  Python detected first:     0 events (0.0%)
  Average difference:     8529.75ms (Go faster)
  Median difference:      8443.32ms

  Latency distribution:
           Go 100ms-1s faster:   22 (  2.3%)
                Go 1s+ faster:  929 ( 97.7%)
```

Go implementation has smaller round-trip latency, but has more bursts in sending out messages, requiring larger un-ack message limit.
```
================================================================================
ROUNDTRIP LATENCY COMPARISON: Python vs Go
================================================================================

Sample Size: 951 messages each

                        Python          Go          Difference
                        ------          --          ----------
Mean Latency           16.356 ms      7.224 ms     -9.132 ms (-55.8%)
Median Latency         15.190 ms      7.157 ms     -8.033 ms (-52.9%)
Standard Deviation      8.765 ms      1.985 ms     -6.780 ms (-77.4%)

Min Latency             1.520 ms      0.932 ms     -0.588 ms (-38.7%)
Max Latency            89.670 ms     10.454 ms    -79.216 ms (-88.3%)

================================================================================
PEAK BURST ANALYSIS: Python vs Go Listeners
================================================================================

Sample Size: 951 messages each

Metric                          Python          Go              Go Advantage
------                          ------          --              ------------
Total Duration                  16.23 sec       <1 sec          >16x faster
Average Rate                    58.6 msg/sec    >951 msg/sec    >16x faster

Peak 100ms Burst                90.0 msg/sec    9,510 msg/sec   105.7x faster
Peak 1-Second Burst             77.0 msg/sec    951.0 msg/sec   12.4x faster

================================================================================
CONCURRENCY ANALYSIS
================================================================================

Assuming 20ms roundtrip latency:

Python: 3 messages in-flight concurrently
  - Sequential processing with minimal overlap
  - Limited parallelism

Go: 951 messages in-flight concurrently
  - Full parallel processing
  - Non-blocking message transmission

This represents a 317x difference in concurrency capability!
```
