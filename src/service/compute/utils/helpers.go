/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
*/

package utils

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	pb "go.corp.nvidia.com/osmo/proto/compute_connector"
)

// ParseHost extracts host and port from a URL string or host:port format
func ParseHost(hostStr string) (string, int, error) {
	if parsedURL, err := url.Parse(hostStr); err == nil && parsedURL.Scheme != "" {
		host := parsedURL.Hostname()
		if host == "" {
			host = "0.0.0.0"
		}

		if parsedURL.Port() == "" {
			return "", 0, fmt.Errorf("port is required in URL: %s", hostStr)
		}

		var port int
		_, err := fmt.Sscanf(parsedURL.Port(), "%d", &port)
		if err != nil {
			return "", 0, fmt.Errorf("invalid port in URL: %s", parsedURL.Port())
		}
		return host, port, nil
	}

	return "", 0, fmt.Errorf(
		"invalid host format, expected URL format (e.g., http://0.0.0.0:8000): %s", hostStr)
}

// ExtractBackendName extracts and validates the backend-name from gRPC metadata.
// Returns an error if the metadata is missing or empty.
func ExtractBackendName(ctx context.Context) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", errors.New("missing gRPC metadata")
	}

	names := md.Get("backend-name")
	if len(names) == 0 {
		return "", errors.New("backend-name metadata is required but not provided")
	}

	backendName := names[0]
	if backendName == "" {
		return "", errors.New("backend-name metadata cannot be empty")
	}

	return backendName, nil
}

// IsExpectedClose checks if an error is an expected stream closure.
func IsExpectedClose(err error) bool {
	if err == nil {
		return false
	}
	if err == io.EOF || err == context.Canceled {
		return true
	}
	return status.Code(err) == codes.Canceled
}

// CreateOrUpdateBackend inserts or updates a backend in the database
// This function implements the same logic as the Python create_backend function
// Returns isCreate (true if new backend was created),
// isUpdate (true if backend was updated), and error
func CreateOrUpdateBackend(
	ctx context.Context,
	pool *pgxpool.Pool,
	initBody *pb.InitBody,
	serviceHostname string,
) (bool, bool, error) {
	now := time.Now()
	isCreate := false
	isUpdate := false

	// Initialize router_address with hostname from config if available
	routerAddress := ""
	if serviceHostname != "" {
		parsedURL, err := url.Parse(serviceHostname)
		if err == nil && parsedURL.Hostname() != "" {
			routerAddress = fmt.Sprintf("wss://%s", parsedURL.Hostname())
		} else {
			routerAddress = fmt.Sprintf("wss://%s", serviceHostname)
		}
		slog.InfoContext(ctx, "initializing router_address for backend",
			slog.String("backend_name", initBody.Name),
			slog.String("router_address", routerAddress))
	}

	// Default scheduler settings as JSON (empty object)
	schedulerSettings, err := json.Marshal(struct{}{})
	if err != nil {
		return isCreate, isUpdate, fmt.Errorf("failed to marshal scheduler settings: %w", err)
	}

	// Insert or update backend using the same pattern as Python code
	insertCmd := `
		WITH input_rows(name, k8s_uid, k8s_namespace, dashboard_url, grafana_url,
			scheduler_settings,
			last_heartbeat, created_date,
			description, router_address,
			version) AS (
			VALUES
				($1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
				 $7::timestamp,
				 $8::timestamp, $9::text,
				 $10::text, $11::text)
			)
		, new_row AS (
			INSERT INTO backends (name, k8s_uid, k8s_namespace,
				dashboard_url, grafana_url,
				scheduler_settings,
				last_heartbeat, created_date, description, router_address,
				version)
			SELECT * FROM input_rows
			ON CONFLICT (name) DO NOTHING
			RETURNING name, k8s_uid, true as is_new
			)
		SELECT k8s_uid, COALESCE(is_new, false) as is_new FROM new_row
		UNION ALL
		SELECT b.k8s_uid, false as is_new FROM input_rows
		JOIN backends b USING (name)
		WHERE NOT EXISTS (SELECT 1 FROM new_row);
	`

	var k8sUIDResult string
	err = pool.QueryRow(
		ctx,
		insertCmd,
		initBody.Name,
		initBody.K8SUid,
		initBody.K8SNamespace,
		"",                        // dashboard_url
		"",                        // grafana_url
		string(schedulerSettings), // scheduler_settings
		now,                       // last_heartbeat
		now,                       // created_date
		"",                        // description
		routerAddress,             // router_address
		initBody.Version,          // version
	).Scan(&k8sUIDResult, &isCreate)

	if err != nil {
		return isCreate, isUpdate, fmt.Errorf("failed to insert/update backend: %w", err)
	}

	// Verify the k8s_uid matches to prevent conflicts
	if k8sUIDResult != initBody.K8SUid {
		return isCreate, isUpdate, fmt.Errorf(
			"backend %s is already being used by a different cluster (uid: %s)",
			initBody.Name, k8sUIDResult)
	}

	// Always update k8s_namespace, version, and node_conditions
	// This matches the Python implementation which always runs the UPDATE
	updateCmd := `
		WITH old_values AS (
			SELECT k8s_namespace as old_k8s_namespace,
				   version as old_version,
				   COALESCE(node_conditions->>'prefix', '') as old_prefix
			FROM backends WHERE name = $1
		)
		UPDATE backends SET
			k8s_namespace = $2,
			version = $3,
			node_conditions = jsonb_set(
				COALESCE(node_conditions, '{"rules": {"Ready": "True"}}'::jsonb),
				'{prefix}',
				to_jsonb($4::text)
			)
		WHERE name = $1
		RETURNING
			(
				(SELECT old_k8s_namespace FROM old_values) IS DISTINCT FROM $2 OR
				(SELECT old_version FROM old_values) IS DISTINCT FROM $3 OR
				(SELECT old_prefix FROM old_values) IS DISTINCT FROM $4
			) as did_update;
	`

	err = pool.QueryRow(
		ctx,
		updateCmd,
		initBody.Name,
		initBody.K8SNamespace,
		initBody.Version,
		initBody.NodeConditionPrefix,
	).Scan(&isUpdate)

	if err != nil {
		return isCreate, isUpdate, fmt.Errorf("failed to update backend: %w", err)
	}

	return isCreate, isUpdate, nil
}
