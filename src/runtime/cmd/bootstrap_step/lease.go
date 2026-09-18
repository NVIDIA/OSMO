// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// releaseLeases runs only after the supervised process tree has been reaped.
// This lets Helm prune a failed Job without losing the evidence that its writer
// stopped. A SIGKILL of the supervisor remains a fail-closed manual-recovery case.
func releaseLeases() error {
	names := os.Getenv("OSMO_BOOTSTRAP_LEASES")
	if names == "" {
		return nil
	}
	uid := os.Getenv("OSMO_POD_UID")
	namespace := os.Getenv("OSMO_POD_NAMESPACE")
	if uid == "" || namespace == "" {
		return fmt.Errorf("lease cleanup requires Pod identity")
	}
	const directory = "/var/run/secrets/kubernetes.io/serviceaccount/"
	token, err := os.ReadFile(directory + "token")
	if err != nil {
		return err
	}
	certificate, err := os.ReadFile(directory + "ca.crt")
	if err != nil {
		return err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(certificate) {
		return fmt.Errorf("invalid Kubernetes CA bundle")
	}
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	host := net.JoinHostPort(os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT_HTTPS"))
	for _, name := range strings.Split(names, ",") {
		endpoint := "https://" + host + "/apis/coordination.k8s.io/v1/namespaces/" +
			url.PathEscape(namespace) + "/leases/" + url.PathEscape(name)
		if err := releaseLease(client, endpoint, string(token), uid); err != nil {
			return err
		}
	}
	return nil
}

func releaseLease(client *http.Client, endpoint, token, uid string) error {
	request, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("lease cleanup request failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("lease cleanup GET status=%d", response.StatusCode)
	}
	var lease struct {
		Metadata struct {
			ResourceVersion string `json:"resourceVersion"`
		} `json:"metadata"`
		Spec struct {
			HolderIdentity string `json:"holderIdentity"`
		} `json:"spec"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&lease); err != nil {
		return err
	}
	holder := lease.Spec.HolderIdentity
	if !strings.HasSuffix(holder, "/"+uid) && !strings.HasSuffix(holder, ":"+uid) {
		return nil
	}
	body, err := json.Marshal(map[string]any{
		"metadata": map[string]string{"resourceVersion": lease.Metadata.ResourceVersion},
		"spec":     map[string]any{"holderIdentity": nil},
	})
	if err != nil {
		return err
	}
	request, err = http.NewRequest(http.MethodPatch, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/merge-patch+json")
	patched, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("lease cleanup PATCH failed")
	}
	defer patched.Body.Close()
	if patched.StatusCode != http.StatusOK {
		return fmt.Errorf("lease cleanup PATCH status=%d", patched.StatusCode)
	}
	return nil
}
