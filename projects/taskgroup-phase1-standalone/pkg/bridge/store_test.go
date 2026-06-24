package bridge

import (
	"context"
	"testing"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestConfigMapStoreLeasesCommandsDurably(t *testing.T) {
	ctx := context.Background()
	store := newTestConfigMapStore(t)
	command := Command{Action: ActionCreateOTG, ClusterID: "compute-a", Namespace: "osmo-exp", Name: "smoke"}
	id, err := store.Enqueue(ctx, command)
	if err != nil {
		t.Fatalf("Enqueue() error = %v", err)
	}

	now := time.Unix(100, 0)
	commands, err := store.LeaseCommands(ctx, "compute-a", now, time.Minute)
	if err != nil {
		t.Fatalf("LeaseCommands() error = %v", err)
	}
	if len(commands) != 1 || commands[0].ID != id {
		t.Fatalf("leased commands = %+v, want command %s", commands, id)
	}
	commands, err = store.LeaseCommands(ctx, "compute-a", now.Add(10*time.Second), time.Minute)
	if err != nil {
		t.Fatalf("LeaseCommands() second error = %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("leased commands before lease expiry = %+v, want none", commands)
	}

	restartedStore := newTestConfigMapStoreFromClient(store.client, "control")
	commands, err = restartedStore.LeaseCommands(ctx, "compute-a", now.Add(2*time.Minute), time.Minute)
	if err != nil {
		t.Fatalf("LeaseCommands() after restart error = %v", err)
	}
	if len(commands) != 1 || commands[0].ID != id {
		t.Fatalf("leased commands after restart = %+v, want command %s", commands, id)
	}
	if err := restartedStore.CompleteCommand(ctx, CommandResult{ID: id, ClusterID: "compute-a", OK: true}); err != nil {
		t.Fatalf("CompleteCommand() error = %v", err)
	}
	commands, err = restartedStore.LeaseCommands(ctx, "compute-a", now.Add(3*time.Minute), time.Minute)
	if err != nil {
		t.Fatalf("LeaseCommands() after completion error = %v", err)
	}
	if len(commands) != 0 {
		t.Fatalf("leased commands after completion = %+v, want none", commands)
	}
}

func TestConfigMapStorePersistsStatusReports(t *testing.T) {
	ctx := context.Background()
	store := newTestConfigMapStore(t)
	reportedAt := time.Unix(200, 0)
	err := store.ReportStatus(ctx, StatusReport{
		ClusterID: "compute-a",
		Namespace: "osmo-exp",
		Name:      "smoke",
		Status: taskgroupv1alpha1.OSMOTaskGroupStatus{
			Phase: "Running",
		},
	}, reportedAt)
	if err != nil {
		t.Fatalf("ReportStatus() error = %v", err)
	}
	status, err := store.GetStatus(ctx, "compute-a", "osmo-exp", "smoke")
	if err != nil {
		t.Fatalf("GetStatus() error = %v", err)
	}
	if status.Phase != "Running" || !status.LastReportTime.Time.Equal(reportedAt) {
		t.Fatalf("status = %+v, want Running at %s", status, reportedAt)
	}
	if err := store.ReportStatus(ctx, StatusReport{ClusterID: "compute-a", Namespace: "osmo-exp", Name: "smoke", Deleted: true}, reportedAt); err != nil {
		t.Fatalf("ReportStatus(deleted) error = %v", err)
	}
	if _, err := store.GetStatus(ctx, "compute-a", "osmo-exp", "smoke"); err == nil {
		t.Fatalf("GetStatus() after delete succeeded, want not found")
	}
}

func newTestConfigMapStore(t *testing.T) *ConfigMapStore {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme core error = %v", err)
	}
	kubeClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	return newTestConfigMapStoreFromClient(kubeClient, "control")
}

func newTestConfigMapStoreFromClient(kubeClient client.Client, namespace string) *ConfigMapStore {
	return NewConfigMapStore(kubeClient, namespace)
}
