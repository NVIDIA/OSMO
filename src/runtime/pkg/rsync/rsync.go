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

package rsync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"go.corp.nvidia.com/osmo/runtime/pkg/common"
	"go.corp.nvidia.com/osmo/runtime/pkg/messages"
)

type RsyncStatus struct {
	mutex   sync.Mutex
	running bool
}

func (r *RsyncStatus) IsRunning() bool {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	return r.running
}

func (r *RsyncStatus) SetRunning(running bool) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	r.running = running
}

func RunRsync(
	ctx context.Context,
	userBinPath string,
	runLocation string,
	rsyncReadLimit int,
	rsyncWriteLimit int,
	rsyncPathAllowList string,
	unixConn net.Conn,
) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	rsyncCmd := exec.CommandContext(
		ctx,
		fmt.Sprintf("%s/rsync", userBinPath),
		"-port", fmt.Sprintf("%d", common.RsyncPort),
		"-runLocation", runLocation,
		"-readLimit", fmt.Sprintf("%d", rsyncReadLimit),
		"-writeLimit", fmt.Sprintf("%d", rsyncWriteLimit),
		"-pathAllowList", rsyncPathAllowList,
	)
	rsyncCmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	rsyncCmd.Stdout = os.Stdout
	rsyncCmd.Stderr = os.Stderr

	if err := rsyncCmd.Start(); err != nil {
		log.Printf("Failed to start rsync: %v", err)
		return err
	}

	go monitorRsync(ctx, rsyncCmd, unixConn)

	if err := rsyncCmd.Wait(); err != nil {
		log.Printf("Rsync command exited with error: %v", err)
		return err
	}

	return nil
}

func monitorRsync(ctx context.Context, rsyncCmd *exec.Cmd, unixConn net.Conn) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Context was cancelled, send status update and exit
			if err := json.NewEncoder(unixConn).Encode(
				messages.UserRsyncStatusRequest(false),
			); err != nil {
				log.Printf("Failed to send request: %v\n", err)
			}
			return
		case <-ticker.C:
			if rsyncCmd.Process == nil {
				if err := json.NewEncoder(unixConn).Encode(
					messages.UserRsyncStatusRequest(false),
				); err != nil {
					log.Printf("Failed to send request: %v\n", err)
				}
				continue
			}

			if err := rsyncCmd.Process.Signal(syscall.Signal(0)); err != nil {
				if err := json.NewEncoder(unixConn).Encode(
					messages.UserRsyncStatusRequest(false),
				); err != nil {
					log.Printf("Failed to send request: %v\n", err)
				}
				continue
			}

			if err := json.NewEncoder(unixConn).Encode(
				messages.UserRsyncStatusRequest(true),
			); err != nil {
				log.Printf("Failed to send request: %v\n", err)
			}
		}
	}
}
