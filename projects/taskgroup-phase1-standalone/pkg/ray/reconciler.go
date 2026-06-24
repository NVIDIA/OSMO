package ray

import (
	"context"
	"fmt"
	"strconv"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"
	"example.com/taskgroup-phase1-standalone/pkg/runtimeobject"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

const (
	modeCluster = "cluster"
	modeJob     = "job"
)

type Reconciler struct {
	client client.Client
}

func NewReconciler(kubeClient client.Client) *Reconciler {
	return &Reconciler{client: kubeClient}
}

func (r *Reconciler) Validate(_ context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	config, err := otg.Spec.RuntimeConfig.RayConfig()
	if err != nil {
		return err
	}
	mode := effectiveMode(config)
	if mode != modeCluster && mode != modeJob {
		return fmt.Errorf("runtimeConfig.ray.mode must be %q or %q", modeCluster, modeJob)
	}
	if config.RayVersion == "" {
		return fmt.Errorf("runtimeConfig.ray.rayVersion is required")
	}
	if config.Head.Image == "" {
		return fmt.Errorf("runtimeConfig.ray.head.image is required")
	}
	for _, worker := range config.Workers {
		if worker.Name == "" {
			return fmt.Errorf("runtimeConfig.ray.workers[].name is required")
		}
		if worker.Image == "" {
			return fmt.Errorf("runtimeConfig.ray.workers[%s].image is required", worker.Name)
		}
	}
	if mode == modeJob && (config.Job == nil || config.Job.Entrypoint == "") {
		return fmt.Errorf("runtimeConfig.ray.job.entrypoint is required when mode is %q", modeJob)
	}
	if wantsPodGroup(config.Scheduler) && config.Scheduler.Queue == "" {
		return fmt.Errorf("runtimeConfig.ray.scheduler.queue is required when Ray uses KAI gang scheduling")
	}
	return nil
}

func (r *Reconciler) ReconcileRuntime(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) error {
	config, err := otg.Spec.RuntimeConfig.RayConfig()
	if err != nil {
		return err
	}
	objects := Render(otg, config)
	if otg.EffectiveMode() == taskgroupv1alpha1.ModeShadow {
		return nil
	}
	for i := range objects {
		object := objects[i]
		if err := runtimeobject.Reconcile(ctx, r.client, otg, &object); err != nil {
			return err
		}
	}
	return nil
}

func (r *Reconciler) MapStatus(ctx context.Context, otg *taskgroupv1alpha1.OSMOTaskGroup) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	config, err := otg.Spec.RuntimeConfig.RayConfig()
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	rayStatus := &taskgroupv1alpha1.RayRuntimeStatus{
		RayClusterName:   clusterName(otg),
		WorkersDesired:   desiredWorkers(config),
		DashboardService: clusterName(otg) + "-head-svc",
		DashboardPort:    8265,
	}
	phase := "Pending"
	message := "Ray resources have not reported status yet"
	if effectiveMode(config) == modeJob {
		rayStatus.RayJobName = jobName(otg)
		job := &unstructured.Unstructured{}
		job.SetAPIVersion("ray.io/v1")
		job.SetKind("RayJob")
		err := r.client.Get(ctx, client.ObjectKey{Namespace: otg.Namespace, Name: jobName(otg)}, job)
		if err != nil && !apierrors.IsNotFound(err) {
			return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
		}
		if err == nil {
			rayStatus.JobStatus, _, _ = unstructured.NestedString(job.Object, "status", "jobStatus")
			phase = phaseFromRayJobStatus(rayStatus.JobStatus)
			message = "RayJob status mapped"
		}
	} else {
		cluster := &unstructured.Unstructured{}
		cluster.SetAPIVersion("ray.io/v1")
		cluster.SetKind("RayCluster")
		err := r.client.Get(ctx, client.ObjectKey{Namespace: otg.Namespace, Name: clusterName(otg)}, cluster)
		if err != nil && !apierrors.IsNotFound(err) {
			return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
		}
		if err == nil {
			rayStatus.HeadReady = nestedBool(cluster.Object, "status", "head", "ready")
			rayStatus.WorkersReady = nestedInt32(cluster.Object, "status", "availableWorkerReplicas")
			if rayStatus.HeadReady && rayStatus.WorkersReady >= rayStatus.WorkersDesired {
				phase = "Running"
			}
			message = "RayCluster status mapped"
		}
	}
	return taskgroupv1alpha1.OSMOTaskGroupStatus{
		Phase:   phase,
		Message: message,
		RuntimeStatus: taskgroupv1alpha1.RuntimeStatus{
			Ray: rayStatus,
		},
		Conditions: []metav1.Condition{{
			Type:               "Reconciled",
			Status:             metav1.ConditionTrue,
			ObservedGeneration: otg.Generation,
			Reason:             "RayStatusMapped",
			Message:            message,
		}},
	}, nil
}

func Render(otg *taskgroupv1alpha1.OSMOTaskGroup, config taskgroupv1alpha1.RayConfig) []unstructured.Unstructured {
	clusterSpec := rayClusterSpec(otg, config)
	objects := []unstructured.Unstructured{}
	if wantsPodGroup(config.Scheduler) {
		objects = append(objects, renderPodGroup(otg, config))
	}
	if effectiveMode(config) == modeJob {
		spec := map[string]any{
			"entrypoint":               config.Job.Entrypoint,
			"rayClusterSpec":           clusterSpec,
			"shutdownAfterJobFinishes": config.ShutdownAfterJob,
		}
		if runtimeEnvYAML := rayJobRuntimeEnvYAML(config.Job); runtimeEnvYAML != "" {
			spec["runtimeEnvYAML"] = runtimeEnvYAML
		}
		job := map[string]any{
			"apiVersion": "ray.io/v1",
			"kind":       "RayJob",
			"metadata": map[string]any{
				"name":      jobName(otg),
				"namespace": otg.Namespace,
				"labels":    labels(otg, config),
			},
			"spec": spec,
		}
		return append(objects, unstructured.Unstructured{Object: job})
	}
	cluster := map[string]any{
		"apiVersion": "ray.io/v1",
		"kind":       "RayCluster",
		"metadata": map[string]any{
			"name":      clusterName(otg),
			"namespace": otg.Namespace,
			"labels":    labels(otg, config),
		},
		"spec": clusterSpec,
	}
	return append(objects, unstructured.Unstructured{Object: cluster})
}

func rayClusterSpec(otg *taskgroupv1alpha1.OSMOTaskGroup, config taskgroupv1alpha1.RayConfig) map[string]any {
	spec := map[string]any{
		"rayVersion": config.RayVersion,
		"headGroupSpec": map[string]any{
			"rayStartParams": map[string]any{"dashboard-host": "0.0.0.0"},
			"template":       podTemplate(otg.Name, "ray-head", config.Head, config.Scheduler),
		},
	}
	if len(config.Workers) > 0 {
		workers := make([]any, 0, len(config.Workers))
		for _, worker := range config.Workers {
			replicas := worker.Replicas
			if replicas == 0 {
				replicas = 1
			}
			minReplicas := worker.MinReplicas
			if minReplicas == 0 {
				minReplicas = replicas
			}
			maxReplicas := worker.MaxReplicas
			if maxReplicas == 0 {
				maxReplicas = replicas
			}
			workers = append(workers, map[string]any{
				"groupName":      worker.Name,
				"replicas":       replicas,
				"minReplicas":    minReplicas,
				"maxReplicas":    maxReplicas,
				"rayStartParams": map[string]any{},
				"template":       podTemplate(otg.Name, "ray-worker", worker.RayNodeGroup, config.Scheduler),
			})
		}
		spec["workerGroupSpecs"] = workers
	}
	return spec
}

func podTemplate(otgName string, containerName string, group taskgroupv1alpha1.RayNodeGroup, scheduler taskgroupv1alpha1.SchedulerConfig) map[string]any {
	labels := map[string]any{}
	annotations := map[string]any{}
	if scheduler.Queue != "" {
		labels["kai.scheduler/queue"] = scheduler.Queue
		labels["runai/queue"] = scheduler.Queue
	}
	if wantsPodGroup(scheduler) {
		annotations["pod-group-name"] = otgName
	}
	container := map[string]any{
		"name":      containerName,
		"image":     group.Image,
		"resources": resources(group.Resources),
	}
	if len(group.Env) > 0 {
		env := make([]any, 0, len(group.Env))
		for key, value := range group.Env {
			env = append(env, map[string]any{"name": key, "value": value})
		}
		container["env"] = env
	}
	spec := map[string]any{
		"containers": []any{container},
	}
	if scheduler.SchedulerName != "" {
		spec["schedulerName"] = scheduler.SchedulerName
	}
	if scheduler.PriorityClassName != "" {
		spec["priorityClassName"] = scheduler.PriorityClassName
	}
	return map[string]any{
		"metadata": map[string]any{
			"labels":      labels,
			"annotations": annotations,
		},
		"spec": spec,
	}
}

func renderPodGroup(otg *taskgroupv1alpha1.OSMOTaskGroup, config taskgroupv1alpha1.RayConfig) unstructured.Unstructured {
	minMember := int64(config.Scheduler.MinMember)
	if minMember == 0 {
		minMember = int64(1 + desiredWorkers(config))
	}
	object := map[string]any{
		"apiVersion": "scheduling.run.ai/v2alpha2",
		"kind":       "PodGroup",
		"metadata": map[string]any{
			"name":      otg.Name,
			"namespace": otg.Namespace,
			"labels": map[string]any{
				"kai.scheduler/queue": config.Scheduler.Queue,
				"runai/queue":         config.Scheduler.Queue,
			},
		},
		"spec": map[string]any{
			"queue":     config.Scheduler.Queue,
			"minMember": minMember,
		},
	}
	spec := object["spec"].(map[string]any)
	if config.Scheduler.PriorityClassName != "" {
		spec["priorityClassName"] = config.Scheduler.PriorityClassName
	}
	return unstructured.Unstructured{Object: object}
}

func rayJobRuntimeEnvYAML(job *taskgroupv1alpha1.RayJobConfig) string {
	if job == nil {
		return ""
	}
	runtimeEnv := map[string]any{}
	if len(job.Env) > 0 {
		runtimeEnv["env_vars"] = job.Env
	}
	if job.WorkingDir != "" {
		runtimeEnv["working_dir"] = job.WorkingDir
	}
	if len(runtimeEnv) == 0 {
		return ""
	}
	data, err := yaml.Marshal(runtimeEnv)
	if err != nil {
		return ""
	}
	return string(data)
}

func wantsPodGroup(scheduler taskgroupv1alpha1.SchedulerConfig) bool {
	return scheduler.Type == "kai" || scheduler.Queue != "" || scheduler.MinMember > 0
}

func resources(resources taskgroupv1alpha1.RayResources) map[string]any {
	requests := map[string]any{}
	if resources.CPU != "" {
		requests["cpu"] = resources.CPU
	}
	if resources.Memory != "" {
		requests["memory"] = resources.Memory
	}
	if resources.GPU != "" && resources.GPU != "0" {
		requests["nvidia.com/gpu"] = resources.GPU
	}
	if resources.Storage != "" {
		requests["ephemeral-storage"] = resources.Storage
	}
	if len(requests) == 0 {
		return map[string]any{}
	}
	return map[string]any{
		"requests": requests,
		"limits":   requests,
	}
}

func labels(otg *taskgroupv1alpha1.OSMOTaskGroup, config taskgroupv1alpha1.RayConfig) map[string]any {
	result := map[string]any{
		"workflow.osmo.nvidia.com/workflow-name": otg.Spec.WorkflowRef.Name,
		"workflow.osmo.nvidia.com/group-name":    otg.Spec.GroupName,
		"workflow.osmo.nvidia.com/runtime-type":  taskgroupv1alpha1.RuntimeTypeRay,
	}
	if config.Pool.Name != "" {
		result["workflow.osmo.nvidia.com/pool"] = config.Pool.Name
	}
	if config.Pool.Platform != "" {
		result["workflow.osmo.nvidia.com/platform"] = config.Pool.Platform
	}
	return result
}

func effectiveMode(config taskgroupv1alpha1.RayConfig) string {
	if config.Mode == "" {
		return modeCluster
	}
	return config.Mode
}

func clusterName(otg *taskgroupv1alpha1.OSMOTaskGroup) string {
	return otg.Name
}

func jobName(otg *taskgroupv1alpha1.OSMOTaskGroup) string {
	return otg.Name + "-job"
}

func desiredWorkers(config taskgroupv1alpha1.RayConfig) int32 {
	var desired int32
	for _, worker := range config.Workers {
		if worker.Replicas > 0 {
			desired += worker.Replicas
		} else {
			desired++
		}
	}
	return desired
}

func phaseFromRayJobStatus(status string) string {
	switch status {
	case "SUCCEEDED", "Succeeded", "Complete", "Completed":
		return "Succeeded"
	case "FAILED", "Failed":
		return "Failed"
	case "RUNNING", "Running":
		return "Running"
	default:
		return "Pending"
	}
}

func nestedBool(object map[string]any, fields ...string) bool {
	value, found, _ := unstructured.NestedBool(object, fields...)
	return found && value
}

func nestedInt32(object map[string]any, fields ...string) int32 {
	value, found, _ := unstructured.NestedInt64(object, fields...)
	if found {
		return int32(value)
	}
	stringValue, found, _ := unstructured.NestedString(object, fields...)
	if !found {
		return 0
	}
	parsed, err := strconv.ParseInt(stringValue, 10, 32)
	if err != nil {
		return 0
	}
	return int32(parsed)
}
