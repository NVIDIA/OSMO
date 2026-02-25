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
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/credentials"
)

const (
	osmoAuthHeader = "x-osmo-auth"
	expireWindow   = 4 * time.Second
)

// jwtExpired reports whether a JWT token's exp claim is within expireWindow of now.
func jwtExpired(token string) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		slog.Debug("JWT token has invalid format (expected 3 parts)", slog.Int("parts", len(parts)))
		return true
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		slog.Debug("JWT payload base64 decode failed", slog.String("error", err.Error()))
		return true
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return true
	}
	return time.Now().Add(expireWindow).Unix() >= claims.Exp
}

// TokenCredentials implements credentials.PerRPCCredentials for token-based auth.
// It fetches and caches an id_token from the OSMO token refresh endpoint, injecting
// x-osmo-auth into every gRPC call and refreshing when the JWT is near expiry.
type TokenCredentials struct {
	refreshURL string
	mu         sync.Mutex
	idToken    string
	httpClient *http.Client
}

// GetRequestMetadata refreshes the id_token if expired and returns the x-osmo-auth metadata.
func (tc *TokenCredentials) GetRequestMetadata(ctx context.Context, uri ...string) (map[string]string, error) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	if tc.idToken == "" || jwtExpired(tc.idToken) {
		if err := tc.fetchToken(ctx); err != nil {
			return nil, fmt.Errorf("token refresh failed: %w", err)
		}
	}
	return map[string]string{osmoAuthHeader: tc.idToken}, nil
}

// RequireTransportSecurity returns false to allow use with both HTTP and HTTPS.
func (tc *TokenCredentials) RequireTransportSecurity() bool { return false }

// fetchToken calls GET refreshURL and stores the returned id_token.
func (tc *TokenCredentials) fetchToken(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, tc.refreshURL, nil)
	if err != nil {
		return err
	}
	resp, err := tc.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("token endpoint returned %d: %s", resp.StatusCode, body)
	}
	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode token response: %w", err)
	}
	if result.Token == "" {
		return fmt.Errorf("token endpoint returned empty token")
	}
	tc.idToken = result.Token
	return nil
}

// NewCredentials returns PerRPCCredentials if args.TokenFile is set, or nil if no auth is configured.
func NewCredentials(args ListenerArgs) (credentials.PerRPCCredentials, error) {
	if args.TokenFile == "" {
		return nil, nil
	}
	tokenBytes, err := os.ReadFile(args.TokenFile)
	if err != nil {
		return nil, fmt.Errorf("read token file %q: %w", args.TokenFile, err)
	}
	token := strings.TrimSpace(string(tokenBytes))
	baseURL, err := url.Parse(args.ServiceURL)
	if err != nil {
		return nil, fmt.Errorf("invalid service URL %q: %w", args.ServiceURL, err)
	}
	refreshURLParsed := baseURL.JoinPath("/api/auth/jwt/access_token")
	refreshURLParsed.RawQuery = "access_token=" + url.QueryEscape(token)
	refreshURL := refreshURLParsed.String()
	return &TokenCredentials{
		refreshURL: refreshURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}, nil
}
