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

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"strings"

	"github.com/conduitio/bwlimit"
	"github.com/gokrazy/rsync/rsyncd"
	"go.corp.nvidia.com/osmo/runtime/pkg/common"
)

// Parses the path allow list and returns a list of modules.
func getModulesList(pathAllowListFlag string, runLocation string) ([]rsyncd.Module, error) {
	modulesMap := make(map[string]rsyncd.Module)

	// Create a default workspace module that is always writable.
	workspacePath := fmt.Sprintf("%s/workspace", runLocation)
	if _, err := os.Stat(workspacePath); os.IsNotExist(err) {
		if err := os.MkdirAll(workspacePath, 0755); err != nil {
			return nil, fmt.Errorf("failed to create workspace directory: %v", err)
		}
	}
	modulesMap["osmo"] = rsyncd.Module{
		Name:     "osmo",
		Path:     workspacePath,
		Writable: true,
	}

	// Add more modules from the path allow list.
	pathAllowList := strings.Split(pathAllowListFlag, ",")
	for _, pathAllow := range pathAllowList {
		parts := strings.Split(pathAllow, ":")
		if len(parts) != 3 {
			log.Printf("Invalid path allow list entry: %s", pathAllow)
			continue
		}
		if parts[0] == "" {
			log.Printf("Empty name in path allow list entry: %s", pathAllow)
			continue
		}
		if _, ok := modulesMap[parts[0]]; ok {
			log.Printf("Path allow list entry name already exists: %s", parts[0])
			continue
		}
		if parts[1] == "" {
			log.Printf("Empty path in path allow list entry: %s", pathAllow)
			continue
		}
		if _, err := os.Stat(parts[1]); os.IsNotExist(err) {
			log.Printf("Path allow list entry path does not exist: %s", pathAllow)
			continue
		}
		if parts[2] != "" && parts[2] != "true" && parts[2] != "false" {
			log.Printf("Invalid writable value in path allow list entry: %s", pathAllow)
			continue
		}

		modulesMap[parts[0]] = rsyncd.Module{
			Name:     parts[0],
			Path:     parts[1],
			Writable: parts[2] == "true",
		}
	}

	modules := make([]rsyncd.Module, 0, len(modulesMap))
	for _, module := range modulesMap {
		modules = append(modules, module)
	}

	return modules, nil
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	port := flag.Int("port", int(common.RsyncPort), "Rsync port.")
	runLocation := flag.String("runLocation", "/osmo/run", "Run Location.")
	readLimit := flag.Int("readLimit", 0, "Read limit in bytes per second.")
	writeLimit := flag.Int("writeLimit", 0, "Write limit in bytes per second.")
	pathAllowListFlag := flag.String(
		"pathAllowList", "",
		"Comma-separated list of name:path:writable tuples (e.g., name:path:false,name2:path2:true)",
	)
	flag.Parse()

	log.Printf("Starting rsync server on port %d with run location %s", *port, *runLocation)

	if _, err := os.Stat(*runLocation); os.IsNotExist(err) {
		log.Fatalf("Run location %s does not exist", *runLocation)
	}

	modules, err := getModulesList(*pathAllowListFlag, *runLocation)
	if err != nil {
		log.Fatalf("Failed to get modules list: %v", err)
	}

	// Creates an rsync server in daemon mode.
	server, err := rsyncd.NewServer(modules)
	if err != nil {
		log.Fatalf("Failed to create rsync server: %v", err)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", *port))
	if err != nil {
		log.Fatalf("Failed to create listener: %v", err)
	}

	// Limit the listener bandwidth
	limitedListener := bwlimit.NewListener(
		listener,
		bwlimit.Byte(*writeLimit),
		bwlimit.Byte(*readLimit),
	)

	log.Printf("Serving rsync server")

	// Blocks until the context is cancelled or the listener is closed
	if err := server.Serve(ctx, limitedListener); err != nil {
		log.Fatalf("Failed to serve rsync server: %v", err)
	}

	log.Printf("Rsync server stopped")
}
