package bridge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"sync"
	"time"

	taskgroupv1alpha1 "example.com/taskgroup-phase1-standalone/api/taskgroup/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	commandStatePending   = "Pending"
	commandStateLeased    = "Leased"
	commandStateSucceeded = "Succeeded"
	commandStateFailed    = "Failed"

	dispatchRecordLabel  = "workflow.osmo.nvidia.com/dispatch-record"
	dispatchClusterLabel = "workflow.osmo.nvidia.com/cluster-id"
	dispatchStateLabel   = "workflow.osmo.nvidia.com/state"

	dispatchRecordCommand = "command"
	dispatchRecordStatus  = "status"
)

type Store interface {
	Enqueue(ctx context.Context, command Command) (string, error)
	LeaseCommands(ctx context.Context, clusterID string, now time.Time, leaseDuration time.Duration) ([]Command, error)
	CompleteCommand(ctx context.Context, result CommandResult) error
	ReportStatus(ctx context.Context, report StatusReport, now time.Time) error
	GetStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error)
}

type commandRecord struct {
	Command    Command        `json:"command"`
	State      string         `json:"state"`
	Attempts   int            `json:"attempts,omitempty"`
	LeaseUntil *metav1.Time   `json:"leaseUntil,omitempty"`
	Result     *CommandResult `json:"result,omitempty"`
	UpdatedAt  metav1.Time    `json:"updatedAt,omitempty"`
}

type MemoryStore struct {
	mu       sync.Mutex
	commands map[string]commandRecord
	statuses map[string]taskgroupv1alpha1.OSMOTaskGroupStatus
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		commands: map[string]commandRecord{},
		statuses: map[string]taskgroupv1alpha1.OSMOTaskGroupStatus{},
	}
}

func (s *MemoryStore) Enqueue(_ context.Context, command Command) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	command.ID = commandID(command)
	record, ok := s.commands[command.ID]
	if ok && record.State != commandStateFailed {
		return command.ID, nil
	}
	s.commands[command.ID] = commandRecord{Command: command, State: commandStatePending, UpdatedAt: metav1.Now()}
	return command.ID, nil
}

func (s *MemoryStore) LeaseCommands(_ context.Context, clusterID string, now time.Time, leaseDuration time.Duration) ([]Command, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := make([]string, 0, len(s.commands))
	for id := range s.commands {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	commands := []Command{}
	for _, id := range ids {
		record := s.commands[id]
		if record.Command.ClusterID != clusterID || !record.Leaseable(now) {
			continue
		}
		leaseUntil := metav1.NewTime(now.Add(leaseDuration))
		record.State = commandStateLeased
		record.LeaseUntil = &leaseUntil
		record.Attempts++
		record.UpdatedAt = metav1.Now()
		s.commands[id] = record
		commands = append(commands, record.Command)
	}
	return commands, nil
}

func (s *MemoryStore) CompleteCommand(_ context.Context, result CommandResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.commands[result.ID]
	if !ok {
		return nil
	}
	record.Result = &result
	record.UpdatedAt = metav1.Now()
	if result.OK {
		record.State = commandStateSucceeded
	} else {
		record.State = commandStateFailed
	}
	record.LeaseUntil = nil
	s.commands[result.ID] = record
	return nil
}

func (s *MemoryStore) ReportStatus(_ context.Context, report StatusReport, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := statusKey(report.ClusterID, report.Namespace, report.Name)
	if report.Deleted {
		delete(s.statuses, key)
		return nil
	}
	status := report.Status
	status.LastReportTime = metav1.NewTime(now)
	s.statuses[key] = status
	return nil
}

func (s *MemoryStore) GetStatus(_ context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	status, ok := s.statuses[statusKey(clusterID, namespace, name)]
	if !ok {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, notFoundStatus(name)
	}
	return status, nil
}

type ConfigMapStore struct {
	client    client.Client
	namespace string
}

func NewConfigMapStore(kubeClient client.Client, namespace string) *ConfigMapStore {
	return &ConfigMapStore{client: kubeClient, namespace: namespace}
}

func (s *ConfigMapStore) Enqueue(ctx context.Context, command Command) (string, error) {
	command.ID = commandID(command)
	name := commandConfigMapName(command.ID)
	existing := &corev1.ConfigMap{}
	err := s.client.Get(ctx, client.ObjectKey{Namespace: s.namespace, Name: name}, existing)
	if err == nil {
		record, err := recordFromConfigMap(existing)
		if err != nil {
			return "", err
		}
		if record.State != commandStateFailed {
			return command.ID, nil
		}
		record.Command = command
		record.State = commandStatePending
		record.Result = nil
		record.LeaseUntil = nil
		record.UpdatedAt = metav1.Now()
		applyCommandRecord(existing, record)
		return command.ID, s.client.Update(ctx, existing)
	}
	if !apierrors.IsNotFound(err) {
		return "", err
	}
	cm := commandConfigMap(command)
	cm.Namespace = s.namespace
	return command.ID, s.client.Create(ctx, cm)
}

func (s *ConfigMapStore) LeaseCommands(ctx context.Context, clusterID string, now time.Time, leaseDuration time.Duration) ([]Command, error) {
	list := &corev1.ConfigMapList{}
	if err := s.client.List(ctx, list,
		client.InNamespace(s.namespace),
		client.MatchingLabels{
			dispatchRecordLabel:  dispatchRecordCommand,
			dispatchClusterLabel: clusterID,
		},
	); err != nil {
		return nil, err
	}
	sort.Slice(list.Items, func(i, j int) bool {
		return list.Items[i].Name < list.Items[j].Name
	})
	commands := []Command{}
	for i := range list.Items {
		cm := &list.Items[i]
		record, err := recordFromConfigMap(cm)
		if err != nil {
			return nil, err
		}
		if !record.Leaseable(now) {
			continue
		}
		leaseUntil := metav1.NewTime(now.Add(leaseDuration))
		record.State = commandStateLeased
		record.LeaseUntil = &leaseUntil
		record.Attempts++
		record.UpdatedAt = metav1.Now()
		applyCommandRecord(cm, record)
		if err := s.client.Update(ctx, cm); err != nil {
			return nil, err
		}
		commands = append(commands, record.Command)
	}
	return commands, nil
}

func (s *ConfigMapStore) CompleteCommand(ctx context.Context, result CommandResult) error {
	cm := &corev1.ConfigMap{}
	err := s.client.Get(ctx, client.ObjectKey{Namespace: s.namespace, Name: commandConfigMapName(result.ID)}, cm)
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	record, err := recordFromConfigMap(cm)
	if err != nil {
		return err
	}
	record.Result = &result
	record.UpdatedAt = metav1.Now()
	if result.OK {
		record.State = commandStateSucceeded
	} else {
		record.State = commandStateFailed
	}
	record.LeaseUntil = nil
	applyCommandRecord(cm, record)
	return s.client.Update(ctx, cm)
}

func (s *ConfigMapStore) ReportStatus(ctx context.Context, report StatusReport, now time.Time) error {
	name := statusConfigMapName(report.ClusterID, report.Namespace, report.Name)
	if report.Deleted {
		cm := &corev1.ConfigMap{}
		err := s.client.Get(ctx, client.ObjectKey{Namespace: s.namespace, Name: name}, cm)
		if apierrors.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return err
		}
		return s.client.Delete(ctx, cm)
	}
	status := report.Status
	status.LastReportTime = metav1.NewTime(now)
	data, err := json.Marshal(status)
	if err != nil {
		return err
	}
	cm := &corev1.ConfigMap{}
	err = s.client.Get(ctx, client.ObjectKey{Namespace: s.namespace, Name: name}, cm)
	if apierrors.IsNotFound(err) {
		cm = &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      name,
				Namespace: s.namespace,
				Labels: map[string]string{
					dispatchRecordLabel:  dispatchRecordStatus,
					dispatchClusterLabel: report.ClusterID,
				},
			},
			Data: map[string]string{
				"clusterID":   report.ClusterID,
				"namespace":   report.Namespace,
				"name":        report.Name,
				"status.json": string(data),
			},
		}
		return s.client.Create(ctx, cm)
	}
	if err != nil {
		return err
	}
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data["clusterID"] = report.ClusterID
	cm.Data["namespace"] = report.Namespace
	cm.Data["name"] = report.Name
	cm.Data["status.json"] = string(data)
	return s.client.Update(ctx, cm)
}

func (s *ConfigMapStore) GetStatus(ctx context.Context, clusterID string, namespace string, name string) (taskgroupv1alpha1.OSMOTaskGroupStatus, error) {
	cm := &corev1.ConfigMap{}
	err := s.client.Get(ctx, client.ObjectKey{Namespace: s.namespace, Name: statusConfigMapName(clusterID, namespace, name)}, cm)
	if apierrors.IsNotFound(err) {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, notFoundStatus(name)
	}
	if err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	var status taskgroupv1alpha1.OSMOTaskGroupStatus
	if err := json.Unmarshal([]byte(cm.Data["status.json"]), &status); err != nil {
		return taskgroupv1alpha1.OSMOTaskGroupStatus{}, err
	}
	return status, nil
}

func (r commandRecord) Leaseable(now time.Time) bool {
	if r.State == commandStatePending {
		return true
	}
	return r.State == commandStateLeased && r.LeaseUntil != nil && now.After(r.LeaseUntil.Time)
}

func commandConfigMap(command Command) *corev1.ConfigMap {
	record := commandRecord{Command: command, State: commandStatePending, UpdatedAt: metav1.Now()}
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      commandConfigMapName(command.ID),
			Namespace: "",
			Labels: map[string]string{
				dispatchRecordLabel:  dispatchRecordCommand,
				dispatchClusterLabel: command.ClusterID,
				dispatchStateLabel:   commandStatePending,
			},
		},
	}
	applyCommandRecord(cm, record)
	return cm
}

func applyCommandRecord(cm *corev1.ConfigMap, record commandRecord) {
	data, _ := json.Marshal(record)
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data["record.json"] = string(data)
	if cm.Labels == nil {
		cm.Labels = map[string]string{}
	}
	cm.Labels[dispatchRecordLabel] = dispatchRecordCommand
	cm.Labels[dispatchClusterLabel] = record.Command.ClusterID
	cm.Labels[dispatchStateLabel] = record.State
}

func recordFromConfigMap(cm *corev1.ConfigMap) (commandRecord, error) {
	var record commandRecord
	if err := json.Unmarshal([]byte(cm.Data["record.json"]), &record); err != nil {
		return commandRecord{}, err
	}
	return record, nil
}

func commandID(command Command) string {
	copy := command
	copy.ID = ""
	data, _ := json.Marshal(copy)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:20]
}

func commandConfigMapName(commandID string) string {
	return "osmo-dispatch-c-" + commandID
}

func statusConfigMapName(clusterID, namespace, name string) string {
	sum := sha256.Sum256([]byte(statusKey(clusterID, namespace, name)))
	return "osmo-dispatch-s-" + hex.EncodeToString(sum[:])[:20]
}

func notFoundStatus(name string) error {
	return apierrors.NewNotFound(schema.GroupResource{
		Group:    taskgroupv1alpha1.GroupVersion.Group,
		Resource: "osmotaskgroups",
	}, name)
}

func decodeJSON(reader io.Reader, value any) error {
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(value); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func ValidateConfigMapStoreNamespace(namespace string) error {
	if namespace == "" {
		return fmt.Errorf("dispatcher state namespace is required")
	}
	return nil
}
