package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var GroupVersion = schema.GroupVersion{Group: "workflow.osmo.nvidia.com", Version: "v1alpha1"}

func AddToScheme(scheme *runtime.Scheme) error {
	scheme.AddKnownTypes(GroupVersion, &OSMOTaskGroup{}, &OSMOTaskGroupList{})
	metav1.AddToGroupVersion(scheme, GroupVersion)
	return nil
}
