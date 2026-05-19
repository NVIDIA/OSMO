// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package apiserver

import (
	"encoding/json"
	"errors"
	"net/http"
)

// API server errors carry an HTTP status code in addition to the underlying cause. The
// pattern keeps handlers simple: return the error, let translateError figure out the
// status code and JSON envelope.

type apiError struct {
	status int
	err    error
}

func (e *apiError) Error() string { return e.err.Error() }
func (e *apiError) Unwrap() error { return e.err }

func badRequest(err error) error    { return &apiError{status: http.StatusBadRequest, err: err} }
func notFound(err error) error      { return &apiError{status: http.StatusNotFound, err: err} }
func forbidden(err error) error     { return &apiError{status: http.StatusForbidden, err: err} }
func notImplemented(err error) error { return &apiError{status: http.StatusNotImplemented, err: err} }

func translateError(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeError(w, ae.status, ae.err)
		return
	}
	writeError(w, http.StatusInternalServerError, err)
}

func writeError(w http.ResponseWriter, code int, err error) {
	_ = writeJSON(w, code, map[string]string{"error": err.Error()})
}

func writeJSON(w http.ResponseWriter, code int, body any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	return json.NewEncoder(w).Encode(body)
}
