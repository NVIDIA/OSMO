package osmocontainer

import (
	"context"
	"strings"
	"testing"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/runtimeobject"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestReconcileRenderedPodAndMapTaskStatus(t *testing.T) {
	ctx := context.Background()
	scheme := runtime.NewScheme()
	if err := taskgroupv1alpha1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme taskgroup error = %v", err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("AddToScheme core error = %v", err)
	}
	otg := &taskgroupv1alpha1.OSMOTaskGroup{
		ObjectMeta: metav1.ObjectMeta{Name: "wf-prep", Namespace: "osmo-vpan", UID: "otg-uid"},
		Spec: taskgroupv1alpha1.OSMOTaskGroupSpec{
			RuntimeType: taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup,
			Mode:        taskgroupv1alpha1.ModeActive,
			RuntimeConfig: taskgroupv1alpha1.NewOSMOContainerGroupConfig(taskgroupv1alpha1.OSMOContainerGroupConfig{
				Tasks: []taskgroupv1alpha1.OSMOContainerTask{{
					Name:    "prep",
					PodName: "prep-pod",
					Lead:    true,
				}},
				RenderedObjects: []runtime.RawExtension{{
					Raw: []byte(`{
						"apiVersion":"v1",
						"kind":"Pod",
						"metadata":{"name":"prep-pod"},
						"spec":{"restartPolicy":"Never","containers":[{"name":"user","image":"busybox"}]}
					}`),
				}},
			}),
		},
	}
	kubeClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithStatusSubresource(&taskgroupv1alpha1.OSMOTaskGroup{}).
		Build()
	reconciler := NewReconciler(kubeClient)
	if err := reconciler.Validate(ctx, otg); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if err := reconciler.ReconcileRuntime(ctx, otg); err != nil {
		t.Fatalf("ReconcileRuntime() error = %v", err)
	}
	pod := &corev1.Pod{}
	if err := kubeClient.Get(ctx, client.ObjectKey{Namespace: "osmo-vpan", Name: "prep-pod"}, pod); err != nil {
		t.Fatalf("rendered pod was not created: %v", err)
	}
	if pod.GetAnnotations()[runtimeobject.SpecHashAnnotation] == "" {
		t.Fatalf("rendered pod is missing spec hash annotation")
	}
	if len(pod.OwnerReferences) != 1 || pod.OwnerReferences[0].Controller == nil || !*pod.OwnerReferences[0].Controller {
		t.Fatalf("rendered pod ownerReferences = %+v, want controller owner reference", pod.OwnerReferences)
	}
	if err := reconciler.ReconcileRuntime(ctx, otg); err != nil {
		t.Fatalf("ReconcileRuntime() with identical rendered object error = %v", err)
	}
	drifted := otg.DeepCopyObject().(*taskgroupv1alpha1.OSMOTaskGroup)
	drifted.Spec.RuntimeConfig = taskgroupv1alpha1.NewOSMOContainerGroupConfig(taskgroupv1alpha1.OSMOContainerGroupConfig{
		Tasks: []taskgroupv1alpha1.OSMOContainerTask{{
			Name:    "prep",
			PodName: "prep-pod",
			Lead:    true,
		}},
		RenderedObjects: []runtime.RawExtension{{
			Raw: []byte(`{
				"apiVersion":"v1",
				"kind":"Pod",
				"metadata":{"name":"prep-pod"},
				"spec":{"restartPolicy":"Never","containers":[{"name":"user","image":"alpine"}]}
			}`),
		}},
	})
	if err := reconciler.ReconcileRuntime(ctx, drifted); err == nil || !strings.Contains(err.Error(), "different desired spec") {
		t.Fatalf("ReconcileRuntime() drift error = %v, want different desired spec", err)
	}
	pod.Status.Phase = corev1.PodSucceeded
	if err := kubeClient.Status().Update(ctx, pod); err != nil {
		t.Fatalf("pod status update error = %v", err)
	}
	status, err := reconciler.MapStatus(ctx, otg)
	if err != nil {
		t.Fatalf("MapStatus() error = %v", err)
	}
	if status.Phase != "Succeeded" {
		t.Fatalf("phase = %q, want Succeeded", status.Phase)
	}
	if len(status.Tasks) != 1 || status.Tasks[0].Phase != "Succeeded" {
		t.Fatalf("tasks status = %+v, want one Succeeded task", status.Tasks)
	}
}
