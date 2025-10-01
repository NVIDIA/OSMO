/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

package data

import (
	"fmt"
	"net/url"
	"strings"

	"go.corp.nvidia.com/osmo/pkg/osmo_errors"
)

type StorageBackendType string

const (
	SWIFT string = "swift"
	S3    string = "s3"
	GS    string = "gs"
	TOS   string = "tos"
)

type StorageBackend interface {
	GetScheme() string
	GetURI() string
	GetBucket() string
	GetPath() string
	GetAuthEndpoint() string
	GetProfile() string
	GetMountBase() string
}

type SwiftBackend struct {
	Scheme    string
	URI       string
	Netloc    string
	Namespace string
	Bucket    string
	Path      string
}

func (f SwiftBackend) GetScheme() string       { return f.Scheme }
func (f SwiftBackend) GetURI() string          { return f.URI }
func (f SwiftBackend) GetBucket() string       { return f.Bucket }
func (f SwiftBackend) GetPath() string         { return f.Path }
func (f SwiftBackend) GetAuthEndpoint() string { return fmt.Sprintf("https://%s", f.Netloc) }
func (f SwiftBackend) GetProfile() string {
	return fmt.Sprintf("%s://%s/%s", f.Scheme, f.Netloc, f.Namespace)
}
func (f SwiftBackend) GetMountBase() string {
	return fmt.Sprintf("%s://%s/%s/%s", f.Scheme, f.Netloc, f.Namespace, f.Bucket)
}

type S3Backend struct {
	Scheme string
	URI    string
	Bucket string
	Path   string
}

func (f S3Backend) GetScheme() string       { return f.Scheme }
func (f S3Backend) GetURI() string          { return f.URI }
func (f S3Backend) GetBucket() string       { return f.Bucket }
func (f S3Backend) GetPath() string         { return f.Path }
func (f S3Backend) GetAuthEndpoint() string { return "" }
func (f S3Backend) GetProfile() string {
	return fmt.Sprintf("%s://%s", f.Scheme, f.Bucket)
}
func (f S3Backend) GetMountBase() string {
	return fmt.Sprintf("%s://%s", f.Scheme, f.Bucket)
}

type GSBackend struct {
	Scheme string
	URI    string
	Netloc string
	Bucket string
	Path   string
}

func (f GSBackend) GetScheme() string       { return f.Scheme }
func (f GSBackend) GetURI() string          { return f.URI }
func (f GSBackend) GetBucket() string       { return f.Bucket }
func (f GSBackend) GetPath() string         { return f.Path }
func (f GSBackend) GetAuthEndpoint() string { return fmt.Sprintf("https://%s", f.Netloc) }
func (f GSBackend) GetProfile() string {
	return fmt.Sprintf("%s://%s", f.Scheme, f.Bucket)
}
func (f GSBackend) GetMountBase() string {
	return fmt.Sprintf("%s://%s", f.Scheme, f.Bucket)
}

type TOSBackend struct {
	Scheme string
	URI    string
	Netloc string
	Bucket string
	Path   string
}

func (f TOSBackend) GetScheme() string       { return f.Scheme }
func (f TOSBackend) GetURI() string          { return f.URI }
func (f TOSBackend) GetBucket() string       { return f.Bucket }
func (f TOSBackend) GetPath() string         { return f.Path }
func (f TOSBackend) GetAuthEndpoint() string { return fmt.Sprintf("https://%s", f.Netloc) }
func (f TOSBackend) GetProfile() string {
	return fmt.Sprintf("%s://%s/%s", f.Scheme, f.Netloc, f.Bucket)
}
func (f TOSBackend) GetMountBase() string {
	return fmt.Sprintf("%s://%s/%s", f.Scheme, f.Netloc, f.Bucket)
}

func ParseStorageBackend(urlPath string) StorageBackend {
	urlInfo, err := url.Parse(urlPath)
	if err != nil {
		osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
		panic(err)
	}

	if urlInfo.Scheme == SWIFT {
		// swift://host/AUTH_/bucket/path
		splitPath := strings.SplitN(urlInfo.Path, "/", 4)[1:]
		var path string
		if len(splitPath) > 2 {
			path = splitPath[2]
		}
		return SwiftBackend{
			Scheme:    SWIFT,
			URI:       urlPath,
			Netloc:    urlInfo.Hostname(),
			Namespace: splitPath[0],
			Bucket:    splitPath[1],
			Path:      path}
	} else if urlInfo.Scheme == S3 {
		// s3://bucket/path
		return S3Backend{
			Scheme: S3,
			URI:    urlPath,
			Bucket: urlInfo.Hostname(),
			Path:   strings.TrimPrefix(urlInfo.Path, "/")}
	} else if urlInfo.Scheme == GS {
		// gs://bucket/path
		return GSBackend{
			Scheme: GS,
			URI:    urlPath,
			Netloc: "storage.googleapis.com",
			Bucket: urlInfo.Hostname(),
			Path:   strings.TrimPrefix(urlInfo.Path, "/")}
	} else if urlInfo.Scheme == TOS {
		// tos://netloc/bucket/path
		splitPath := strings.SplitN(urlInfo.Path, "/", 3)[1:]
		var path string
		if len(splitPath) > 1 {
			path = splitPath[1]
		}
		return TOSBackend{
			Scheme: TOS,
			URI:    urlPath,
			Netloc: urlInfo.Hostname(),
			Bucket: splitPath[0],
			Path:   path}
	}

	osmo_errors.SetExitCode(osmo_errors.INVALID_INPUT_CODE)
	panic(fmt.Sprintf("Unknown scheme: %s", urlInfo.Scheme))
}
