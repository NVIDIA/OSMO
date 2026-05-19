// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package apiserver

import (
	"errors"
	"net/http"
	"strings"
)

// ErrUnauthorized is the sentinel returned by Authenticator implementations when the
// request can't be authenticated.
var ErrUnauthorized = errors.New("unauthorized")

// StaticTokenAuth is a placeholder Authenticator for development and CI: it accepts any
// Bearer token whose value is a non-empty subject. NOT for production. Replace with a
// real IDP integration (validate JWT signature, check expiry, extract claims).
type StaticTokenAuth struct{}

func (StaticTokenAuth) Authenticate(r *http.Request) (User, error) {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return User{}, ErrUnauthorized
	}
	subject := strings.TrimSpace(strings.TrimPrefix(h, prefix))
	if subject == "" {
		return User{}, ErrUnauthorized
	}
	return User{Subject: subject}, nil
}
