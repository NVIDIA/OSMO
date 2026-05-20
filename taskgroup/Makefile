# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

SHELL := /bin/bash
BIN := $(CURDIR)/.bin
PROTOC_GEN_GO_VERSION := v1.33.0
PROTOC_GEN_GO_GRPC_VERSION := v1.3.0

.PHONY: build test vet proto tools clean
.DEFAULT_GOAL := build

build:
	go build ./...

test:
	go test ./...

vet:
	go vet ./...

# Regenerate Go bindings from operator/proto/operator.proto.
# Requires protoc on PATH (brew install protobuf).
# The protoc-gen-go and protoc-gen-go-grpc plugins are installed locally to .bin/
# so they don't pollute the user's GOBIN.
proto: tools
	PATH=$(BIN):$$PATH protoc \
		--go_out=operator/proto --go_opt=paths=source_relative \
		--go-grpc_out=operator/proto --go-grpc_opt=paths=source_relative \
		-I operator/proto \
		operator.proto

tools:
	@command -v protoc >/dev/null 2>&1 || { echo "protoc not found; brew install protobuf"; exit 1; }
	GOBIN=$(BIN) go install google.golang.org/protobuf/cmd/protoc-gen-go@$(PROTOC_GEN_GO_VERSION)
	GOBIN=$(BIN) go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@$(PROTOC_GEN_GO_GRPC_VERSION)

clean:
	rm -rf $(BIN)
