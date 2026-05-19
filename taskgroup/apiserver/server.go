// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package apiserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/nvidia/osmo/taskgroup/api/v1alpha1"
)

// Replace this stand-in with a real interface when integrating with an actual IDP.
// The auth contract is: extract a user identity (sub claim) from the request and use it
// to populate the workflow's owner field. No server-side session state.
type Authenticator interface {
	Authenticate(r *http.Request) (User, error)
}

// User is the authenticated principal. Phase 1 just needs the subject.
type User struct {
	Subject string
}

// Server bundles the dependencies the HTTP handlers need. It holds no per-request state
// and no database — every request reads/writes directly to the control cluster's K8s API.
type Server struct {
	// Client talks to the control cluster's K8s API. The Server treats Kubernetes as
	// its database.
	Client client.Client

	// Namespace where OSMOWorkflow CRs are created. Typically "osmo-workflows".
	Namespace string

	// Auth extracts the user identity from each request.
	Auth Authenticator
}

// Register attaches the API server's routes to a standard http.ServeMux.
//
// Routes are spelled out explicitly here rather than using a router framework so the
// dependency graph stays minimal. If the route count grows beyond ~10, swap in a router.
func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/workflows",                s.wrap(s.submitWorkflow))
	mux.HandleFunc("GET /v1/workflows",                 s.wrap(s.listWorkflows))
	mux.HandleFunc("GET /v1/workflows/{name}",          s.wrap(s.getWorkflow))
	mux.HandleFunc("DELETE /v1/workflows/{name}",       s.wrap(s.deleteWorkflow))
	mux.HandleFunc("GET /v1/workflows/{name}/logs",     s.wrap(s.streamLogs))
	mux.HandleFunc("GET /healthz",                       s.healthz)
	mux.HandleFunc("GET /readyz",                        s.readyz)
}

// wrap is the per-request middleware chain: authenticate, then dispatch. All handlers
// return an error to keep the dispatch shape uniform.
type handlerFunc func(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error

func (s *Server) wrap(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := s.Auth.Authenticate(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err)
			return
		}
		if err := h(r.Context(), w, r, user); err != nil {
			translateError(w, err)
		}
	}
}

// ----- Handlers -----

// submitWorkflow accepts a workflow definition and writes it as an OSMOWorkflow CR.
//
// Phase 1 input shape is the OSMOWorkflow.spec verbatim, JSON-encoded. A future revision
// can accept the higher-level OSMO workflow YAML (the one users write today) and
// translate to OSMOWorkflow.spec server-side.
func (s *Server) submitWorkflow(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error {
	var spec v1alpha1.OSMOWorkflowSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		return badRequest(fmt.Errorf("invalid workflow body: %w", err))
	}
	if len(spec.Groups) == 0 {
		return badRequest(errors.New("workflow must contain at least one group"))
	}
	spec.Owner = user.Subject

	// Name is server-generated to avoid collisions; the CR name doubles as the workflow ID.
	wf := &v1alpha1.OSMOWorkflow{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: "wf-",
			Namespace:    s.Namespace,
			Labels: map[string]string{
				"workflow.osmo.nvidia.com/owner": user.Subject,
			},
		},
		Spec: spec,
	}
	if err := s.Client.Create(ctx, wf); err != nil {
		return fmt.Errorf("creating workflow CR: %w", err)
	}
	return writeJSON(w, http.StatusCreated, submitResponse{
		ID:        wf.Name,
		Namespace: wf.Namespace,
	})
}

// listWorkflows returns workflows owned by the authenticated user.
func (s *Server) listWorkflows(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error {
	var list v1alpha1.OSMOWorkflowList
	if err := s.Client.List(ctx, &list,
		client.InNamespace(s.Namespace),
		client.MatchingLabels{"workflow.osmo.nvidia.com/owner": user.Subject},
	); err != nil {
		return fmt.Errorf("listing workflows: %w", err)
	}
	return writeJSON(w, http.StatusOK, list)
}

// getWorkflow returns one workflow CR.
func (s *Server) getWorkflow(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error {
	name := r.PathValue("name")
	wf, err := s.loadWorkflow(ctx, name, user)
	if err != nil {
		return err
	}
	return writeJSON(w, http.StatusOK, wf)
}

// deleteWorkflow cancels and deletes a workflow. Cascade deletion of child OSMOTaskGroups
// is handled by Kubernetes via owner references in the local-cluster case. Remote-cluster
// children (Phase 2) are deleted via the Operator Service stream by the Workflow Controller's
// finalizer.
func (s *Server) deleteWorkflow(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error {
	name := r.PathValue("name")
	wf, err := s.loadWorkflow(ctx, name, user)
	if err != nil {
		return err
	}
	if err := s.Client.Delete(ctx, wf); err != nil {
		return fmt.Errorf("deleting workflow: %w", err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// streamLogs proxies pod logs back to the caller. Phase 1 supports local-cluster groups
// only — it reads pod logs directly via the K8s API. Phase 2 swaps in a GetLogs request
// on the operator-service session stream for remote groups.
func (s *Server) streamLogs(ctx context.Context, w http.ResponseWriter, r *http.Request, user User) error {
	// Phase 1 stub: deliberately returns a clear "not implemented" rather than half a
	// solution. Implement once we have either a typed kubernetes client wrapper or a
	// session.LogClient.
	return notImplemented(errors.New("log streaming not yet implemented; use kubectl logs on the workflow's pods directly"))
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("ok")) }
func (s *Server) readyz(w http.ResponseWriter, _ *http.Request)  { _, _ = w.Write([]byte("ok")) }

// loadWorkflow fetches a single workflow and verifies the caller owns it.
func (s *Server) loadWorkflow(ctx context.Context, name string, user User) (*v1alpha1.OSMOWorkflow, error) {
	var wf v1alpha1.OSMOWorkflow
	if err := s.Client.Get(ctx, types.NamespacedName{Name: name, Namespace: s.Namespace}, &wf); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, notFound(fmt.Errorf("workflow %q not found", name))
		}
		return nil, err
	}
	if wf.Labels["workflow.osmo.nvidia.com/owner"] != user.Subject {
		return nil, forbidden(fmt.Errorf("workflow %q is not owned by %q", name, user.Subject))
	}
	return &wf, nil
}

// submitResponse is the JSON shape returned to clients on workflow creation.
type submitResponse struct {
	ID        string `json:"id"`
	Namespace string `json:"namespace"`
}
