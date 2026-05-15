// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

package operator

import (
	"encoding/json"
	"net/http"
)

func NewHTTPHandler(server *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writer.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/v1/otg/create", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		payload := &CreateOTGRequest{}
		if err := json.NewDecoder(request.Body).Decode(payload); err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		response, err := server.CreateOTG(request.Context(), payload)
		writeJSONResponse(writer, response, err)
	})
	mux.HandleFunc("/v1/otg/delete", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		payload := &DeleteOTGRequest{}
		if err := json.NewDecoder(request.Body).Decode(payload); err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		response, err := server.DeleteOTG(request.Context(), payload)
		writeJSONResponse(writer, response, err)
	})
	mux.HandleFunc("/v1/otg/status", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		payload := &GetOTGStatusRequest{}
		if err := json.NewDecoder(request.Body).Decode(payload); err != nil {
			http.Error(writer, err.Error(), http.StatusBadRequest)
			return
		}
		response, err := server.GetOTGStatus(request.Context(), payload)
		writeJSONResponse(writer, response, err)
	})
	return mux
}

func writeJSONResponse(writer http.ResponseWriter, response any, err error) {
	writer.Header().Set("Content-Type", "application/json")
	if err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := json.NewEncoder(writer).Encode(response); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
	}
}
