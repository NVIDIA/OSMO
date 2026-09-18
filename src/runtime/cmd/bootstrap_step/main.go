// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// bootstrap-step bounds a command and all of its descendants, independently of
// the command's interpreter. It is copied into an emptyDir for the AWS CLI step.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

type unsafeCleanupError struct{ cause error }

func (err *unsafeCleanupError) Error() string { return err.cause.Error() }

func install(destination string) error {
	source, err := os.Executable()
	if err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	return errors.Join(copyErr, output.Close())
}

func runAttempt(ctx context.Context, timeout time.Duration, arguments []string) error {
	command := exec.Command(arguments[0], arguments[1:]...)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	var result error
	select {
	case result = <-done:
	case <-timer.C:
		result = fmt.Errorf("step exceeded %s", timeout)
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		<-done
	case <-ctx.Done():
		result = ctx.Err()
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		<-done
	}
	// Also clean up descendants left behind by a command that exited successfully.
	_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	if err := reapGroup(command.Process.Pid); err != nil {
		return &unsafeCleanupError{cause: errors.Join(result, err)}
	}
	return result
}

func run(ctx context.Context, timeout time.Duration, retries int, arguments []string) error {
	if timeout <= 0 || retries < 0 || len(arguments) == 0 {
		return errors.New("positive --timeout, nonnegative --retries and command are required")
	}
	if err := becomeSubreaper(); err != nil {
		return err
	}
	commands := [][]string{}
	before, after := []string{}, []string{}
	for name, destination := range map[string]*[]string{
		"OSMO_BOOTSTRAP_BEFORE": &before, "OSMO_BOOTSTRAP_AFTER": &after,
	} {
		if value := os.Getenv(name); value != "" {
			if err := json.Unmarshal([]byte(value), destination); err != nil {
				return fmt.Errorf("invalid %s command", name)
			}
		}
	}
	if len(before) > 0 {
		commands = append(commands, before)
	}
	commands = append(commands, arguments)
	if len(after) > 0 {
		commands = append(commands, after)
	}
	var result error
	for attempt := 0; attempt <= retries; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "bootstrap step attempt=%d/%d\n", attempt+1, retries+1)
		deadline := time.Now().Add(timeout)
		for _, command := range commands {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				result = fmt.Errorf("step exceeded %s", timeout)
				break
			}
			result = runAttempt(ctx, remaining, command)
			if result != nil {
				break
			}
		}
		if result == nil {
			return nil
		}
		var unsafe *unsafeCleanupError
		if errors.As(result, &unsafe) {
			return result
		}
		fmt.Fprintf(os.Stderr, "bootstrap step failed: %v\n", result)
	}
	return result
}

func main() {
	destination := flag.String("install", "", "copy this static binary to the shared tools volume")
	timeout := flag.Duration("timeout", 0, "hard deadline per attempt, e.g. 300s")
	retries := flag.Int("retries", 0, "number of additional attempts")
	flag.Parse()
	var err error
	if *destination != "" {
		err = install(*destination)
	} else {
		ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
		defer cancel()
		err = run(ctx, *timeout, *retries, flag.Args())
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		var unsafe *unsafeCleanupError
		if *destination == "" && !errors.As(err, &unsafe) {
			if cleanupErr := releaseLeases(); cleanupErr != nil {
				fmt.Fprintf(os.Stderr, "lease cleanup failed: %v\n", cleanupErr)
			}
		}
		os.Exit(1)
	}
}
