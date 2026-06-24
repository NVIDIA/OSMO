package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/yaml"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/metadata"
)

const (
	apiGroup                 = "spikego.osmo.nvidia.com"
	apiVersion               = "v1alpha1"
	finalizer                = "spikego.osmo.nvidia.com/cleanup"
	submittedByAnnotation    = "spikego.osmo.nvidia.com/submitted-by"
	cleanupPendingAnnotation = "spikego.osmo.nvidia.com/cleanup-pending-targets"
	labelWorkflow            = "spikego.osmo.nvidia.com/workflow"
	labelTaskGroup           = "spikego.osmo.nvidia.com/taskgroup"
	labelRole                = "spikego.osmo.nvidia.com/role"
	labelManagedBy           = "app.kubernetes.io/managed-by"
	managedBy                = "osmo-go-spike"
	defaultClusterID         = "osmo-backend"
	defaultRuntimeNamespace  = "osmo-phase1a-go"
)

var (
	workflowGVR   = schema.GroupVersionResource{Group: apiGroup, Version: apiVersion, Resource: "osmoworkflows"}
	taskGroupGVR  = schema.GroupVersionResource{Group: apiGroup, Version: apiVersion, Resource: "osmotaskgroups"}
	clusterGVR    = schema.GroupVersionResource{Group: apiGroup, Version: apiVersion, Resource: "osmoclusters"}
	poolGVR       = schema.GroupVersionResource{Group: apiGroup, Version: apiVersion, Resource: "osmopools"}
	configMapGVR  = schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"}
	jobGVR        = schema.GroupVersionResource{Group: "batch", Version: "v1", Resource: "jobs"}
	rayJobGVR     = schema.GroupVersionResource{Group: "ray.io", Version: "v1", Resource: "rayjobs"}
	rayClusterGVR = schema.GroupVersionResource{Group: "ray.io", Version: "v1", Resource: "rayclusters"}
)

type jsonCodec struct{}

func (jsonCodec) Marshal(v any) ([]byte, error)   { return json.Marshal(v) }
func (jsonCodec) Unmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
func (jsonCodec) Name() string                    { return "json" }

type apiPolicyEntry struct {
	Token   string   `json:"token"`
	Subject string   `json:"subject"`
	Pools   []string `json:"pools"`
}

type apiSubmitRequest struct {
	File                  string   `json:"file"`
	SetVariables          []string `json:"set_variables"`
	SetStringVariables    []string `json:"set_string_variables"`
	UploadedTemplatedSpec string   `json:"uploaded_templated_spec"`
}

type sessionEnvelope struct {
	Kind       string              `json:"kind"`
	ClusterID  string              `json:"clusterID,omitempty"`
	TaskGroups []taskGroupSnapshot `json:"taskGroups,omitempty"`
	Cleanup    []cleanupTarget     `json:"cleanup,omitempty"`
	Status     *taskGroupStatus    `json:"status,omitempty"`
	CleanupAck *cleanupAck         `json:"cleanupAck,omitempty"`
	Message    string              `json:"message,omitempty"`
}

type taskGroupSnapshot struct {
	Name            string           `json:"name"`
	Namespace       string           `json:"namespace"`
	UID             string           `json:"uid"`
	Generation      int64            `json:"generation"`
	WorkflowName    string           `json:"workflowName"`
	WorkflowUID     string           `json:"workflowUID"`
	GroupName       string           `json:"groupName"`
	RuntimeType     string           `json:"runtimeType"`
	RuntimeConfig   map[string]any   `json:"runtimeConfig,omitempty"`
	RenderedObjects []map[string]any `json:"renderedObjects,omitempty"`
	ClusterID       string           `json:"clusterID"`
	TargetNamespace string           `json:"targetNamespace"`
	PoolRef         string           `json:"poolRef,omitempty"`
}

type taskGroupStatus struct {
	ClusterID    string `json:"clusterID"`
	Namespace    string `json:"namespace"`
	Name         string `json:"name"`
	WorkflowName string `json:"workflowName"`
	WorkflowUID  string `json:"workflowUID"`
	TaskGroupUID string `json:"taskGroupUID"`
	Generation   int64  `json:"generation"`
	Phase        string `json:"phase"`
	Message      string `json:"message,omitempty"`
}

type cleanupTarget struct {
	WorkflowName string `json:"workflowName"`
	WorkflowUID  string `json:"workflowUID"`
	ClusterID    string `json:"clusterID"`
	Namespace    string `json:"namespace"`
}

type cleanupAck struct {
	WorkflowName string `json:"workflowName"`
	WorkflowUID  string `json:"workflowUID"`
	ClusterID    string `json:"clusterID"`
	Namespace    string `json:"namespace"`
	OK           bool   `json:"ok"`
	Message      string `json:"message,omitempty"`
}

type controlState struct {
	client       dynamic.Interface
	kube         kubernetes.Interface
	namespace    string
	clusterToken string
	apiPolicy    map[string]apiPolicyEntry

	mu       sync.RWMutex
	desired  map[string][]taskGroupSnapshot
	cleanup  map[string][]cleanupTarget
	statuses map[string]taskGroupStatus
}

func main() {
	encoding.RegisterCodec(jsonCodec{})
	role := getenv("OSMO_SPIKE_ROLE", "control")
	ctx := context.Background()
	cfg, err := kubeConfig()
	if err != nil {
		log.Fatalf("kube config: %v", err)
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		log.Fatalf("dynamic client: %v", err)
	}
	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		log.Fatalf("kube client: %v", err)
	}
	switch role {
	case "control":
		if err := runControl(ctx, dyn, kube); err != nil {
			log.Fatalf("control failed: %v", err)
		}
	case "backend":
		if err := runBackend(ctx, dyn); err != nil {
			log.Fatalf("backend failed: %v", err)
		}
	default:
		log.Fatalf("unsupported OSMO_SPIKE_ROLE %q", role)
	}
}

func kubeConfig() (*rest.Config, error) {
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	loading := clientcmd.NewDefaultClientConfigLoadingRules()
	overrides := &clientcmd.ConfigOverrides{}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loading, overrides).ClientConfig()
}

func runControl(ctx context.Context, dyn dynamic.Interface, kube kubernetes.Interface) error {
	state := &controlState{
		client:       dyn,
		kube:         kube,
		namespace:    getenv("CONTROL_NAMESPACE", "osmo-exp"),
		clusterToken: strings.TrimSpace(os.Getenv("CLUSTER_TOKEN")),
		apiPolicy:    loadAPIPolicy(),
		desired:      map[string][]taskGroupSnapshot{},
		cleanup:      map[string][]cleanupTarget{},
		statuses:     map[string]taskGroupStatus{},
	}
	if err := ensureDefaultPlacement(ctx, dyn, state.namespace); err != nil {
		return err
	}

	operatorBind := getenv("OPERATOR_BIND", "0.0.0.0:50051")
	apiBind := getenv("API_BIND", "0.0.0.0:8080")
	go func() {
		if err := serveOperator(ctx, state, operatorBind); err != nil {
			log.Fatalf("operator service: %v", err)
		}
	}()
	go func() {
		if err := serveAPI(ctx, state, apiBind); err != nil {
			log.Fatalf("api server: %v", err)
		}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := reconcileControl(ctx, state); err != nil {
				log.Printf("control reconcile failed: %v", err)
			}
		}
	}
}

type clusterSessionServer struct {
	state *controlState
}

func serveOperator(ctx context.Context, state *controlState, bind string) error {
	lis, err := net.Listen("tcp", bind)
	if err != nil {
		return err
	}
	server := grpc.NewServer(grpc.ForceServerCodec(jsonCodec{}))
	RegisterClusterSessionServer(server, &clusterSessionServer{state: state})
	go func() {
		<-ctx.Done()
		server.GracefulStop()
	}()
	log.Printf("operator service listening on %s", bind)
	return server.Serve(lis)
}

func (s *clusterSessionServer) Connect(stream grpc.ServerStream) error {
	if s.state.clusterToken != "" {
		md, _ := metadata.FromIncomingContext(stream.Context())
		auth := ""
		if values := md.Get("authorization"); len(values) > 0 {
			auth = values[0]
		}
		if auth != "Bearer "+s.state.clusterToken {
			return fmt.Errorf("unauthorized cluster session")
		}
	}
	var hello sessionEnvelope
	if err := stream.RecvMsg(&hello); err != nil {
		return err
	}
	if hello.Kind != "hello" || hello.ClusterID == "" {
		return fmt.Errorf("first ClusterSession message must be hello with clusterID")
	}
	clusterID := hello.ClusterID
	log.Printf("cluster session connected cluster=%s", clusterID)

	errCh := make(chan error, 1)
	go func() {
		for {
			var msg sessionEnvelope
			if err := stream.RecvMsg(&msg); err != nil {
				errCh <- err
				return
			}
			switch msg.Kind {
			case "status":
				if msg.Status != nil {
					s.handleStatus(stream.Context(), *msg.Status)
				}
			case "cleanupAck":
				if msg.CleanupAck != nil {
					s.handleCleanupAck(stream.Context(), *msg.CleanupAck)
				}
			}
		}
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return stream.Context().Err()
		case err := <-errCh:
			return err
		case <-ticker.C:
			s.state.mu.RLock()
			desired := append([]taskGroupSnapshot(nil), s.state.desired[clusterID]...)
			cleanup := append([]cleanupTarget(nil), s.state.cleanup[clusterID]...)
			s.state.mu.RUnlock()
			if err := stream.SendMsg(&sessionEnvelope{Kind: "sync", ClusterID: clusterID, TaskGroups: desired, Cleanup: cleanup}); err != nil {
				return err
			}
		}
	}
}

func (s *clusterSessionServer) handleStatus(ctx context.Context, status taskGroupStatus) {
	key := statusKey(status.ClusterID, status.Namespace, status.Name)
	s.state.mu.Lock()
	s.state.statuses[key] = status
	s.state.mu.Unlock()

	tg, err := s.state.client.Resource(taskGroupGVR).Namespace(s.state.namespace).Get(ctx, status.Name, metav1.GetOptions{})
	if err != nil {
		if !apierrors.IsNotFound(err) {
			log.Printf("get desired taskgroup for status failed: %v", err)
		}
		return
	}
	if string(tg.GetUID()) != status.TaskGroupUID || tg.GetGeneration() != status.Generation {
		log.Printf("dropped stale status taskgroup=%s statusUID=%s currentUID=%s statusGen=%d currentGen=%d", status.Name, status.TaskGroupUID, tg.GetUID(), status.Generation, tg.GetGeneration())
		return
	}
	_ = patchStatus(ctx, s.state.client, taskGroupGVR, s.state.namespace, status.Name, map[string]any{
		"phase":              status.Phase,
		"message":            status.Message,
		"observedGeneration": status.Generation,
	})
}

func (s *clusterSessionServer) handleCleanupAck(ctx context.Context, ack cleanupAck) {
	if !ack.OK {
		log.Printf("backend cleanup failed workflow=%s cluster=%s namespace=%s: %s", ack.WorkflowName, ack.ClusterID, ack.Namespace, ack.Message)
		return
	}
	wf, err := s.state.client.Resource(workflowGVR).Namespace(s.state.namespace).Get(ctx, ack.WorkflowName, metav1.GetOptions{})
	if err != nil {
		return
	}
	if string(wf.GetUID()) != ack.WorkflowUID {
		log.Printf("ignored stale cleanup ack workflow=%s", ack.WorkflowName)
		return
	}
	pending := cleanupPending(wf)
	targetKey := cleanupKey(ack.ClusterID, ack.Namespace)
	remaining := make([]string, 0, len(pending))
	for _, item := range pending {
		if item != targetKey {
			remaining = append(remaining, item)
		}
	}
	if len(remaining) > 0 {
		_ = patchMetadata(ctx, s.state.client, workflowGVR, s.state.namespace, ack.WorkflowName, map[string]string{cleanupPendingAnnotation: strings.Join(remaining, ",")}, nil)
		return
	}
	_ = deleteDesiredForWorkflow(ctx, s.state.client, s.state.namespace, ack.WorkflowName)
	_ = patchMetadata(ctx, s.state.client, workflowGVR, s.state.namespace, ack.WorkflowName, map[string]string{cleanupPendingAnnotation: ""}, []string{finalizer})
	log.Printf("cleanup ack complete workflow=%s", ack.WorkflowName)
}

func serveAPI(_ context.Context, state *controlState, bind string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("/api/pool/", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/workflow") {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		pool := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/pool/"), "/workflow")
		if pool == "" {
			http.Error(w, "pool is required", http.StatusBadRequest)
			return
		}
		subject, ok := authorizeAPI(state.apiPolicy, r.Header.Get("Authorization"), pool)
		if !ok {
			if r.Header.Get("Authorization") == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			} else {
				http.Error(w, "forbidden", http.StatusForbidden)
			}
			return
		}
		limit := int64(envInt("API_BODY_LIMIT_BYTES", 1048576))
		data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
		if err != nil || int64(len(data)) > limit {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		var req apiSubmitRequest
		if err := json.Unmarshal(data, &req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		wf, rendered, err := workflowFromOSMO(req, pool, subject)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if r.URL.Query().Get("dry_run") == "true" {
			writeJSON(w, map[string]any{"rendered": rendered})
			return
		}
		if r.URL.Query().Get("validation_only") == "true" {
			writeJSON(w, wf.Object["spec"])
			return
		}
		created, err := createOrUpdate(state.client.Resource(workflowGVR).Namespace(state.namespace), r.Context(), wf)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, created.Object)
	})
	log.Printf("api listening on %s", bind)
	return http.ListenAndServe(bind, mux)
}

func reconcileControl(ctx context.Context, state *controlState) error {
	list, err := state.client.Resource(workflowGVR).Namespace(state.namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	nextDesired := map[string][]taskGroupSnapshot{}
	nextCleanup := map[string][]cleanupTarget{}
	for i := range list.Items {
		wf := &list.Items[i]
		name := wf.GetName()
		if wf.GetDeletionTimestamp() != nil {
			targets := cleanupTargetsForWorkflow(ctx, state, wf)
			if len(targets) == 0 {
				targets = []cleanupTarget{{WorkflowName: name, WorkflowUID: string(wf.GetUID()), ClusterID: nestedStringDefault(wf.Object, []string{"spec", "clusterID"}, defaultClusterID), Namespace: nestedStringDefault(wf.Object, []string{"spec", "namespace"}, defaultRuntimeNamespace)}}
			}
			targetKeys := make([]string, 0, len(targets))
			for _, target := range targets {
				targetKeys = append(targetKeys, cleanupKey(target.ClusterID, target.Namespace))
			}
			sort.Strings(targetKeys)
			pending := cleanupPending(wf)
			sort.Strings(pending)
			if len(pending) == 0 || strings.Join(pending, ",") != strings.Join(targetKeys, ",") {
				pending = targetKeys
				_ = patchMetadata(ctx, state.client, workflowGVR, state.namespace, name, map[string]string{cleanupPendingAnnotation: strings.Join(pending, ",")}, nil)
			}
			for _, key := range pending {
				clusterID, ns := splitCleanupKey(key)
				if clusterID != "" && ns != "" {
					nextCleanup[clusterID] = append(nextCleanup[clusterID], cleanupTarget{WorkflowName: name, WorkflowUID: string(wf.GetUID()), ClusterID: clusterID, Namespace: ns})
				}
			}
			continue
		}
		if !hasFinalizer(wf, finalizer) {
			_ = patchMetadata(ctx, state.client, workflowGVR, state.namespace, name, nil, []string{finalizer})
		}
		ttlExpired, ttlErr := maybeExpireWorkflow(ctx, state.client, state.namespace, wf)
		if ttlErr != nil {
			log.Printf("ttl check failed workflow=%s: %v", name, ttlErr)
		}
		if ttlExpired {
			continue
		}
		snapshots, err := reconcileWorkflow(ctx, state, wf)
		if err != nil {
			_ = patchStatus(ctx, state.client, workflowGVR, state.namespace, name, map[string]any{"phase": "Failed", "message": err.Error(), "observedGeneration": wf.GetGeneration()})
			continue
		}
		for _, snapshot := range snapshots {
			nextDesired[snapshot.ClusterID] = append(nextDesired[snapshot.ClusterID], snapshot)
		}
	}
	state.mu.Lock()
	state.desired = nextDesired
	state.cleanup = nextCleanup
	state.mu.Unlock()
	return nil
}

func reconcileWorkflow(ctx context.Context, state *controlState, wf *unstructured.Unstructured) ([]taskGroupSnapshot, error) {
	taskGroups, ok, err := unstructured.NestedSlice(wf.Object, "spec", "taskGroups")
	if err != nil || !ok || len(taskGroups) == 0 {
		return nil, fmt.Errorf("spec.taskGroups is required")
	}
	var snapshots []taskGroupSnapshot
	phase := "Succeeded"
	message := "desired taskgroups recorded and synced via ClusterSession"
	for _, raw := range taskGroups {
		tg, ok := raw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("taskGroup must be an object")
		}
		groupName := stringValue(tg["name"])
		if groupName == "" {
			return nil, fmt.Errorf("taskGroup.name is required")
		}
		runtimeType := stringValue(tg["runtimeType"])
		if !validRuntime(runtimeType) {
			return nil, fmt.Errorf("unsupported runtimeType %q", runtimeType)
		}
		clusterID := nestedStringDefault(wf.Object, []string{"spec", "clusterID"}, defaultClusterID)
		targetNamespace := nestedStringDefault(wf.Object, []string{"spec", "namespace"}, defaultRuntimeNamespace)
		poolRef := stringValue(tg["poolRef"])
		if poolRef != "" {
			resolvedCluster, resolvedNS, err := resolvePool(ctx, state.client, state.namespace, poolRef)
			if err != nil {
				return nil, err
			}
			clusterID, targetNamespace = resolvedCluster, resolvedNS
		}
		name := safeName(wf.GetName() + "-" + groupName)
		renderedObjects, _ := normalizeObjectSlice(tg["renderedObjects"])
		runtimeConfig, _ := tg["runtimeConfig"].(map[string]any)
		desired := &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": apiGroup + "/" + apiVersion,
			"kind":       "OSMOTaskGroup",
			"metadata": map[string]any{
				"name":      name,
				"namespace": state.namespace,
				"labels":    map[string]any{labelWorkflow: wf.GetName(), labelTaskGroup: groupName, labelRole: "desired", labelManagedBy: managedBy},
			},
			"spec": map[string]any{
				"workflowName":    wf.GetName(),
				"workflowUid":     string(wf.GetUID()),
				"groupName":       groupName,
				"clusterID":       clusterID,
				"targetNamespace": targetNamespace,
				"runtimeType":     runtimeType,
				"runtimeConfig":   runtimeConfig,
				"renderedObjects": renderedObjects,
				"poolRef":         poolRef,
			},
		}}
		created, err := createOrUpdate(state.client.Resource(taskGroupGVR).Namespace(state.namespace), ctx, desired)
		if err != nil {
			return nil, err
		}
		statusPhase, _, _ := unstructured.NestedString(created.Object, "status", "phase")
		if statusPhase == "Failed" {
			phase = "Failed"
			message = nestedStringDefault(created.Object, []string{"status", "message"}, "taskgroup failed")
		} else if statusPhase == "" || statusPhase == "Pending" || statusPhase == "Running" {
			if phase != "Failed" {
				phase = "Running"
			}
		}
		snapshots = append(snapshots, snapshotFromTaskGroup(created))
	}
	currentPhase := nestedStringDefault(wf.Object, []string{"status", "phase"}, "")
	currentCompletion := nestedStringDefault(wf.Object, []string{"status", "completionTime"}, "")
	status := map[string]any{"phase": phase, "message": message, "observedGeneration": wf.GetGeneration()}
	if phase == "Succeeded" || phase == "Failed" {
		if currentCompletion == "" || currentPhase != phase {
			status["completionTime"] = time.Now().UTC().Format(time.RFC3339)
		}
	} else if currentCompletion != "" {
		status["completionTime"] = nil
	}
	_ = patchStatus(ctx, state.client, workflowGVR, state.namespace, wf.GetName(), status)
	return snapshots, nil
}

func snapshotFromTaskGroup(tg *unstructured.Unstructured) taskGroupSnapshot {
	spec, _, _ := unstructured.NestedMap(tg.Object, "spec")
	rendered, _ := normalizeObjectSlice(spec["renderedObjects"])
	cfg, _ := spec["runtimeConfig"].(map[string]any)
	return taskGroupSnapshot{
		Name: tg.GetName(), Namespace: tg.GetNamespace(), UID: string(tg.GetUID()), Generation: tg.GetGeneration(),
		WorkflowName: stringValue(spec["workflowName"]), WorkflowUID: stringValue(spec["workflowUid"]), GroupName: stringValue(spec["groupName"]),
		RuntimeType: stringValue(spec["runtimeType"]), RuntimeConfig: cfg, RenderedObjects: rendered,
		ClusterID: stringValue(spec["clusterID"]), TargetNamespace: stringValue(spec["targetNamespace"]), PoolRef: stringValue(spec["poolRef"]),
	}
}

func runBackend(ctx context.Context, dyn dynamic.Interface) error {
	clusterID := getenv("CLUSTER_ID", defaultClusterID)
	namespace := getenv("BACKEND_NAMESPACE", defaultRuntimeNamespace)
	operatorURL := strings.TrimRight(os.Getenv("OPERATOR_URL"), "/")
	if operatorURL == "" {
		return fmt.Errorf("OPERATOR_URL is required")
	}
	token := strings.TrimSpace(os.Getenv("CLUSTER_TOKEN"))
	for {
		if err := runBackendSession(ctx, dyn, clusterID, namespace, operatorURL, token); err != nil {
			log.Printf("backend session ended: %v", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

func runBackendSession(ctx context.Context, dyn dynamic.Interface, clusterID, namespace, operatorURL, token string) error {
	conn, err := grpcDial(operatorURL, getenv("OPERATOR_AUTHORITY", ""))
	if err != nil {
		return err
	}
	defer conn.Close()
	client := NewClusterSessionClient(conn)
	md := metadata.MD{}
	if token != "" {
		md.Set("authorization", "Bearer "+token)
	}
	stream, err := client.Connect(metadata.NewOutgoingContext(ctx, md))
	if err != nil {
		return err
	}
	if err := stream.Send(&sessionEnvelope{Kind: "hello", ClusterID: clusterID}); err != nil {
		return err
	}
	statusTicker := time.NewTicker(5 * time.Second)
	defer statusTicker.Stop()
	var lastDesired []taskGroupSnapshot
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-statusTicker.C:
			for _, status := range collectBackendStatuses(ctx, dyn, namespace, clusterID) {
				_ = stream.Send(&sessionEnvelope{Kind: "status", ClusterID: clusterID, Status: &status})
			}
		default:
		}
		msg, err := stream.Recv()
		if err != nil {
			return err
		}
		if msg.Kind != "sync" {
			continue
		}
		if err := applyBackendSync(ctx, dyn, namespace, clusterID, msg.TaskGroups, msg.Cleanup, stream); err != nil {
			log.Printf("apply backend sync failed: %v", err)
		}
		lastDesired = msg.TaskGroups
		for _, snapshot := range lastDesired {
			status := statusForSnapshot(ctx, dyn, namespace, clusterID, snapshot)
			_ = stream.Send(&sessionEnvelope{Kind: "status", ClusterID: clusterID, Status: &status})
		}
	}
}

func grpcDial(rawURL, authority string) (*grpc.ClientConn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	target := u.Host
	if target == "" {
		target = rawURL
	}
	opts := []grpc.DialOption{grpc.WithDefaultCallOptions(grpc.ForceCodec(jsonCodec{}))}
	if u.Scheme == "https" {
		if !strings.Contains(target, ":") {
			target += ":443"
		}
		serverName := authority
		if serverName == "" {
			serverName = u.Hostname()
		}
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{ServerName: serverName})))
	} else {
		if u.Scheme == "http" && !strings.Contains(target, ":") {
			target += ":80"
		}
		opts = append(opts, grpc.WithInsecure())
	}
	if authority != "" {
		opts = append(opts, grpc.WithAuthority(authority))
	}
	return grpc.DialContext(context.Background(), target, opts...)
}

func applyBackendSync(ctx context.Context, dyn dynamic.Interface, namespace, clusterID string, desired []taskGroupSnapshot, cleanup []cleanupTarget, stream ClusterSession_ConnectClient) error {
	for _, target := range cleanup {
		if target.ClusterID != clusterID {
			continue
		}
		err := cleanupWorkflowRuntime(ctx, dyn, target.Namespace, target.WorkflowName)
		ack := cleanupAck{WorkflowName: target.WorkflowName, WorkflowUID: target.WorkflowUID, ClusterID: clusterID, Namespace: target.Namespace, OK: err == nil}
		if err != nil {
			ack.Message = err.Error()
		}
		_ = stream.Send(&sessionEnvelope{Kind: "cleanupAck", ClusterID: clusterID, CleanupAck: &ack})
	}
	desiredNames := map[string]bool{}
	for _, snapshot := range desired {
		if snapshot.ClusterID != clusterID {
			continue
		}
		desiredNames[snapshot.Name] = true
		if err := applyMirror(ctx, dyn, namespace, snapshot); err != nil {
			log.Printf("apply mirror failed taskgroup=%s: %v", snapshot.Name, err)
			continue
		}
		if err := reconcileRuntime(ctx, dyn, namespace, snapshot); err != nil {
			log.Printf("reconcile runtime failed taskgroup=%s: %v", snapshot.Name, err)
		}
	}
	list, err := dyn.Resource(taskGroupGVR).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelManagedBy + "=" + managedBy})
	if err == nil {
		for i := range list.Items {
			item := &list.Items[i]
			if !desiredNames[item.GetName()] {
				_ = cleanupTaskGroupRuntime(ctx, dyn, namespace, item)
				_ = dyn.Resource(taskGroupGVR).Namespace(namespace).Delete(ctx, item.GetName(), metav1.DeleteOptions{})
			}
		}
	}
	return nil
}

func applyMirror(ctx context.Context, dyn dynamic.Interface, namespace string, snapshot taskGroupSnapshot) error {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiGroup + "/" + apiVersion,
		"kind":       "OSMOTaskGroup",
		"metadata": map[string]any{
			"name":      snapshot.Name,
			"namespace": namespace,
			"labels":    map[string]any{labelWorkflow: snapshot.WorkflowName, labelTaskGroup: snapshot.GroupName, labelRole: "mirror", labelManagedBy: managedBy},
		},
		"spec": map[string]any{
			"workflowName":        snapshot.WorkflowName,
			"workflowUid":         snapshot.WorkflowUID,
			"desiredTaskGroupUid": snapshot.UID,
			"desiredGeneration":   snapshot.Generation,
			"groupName":           snapshot.GroupName,
			"clusterID":           snapshot.ClusterID,
			"targetNamespace":     snapshot.TargetNamespace,
			"runtimeType":         snapshot.RuntimeType,
			"runtimeConfig":       snapshot.RuntimeConfig,
			"renderedObjects":     snapshot.RenderedObjects,
			"poolRef":             snapshot.PoolRef,
		},
	}}
	_, err := createOrUpdate(dyn.Resource(taskGroupGVR).Namespace(namespace), ctx, obj)
	return err
}

func reconcileRuntime(ctx context.Context, dyn dynamic.Interface, namespace string, snapshot taskGroupSnapshot) error {
	if !validRuntime(snapshot.RuntimeType) {
		return patchStatus(ctx, dyn, taskGroupGVR, namespace, snapshot.Name, map[string]any{"phase": "Failed", "message": "unsupported runtimeType " + snapshot.RuntimeType})
	}
	var desired []runtimeRef
	var err error
	switch snapshot.RuntimeType {
	case "kubernetesObjects", "osmoContainerGroup", "osmoWorkflow":
		desired, err = applyRenderedObjects(ctx, dyn, namespace, snapshot)
	case "rayJob":
		desired, err = applyRayObject(ctx, dyn, namespace, snapshot, "RayJob", rayJobGVR)
	case "rayCluster":
		desired, err = applyRayObject(ctx, dyn, namespace, snapshot, "RayCluster", rayClusterGVR)
	}
	if err != nil {
		_ = patchStatus(ctx, dyn, taskGroupGVR, namespace, snapshot.Name, map[string]any{"phase": "Failed", "message": err.Error()})
		return err
	}
	if err := pruneRuntime(ctx, dyn, namespace, snapshot, desired); err != nil {
		return err
	}
	status := statusForSnapshot(ctx, dyn, namespace, snapshot.ClusterID, snapshot)
	return patchStatus(ctx, dyn, taskGroupGVR, namespace, snapshot.Name, map[string]any{"phase": status.Phase, "message": status.Message})
}

type runtimeRef struct {
	GVR  schema.GroupVersionResource
	Kind string
	Name string
}

func applyRenderedObjects(ctx context.Context, dyn dynamic.Interface, namespace string, snapshot taskGroupSnapshot) ([]runtimeRef, error) {
	var refs []runtimeRef
	for _, rendered := range snapshot.RenderedObjects {
		obj := &unstructured.Unstructured{Object: deepCopyMap(rendered)}
		if obj.GetKind() == "" || obj.GetAPIVersion() == "" || obj.GetName() == "" {
			return nil, fmt.Errorf("rendered object requires apiVersion, kind, and metadata.name")
		}
		gvr, ok := allowedRenderedGVR(obj.GetAPIVersion(), obj.GetKind())
		if !ok {
			return nil, fmt.Errorf("rendered object %s/%s is not allowed", obj.GetAPIVersion(), obj.GetKind())
		}
		obj.SetNamespace(namespace)
		labels := obj.GetLabels()
		if labels == nil {
			labels = map[string]string{}
		}
		labels[labelWorkflow] = snapshot.WorkflowName
		labels[labelTaskGroup] = snapshot.GroupName
		labels[labelManagedBy] = managedBy
		obj.SetLabels(labels)
		if gvr == jobGVR {
			if _, err := dyn.Resource(gvr).Namespace(namespace).Get(ctx, obj.GetName(), metav1.GetOptions{}); err == nil {
				refs = append(refs, runtimeRef{GVR: gvr, Kind: obj.GetKind(), Name: obj.GetName()})
				continue
			}
		}
		if _, err := createOrUpdate(dyn.Resource(gvr).Namespace(namespace), ctx, obj); err != nil {
			return nil, err
		}
		refs = append(refs, runtimeRef{GVR: gvr, Kind: obj.GetKind(), Name: obj.GetName()})
	}
	if len(refs) == 0 {
		return nil, fmt.Errorf("no renderedObjects supplied")
	}
	return refs, nil
}

func applyRayObject(ctx context.Context, dyn dynamic.Interface, namespace string, snapshot taskGroupSnapshot, kind string, gvr schema.GroupVersionResource) ([]runtimeRef, error) {
	name := stringValue(snapshot.RuntimeConfig["name"])
	if name == "" {
		name = snapshot.Name
	}
	spec, _ := snapshot.RuntimeConfig["spec"].(map[string]any)
	if len(spec) == 0 {
		return nil, fmt.Errorf("%s runtimeConfig.spec is required", kind)
	}
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "ray.io/v1",
		"kind":       kind,
		"metadata": map[string]any{
			"name":      name,
			"namespace": namespace,
			"labels":    map[string]any{labelWorkflow: snapshot.WorkflowName, labelTaskGroup: snapshot.GroupName, labelManagedBy: managedBy},
		},
		"spec": spec,
	}}
	if _, err := createOrUpdate(dyn.Resource(gvr).Namespace(namespace), ctx, obj); err != nil {
		return nil, err
	}
	return []runtimeRef{{GVR: gvr, Kind: kind, Name: name}}, nil
}

func pruneRuntime(ctx context.Context, dyn dynamic.Interface, namespace string, snapshot taskGroupSnapshot, desired []runtimeRef) error {
	keep := map[string]bool{}
	for _, ref := range desired {
		keep[ref.GVR.String()+"/"+ref.Name] = true
	}
	for _, ref := range []runtimeRef{{GVR: configMapGVR}, {GVR: jobGVR}, {GVR: rayJobGVR}, {GVR: rayClusterGVR}} {
		list, err := dyn.Resource(ref.GVR).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: fmt.Sprintf("%s=%s,%s=%s,%s=%s", labelManagedBy, managedBy, labelWorkflow, snapshot.WorkflowName, labelTaskGroup, snapshot.GroupName)})
		if err != nil {
			continue
		}
		for i := range list.Items {
			item := &list.Items[i]
			if !keep[ref.GVR.String()+"/"+item.GetName()] {
				_ = dyn.Resource(ref.GVR).Namespace(namespace).Delete(ctx, item.GetName(), metav1.DeleteOptions{})
			}
		}
	}
	return nil
}

func statusForSnapshot(ctx context.Context, dyn dynamic.Interface, namespace, clusterID string, snapshot taskGroupSnapshot) taskGroupStatus {
	status := taskGroupStatus{ClusterID: clusterID, Namespace: namespace, Name: snapshot.Name, WorkflowName: snapshot.WorkflowName, WorkflowUID: snapshot.WorkflowUID, TaskGroupUID: snapshot.UID, Generation: snapshot.Generation, Phase: "Succeeded", Message: "runtime reconciled"}
	switch snapshot.RuntimeType {
	case "rayJob":
		name := stringValue(snapshot.RuntimeConfig["name"])
		if name == "" {
			name = snapshot.Name
		}
		obj, err := dyn.Resource(rayJobGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			status.Phase = "Running"
			status.Message = "waiting for RayJob"
			return status
		}
		jobStatus, _, _ := unstructured.NestedString(obj.Object, "status", "jobStatus")
		switch jobStatus {
		case "SUCCEEDED":
		case "FAILED":
			status.Phase = "Failed"
			status.Message = "RayJob failed"
		default:
			status.Phase = "Running"
			if jobStatus == "" {
				status.Message = "waiting for RayJob status"
			} else {
				status.Message = "RayJob status " + jobStatus
			}
		}
	case "rayCluster":
		name := stringValue(snapshot.RuntimeConfig["name"])
		if name == "" {
			name = snapshot.Name
		}
		if _, err := dyn.Resource(rayClusterGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{}); err != nil {
			status.Phase = "Running"
			status.Message = "waiting for RayCluster"
		}
	default:
		for _, rendered := range snapshot.RenderedObjects {
			kind := stringValue(rendered["kind"])
			apiVersion := stringValue(rendered["apiVersion"])
			meta, _ := rendered["metadata"].(map[string]any)
			name := stringValue(meta["name"])
			gvr, ok := allowedRenderedGVR(apiVersion, kind)
			if !ok || name == "" {
				status.Phase = "Failed"
				status.Message = "invalid rendered object"
				return status
			}
			obj, err := dyn.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				status.Phase = "Running"
				status.Message = "waiting for rendered object"
				return status
			}
			if gvr == jobGVR {
				succeeded, _, _ := unstructured.NestedInt64(obj.Object, "status", "succeeded")
				failed, _, _ := unstructured.NestedInt64(obj.Object, "status", "failed")
				if failed > 0 {
					status.Phase = "Failed"
					status.Message = "job failed"
					return status
				}
				if succeeded < 1 {
					status.Phase = "Running"
					status.Message = "waiting for job completion"
					return status
				}
			}
		}
	}
	return status
}

func collectBackendStatuses(ctx context.Context, dyn dynamic.Interface, namespace, clusterID string) []taskGroupStatus {
	list, err := dyn.Resource(taskGroupGVR).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelManagedBy + "=" + managedBy})
	if err != nil {
		return nil
	}
	var statuses []taskGroupStatus
	for i := range list.Items {
		item := &list.Items[i]
		spec, _, _ := unstructured.NestedMap(item.Object, "spec")
		snapshot := taskGroupSnapshot{
			Name: item.GetName(), Namespace: namespace, UID: stringValue(spec["desiredTaskGroupUid"]), Generation: int64Value(spec["desiredGeneration"]),
			WorkflowName: stringValue(spec["workflowName"]), WorkflowUID: stringValue(spec["workflowUid"]), GroupName: stringValue(spec["groupName"]),
			RuntimeType: stringValue(spec["runtimeType"]), ClusterID: stringValue(spec["clusterID"]), TargetNamespace: stringValue(spec["targetNamespace"]),
		}
		snapshot.RuntimeConfig, _ = spec["runtimeConfig"].(map[string]any)
		snapshot.RenderedObjects, _ = normalizeObjectSlice(spec["renderedObjects"])
		statuses = append(statuses, statusForSnapshot(ctx, dyn, namespace, clusterID, snapshot))
	}
	return statuses
}

func cleanupWorkflowRuntime(ctx context.Context, dyn dynamic.Interface, namespace, workflowName string) error {
	for _, gvr := range []schema.GroupVersionResource{configMapGVR, jobGVR, rayJobGVR, rayClusterGVR, taskGroupGVR} {
		list, err := dyn.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: fmt.Sprintf("%s=%s,%s=%s", labelManagedBy, managedBy, labelWorkflow, workflowName)})
		if err != nil {
			continue
		}
		for i := range list.Items {
			_ = dyn.Resource(gvr).Namespace(namespace).Delete(ctx, list.Items[i].GetName(), metav1.DeleteOptions{})
		}
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		remaining := 0
		for _, gvr := range []schema.GroupVersionResource{configMapGVR, jobGVR, rayJobGVR, rayClusterGVR, taskGroupGVR} {
			list, err := dyn.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: fmt.Sprintf("%s=%s,%s=%s", labelManagedBy, managedBy, labelWorkflow, workflowName)})
			if err == nil {
				remaining += len(list.Items)
			}
		}
		if remaining == 0 {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("cleanup timed out for workflow %s", workflowName)
}

func cleanupTaskGroupRuntime(ctx context.Context, dyn dynamic.Interface, namespace string, tg *unstructured.Unstructured) error {
	workflow := tg.GetLabels()[labelWorkflow]
	group := tg.GetLabels()[labelTaskGroup]
	for _, gvr := range []schema.GroupVersionResource{configMapGVR, jobGVR, rayJobGVR, rayClusterGVR} {
		list, err := dyn.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: fmt.Sprintf("%s=%s,%s=%s,%s=%s", labelManagedBy, managedBy, labelWorkflow, workflow, labelTaskGroup, group)})
		if err != nil {
			continue
		}
		for i := range list.Items {
			_ = dyn.Resource(gvr).Namespace(namespace).Delete(ctx, list.Items[i].GetName(), metav1.DeleteOptions{})
		}
	}
	return nil
}

func workflowFromOSMO(req apiSubmitRequest, pool, subject string) (*unstructured.Unstructured, string, error) {
	source := req.File
	if source == "" {
		source = req.UploadedTemplatedSpec
	}
	if strings.TrimSpace(source) == "" {
		return nil, "", fmt.Errorf("file is required")
	}
	context := extractDefaultValues(source)
	for _, pair := range append(req.SetVariables, req.SetStringVariables...) {
		key, value, ok := strings.Cut(pair, "=")
		if !ok || key == "" {
			return nil, "", fmt.Errorf("invalid template variable %q", pair)
		}
		context[strings.TrimSpace(key)] = value
	}
	rendered := renderJinjaLite(source, context)
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(rendered), &doc); err != nil {
		return nil, "", err
	}
	workflow, ok := doc["workflow"].(map[string]any)
	if !ok {
		return nil, "", fmt.Errorf("workflow section is required")
	}
	name := stringValue(workflow["name"])
	if name == "" {
		return nil, "", fmt.Errorf("workflow.name is required")
	}
	tasks, ok := workflow["tasks"].([]any)
	if !ok || len(tasks) == 0 {
		return nil, "", fmt.Errorf("workflow.tasks is required")
	}
	var taskGroups []any
	for _, raw := range tasks {
		task, ok := raw.(map[string]any)
		if !ok {
			return nil, "", fmt.Errorf("task must be an object")
		}
		taskName := stringValue(task["name"])
		if taskName == "" {
			return nil, "", fmt.Errorf("task.name is required")
		}
		job, err := jobForTask(name, task)
		if err != nil {
			return nil, "", err
		}
		taskGroups = append(taskGroups, map[string]any{
			"name":            taskName,
			"runtimeType":     "kubernetesObjects",
			"poolRef":         pool,
			"renderedObjects": []any{job},
		})
	}
	wf := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiGroup + "/" + apiVersion,
		"kind":       "OSMOWorkflow",
		"metadata": map[string]any{
			"name":        safeName(name),
			"annotations": map[string]any{submittedByAnnotation: subject},
		},
		"spec": map[string]any{
			"clusterID":               defaultClusterID,
			"namespace":               defaultRuntimeNamespace,
			"ttlSecondsAfterFinished": int64(300),
			"taskGroups":              taskGroups,
		},
	}}
	return wf, rendered, nil
}

func jobForTask(workflowName string, task map[string]any) (map[string]any, error) {
	taskName := stringValue(task["name"])
	image := stringValue(task["image"])
	if image == "" {
		return nil, fmt.Errorf("task %s image is required", taskName)
	}
	container := map[string]any{"name": "main", "image": image}
	if command := stringSlice(task["command"]); len(command) > 0 {
		container["command"] = command
	}
	if args := stringSlice(task["args"]); len(args) > 0 {
		container["args"] = args
	}
	if envMap, ok := task["environment"].(map[string]any); ok && len(envMap) > 0 {
		keys := make([]string, 0, len(envMap))
		for key := range envMap {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		var env []any
		for _, key := range keys {
			env = append(env, map[string]any{"name": key, "value": stringValue(envMap[key])})
		}
		container["env"] = env
	}
	return map[string]any{
		"apiVersion": "batch/v1",
		"kind":       "Job",
		"metadata":   map[string]any{"name": safeName(workflowName + "-" + taskName)},
		"spec": map[string]any{
			"backoffLimit": int64(0),
			"template": map[string]any{"spec": map[string]any{
				"restartPolicy": "Never",
				"containers":    []any{container},
			}},
		},
	}, nil
}

func ensureDefaultPlacement(ctx context.Context, dyn dynamic.Interface, namespace string) error {
	cluster := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiGroup + "/" + apiVersion,
		"kind":       "OSMOCluster",
		"metadata":   map[string]any{"name": "osmo-backend", "namespace": namespace, "labels": map[string]any{labelManagedBy: managedBy}},
		"spec":       map[string]any{"clusterID": defaultClusterID},
	}}
	if _, err := createOrUpdate(dyn.Resource(clusterGVR).Namespace(namespace), ctx, cluster); err != nil {
		return err
	}
	pool := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiGroup + "/" + apiVersion,
		"kind":       "OSMOPool",
		"metadata":   map[string]any{"name": "default", "namespace": namespace, "labels": map[string]any{labelManagedBy: managedBy}},
		"spec":       map[string]any{"clusterRef": "osmo-backend", "namespace": defaultRuntimeNamespace, "schedulerType": "none", "maintenance": false},
	}}
	_, err := createOrUpdate(dyn.Resource(poolGVR).Namespace(namespace), ctx, pool)
	return err
}

func resolvePool(ctx context.Context, dyn dynamic.Interface, namespace, poolName string) (string, string, error) {
	pool, err := dyn.Resource(poolGVR).Namespace(namespace).Get(ctx, poolName, metav1.GetOptions{})
	if err != nil {
		return "", "", fmt.Errorf("resolve pool %s: %w", poolName, err)
	}
	clusterRef := nestedStringDefault(pool.Object, []string{"spec", "clusterRef"}, "")
	targetNS := nestedStringDefault(pool.Object, []string{"spec", "namespace"}, defaultRuntimeNamespace)
	if clusterRef == "" {
		return "", "", fmt.Errorf("pool %s missing spec.clusterRef", poolName)
	}
	cluster, err := dyn.Resource(clusterGVR).Namespace(namespace).Get(ctx, clusterRef, metav1.GetOptions{})
	if err != nil {
		return "", "", fmt.Errorf("resolve cluster %s: %w", clusterRef, err)
	}
	clusterID := nestedStringDefault(cluster.Object, []string{"spec", "clusterID"}, clusterRef)
	return clusterID, targetNS, nil
}

func createOrUpdate(resource dynamic.ResourceInterface, ctx context.Context, desired *unstructured.Unstructured) (*unstructured.Unstructured, error) {
	current, err := resource.Get(ctx, desired.GetName(), metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return resource.Create(ctx, desired, metav1.CreateOptions{})
	}
	if err != nil {
		return nil, err
	}
	desired.SetResourceVersion(current.GetResourceVersion())
	desired.SetUID(current.GetUID())
	desired.SetFinalizers(current.GetFinalizers())
	if desired.GetAnnotations() == nil {
		desired.SetAnnotations(current.GetAnnotations())
	}
	if desired.GetLabels() == nil {
		desired.SetLabels(current.GetLabels())
	}
	if current.GetDeletionTimestamp() != nil {
		return current, nil
	}
	return resource.Update(ctx, desired, metav1.UpdateOptions{})
}

func patchStatus(ctx context.Context, dyn dynamic.Interface, gvr schema.GroupVersionResource, namespace, name string, status map[string]any) error {
	body, _ := json.Marshal(map[string]any{"status": status})
	_, err := dyn.Resource(gvr).Namespace(namespace).Patch(ctx, name, types.MergePatchType, body, metav1.PatchOptions{}, "status")
	return err
}

func patchMetadata(ctx context.Context, dyn dynamic.Interface, gvr schema.GroupVersionResource, namespace, name string, annotations map[string]string, addOrRemoveFinalizers []string) error {
	obj, err := dyn.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}
	if annotations != nil {
		current := obj.GetAnnotations()
		if current == nil {
			current = map[string]string{}
		}
		for key, value := range annotations {
			if value == "" {
				delete(current, key)
			} else {
				current[key] = value
			}
		}
		obj.SetAnnotations(current)
	}
	if addOrRemoveFinalizers != nil {
		current := obj.GetFinalizers()
		for _, f := range addOrRemoveFinalizers {
			if hasString(current, f) {
				current = removeString(current, f)
			} else {
				current = append(current, f)
			}
		}
		obj.SetFinalizers(current)
	}
	_, err = dyn.Resource(gvr).Namespace(namespace).Update(ctx, obj, metav1.UpdateOptions{})
	return err
}

func deleteDesiredForWorkflow(ctx context.Context, dyn dynamic.Interface, namespace, workflow string) error {
	list, err := dyn.Resource(taskGroupGVR).Namespace(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelWorkflow + "=" + workflow})
	if err != nil {
		return err
	}
	for i := range list.Items {
		_ = dyn.Resource(taskGroupGVR).Namespace(namespace).Delete(ctx, list.Items[i].GetName(), metav1.DeleteOptions{})
	}
	return nil
}

func maybeExpireWorkflow(ctx context.Context, dyn dynamic.Interface, namespace string, wf *unstructured.Unstructured) (bool, error) {
	if wf.GetDeletionTimestamp() != nil {
		return false, nil
	}
	phase := nestedStringDefault(wf.Object, []string{"status", "phase"}, "")
	if phase != "Succeeded" && phase != "Failed" {
		return false, nil
	}
	ttl, _, _ := unstructured.NestedInt64(wf.Object, "spec", "ttlSecondsAfterFinished")
	if ttl <= 0 {
		return false, nil
	}
	completed := nestedStringDefault(wf.Object, []string{"status", "completionTime"}, "")
	if completed == "" {
		return false, nil
	}
	t, err := time.Parse(time.RFC3339, completed)
	if err != nil {
		return false, err
	}
	if time.Since(t) < time.Duration(ttl)*time.Second {
		return false, nil
	}
	err = dyn.Resource(workflowGVR).Namespace(namespace).Delete(ctx, wf.GetName(), metav1.DeleteOptions{})
	return err == nil, err
}

func validRuntime(runtimeType string) bool {
	switch runtimeType {
	case "kubernetesObjects", "osmoContainerGroup", "osmoWorkflow", "rayJob", "rayCluster":
		return true
	default:
		return false
	}
}

func allowedRenderedGVR(apiVersion, kind string) (schema.GroupVersionResource, bool) {
	switch apiVersion + "/" + kind {
	case "v1/ConfigMap":
		return configMapGVR, true
	case "batch/v1/Job":
		return jobGVR, true
	default:
		return schema.GroupVersionResource{}, false
	}
}

func cleanupTargetsForWorkflow(ctx context.Context, state *controlState, wf *unstructured.Unstructured) []cleanupTarget {
	if list, err := state.client.Resource(taskGroupGVR).Namespace(state.namespace).List(ctx, metav1.ListOptions{LabelSelector: labelWorkflow + "=" + wf.GetName() + "," + labelRole + "=desired"}); err == nil {
		seen := map[string]cleanupTarget{}
		for i := range list.Items {
			spec, _, _ := unstructured.NestedMap(list.Items[i].Object, "spec")
			clusterID := stringValue(spec["clusterID"])
			ns := stringValue(spec["targetNamespace"])
			if clusterID == "" || ns == "" {
				continue
			}
			seen[cleanupKey(clusterID, ns)] = cleanupTarget{WorkflowName: wf.GetName(), WorkflowUID: string(wf.GetUID()), ClusterID: clusterID, Namespace: ns}
		}
		if len(seen) > 0 {
			targets := make([]cleanupTarget, 0, len(seen))
			for _, target := range seen {
				targets = append(targets, target)
			}
			return targets
		}
	}
	taskGroups, _, _ := unstructured.NestedSlice(wf.Object, "spec", "taskGroups")
	seen := map[string]cleanupTarget{}
	for _, raw := range taskGroups {
		tg, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		clusterID := nestedStringDefault(wf.Object, []string{"spec", "clusterID"}, defaultClusterID)
		ns := nestedStringDefault(wf.Object, []string{"spec", "namespace"}, defaultRuntimeNamespace)
		if stringValue(tg["poolRef"]) != "" {
			if resolvedCluster, resolvedNS, err := resolvePool(ctx, state.client, state.namespace, stringValue(tg["poolRef"])); err == nil {
				clusterID, ns = resolvedCluster, resolvedNS
			}
		}
		seen[cleanupKey(clusterID, ns)] = cleanupTarget{WorkflowName: wf.GetName(), WorkflowUID: string(wf.GetUID()), ClusterID: clusterID, Namespace: ns}
	}
	targets := make([]cleanupTarget, 0, len(seen))
	for _, target := range seen {
		targets = append(targets, target)
	}
	return targets
}

func cleanupPending(wf *unstructured.Unstructured) []string {
	value := wf.GetAnnotations()[cleanupPendingAnnotation]
	if value == "" {
		return nil
	}
	var out []string
	for _, item := range strings.Split(value, ",") {
		item = strings.TrimSpace(item)
		if item != "" {
			out = append(out, item)
		}
	}
	return out
}

func cleanupKey(clusterID, namespace string) string { return clusterID + "/" + namespace }

func splitCleanupKey(key string) (string, string) {
	before, after, ok := strings.Cut(key, "/")
	if !ok {
		return "", ""
	}
	return before, after
}

func statusKey(clusterID, namespace, name string) string {
	return clusterID + "/" + namespace + "/" + name
}

func loadAPIPolicy() map[string]apiPolicyEntry {
	raw := strings.TrimSpace(os.Getenv("API_AUTHZ_POLICY_JSON"))
	if raw == "" {
		return map[string]apiPolicyEntry{}
	}
	var entries []apiPolicyEntry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		log.Printf("invalid API_AUTHZ_POLICY_JSON: %v", err)
		return map[string]apiPolicyEntry{}
	}
	out := map[string]apiPolicyEntry{}
	for _, entry := range entries {
		out[entry.Token] = entry
	}
	return out
}

func authorizeAPI(policy map[string]apiPolicyEntry, authHeader, pool string) (string, bool) {
	token := strings.TrimPrefix(authHeader, "Bearer ")
	entry, ok := policy[token]
	if !ok {
		return "", false
	}
	for _, allowed := range entry.Pools {
		if allowed == pool || allowed == "*" {
			if entry.Subject == "" {
				entry.Subject = "unknown"
			}
			return entry.Subject, true
		}
	}
	return entry.Subject, false
}

func extractDefaultValues(source string) map[string]string {
	values := map[string]string{}
	lines := strings.Split(source, "\n")
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if !strings.HasSuffix(trimmed, "default-values:") {
			continue
		}
		baseIndent := len(line) - len(strings.TrimLeft(line, " "))
		for j := i + 1; j < len(lines); j++ {
			next := lines[j]
			if strings.TrimSpace(next) == "" {
				continue
			}
			indent := len(next) - len(strings.TrimLeft(next, " "))
			if indent <= baseIndent {
				break
			}
			key, value, ok := strings.Cut(strings.TrimSpace(next), ":")
			if !ok {
				continue
			}
			values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return values
}

var jinjaExpr = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_-]+)\s*\}\}`)

func renderJinjaLite(source string, context map[string]string) string {
	return jinjaExpr.ReplaceAllStringFunc(source, func(match string) string {
		groups := jinjaExpr.FindStringSubmatch(match)
		if len(groups) != 2 {
			return match
		}
		if value, ok := context[groups[1]]; ok {
			return value
		}
		return match
	})
}

func normalizeObjectSlice(value any) ([]map[string]any, error) {
	switch typed := value.(type) {
	case []map[string]any:
		return typed, nil
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			m, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("object list item must be object")
			}
			out = append(out, m)
		}
		return out, nil
	default:
		return nil, nil
	}
}

func stringSlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []string:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return nil
	}
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func nestedStringDefault(obj map[string]any, fields []string, fallback string) string {
	value, ok, _ := unstructured.NestedString(obj, fields...)
	if ok && value != "" {
		return value
	}
	return fallback
}

func hasFinalizer(obj metav1.Object, f string) bool { return hasString(obj.GetFinalizers(), f) }

func hasString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func removeString(values []string, needle string) []string {
	out := values[:0]
	for _, value := range values {
		if value != needle {
			out = append(out, value)
		}
	}
	return out
}

func safeName(input string) string {
	input = strings.ToLower(input)
	var b strings.Builder
	lastDash := false
	for _, r := range input {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func deepCopyMap(in map[string]any) map[string]any {
	data, _ := json.Marshal(in)
	out := map[string]any{}
	_ = json.Unmarshal(data, &out)
	return out
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

// Manual gRPC service/client bindings keep the spike self-contained while still
// using a real bidirectional ClusterSession stream.
type ClusterSessionServer interface {
	Connect(grpc.ServerStream) error
}

func RegisterClusterSessionServer(s grpc.ServiceRegistrar, srv ClusterSessionServer) {
	s.RegisterService(&grpc.ServiceDesc{
		ServiceName: "osmo.spikego.v1.ClusterSession",
		HandlerType: (*ClusterSessionServer)(nil),
		Streams: []grpc.StreamDesc{{
			StreamName: "Connect",
			Handler: func(srv any, stream grpc.ServerStream) error {
				return srv.(ClusterSessionServer).Connect(stream)
			},
			ServerStreams: true,
			ClientStreams: true,
		}},
	}, srv)
}

type ClusterSessionClient interface {
	Connect(ctx context.Context, opts ...grpc.CallOption) (ClusterSession_ConnectClient, error)
}

type clusterSessionClient struct{ cc grpc.ClientConnInterface }

func NewClusterSessionClient(cc grpc.ClientConnInterface) ClusterSessionClient {
	return &clusterSessionClient{cc: cc}
}

func (c *clusterSessionClient) Connect(ctx context.Context, opts ...grpc.CallOption) (ClusterSession_ConnectClient, error) {
	stream, err := c.cc.NewStream(ctx, &grpc.StreamDesc{ServerStreams: true, ClientStreams: true}, "/osmo.spikego.v1.ClusterSession/Connect", opts...)
	if err != nil {
		return nil, err
	}
	return &clusterSessionConnectClient{ClientStream: stream}, nil
}

type ClusterSession_ConnectClient interface {
	Send(*sessionEnvelope) error
	Recv() (*sessionEnvelope, error)
	grpc.ClientStream
}

type clusterSessionConnectClient struct{ grpc.ClientStream }

func (c *clusterSessionConnectClient) Send(m *sessionEnvelope) error {
	return c.ClientStream.SendMsg(m)
}

func (c *clusterSessionConnectClient) Recv() (*sessionEnvelope, error) {
	m := new(sessionEnvelope)
	if err := c.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

var _ = bytes.MinRead
var _ = errors.New
var _ = batchv1.Job{}
var _ = corev1.ConfigMap{}
