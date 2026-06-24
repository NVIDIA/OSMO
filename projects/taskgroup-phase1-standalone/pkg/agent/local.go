package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type LocalComputeAgent struct {
	ClusterID string
	Client    client.Client
}

type workflowDispatchFields struct {
	Mode        string
	WorkflowRef taskgroupv1alpha1.WorkflowReference
}

func NewLocalComputeAgent(clusterID string, kubeClient client.Client) *LocalComputeAgent {
	return &LocalComputeAgent{ClusterID: clusterID, Client: kubeClient}
}

func (a *LocalComputeAgent) CreateOTG(ctx context.Context, clusterID string, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	if err := a.ensureCluster(clusterID); err != nil {
		return err
	}
	dispatchFields := workflowDispatchFields{
		Mode:        otg.Spec.Mode,
		WorkflowRef: otg.Spec.WorkflowRef,
	}
	createObj, err := unstructuredOTG(otg)
	if err != nil {
		return err
	}
	err = a.Client.Create(ctx, createObj)
	if err == nil {
		return a.ensureWorkflowDispatchFields(ctx, createObj.GetNamespace(), createObj.GetName(), dispatchFields)
	}
	if !apierrors.IsAlreadyExists(err) {
		return err
	}
	existing := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := a.Client.Get(ctx, client.ObjectKey{Namespace: otg.Namespace, Name: otg.Name}, existing); err != nil {
		return err
	}
	existing.Labels = otg.Labels
	existing.Annotations = otg.Annotations
	existing.Spec = otg.Spec
	existing.TypeMeta = metav1.TypeMeta{APIVersion: taskgroupv1alpha1.GroupVersion.String(), Kind: "OSMOTaskGroup"}
	if err := a.Client.Update(ctx, existing); err != nil {
		return err
	}
	return a.ensureWorkflowDispatchFields(ctx, otg.Namespace, otg.Name, dispatchFields)
}

func (a *LocalComputeAgent) DeleteOTG(ctx context.Context, clusterID string, namespace string, name string) error {
	if err := a.ensureCluster(clusterID); err != nil {
		return err
	}
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := a.Client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, otg); err != nil {
		return err
	}
	return a.Client.Delete(ctx, otg)
}

func (a *LocalComputeAgent) GetOTGStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	if err := a.ensureCluster(clusterID); err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	otg := &taskgroupv1alpha1.OSMOTaskGroup{}
	if err := a.Client.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, otg); err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	return otg.Status, nil
}

func (a *LocalComputeAgent) ensureCluster(clusterID string) error {
	if clusterID == a.ClusterID {
		return nil
	}
	return apierrors.NewNotFound(taskgroupv1alpha1.GroupVersion.WithResource("clusters").GroupResource(), clusterID)
}

func (a *LocalComputeAgent) ensureWorkflowDispatchFields(ctx context.Context, namespace string, name string, desired workflowDispatchFields) error {
	if desired.Mode == "" && desired.WorkflowRef.ID == "" && desired.WorkflowRef.Name == "" {
		return nil
	}
	patch, err := json.Marshal(map[string]any{
		"spec": map[string]any{
			"mode":        desired.Mode,
			"workflowRef": desired.WorkflowRef,
		},
	})
	if err != nil {
		return err
	}
	key := client.ObjectKey{Namespace: namespace, Name: name}
	stable := 0
	for attempt := 0; attempt < 20; attempt++ {
		current := unstructuredTaskGroup()
		current.SetNamespace(namespace)
		current.SetName(name)
		if err := a.Client.Patch(ctx, current, client.RawPatch(types.MergePatchType, patch)); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
		current = unstructuredTaskGroup()
		if err := a.Client.Get(ctx, key, current); err != nil {
			return err
		}
		mode, _, _ := unstructured.NestedString(current.Object, "spec", "mode")
		workflowName, _, _ := unstructured.NestedString(current.Object, "spec", "workflowRef", "name")
		if mode == desired.Mode && workflowName == desired.WorkflowRef.Name {
			stable++
			if stable >= 2 {
				return nil
			}
			continue
		}
		stable = 0
	}
	return fmt.Errorf("create_otg %s/%s did not persist spec.mode/spec.workflowRef after patch retries", namespace, name)
}

func unstructuredOTG(otg *taskgroupv1alpha1.OSMOTaskGroup) (*unstructured.Unstructured, error) {
	data, err := json.Marshal(otg)
	if err != nil {
		return nil, err
	}
	obj := map[string]any{}
	if err := json.Unmarshal(data, &obj); err != nil {
		return nil, err
	}
	return &unstructured.Unstructured{Object: obj}, nil
}

func unstructuredTaskGroup() *unstructured.Unstructured {
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion(taskgroupv1alpha1.GroupVersion.String())
	obj.SetKind("OSMOTaskGroup")
	return obj
}
