package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type HTTPClient struct {
	baseURL    string
	httpClient *http.Client
}

func NewHTTPClient(baseURL string) *HTTPClient {
	return &HTTPClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *HTTPClient) CreateOTG(ctx context.Context, clusterID string, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	return c.post(ctx, "/control/create", Command{Action: ActionCreateOTG, ClusterID: clusterID, Namespace: otg.Namespace, Name: otg.Name, OTG: otg})
}

func (c *HTTPClient) DeleteOTG(ctx context.Context, clusterID string, namespace string, name string) error {
	return c.post(ctx, "/control/delete", Command{Action: ActionDeleteOTG, ClusterID: clusterID, Namespace: namespace, Name: name})
}

func (c *HTTPClient) GetOTGStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	params := url.Values{}
	params.Set("clusterID", clusterID)
	params.Set("namespace", namespace)
	params.Set("name", name)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/control/status?"+params.Encode(), nil)
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, apierrors.NewNotFound(schema.GroupResource{
			Group:    taskgroupv1alpha1.GroupVersion.Group,
			Resource: "osmotaskgroups",
		}, name)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, fmt.Errorf("dispatcher status request failed: %s", resp.Status)
	}
	var status taskgroupv1alpha1.OSMOTaskGroupStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	return status, nil
}

func (c *HTTPClient) post(ctx context.Context, path string, command Command) error {
	data, err := json.Marshal(command)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("dispatcher command request failed: %s", resp.Status)
	}
	return nil
}

func (s *DispatcherServer) ControlHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/control/create", s.handleControlCreate)
	mux.HandleFunc("/control/delete", s.handleControlDelete)
	mux.HandleFunc("/control/status", s.handleControlStatus)
	mux.Handle("/agent/", s.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func (s *DispatcherServer) handleControlCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var command Command
	if err := json.NewDecoder(r.Body).Decode(&command); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if command.OTG == nil {
		http.Error(w, "otg is required", http.StatusBadRequest)
		return
	}
	if err := s.CreateOTG(r.Context(), command.ClusterID, command.OTG); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *DispatcherServer) handleControlDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var command Command
	if err := json.NewDecoder(r.Body).Decode(&command); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.DeleteOTG(r.Context(), command.ClusterID, command.Namespace, command.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *DispatcherServer) handleControlStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	status, err := s.GetOTGStatus(r.Context(), r.URL.Query().Get("clusterID"), r.URL.Query().Get("namespace"), r.URL.Query().Get("name"))
	if err != nil {
		if apierrors.IsNotFound(err) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, status)
}
