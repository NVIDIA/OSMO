package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/bridge"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type RemoteComputeAgent struct {
	ClusterID     string
	DispatcherURL string
	AgentToken    string
	Client        client.Client
	HTTPClient    *http.Client
}

func NewRemoteComputeAgent(clusterID string, dispatcherURL string, kubeClient client.Client) *RemoteComputeAgent {
	return &RemoteComputeAgent{
		ClusterID:     clusterID,
		DispatcherURL: strings.TrimRight(dispatcherURL, "/"),
		Client:        kubeClient,
		HTTPClient:    &http.Client{Timeout: 35 * time.Second},
	}
}

func (a *RemoteComputeAgent) SetAgentToken(token string) {
	a.AgentToken = strings.TrimSpace(token)
}

func (a *RemoteComputeAgent) Run(ctx context.Context) error {
	statusTicker := time.NewTicker(10 * time.Second)
	defer statusTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-statusTicker.C:
			if err := a.ReportStatuses(ctx); err != nil {
				log.Printf("report statuses failed: %v", err)
			}
		default:
		}
		if err := a.pollAndApply(ctx); err != nil {
			log.Printf("poll and apply failed: %v", err)
			time.Sleep(2 * time.Second)
		}
	}
}

func (a *RemoteComputeAgent) pollAndApply(ctx context.Context) error {
	params := url.Values{}
	params.Set("clusterID", a.ClusterID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.DispatcherURL+"/agent/commands?"+params.Encode(), nil)
	if err != nil {
		return err
	}
	a.authorize(req)
	resp, err := a.HTTPClient.Do(req)
	if err != nil {
		log.Printf("poll dispatcher commands failed: %v", err)
		time.Sleep(2 * time.Second)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("poll dispatcher commands returned %s", resp.Status)
		time.Sleep(2 * time.Second)
		return nil
	}
	var commands []bridge.Command
	if err := json.NewDecoder(resp.Body).Decode(&commands); err != nil {
		return err
	}
	for _, command := range commands {
		err := a.applyCommand(ctx, command)
		result := bridge.CommandResult{ID: command.ID, ClusterID: a.ClusterID, OK: err == nil}
		if err != nil {
			result.Error = err.Error()
		}
		if reportErr := a.post(ctx, "/agent/results", result); reportErr != nil {
			log.Printf("post command result %s failed: %v", command.ID, reportErr)
			continue
		}
	}
	return nil
}

func (a *RemoteComputeAgent) applyCommand(ctx context.Context, command bridge.Command) error {
	switch command.Action {
	case bridge.ActionCreateOTG:
		if command.OTG == nil {
			return fmt.Errorf("create_otg command missing otg")
		}
		if command.OTG.Spec.Mode == "" {
			return fmt.Errorf("create_otg %s/%s missing spec.mode", command.Namespace, command.Name)
		}
		if command.OTG.Spec.WorkflowRef.Name == "" {
			return fmt.Errorf("create_otg %s/%s missing spec.workflowRef.name", command.Namespace, command.Name)
		}
		log.Printf("applying create_otg id=%s otg=%s/%s runtimeType=%s mode=%s workflow=%s", command.ID, command.OTG.Namespace, command.OTG.Name, command.OTG.Spec.RuntimeType, command.OTG.Spec.Mode, command.OTG.Spec.WorkflowRef.Name)
		local := NewLocalComputeAgent(a.ClusterID, a.Client)
		return local.CreateOTG(ctx, a.ClusterID, command.OTG)
	case bridge.ActionDeleteOTG:
		local := NewLocalComputeAgent(a.ClusterID, a.Client)
		err := local.DeleteOTG(ctx, a.ClusterID, command.Namespace, command.Name)
		if apierrors.IsNotFound(err) {
			err = nil
		}
		if err != nil {
			return err
		}
		return a.post(ctx, "/agent/status", bridge.StatusReport{
			ClusterID: a.ClusterID,
			Namespace: command.Namespace,
			Name:      command.Name,
			Deleted:   true,
		})
	default:
		return fmt.Errorf("unsupported command action %q", command.Action)
	}
}

func (a *RemoteComputeAgent) ReportStatuses(ctx context.Context) error {
	list := &taskgroupv1alpha1.OSMOTaskGroupList{}
	if err := a.Client.List(ctx, list); err != nil {
		return err
	}
	for _, otg := range list.Items {
		report := bridge.StatusReport{
			ClusterID: a.ClusterID,
			Namespace: otg.Namespace,
			Name:      otg.Name,
			Status:    otg.Status,
		}
		if err := a.post(ctx, "/agent/status", report); err != nil {
			return err
		}
	}
	return nil
}

func (a *RemoteComputeAgent) post(ctx context.Context, path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.DispatcherURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	a.authorize(req)
	resp, err := a.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("post %s: %s", path, resp.Status)
	}
	return nil
}

func (a *RemoteComputeAgent) authorize(req *http.Request) {
	if a.AgentToken != "" {
		req.Header.Set("Authorization", "Bearer "+a.AgentToken)
	}
}
