package taskgroup

import (
	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/kai"
	"example.com/taskgroup-phase1-standalone/pkg/osmocontainer"
	"example.com/taskgroup-phase1-standalone/pkg/ray"

	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func NewDefaultReconciler(kubeClient client.Client, scheme *runtime.Scheme) *Reconciler {
	return NewReconciler(kubeClient, scheme, map[string]RuntimeReconciler{
		taskgroupv1alpha1.RuntimeTypeKAI:                kai.NewReconciler(kubeClient),
		taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup: osmocontainer.NewReconciler(kubeClient),
		taskgroupv1alpha1.RuntimeTypeRay:                ray.NewReconciler(kubeClient),
	})
}
