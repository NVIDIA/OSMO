/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package roles

import (
	"context"
	"fmt"

	"go.corp.nvidia.com/osmo/utils/postgres"
)

var poolResourcePrefix = string(ResourceTypePool) + "/"

// GetAllPoolNames retrieves all pool names from the database.
func GetAllPoolNames(ctx context.Context, client *postgres.PostgresClient) ([]string, error) {
	query := `SELECT name FROM pools ORDER BY name`

	rows, err := client.Pool().Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query pool names: %w", err)
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("failed to scan pool name: %w", err)
		}
		names = append(names, name)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating pool names: %w", err)
	}

	return names, nil
}

// GetAllowedPools evaluates role policies to determine which pools the user
// can access based on the ActionWorkflowCreate action scoped to pool resources.
//
// Roles are independent: a Deny in one role does NOT override an Allow from
// another role. Within a single role, Deny takes precedence over Allow.
// A pool is accessible if at least one role grants ActionWorkflowCreate on it.
func GetAllowedPools(userRoles []*Role, allPoolNames []string) []string {
	var allowed []string
	for _, poolName := range allPoolNames {
		poolResource := poolResourcePrefix + poolName
		for _, role := range userRoles {
			if CheckActionOnResource(role, ActionWorkflowCreate, poolResource).Allowed {
				allowed = append(allowed, poolName)
				break
			}
		}
	}
	return allowed
}
