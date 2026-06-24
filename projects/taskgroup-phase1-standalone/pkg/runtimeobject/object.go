package runtimeobject

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const SpecHashAnnotation = "workflow.osmo.nvidia.com/spec-hash"

func Reconcile(ctx context.Context, kubeClient client.Client, otg *taskgroupv1alpha1.OSMOTaskGroup, desired *unstructured.Unstructured) error {
	if desired.GetNamespace() == "" {
		desired.SetNamespace(otg.Namespace)
	}
	PropagateControllerOwner(otg, desired)
	if err := SetControllerOwner(otg, desired); err != nil {
		return err
	}
	if err := NormalizeJSON(desired); err != nil {
		return err
	}
	desiredHash, err := AnnotateSpecHash(desired)
	if err != nil {
		return err
	}
	if err := kubeClient.Create(ctx, desired); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return err
		}
		return verifyOrAdoptExisting(ctx, kubeClient, otg, desired, desiredHash)
	}
	return nil
}

func PropagateControllerOwner(otg *taskgroupv1alpha1.OSMOTaskGroup, object *unstructured.Unstructured) {
	owner := otg.GetLabels()[taskgroupv1alpha1.ControllerOwnerLabel]
	if owner == "" {
		return
	}
	labels := object.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[taskgroupv1alpha1.ControllerOwnerLabel] = owner
	object.SetLabels(labels)
}

func SetControllerOwner(otg *taskgroupv1alpha1.OSMOTaskGroup, object *unstructured.Unstructured) error {
	controller := true
	blockOwnerDeletion := true
	owner := metav1.OwnerReference{
		APIVersion:         taskgroupv1alpha1.GroupVersion.String(),
		Kind:               "OSMOTaskGroup",
		Name:               otg.Name,
		UID:                otg.UID,
		Controller:         &controller,
		BlockOwnerDeletion: &blockOwnerDeletion,
	}
	refs := object.GetOwnerReferences()
	for i := range refs {
		if refs[i].Controller != nil && *refs[i].Controller && refs[i].UID != otg.UID {
			return fmt.Errorf("%s/%s already has controller owner %s/%s", object.GetNamespace(), object.GetName(), refs[i].Kind, refs[i].Name)
		}
		if refs[i].UID == otg.UID {
			refs[i] = owner
			object.SetOwnerReferences(refs)
			return nil
		}
	}
	object.SetOwnerReferences(append(refs, owner))
	return nil
}

func AnnotateSpecHash(object *unstructured.Unstructured) (string, error) {
	hash, err := SpecHash(object)
	if err != nil {
		return "", err
	}
	annotations := object.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	annotations[SpecHashAnnotation] = hash
	object.SetAnnotations(annotations)
	return hash, nil
}

func verifyOrAdoptExisting(ctx context.Context, kubeClient client.Client, otg *taskgroupv1alpha1.OSMOTaskGroup, desired *unstructured.Unstructured, desiredHash string) error {
	existing := &unstructured.Unstructured{}
	existing.SetAPIVersion(desired.GetAPIVersion())
	existing.SetKind(desired.GetKind())
	if err := kubeClient.Get(ctx, types.NamespacedName{Namespace: desired.GetNamespace(), Name: desired.GetName()}, existing); err != nil {
		return err
	}
	existingHash := existing.GetAnnotations()[SpecHashAnnotation]
	if existingHash == "" {
		calculatedHash, err := SpecHash(existing)
		if err != nil {
			return err
		}
		existingHash = calculatedHash
	}
	if existingHash != desiredHash {
		return fmt.Errorf("%s %s/%s already exists with a different desired spec; update the owning OSMOTaskGroup by replacing the child resource or creating a new task group revision", desired.GetKind(), desired.GetNamespace(), desired.GetName())
	}
	owned := hasControllerOwner(existing, otg.UID)
	annotated := existing.GetAnnotations()[SpecHashAnnotation] == desiredHash
	if err := SetControllerOwner(otg, existing); err != nil {
		return err
	}
	annotations := existing.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	if owned && annotated {
		return nil
	}
	annotations[SpecHashAnnotation] = desiredHash
	existing.SetAnnotations(annotations)
	return kubeClient.Update(ctx, existing)
}

func hasControllerOwner(object *unstructured.Unstructured, uid types.UID) bool {
	for _, ref := range object.GetOwnerReferences() {
		if ref.UID == uid && ref.Controller != nil && *ref.Controller {
			return true
		}
	}
	return false
}

func NormalizeJSON(object *unstructured.Unstructured) error {
	data, err := json.Marshal(object.Object)
	if err != nil {
		return err
	}
	normalized := map[string]any{}
	if err := json.Unmarshal(data, &normalized); err != nil {
		return err
	}
	object.Object = normalized
	return nil
}

func SpecHash(object *unstructured.Unstructured) (string, error) {
	copy := &unstructured.Unstructured{}
	copy.Object = object.Object
	if err := NormalizeJSON(copy); err != nil {
		return "", err
	}
	annotations := copy.GetAnnotations()
	if len(annotations) > 0 {
		delete(annotations, SpecHashAnnotation)
		if len(annotations) == 0 {
			copy.SetAnnotations(nil)
		} else {
			copy.SetAnnotations(annotations)
		}
	}
	canonical := copy.Object
	delete(canonical, "status")
	metadata, ok := canonical["metadata"].(map[string]any)
	if ok {
		for _, key := range []string{"creationTimestamp", "deletionGracePeriodSeconds", "deletionTimestamp", "finalizers", "generation", "managedFields", "ownerReferences", "resourceVersion", "uid"} {
			delete(metadata, key)
		}
	}
	data, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:16], nil
}
