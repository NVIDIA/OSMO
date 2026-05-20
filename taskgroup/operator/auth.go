// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// SecretKeyTokenHash is the data key in the OSMOCluster.spec.tokenSecretRef Secret
// that holds the hex-encoded SHA-256 of the cluster's bearer token.
const SecretKeyTokenHash = "tokenHash"

// ErrUnauthorized is returned when a Hello presents an unknown cluster or wrong token.
// We deliberately return the same error for both to avoid revealing which clusters are
// registered to unauthenticated callers.
var ErrUnauthorized = errors.New("unauthorized")

// Authenticator validates a Hello.token against the SHA-256 stored in the OSMOCluster's
// referenced Secret. Implementations are stateless apart from the K8s client they hold.
type Authenticator interface {
	// Authenticate is called on every Hello message. Returns nil only if the token
	// hashes to the value stored in the cluster's registered Secret.
	Authenticate(ctx context.Context, clusterID, token string) error
}

// ClusterAuthenticator is the production Authenticator. It looks up the OSMOCluster CR
// by name, fetches its tokenSecretRef Secret, and constant-time-compares hashes.
type ClusterAuthenticator struct {
	Client client.Client
}

// Authenticate implements Authenticator.
//
// Security notes:
//   - Returns ErrUnauthorized for both "cluster not registered" and "wrong token" so an
//     attacker can't enumerate cluster IDs.
//   - Uses subtle.ConstantTimeCompare for the hash comparison.
//   - The plaintext token never appears in any returned error or log line.
func (a *ClusterAuthenticator) Authenticate(ctx context.Context, clusterID, token string) error {
	if clusterID == "" || token == "" {
		return ErrUnauthorized
	}

	var cluster v1alpha1.OSMOCluster
	if err := a.Client.Get(ctx, types.NamespacedName{Name: clusterID}, &cluster); err != nil {
		if apierrors.IsNotFound(err) {
			return ErrUnauthorized
		}
		return fmt.Errorf("reading OSMOCluster %q: %w", clusterID, err)
	}

	ref := cluster.Spec.TokenSecretRef
	if ref == nil || ref.Name == "" {
		return ErrUnauthorized
	}

	var secret corev1.Secret
	if err := a.Client.Get(ctx, types.NamespacedName{Name: ref.Name, Namespace: ref.Namespace}, &secret); err != nil {
		if apierrors.IsNotFound(err) {
			return ErrUnauthorized
		}
		return fmt.Errorf("reading token Secret %q: %w", ref.Name, err)
	}

	expectedHashHex, ok := secret.Data[SecretKeyTokenHash]
	if !ok || len(expectedHashHex) == 0 {
		return ErrUnauthorized
	}

	presented := sha256.Sum256([]byte(token))
	presentedHex := hex.EncodeToString(presented[:])

	if subtle.ConstantTimeCompare([]byte(presentedHex), expectedHashHex) != 1 {
		return ErrUnauthorized
	}
	return nil
}
