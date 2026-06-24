package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/validation"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/config"
	"sigs.k8s.io/yaml"
)

const ownerLabel = "workflow.osmo.nvidia.com/owner"

var workflowGVK = schema.GroupVersionKind{
	Group:   "workflow.osmo.nvidia.com",
	Version: "v1alpha1",
	Kind:    "Workflow",
}

type submitWorkflowRequest struct {
	APIVersion   string                 `json:"apiVersion,omitempty"`
	Kind         string                 `json:"kind,omitempty"`
	Metadata     map[string]any         `json:"metadata,omitempty"`
	Spec         map[string]any         `json:"spec,omitempty"`
	ClusterID    string                 `json:"clusterID,omitempty"`
	Namespace    string                 `json:"namespace,omitempty"`
	Mode         string                 `json:"mode,omitempty"`
	Owner        string                 `json:"owner,omitempty"`
	Pool         string                 `json:"pool,omitempty"`
	Priority     string                 `json:"priority,omitempty"`
	RuntimeType  string                 `json:"runtimeType,omitempty"`
	WorkflowID   string                 `json:"workflowID,omitempty"`
	WorkflowName string                 `json:"workflowName,omitempty"`
	TaskGroups   []map[string]any       `json:"taskGroups,omitempty"`
	Workflow     map[string]any         `json:"workflow,omitempty"`
	Extra        map[string]interface{} `json:"-"`
}

type server struct {
	client    client.Client
	namespace string
}

func main() {
	var bind string
	var workflowNamespace string
	var k8sQPS float64
	var k8sBurst int
	flag.StringVar(&bind, "bind", ":8088", "HTTP bind address")
	flag.StringVar(&workflowNamespace, "workflow-namespace", "osmo-workflows", "namespace for OSMOWorkflow resources")
	flag.Float64Var(&k8sQPS, "k8s-qps", 50, "Kubernetes client QPS")
	flag.IntVar(&k8sBurst, "k8s-burst", 100, "Kubernetes client burst")
	flag.Parse()

	cfg := config.GetConfigOrDie()
	cfg.QPS = float32(k8sQPS)
	cfg.Burst = k8sBurst
	k8sClient, err := client.New(cfg, client.Options{})
	if err != nil {
		log.Fatalf("create kubernetes client: %v", err)
	}

	s := &server{client: k8sClient, namespace: workflowNamespace}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.healthz)
	mux.HandleFunc("/readyz", s.readyz)
	mux.HandleFunc("/v1/workflows", s.workflows)
	mux.HandleFunc("/v1/workflows/", s.workflowByName)

	log.Printf("taskgroup apiserver listening on %s namespace=%s", bind, workflowNamespace)
	if err := http.ListenAndServe(bind, mux); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func (s *server) healthz(w http.ResponseWriter, _ *http.Request) {
	_, _ = w.Write([]byte("ok"))
}

func (s *server) readyz(w http.ResponseWriter, _ *http.Request) {
	_, _ = w.Write([]byte("ok"))
}

func (s *server) workflows(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.listWorkflows(w, r)
	case http.MethodPost:
		s.submitWorkflow(w, r)
	default:
		w.Header().Set("Allow", "GET, HEAD, POST")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (s *server) workflowByName(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(w, r) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/v1/workflows/")
	name = strings.TrimSuffix(name, "/logs")
	if name == "" {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	switch {
	case strings.HasSuffix(r.URL.Path, "/logs"):
		writeError(w, http.StatusNotImplemented, "workflow log streaming is not implemented in phase1a apiserver")
	case r.Method == http.MethodGet:
		s.getWorkflow(w, r, name)
	case r.Method == http.MethodDelete:
		s.deleteWorkflow(w, r, name)
	default:
		w.Header().Set("Allow", "GET, HEAD, DELETE")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (s *server) submitWorkflow(w http.ResponseWriter, r *http.Request) {
	req, err := decodeSubmitRequest(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid workflow body: %v", err))
		return
	}
	spec, err := reqSpec(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	owner := safeLabelValue(firstString(anyString(spec["owner"]), req.Owner, bearerPrincipal(r)))
	if owner == "" {
		owner = "unknown"
	}

	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(workflowGVK)
	obj.SetNamespace(s.namespace)
	obj.SetGenerateName(firstString(metadataString(req.Metadata, "generateName"), "wf-"))
	if name := metadataString(req.Metadata, "name"); name != "" {
		obj.SetName(name)
		obj.SetGenerateName("")
	}
	obj.SetLabels(map[string]string{
		ownerLabel:                             owner,
		taskgroupv1alpha1.ControllerOwnerLabel: taskgroupv1alpha1.ControllerOwnerPhase1A,
	})
	if labels, ok := req.Metadata["labels"].(map[string]any); ok {
		for k, v := range labels {
			if k == ownerLabel {
				continue
			}
			if errs := validation.IsQualifiedName(k); len(errs) > 0 {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid metadata label key %q: %s", k, strings.Join(errs, "; ")))
				return
			}
			if text, ok := v.(string); ok {
				obj.GetLabels()[k] = safeLabelValue(text)
			}
		}
	}
	if err := unstructured.SetNestedMap(obj.Object, spec, "spec"); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid workflow spec: %v", err))
		return
	}
	if err := s.client.Create(r.Context(), obj); err != nil {
		writeError(w, statusCodeForKubernetesError(err), fmt.Sprintf("creating workflow CR: %v", err))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"name":      obj.GetName(),
		"namespace": obj.GetNamespace(),
		"owner":     owner,
	})
}

func (s *server) listWorkflows(w http.ResponseWriter, r *http.Request) {
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   workflowGVK.Group,
		Version: workflowGVK.Version,
		Kind:    "WorkflowList",
	})
	if err := s.client.List(r.Context(), list, client.InNamespace(s.namespace)); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("listing workflows: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, list.Object)
}

func (s *server) getWorkflow(w http.ResponseWriter, r *http.Request, name string) {
	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(workflowGVK)
	if err := s.client.Get(r.Context(), client.ObjectKey{Namespace: s.namespace, Name: name}, obj); err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("workflow %q not found", name))
		return
	}
	writeJSON(w, http.StatusOK, obj.Object)
}

func (s *server) deleteWorkflow(w http.ResponseWriter, r *http.Request, name string) {
	obj := &unstructured.Unstructured{}
	obj.SetGroupVersionKind(workflowGVK)
	obj.SetNamespace(s.namespace)
	obj.SetName(name)
	if err := s.client.Delete(r.Context(), obj); err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("workflow %q not found", name))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
}

func (s *server) authorized(w http.ResponseWriter, r *http.Request) bool {
	if bearerPrincipal(r) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	return true
}

func decodeSubmitRequest(body io.Reader) (*submitWorkflowRequest, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 1<<20))
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, fmt.Errorf("empty body")
	}
	if !json.Valid(raw) {
		raw, err = yaml.YAMLToJSON(raw)
		if err != nil {
			return nil, err
		}
	}
	req := &submitWorkflowRequest{}
	if err := json.Unmarshal(raw, req); err != nil {
		return nil, err
	}
	return req, nil
}

func reqSpec(req *submitWorkflowRequest) (map[string]any, error) {
	if len(req.Workflow) > 0 {
		return legacyWorkflowSpec(req)
	}
	spec := req.Spec
	if len(spec) == 0 {
		spec = map[string]any{}
		if req.ClusterID != "" {
			spec["clusterID"] = req.ClusterID
		}
		if req.Namespace != "" {
			spec["namespace"] = req.Namespace
		}
		if req.Mode != "" {
			spec["mode"] = req.Mode
		}
		if req.Owner != "" {
			spec["owner"] = req.Owner
		}
		if req.Pool != "" {
			spec["pool"] = req.Pool
		}
		if req.Priority != "" {
			spec["priority"] = req.Priority
		}
		if req.RuntimeType != "" {
			spec["runtimeType"] = req.RuntimeType
		}
		if req.WorkflowID != "" {
			spec["workflowID"] = req.WorkflowID
		}
		if req.WorkflowName != "" {
			spec["workflowName"] = req.WorkflowName
		}
		if len(req.TaskGroups) > 0 {
			taskGroups := make([]any, 0, len(req.TaskGroups))
			for _, group := range req.TaskGroups {
				taskGroups = append(taskGroups, group)
			}
			spec["taskGroups"] = taskGroups
		}
	}
	if anyString(spec["clusterID"]) == "" {
		return nil, fmt.Errorf("workflow spec.clusterID is required")
	}
	if anyString(spec["namespace"]) == "" {
		return nil, fmt.Errorf("workflow spec.namespace is required for phase1a backend namespace isolation")
	}
	taskGroups, ok := spec["taskGroups"].([]any)
	if !ok || len(taskGroups) == 0 {
		return nil, fmt.Errorf("workflow must contain at least one taskGroup")
	}
	return spec, nil
}

func legacyWorkflowSpec(req *submitWorkflowRequest) (map[string]any, error) {
	workflow := req.Workflow
	tasks, ok := workflow["tasks"].([]any)
	if !ok || len(tasks) == 0 {
		return nil, fmt.Errorf("legacy workflow.tasks requires at least one task")
	}
	workflowName := anyString(workflow["name"])
	if workflowName == "" {
		workflowName = req.WorkflowName
	}
	if workflowName == "" {
		workflowName = "legacy-osmo-workflow"
	}
	clusterID := firstString(req.ClusterID, "osmo-backend")
	namespace := firstString(req.Namespace, "osmo-phase1a")
	mode := firstString(req.Mode, taskgroupv1alpha1.ModeActive)
	resources, _ := workflow["resources"].(map[string]any)
	taskGroups := make([]any, 0, len(tasks))
	submissionSuffix := legacySubmissionSuffix()
	for _, rawTask := range tasks {
		task, ok := rawTask.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("legacy workflow.tasks entries must be objects")
		}
		group, err := legacyTaskGroup(workflowName, submissionSuffix, resources, task)
		if err != nil {
			return nil, err
		}
		taskGroups = append(taskGroups, group)
	}
	spec := map[string]any{
		"clusterID":    clusterID,
		"namespace":    namespace,
		"mode":         mode,
		"owner":        req.Owner,
		"pool":         req.Pool,
		"priority":     req.Priority,
		"runtimeType":  taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup,
		"workflowName": workflowName,
		"source": map[string]any{
			"format": "osmo.workflow/v2",
		},
		"taskGroups": taskGroups,
	}
	return spec, nil
}

func legacyTaskGroup(workflowName string, submissionSuffix string, resources map[string]any, task map[string]any) (map[string]any, error) {
	taskName := anyString(task["name"])
	if taskName == "" {
		return nil, fmt.Errorf("legacy workflow task requires name")
	}
	for _, unsupported := range []string{"files", "inputs", "outputs", "credentials", "downloadType", "exitActions"} {
		if _, found := task[unsupported]; found {
			return nil, fmt.Errorf("legacy workflow task %q uses unsupported field %q in phase1a compatibility adapter", taskName, unsupported)
		}
	}
	image := anyString(task["image"])
	if image == "" {
		return nil, fmt.Errorf("legacy workflow task %q requires image", taskName)
	}
	podName := k8sName(workflowName + "-" + taskName + "-" + submissionSuffix)
	container := map[string]any{
		"name":  "user",
		"image": image,
	}
	if command, err := stringList(task["command"]); err != nil {
		return nil, fmt.Errorf("legacy workflow task %q command: %w", taskName, err)
	} else if len(command) > 0 {
		container["command"] = command
	}
	if args, err := stringList(task["args"]); err != nil {
		return nil, fmt.Errorf("legacy workflow task %q args: %w", taskName, err)
	} else if len(args) > 0 {
		container["args"] = args
	}
	if env, err := legacyEnv(task["environment"]); err != nil {
		return nil, fmt.Errorf("legacy workflow task %q environment: %w", taskName, err)
	} else if len(env) > 0 {
		container["env"] = env
	}
	if resourceSpec := legacyResource(resources, anyString(task["resource"])); len(resourceSpec) > 0 {
		container["resources"] = resourceSpec
	}
	pod := map[string]any{
		"apiVersion": "v1",
		"kind":       "Pod",
		"metadata": map[string]any{
			"name": podName,
			"labels": map[string]any{
				"workflow.osmo.nvidia.com/runtime-type":  taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup,
				"workflow.osmo.nvidia.com/workflow-name": workflowName,
				"workflow.osmo.nvidia.com/group-name":    taskName,
			},
		},
		"spec": map[string]any{
			"restartPolicy": "Never",
			"containers": []any{
				container,
			},
		},
	}
	return map[string]any{
		"name":        taskName,
		"runtimeType": taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup,
		"runtimeConfig": map[string]any{
			taskgroupv1alpha1.RuntimeTypeOSMOContainerGroup: map[string]any{
				"tasks": []any{
					map[string]any{
						"name":    taskName,
						"podName": podName,
						"lead":    true,
					},
				},
				"renderedObjects": []any{pod},
			},
		},
	}, nil
}

func legacyResource(resources map[string]any, resourceName string) map[string]any {
	if resourceName == "" {
		resourceName = "default"
	}
	raw, _ := resources[resourceName].(map[string]any)
	if len(raw) == 0 {
		return nil
	}
	requests := map[string]any{}
	limits := map[string]any{}
	if value := resourceQuantity(raw["cpu"]); value != "" {
		requests["cpu"] = value
	}
	if value := resourceQuantity(raw["memory"]); value != "" {
		requests["memory"] = value
	}
	if value := resourceQuantity(raw["storage"]); value != "" {
		requests["ephemeral-storage"] = value
	}
	if value := resourceQuantity(raw["gpu"]); value != "" {
		limits["nvidia.com/gpu"] = value
	}
	out := map[string]any{}
	if len(requests) > 0 {
		out["requests"] = requests
	}
	if len(limits) > 0 {
		out["limits"] = limits
	}
	return out
}

func legacyEnv(raw any) ([]any, error) {
	if raw == nil {
		return nil, nil
	}
	envMap, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("must be a map")
	}
	env := make([]any, 0, len(envMap))
	for name, value := range envMap {
		env = append(env, map[string]any{"name": name, "value": fmt.Sprint(value)})
	}
	return env, nil
}

func stringList(raw any) ([]any, error) {
	switch value := raw.(type) {
	case nil:
		return nil, nil
	case string:
		return []any{value}, nil
	case []any:
		out := make([]any, 0, len(value))
		for _, item := range value {
			text, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("entries must be strings")
			}
			out = append(out, text)
		}
		return out, nil
	default:
		return nil, fmt.Errorf("must be a string or string array")
	}
}

func resourceQuantity(raw any) string {
	switch value := raw.(type) {
	case nil:
		return ""
	case string:
		return value
	case float64:
		if value == float64(int64(value)) {
			return fmt.Sprintf("%d", int64(value))
		}
		return fmt.Sprintf("%g", value)
	default:
		return fmt.Sprint(value)
	}
}

func legacySubmissionSuffix() string {
	var bytes [4]byte
	if _, err := rand.Read(bytes[:]); err == nil {
		return hex.EncodeToString(bytes[:])
	}
	return fmt.Sprintf("%x", time.Now().UnixNano())
}

func bearerPrincipal(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return ""
	}
	return strings.TrimSpace(auth[len("Bearer "):])
}

func firstString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func metadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, _ := metadata[key].(string)
	return value
}

func anyString(value any) string {
	text, _ := value.(string)
	return text
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func statusCodeForKubernetesError(err error) int {
	switch {
	case apierrors.IsInvalid(err), apierrors.IsBadRequest(err):
		return http.StatusBadRequest
	case apierrors.IsAlreadyExists(err):
		return http.StatusConflict
	case apierrors.IsForbidden(err), apierrors.IsUnauthorized(err):
		return http.StatusForbidden
	default:
		return http.StatusInternalServerError
	}
}

var labelChars = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

func safeLabelValue(value string) string {
	value = strings.Trim(labelChars.ReplaceAllString(value, "-"), "-_.")
	if value == "" {
		return ""
	}
	if len(value) <= 63 && len(validation.IsValidLabelValue(value)) == 0 {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	suffix := hex.EncodeToString(sum[:])[:12]
	prefix := value
	if len(prefix) > 50 {
		prefix = prefix[:50]
	}
	prefix = strings.Trim(prefix, "-_.")
	if prefix == "" {
		return "owner-" + suffix
	}
	out := prefix + "-" + suffix
	if len(out) > 63 {
		out = out[:63]
	}
	return strings.Trim(out, "-_.")
}

func k8sName(value string) string {
	value = strings.ToLower(labelChars.ReplaceAllString(value, "-"))
	value = strings.Trim(value, "-.")
	if value == "" {
		return "legacy-task"
	}
	if len(value) <= 63 {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	suffix := hex.EncodeToString(sum[:])[:12]
	prefix := strings.Trim(value[:50], "-.")
	if prefix == "" {
		return "legacy-" + suffix
	}
	return prefix + "-" + suffix
}
