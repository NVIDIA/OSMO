// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func becomeSubreaper() error {
	const prSetChildSubreaper = 36
	_, _, errno := syscall.RawSyscall6(syscall.SYS_PRCTL, prSetChildSubreaper, 1, 0, 0, 0, 0)
	if errno != 0 {
		return errno
	}
	return nil
}

func reapGroup(group int) error {
	deadline := time.Now().Add(2 * time.Second)
	for {
		// Session leaders can escape the original process group. Once their
		// parents die, subreaper adoption makes them our direct children.
		paths, err := filepath.Glob("/proc/self/task/*/children")
		if err != nil {
			return err
		}
		for _, path := range paths {
			children, err := os.ReadFile(path)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return err
			}
			for _, child := range strings.Fields(string(children)) {
				pid, err := strconv.Atoi(child)
				if err != nil {
					return err
				}
				_ = syscall.Kill(pid, syscall.SIGKILL)
			}
		}
		var status syscall.WaitStatus
		_, err = syscall.Wait4(-1, &status, syscall.WNOHANG, nil)
		if err != nil && err != syscall.ECHILD && err != syscall.EINTR {
			return err
		}
		if err == syscall.ECHILD {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("process group %d did not terminate", group)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
