// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	utilruntime "k8s.io/apimachinery/pkg/util/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

func testScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	s := runtime.NewScheme()
	utilruntime.Must(clientgoscheme.AddToScheme(s))
	utilruntime.Must(v1alpha1.AddToScheme(s))
	return s
}

func TestClusterAuthenticator_Happy(t *testing.T) {
	token := "supersecret"
	hash := sha256.Sum256([]byte(token))
	hashHex := hex.EncodeToString(hash[:])

	cluster := &v1alpha1.OSMOCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "c1"},
		Spec: v1alpha1.OSMOClusterSpec{
			TokenSecretRef: &v1alpha1.SecretRef{Name: "tok", Namespace: "osmo-system"},
		},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "tok", Namespace: "osmo-system"},
		Data:       map[string][]byte{SecretKeyTokenHash: []byte(hashHex)},
	}

	cli := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(cluster, secret).Build()
	auth := &ClusterAuthenticator{Client: cli}

	if err := auth.Authenticate(context.Background(), "c1", token); err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestClusterAuthenticator_WrongToken(t *testing.T) {
	hash := sha256.Sum256([]byte("right"))
	hashHex := hex.EncodeToString(hash[:])

	cluster := &v1alpha1.OSMOCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "c1"},
		Spec: v1alpha1.OSMOClusterSpec{
			TokenSecretRef: &v1alpha1.SecretRef{Name: "tok", Namespace: "osmo-system"},
		},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "tok", Namespace: "osmo-system"},
		Data:       map[string][]byte{SecretKeyTokenHash: []byte(hashHex)},
	}

	cli := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(cluster, secret).Build()
	auth := &ClusterAuthenticator{Client: cli}

	if err := auth.Authenticate(context.Background(), "c1", "wrong"); err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

func TestClusterAuthenticator_UnknownCluster(t *testing.T) {
	cli := fake.NewClientBuilder().WithScheme(testScheme(t)).Build()
	auth := &ClusterAuthenticator{Client: cli}
	if err := auth.Authenticate(context.Background(), "ghost", "any"); err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized for unknown cluster, got %v", err)
	}
}

func TestClusterAuthenticator_MissingTokenSecretRef(t *testing.T) {
	cluster := &v1alpha1.OSMOCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "c1"},
		// TokenSecretRef intentionally not set.
	}
	cli := fake.NewClientBuilder().WithScheme(testScheme(t)).WithObjects(cluster).Build()
	auth := &ClusterAuthenticator{Client: cli}
	if err := auth.Authenticate(context.Background(), "c1", "x"); err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized when tokenSecretRef unset, got %v", err)
	}
}

func TestClusterAuthenticator_EmptyArgs(t *testing.T) {
	auth := &ClusterAuthenticator{}
	if err := auth.Authenticate(context.Background(), "", ""); err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized for empty args, got %v", err)
	}
	if err := auth.Authenticate(context.Background(), "c1", ""); err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized for empty token, got %v", err)
	}
}
