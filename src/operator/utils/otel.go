// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package utils

import (
	"context"
	"flag"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"

	sharedutils "go.corp.nvidia.com/osmo/utils"
)

// OTELConfig holds configuration for the OpenTelemetry metrics pipeline.
type OTELConfig struct {
	OTLPEndpoint     string
	ExportIntervalMS int
	ServiceName      string
	ServiceVersion   string
	Enabled          bool
}

// InitOTEL initialises the OTLP metric pipeline, sets the global MeterProvider,
// and returns pre-created instrument handles plus a shutdown function.
//
// On success the caller must invoke the returned shutdown function (typically via
// defer) to flush pending metrics before process exit.
//
// On error the caller should fall back to NewNoopInstruments() so that call sites
// never need nil checks.
func InitOTEL(ctx context.Context, config OTELConfig) (*Instruments, func(context.Context) error, error) {
	exporter, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(config.OTLPEndpoint),
		otlpmetricgrpc.WithInsecure(),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create OTLP exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(config.ServiceName),
			semconv.ServiceVersion(config.ServiceVersion),
		),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create resource: %w", err)
	}

	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(
			exporter,
			sdkmetric.WithInterval(time.Duration(config.ExportIntervalMS)*time.Millisecond),
		)),
		sdkmetric.WithResource(res),
	)

	otel.SetMeterProvider(provider)

	meter := provider.Meter(config.ServiceName)
	inst, err := NewInstruments(meter)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create instruments: %w", err)
	}

	return inst, provider.Shutdown, nil
}

// otelFlagPointers holds pointers to flag values for OTEL configuration.
type otelFlagPointers struct {
	enable     *bool
	host       *string
	port       *int
	intervalMS *int
	component  *string
	version    *string
}

// RegisterOTELFlags registers OpenTelemetry metrics command-line flags and
// returns a function that builds an OTELConfig after flag.Parse() is called.
func RegisterOTELFlags(defaultComponent string) func() OTELConfig {
	ptrs := &otelFlagPointers{
		enable: flag.Bool("metricsOtelEnable",
			sharedutils.GetEnvBool("METRICS_OTEL_ENABLE", true),
			"Enable OpenTelemetry metrics"),
		host: flag.String("metricsOtelCollectorHost",
			sharedutils.GetEnv("METRICS_OTEL_COLLECTOR_HOST", "127.0.0.1"),
			"OpenTelemetry collector host"),
		port: flag.Int("metricsOtelCollectorPort",
			sharedutils.GetEnvInt("METRICS_OTEL_COLLECTOR_PORT", 4317),
			"OpenTelemetry collector port"),
		intervalMS: flag.Int("metricsOtelCollectorIntervalInMillis",
			sharedutils.GetEnvInt("METRICS_OTEL_COLLECTOR_INTERVAL_IN_MILLIS", 6000),
			"OpenTelemetry export interval in milliseconds"),
		component: flag.String("metricsOtelCollectorComponent",
			sharedutils.GetEnv("METRICS_OTEL_COLLECTOR_COMPONENT", defaultComponent),
			"Service name for OpenTelemetry metrics"),
		version: flag.String("serviceVersion",
			sharedutils.GetEnv("SERVICE_VERSION", "unknown"),
			"Service version for OpenTelemetry metrics"),
	}

	return func() OTELConfig {
		return OTELConfig{
			OTLPEndpoint:     fmt.Sprintf("%s:%d", *ptrs.host, *ptrs.port),
			ExportIntervalMS: *ptrs.intervalMS,
			ServiceName:      *ptrs.component,
			ServiceVersion:   *ptrs.version,
			Enabled:          *ptrs.enable,
		}
	}
}
