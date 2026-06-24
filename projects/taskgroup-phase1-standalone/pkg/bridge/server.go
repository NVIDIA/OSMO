package bridge

import (
	"context"
	"fmt"
	"net/http"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
)

type DispatcherServer struct {
	store      Store
	agentToken string
}

func NewDispatcherServer() *DispatcherServer {
	return &DispatcherServer{store: NewMemoryStore()}
}

func NewDispatcherServerWithStore(store Store) *DispatcherServer {
	return &DispatcherServer{store: store}
}

func (s *DispatcherServer) SetAgentToken(token string) {
	s.agentToken = token
}

func (s *DispatcherServer) CreateOTG(ctx context.Context, clusterID string, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	command := Command{Action: ActionCreateOTG, ClusterID: clusterID, Namespace: otg.Namespace, Name: otg.Name, OTG: otg}
	_, err := s.store.Enqueue(ctx, command)
	return err
}

func (s *DispatcherServer) DeleteOTG(ctx context.Context, clusterID string, namespace string, name string) error {
	_, err := s.store.Enqueue(ctx, Command{Action: ActionDeleteOTG, ClusterID: clusterID, Namespace: namespace, Name: name})
	return err
}

func (s *DispatcherServer) GetOTGStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	return s.store.GetStatus(ctx, clusterID, namespace, name)
}

func (s *DispatcherServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/agent/commands", s.requireAgentAuth(s.handleCommands))
	mux.HandleFunc("/agent/results", s.requireAgentAuth(s.handleResults))
	mux.HandleFunc("/agent/status", s.requireAgentAuth(s.handleStatus))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func (s *DispatcherServer) requireAgentAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.agentToken == "" {
			next(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+s.agentToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *DispatcherServer) handleCommands(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clusterID := r.URL.Query().Get("clusterID")
	if clusterID == "" {
		http.Error(w, "clusterID is required", http.StatusBadRequest)
		return
	}
	timeout := time.After(25 * time.Second)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		commands, err := s.store.LeaseCommands(r.Context(), clusterID, time.Now(), 30*time.Second)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(commands) > 0 {
			writeJSON(w, commands)
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-timeout:
			writeJSON(w, []Command{})
			return
		case <-ticker.C:
		}
	}
}

func (s *DispatcherServer) handleResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var result CommandResult
	if err := decodeJSON(r.Body, &result); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.store.CompleteCommand(r.Context(), result); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *DispatcherServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var report StatusReport
	if err := decodeJSON(r.Body, &report); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.store.ReportStatus(r.Context(), report, time.Now()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func statusKey(clusterID, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s", clusterID, namespace, name)
}
