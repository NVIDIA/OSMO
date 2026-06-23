use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use futures::{StreamExt, TryStreamExt};
use kube::api::{Api, DeleteParams, ListParams, Patch, PatchParams, PostParams};
use kube::core::ObjectMeta;
use kube::runtime::watcher::{watcher, Config as WatcherConfig, Event};
use kube::{Client, CustomResource, Resource, ResourceExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::env;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::{Channel, ClientTlsConfig, Endpoint, Server};
use tonic::{Request, Response, Status};
use tracing::{error, info, warn};

pub mod proto {
    tonic::include_proto!("osmo.spike.v1");
}

use proto::cluster_session_client::ClusterSessionClient;
use proto::cluster_session_server::{ClusterSession, ClusterSessionServer};
use proto::{
    backend_envelope, control_envelope, BackendEnvelope, ControlEnvelope, DesiredTaskGroup,
    Heartbeat, Hello, HelloAck, ResyncRequest, TaskGroupAck, TaskGroupStatus, TaskGroupSync,
};

const FINALIZER: &str = "spike.osmo.nvidia.com/cleanup";
const DEFAULT_CONTROL_NAMESPACE: &str = "osmo-exp";
const DEFAULT_BACKEND_NAMESPACE: &str = "osmo-phase1a";
const DEFAULT_CLUSTER_ID: &str = "osmo-backend";
const CLUSTER_NAME: &str = "osmo-backend";
const POOL_NAME: &str = "default";

#[derive(CustomResource, Serialize, Deserialize, Clone, Debug, JsonSchema)]
#[kube(
    group = "spike.osmo.nvidia.com",
    version = "v1alpha1",
    kind = "OSMOWorkflow",
    plural = "osmoworkflows",
    namespaced,
    status = "OSMOWorkflowStatus"
)]
#[serde(rename_all = "camelCase")]
pub struct OSMOWorkflowSpec {
    #[serde(rename = "clusterID", alias = "clusterId")]
    pub cluster_id: String,
    pub namespace: String,
    pub task_groups: Vec<WorkflowTaskGroup>,
    pub ttl_seconds_after_finished: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTaskGroup {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OSMOWorkflowStatus {
    pub phase: Option<String>,
    pub message: Option<String>,
    pub completion_time: Option<DateTime<Utc>>,
    pub groups: Vec<WorkflowGroupStatus>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowGroupStatus {
    pub name: String,
    pub otg_name: String,
    pub namespace: String,
    pub phase: String,
    pub message: Option<String>,
}

#[derive(CustomResource, Serialize, Deserialize, Clone, Debug, JsonSchema)]
#[kube(
    group = "spike.osmo.nvidia.com",
    version = "v1alpha1",
    kind = "OSMOTaskGroup",
    plural = "osmotaskgroups",
    namespaced,
    status = "OSMOTaskGroupStatus"
)]
#[serde(rename_all = "camelCase")]
pub struct OSMOTaskGroupSpec {
    pub workflow_name: String,
    pub group_name: String,
    #[serde(rename = "clusterID", alias = "clusterId")]
    pub cluster_id: String,
    pub target_namespace: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OSMOTaskGroupStatus {
    pub phase: Option<String>,
    pub message: Option<String>,
    pub observed_time: Option<DateTime<Utc>>,
    pub observed_generation: Option<i64>,
}

#[derive(CustomResource, Serialize, Deserialize, Clone, Debug, JsonSchema)]
#[kube(
    group = "spike.osmo.nvidia.com",
    version = "v1alpha1",
    kind = "OSMOCluster",
    plural = "osmoclusters",
    namespaced,
    status = "OSMOClusterStatus"
)]
#[serde(rename_all = "camelCase")]
pub struct OSMOClusterSpec {
    #[serde(rename = "clusterID", alias = "clusterId")]
    pub cluster_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OSMOClusterStatus {
    pub phase: Option<String>,
    pub last_seen_time: Option<DateTime<Utc>>,
    pub message: Option<String>,
}

#[derive(CustomResource, Serialize, Deserialize, Clone, Debug, JsonSchema)]
#[kube(
    group = "spike.osmo.nvidia.com",
    version = "v1alpha1",
    kind = "OSMOPool",
    plural = "osmopools",
    namespaced,
    status = "OSMOPoolStatus"
)]
#[serde(rename_all = "camelCase")]
pub struct OSMOPoolSpec {
    pub cluster_ref: String,
    pub namespace: String,
    pub scheduler_type: String,
    pub maintenance: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OSMOPoolStatus {
    pub phase: Option<String>,
    pub message: Option<String>,
}

type SessionTx = mpsc::Sender<std::result::Result<ControlEnvelope, Status>>;

#[derive(Clone)]
struct SessionEntry {
    generation: u64,
    tx: SessionTx,
}

#[derive(Clone)]
struct ControlState {
    client: Client,
    namespace: String,
    token: String,
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    session_generation: Arc<AtomicU64>,
    statuses_tx: mpsc::Sender<TaskGroupStatus>,
}

#[derive(Clone)]
struct OperatorService {
    state: ControlState,
}

#[tonic::async_trait]
impl ClusterSession for OperatorService {
    type OpenSessionStream = Pin<Box<dyn futures::Stream<Item = std::result::Result<ControlEnvelope, Status>> + Send>>;

    async fn open_session(
        &self,
        request: Request<tonic::Streaming<BackendEnvelope>>,
    ) -> std::result::Result<Response<Self::OpenSessionStream>, Status> {
        let mut inbound = request.into_inner();
        let first = inbound
            .message()
            .await?
            .ok_or_else(|| Status::unauthenticated("missing hello"))?;
        let hello = match first.msg {
            Some(backend_envelope::Msg::Hello(hello)) => hello,
            _ => return Err(Status::unauthenticated("first envelope must be hello")),
        };
        if hello.token != self.state.token {
            return Err(Status::unauthenticated("invalid cluster token"));
        }
        let cluster_id = hello.cluster_id.clone();
        let (tx, rx) = mpsc::channel(64);
        let generation = self.state.session_generation.fetch_add(1, Ordering::Relaxed);
        self.state.sessions.lock().await.insert(cluster_id.clone(), SessionEntry {
            generation,
            tx: tx.clone(),
        });
        tx.send(Ok(ControlEnvelope {
            msg: Some(control_envelope::Msg::HelloAck(HelloAck {
                cluster_id: cluster_id.clone(),
                message: "accepted".to_string(),
            })),
        }))
        .await
        .map_err(|_| Status::internal("session closed"))?;
        tx.send(Ok(ControlEnvelope {
            msg: Some(control_envelope::Msg::ResyncRequest(ResyncRequest {})),
        }))
        .await
        .map_err(|_| Status::internal("session closed"))?;

        let sync_state = self.state.clone();
        let sync_cluster_id = cluster_id.clone();
        tokio::spawn(async move {
            if let Err(err) = sync_assigned_taskgroups(&sync_state, &sync_cluster_id, true, Vec::new()).await {
                warn!(cluster_id = %sync_cluster_id, %err, "taskgroup resync failed");
            }
        });

        let state = self.state.clone();
        tokio::spawn(async move {
            info!(%cluster_id, "backend session connected");
            while let Ok(Some(envelope)) = inbound.message().await {
                match envelope.msg {
                    Some(backend_envelope::Msg::Status(status)) => {
                        if let Err(err) = state.statuses_tx.send(status).await {
                            warn!(%cluster_id, %err, "failed to forward status event");
                        }
                    }
                    Some(backend_envelope::Msg::Ack(ack)) => {
                        info!(
                            %cluster_id,
                            workflow = %ack.workflow_name,
                            group = %ack.task_group_name,
                            namespace = %ack.task_group_namespace,
                            observed_generation = ack.observed_generation,
                            ok = ack.ok,
                            message = %ack.message,
                            "taskgroup sync ack"
                        );
                    }
                    Some(backend_envelope::Msg::Heartbeat(_)) => {
                        if let Err(err) = patch_cluster_status(&state.client, &state.namespace, &cluster_id, "Ready", "heartbeat").await {
                            warn!(%cluster_id, %err, "patch cluster heartbeat failed");
                        }
                    }
                    Some(backend_envelope::Msg::Hello(_)) => {
                        warn!(%cluster_id, "duplicate hello ignored");
                    }
                    None => {}
                }
            }
            let mut sessions = state.sessions.lock().await;
            if sessions
                .get(&cluster_id)
                .map(|entry| entry.generation == generation)
                .unwrap_or(false)
            {
                sessions.remove(&cluster_id);
            }
            info!(%cluster_id, "backend session disconnected");
        });

        Ok(Response::new(Box::pin(ReceiverStream::new(rx)) as Self::OpenSessionStream))
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let role = env::var("OSMO_SPIKE_ROLE").unwrap_or_else(|_| "control".to_string());
    match role.as_str() {
        "control" => run_control().await,
        "backend" => run_backend().await,
        other => Err(anyhow!("unsupported OSMO_SPIKE_ROLE={other}")),
    }
}

async fn run_control() -> Result<()> {
    let namespace = env::var("CONTROL_NAMESPACE").unwrap_or_else(|_| DEFAULT_CONTROL_NAMESPACE.to_string());
    let bind = env::var("OPERATOR_BIND").unwrap_or_else(|_| "0.0.0.0:50051".to_string());
    let token = env::var("CLUSTER_TOKEN").unwrap_or_else(|_| "osmo-spike-token".to_string());
    let client = Client::try_default().await?;
    ensure_control_cluster_pool(client.clone(), &namespace).await?;
    let (statuses_tx, statuses_rx) = mpsc::channel(256);
    let state = ControlState {
        client: client.clone(),
        namespace: namespace.clone(),
        token,
        sessions: Arc::new(Mutex::new(HashMap::new())),
        session_generation: Arc::new(AtomicU64::new(1)),
        statuses_tx,
    };
    let service = OperatorService {
        state: state.clone(),
    };
    let server_addr = bind.parse()?;
    tokio::spawn(async move {
        info!(%bind, "starting operator service");
        if let Err(err) = Server::builder()
            .http2_keepalive_interval(Some(Duration::from_secs(20)))
            .http2_keepalive_timeout(Some(Duration::from_secs(10)))
            .add_service(ClusterSessionServer::new(service))
            .serve(server_addr)
            .await
        {
            error!(%err, "operator service failed");
        }
    });
    tokio::spawn(status_writer(client.clone(), namespace.clone(), statuses_rx));
    tokio::spawn(ttl_scanner(client.clone(), namespace.clone()));
    watch_workflows(client, namespace, state).await
}

async fn watch_workflows(client: Client, namespace: String, state: ControlState) -> Result<()> {
    let workflows: Api<OSMOWorkflow> = Api::namespaced(client, &namespace);
    let mut stream = watcher(workflows.clone(), WatcherConfig::default()).boxed();
    info!(%namespace, "watching OSMOWorkflow resources");
    while let Some(event) = stream.try_next().await? {
        match event {
            Event::Apply(workflow) | Event::InitApply(workflow) => {
                if let Err(err) = reconcile_workflow(&workflows, &state, workflow).await {
                    warn!(%err, "workflow reconcile failed");
                }
            }
            Event::Delete(_) => {}
            Event::Init | Event::InitDone => {}
        }
    }
    Ok(())
}

async fn reconcile_workflow(
    workflows: &Api<OSMOWorkflow>,
    state: &ControlState,
    workflow: OSMOWorkflow,
) -> Result<()> {
    let name = workflow.name_any();
    if workflow.meta().deletion_timestamp.is_some() {
        reconcile_workflow_delete(workflows, state, workflow).await?;
        return Ok(());
    }
    if !has_finalizer(&workflow) {
        patch_finalizers(workflows, &name, Some(FINALIZER)).await?;
        return Ok(());
    }
    let status = workflow.status.clone().unwrap_or_default();
    if let Some(completion_time) = status.completion_time {
        if let Some(ttl) = workflow.spec.ttl_seconds_after_finished {
            let age = Utc::now().signed_duration_since(completion_time).num_seconds();
            if age >= ttl {
                info!(%name, ttl, "ttl expired; deleting workflow");
                workflows.delete(&name, &DeleteParams::default()).await?;
                return Ok(());
            }
        }
    }
    if !status.groups.is_empty() {
        return Ok(());
    }
    dispatch_workflow(workflows, state, &workflow).await
}

async fn dispatch_workflow(
    workflows: &Api<OSMOWorkflow>,
    state: &ControlState,
    workflow: &OSMOWorkflow,
) -> Result<()> {
    let name = workflow.name_any();
    if workflow.spec.task_groups.is_empty() {
        return Err(anyhow!("workflow has no taskGroups"));
    }
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let mut groups = Vec::with_capacity(workflow.spec.task_groups.len());
    for group in &workflow.spec.task_groups {
        ensure_control_taskgroup(&taskgroups, workflow, group).await?;
        groups.push(WorkflowGroupStatus {
            name: group.name.clone(),
            otg_name: taskgroup_name(&name, &group.name),
            namespace: workflow.spec.namespace.clone(),
            phase: "Pending".to_string(),
            message: None,
        });
    }
    let pending = OSMOWorkflowStatus {
        phase: Some("Pending".to_string()),
        message: Some("desired taskgroups recorded and synced via ClusterSession".to_string()),
        completion_time: None,
        groups,
    };
    patch_workflow_status(workflows, &name, pending).await?;
    sync_assigned_taskgroups(state, &workflow.spec.cluster_id, false, Vec::new()).await?;
    Ok(())
}

async fn reconcile_workflow_delete(
    workflows: &Api<OSMOWorkflow>,
    state: &ControlState,
    workflow: OSMOWorkflow,
) -> Result<()> {
    let name = workflow.name_any();
    delete_control_taskgroups(state, &name).await?;
    if let Err(err) = sync_assigned_taskgroups(state, &workflow.spec.cluster_id, true, vec![name.clone()]).await {
        warn!(%name, %err, "taskgroup prune sync failed; keeping finalizer");
        return Ok(());
    }
    patch_finalizers(workflows, &name, None).await?;
    Ok(())
}

async fn ensure_control_taskgroup(
    taskgroups: &Api<OSMOTaskGroup>,
    workflow: &OSMOWorkflow,
    group: &WorkflowTaskGroup,
) -> Result<()> {
    let workflow_name = workflow.name_any();
    let name = taskgroup_name(&workflow_name, &group.name);
    let otg = OSMOTaskGroup {
        metadata: ObjectMeta {
            name: Some(name.clone()),
            labels: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/workflow".to_string(), workflow_name.clone()),
                ("spike.osmo.nvidia.com/group".to_string(), group.name.clone()),
                ("spike.osmo.nvidia.com/cluster".to_string(), workflow.spec.cluster_id.clone()),
                ("spike.osmo.nvidia.com/role".to_string(), "desired".to_string()),
            ])),
            ..Default::default()
        },
        spec: OSMOTaskGroupSpec {
            workflow_name,
            group_name: group.name.clone(),
            cluster_id: workflow.spec.cluster_id.clone(),
            target_namespace: workflow.spec.namespace.clone(),
        },
        status: None,
    };
    match taskgroups.create(&PostParams::default(), &otg).await {
        Ok(_) => info!(%name, "created desired OSMOTaskGroup"),
        Err(kube::Error::Api(err)) if err.code == 409 => {
            taskgroups.patch(&name, &PatchParams::default(), &Patch::Merge(json!({
                "metadata": {
                    "labels": {
                        "spike.osmo.nvidia.com/workflow": otg.spec.workflow_name,
                        "spike.osmo.nvidia.com/group": otg.spec.group_name,
                        "spike.osmo.nvidia.com/cluster": otg.spec.cluster_id,
                        "spike.osmo.nvidia.com/role": "desired"
                    }
                },
                "spec": otg.spec
            }))).await?;
            info!(%name, "patched desired OSMOTaskGroup");
        }
        Err(err) => return Err(err.into()),
    }
    Ok(())
}

async fn delete_control_taskgroups(state: &ControlState, workflow_name: &str) -> Result<()> {
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let list = taskgroups
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/workflow={workflow_name},spike.osmo.nvidia.com/role=desired")))
        .await?;
    for otg in list {
        let name = otg.name_any();
        match taskgroups.delete(&name, &DeleteParams::default()).await {
            Ok(_) => info!(%name, workflow = %workflow_name, "deleted desired OSMOTaskGroup"),
            Err(kube::Error::Api(err)) if err.code == 404 => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

async fn sync_assigned_taskgroups(
    state: &ControlState,
    cluster_id: &str,
    full: bool,
    prune_workflows: Vec<String>,
) -> Result<()> {
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let list = taskgroups
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/cluster={cluster_id},spike.osmo.nvidia.com/role=desired")))
        .await?;
    let desired = list
        .into_iter()
        .map(|otg| DesiredTaskGroup {
            workflow_name: otg.spec.workflow_name,
            task_group_name: otg.spec.group_name,
            task_group_namespace: otg.spec.target_namespace,
            uid: otg.metadata.uid.unwrap_or_default(),
            generation: otg.metadata.generation.unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    let count = desired.len();
    send_to_cluster(state, cluster_id, ControlEnvelope {
        msg: Some(control_envelope::Msg::TaskGroupSync(TaskGroupSync {
            cluster_id: cluster_id.to_string(),
            full,
            task_groups: desired,
            prune_workflows,
            unix_seconds: Utc::now().timestamp(),
        })),
    })
    .await?;
    info!(%cluster_id, full, count, "synced desired taskgroups");
    Ok(())
}

async fn ttl_scanner(client: Client, namespace: String) {
    let workflows: Api<OSMOWorkflow> = Api::namespaced(client, &namespace);
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    loop {
        interval.tick().await;
        let Ok(list) = workflows.list(&ListParams::default()).await else {
            warn!(%namespace, "ttl scanner failed to list workflows");
            continue;
        };
        for workflow in list {
            let Some(status) = workflow.status.as_ref() else {
                continue;
            };
            let Some(completion_time) = status.completion_time else {
                continue;
            };
            let Some(ttl) = workflow.spec.ttl_seconds_after_finished else {
                continue;
            };
            if Utc::now().signed_duration_since(completion_time).num_seconds() < ttl {
                continue;
            }
            let name = workflow.name_any();
            match workflows.delete(&name, &DeleteParams::default()).await {
                Ok(_) => info!(%name, ttl, "ttl scanner deleted workflow"),
                Err(err) => warn!(%name, %err, "ttl scanner failed to delete workflow"),
            }
        }
    }
}

async fn status_writer(
    client: Client,
    namespace: String,
    mut statuses_rx: mpsc::Receiver<TaskGroupStatus>,
) {
    let workflows: Api<OSMOWorkflow> = Api::namespaced(client.clone(), &namespace);
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(client, &namespace);
    while let Some(status) = statuses_rx.recv().await {
        let otg_name = taskgroup_name(&status.workflow_name, &status.task_group_name);
        let otg_status = OSMOTaskGroupStatus {
            phase: Some(status.phase.clone()),
            message: Some(status.message.clone()),
            observed_time: Some(Utc::now()),
            observed_generation: None,
        };
        if let Err(err) = patch_taskgroup_status(&taskgroups, &otg_name, otg_status).await {
            warn!(taskgroup = %otg_name, %err, "patch desired taskgroup status failed");
        }
        let workflow = match workflows.get(&status.workflow_name).await {
            Ok(workflow) => workflow,
            Err(err) => {
                warn!(workflow = %status.workflow_name, %err, "status for unknown workflow");
                continue;
            }
        };
        let mut wf_status = workflow.status.unwrap_or_default();
        if wf_status.groups.is_empty() {
            wf_status.groups.push(WorkflowGroupStatus {
                name: status.task_group_name.clone(),
                otg_name,
                namespace: status.task_group_namespace.clone(),
                phase: status.phase.clone(),
                message: Some(status.message.clone()),
            });
        } else {
            for group in &mut wf_status.groups {
                if group.name == status.task_group_name {
                    group.phase = status.phase.clone();
                    group.message = Some(status.message.clone());
                }
            }
        }
        wf_status.phase = Some(workflow_phase(&wf_status.groups));
        wf_status.message = Some(status.message.clone());
        if matches!(wf_status.phase.as_deref(), Some("Succeeded" | "Failed")) && wf_status.completion_time.is_none() {
            wf_status.completion_time = Some(Utc::now());
        }
        if let Err(err) = patch_workflow_status(&workflows, &status.workflow_name, wf_status).await {
            warn!(workflow = %status.workflow_name, %err, "patch workflow status failed");
        }
    }
}

async fn send_to_cluster(state: &ControlState, cluster_id: &str, envelope: ControlEnvelope) -> Result<()> {
    let sessions = state.sessions.lock().await;
    let entry = sessions
        .get(cluster_id)
        .ok_or_else(|| anyhow!("cluster {cluster_id} is not connected"))?;
    entry.tx.send(Ok(envelope)).await.context("send cluster envelope")?;
    Ok(())
}

async fn run_backend() -> Result<()> {
    let cluster_id = env::var("CLUSTER_ID").unwrap_or_else(|_| DEFAULT_CLUSTER_ID.to_string());
    let namespace = env::var("BACKEND_NAMESPACE").unwrap_or_else(|_| DEFAULT_BACKEND_NAMESPACE.to_string());
    let operator_url = env::var("OPERATOR_URL").context("OPERATOR_URL is required")?;
    let operator_authority = env::var("OPERATOR_AUTHORITY").ok();
    let token = env::var("CLUSTER_TOKEN").unwrap_or_else(|_| "osmo-spike-token".to_string());
    let client = Client::try_default().await?;
    let mut backoff = Duration::from_secs(2);
    loop {
        match backend_session(client.clone(), &operator_url, operator_authority.as_deref(), &cluster_id, &namespace, &token).await {
            Ok(()) => warn!("backend session ended"),
            Err(err) => warn!(error = ?err, "backend session failed"),
        }
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
    }
}

async fn backend_session(
    client: Client,
    operator_url: &str,
    operator_authority: Option<&str>,
    cluster_id: &str,
    namespace: &str,
    token: &str,
) -> Result<()> {
    let mut endpoint: Endpoint = Channel::from_shared(operator_url.to_string())?;
    if let Some(authority) = operator_authority {
        endpoint = endpoint
            .origin(format!("https://{authority}").parse::<http::Uri>()?)
            .tls_config(ClientTlsConfig::new().with_native_roots().domain_name(authority.to_string()))?;
    }
    let channel = endpoint
        .http2_keep_alive_interval(Duration::from_secs(20))
        .keep_alive_timeout(Duration::from_secs(10))
        .keep_alive_while_idle(true)
        .connect()
        .await
        .context("connect operator service")?;
    let mut grpc = ClusterSessionClient::new(channel);
    let (tx, rx) = mpsc::channel::<BackendEnvelope>(64);
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Hello(Hello {
            cluster_id: cluster_id.to_string(),
            token: token.to_string(),
        })),
    })
    .await?;
    let response = grpc.open_session(ReceiverStream::new(rx)).await?;
    let mut inbound = response.into_inner();
    let heartbeat_tx = tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(20));
        loop {
            interval.tick().await;
            if heartbeat_tx
                .send(BackendEnvelope {
                    msg: Some(backend_envelope::Msg::Heartbeat(Heartbeat {
                        unix_seconds: Utc::now().timestamp(),
                    })),
                })
                .await
                .is_err()
            {
                break;
            }
        }
    });
    info!(%cluster_id, %operator_url, "connected to operator service");
    while let Some(envelope) = inbound.message().await? {
        match envelope.msg {
            Some(control_envelope::Msg::HelloAck(ack)) => {
                info!(cluster = %ack.cluster_id, message = %ack.message, "hello ack");
            }
            Some(control_envelope::Msg::TaskGroupSync(sync)) => {
                handle_taskgroup_sync(client.clone(), namespace, cluster_id, &tx, sync).await?;
            }
            Some(control_envelope::Msg::ResyncRequest(_)) => {
                handle_resync(client.clone(), namespace, &tx).await?;
            }
            Some(control_envelope::Msg::Heartbeat(_)) => {}
            None => {}
        }
    }
    Ok(())
}

async fn handle_taskgroup_sync(
    client: Client,
    default_namespace: &str,
    local_cluster_id: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    sync: TaskGroupSync,
) -> Result<()> {
    if !sync.cluster_id.is_empty() && sync.cluster_id != local_cluster_id {
        warn!(sync_cluster = %sync.cluster_id, %local_cluster_id, "received sync for unexpected cluster");
    }
    let mut desired_keys = HashMap::new();
    for desired in sync.task_groups {
        let namespace = desired_namespace(default_namespace, &desired);
        let key = format!("{}/{}", namespace, taskgroup_name(&desired.workflow_name, &desired.task_group_name));
        desired_keys.insert(key, ());
        reconcile_desired_taskgroup(client.clone(), &namespace, local_cluster_id, tx, desired).await?;
    }
    for workflow_name in sync.prune_workflows {
        prune_workflow_taskgroups(client.clone(), default_namespace, &workflow_name).await?;
    }
    if sync.full {
        prune_absent_taskgroups(client, default_namespace, &desired_keys).await?;
    }
    Ok(())
}

async fn reconcile_desired_taskgroup(
    client: Client,
    namespace: &str,
    local_cluster_id: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    desired: DesiredTaskGroup,
) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client, namespace);
    let name = taskgroup_name(&desired.workflow_name, &desired.task_group_name);
    let otg = OSMOTaskGroup {
        metadata: ObjectMeta {
            name: Some(name.clone()),
            labels: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/workflow".to_string(), desired.workflow_name.clone()),
                ("spike.osmo.nvidia.com/group".to_string(), desired.task_group_name.clone()),
                ("spike.osmo.nvidia.com/cluster".to_string(), local_cluster_id.to_string()),
                ("spike.osmo.nvidia.com/role".to_string(), "mirror".to_string()),
            ])),
            ..Default::default()
        },
        spec: OSMOTaskGroupSpec {
            workflow_name: desired.workflow_name.clone(),
            group_name: desired.task_group_name.clone(),
            cluster_id: local_cluster_id.to_string(),
            target_namespace: namespace.to_string(),
        },
        status: None,
    };
    match api.create(&PostParams::default(), &otg).await {
        Ok(_) => info!(%name, %namespace, "created mirrored OSMOTaskGroup"),
        Err(kube::Error::Api(err)) if err.code == 409 => {
            api.patch(&name, &PatchParams::default(), &Patch::Merge(json!({
                "metadata": {
                    "labels": {
                        "spike.osmo.nvidia.com/workflow": desired.workflow_name,
                        "spike.osmo.nvidia.com/group": desired.task_group_name,
                        "spike.osmo.nvidia.com/cluster": local_cluster_id,
                        "spike.osmo.nvidia.com/role": "mirror"
                    }
                },
                "spec": otg.spec
            }))).await?;
            info!(%name, %namespace, "patched mirrored OSMOTaskGroup");
        }
        Err(err) => return Err(err.into()),
    };
    let status = OSMOTaskGroupStatus {
        phase: Some("Succeeded".to_string()),
        message: Some("mirrored by rust TaskGroup Controller desired-state sync".to_string()),
        observed_time: Some(Utc::now()),
        observed_generation: Some(desired.generation),
    };
    patch_taskgroup_status(&api, &name, status).await?;
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Ack(TaskGroupAck {
            workflow_name: desired.workflow_name.clone(),
            task_group_name: desired.task_group_name.clone(),
            task_group_namespace: namespace.to_string(),
            observed_generation: desired.generation,
            ok: true,
            message: "synced".to_string(),
        })),
    })
    .await?;
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Status(TaskGroupStatus {
            workflow_name: desired.workflow_name,
            task_group_name: desired.task_group_name,
            task_group_namespace: namespace.to_string(),
            phase: "Succeeded".to_string(),
            message: "backend taskgroup mirrored and status reported".to_string(),
        })),
    })
    .await?;
    Ok(())
}

async fn prune_workflow_taskgroups(client: Client, namespace: &str, workflow_name: &str) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client, namespace);
    let list = api
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/workflow={workflow_name},spike.osmo.nvidia.com/role=mirror")))
        .await?;
    for otg in list {
        let name = otg.name_any();
        match api.delete(&name, &DeleteParams::default()).await {
            Ok(_) => info!(%name, %namespace, workflow = %workflow_name, "pruned mirrored OSMOTaskGroup"),
            Err(kube::Error::Api(err)) if err.code == 404 => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

async fn prune_absent_taskgroups(client: Client, namespace: &str, desired_keys: &HashMap<String, ()>) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client, namespace);
    let list = api
        .list(&ListParams::default().labels("spike.osmo.nvidia.com/role=mirror"))
        .await?;
    for otg in list {
        let name = otg.name_any();
        let key = format!("{}/{}", namespace, name);
        if desired_keys.contains_key(&key) {
            continue;
        }
        match api.delete(&name, &DeleteParams::default()).await {
            Ok(_) => info!(%name, %namespace, "pruned stale mirrored OSMOTaskGroup after full sync"),
            Err(kube::Error::Api(err)) if err.code == 404 => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

fn desired_namespace(default_namespace: &str, desired: &DesiredTaskGroup) -> String {
    if desired.task_group_namespace.is_empty() {
        default_namespace.to_string()
    } else {
        desired.task_group_namespace.clone()
    }
}

async fn handle_resync(
    client: Client,
    namespace: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client, namespace);
    for otg in api.list(&ListParams::default()).await? {
        let status = otg.status.unwrap_or_default();
        tx.send(BackendEnvelope {
            msg: Some(backend_envelope::Msg::Status(TaskGroupStatus {
                workflow_name: otg.spec.workflow_name,
                task_group_name: otg.spec.group_name,
                task_group_namespace: namespace.to_string(),
        phase: status.phase.unwrap_or_else(|| "Pending".to_string()),
        message: status.message.unwrap_or_else(|| "resync".to_string()),
    })),
        })
        .await?;
    }
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Heartbeat(Heartbeat {
            unix_seconds: Utc::now().timestamp(),
        })),
    })
    .await?;
    Ok(())
}

fn has_finalizer(workflow: &OSMOWorkflow) -> bool {
    workflow
        .metadata
        .finalizers
        .as_ref()
        .map(|finalizers| finalizers.iter().any(|item| item == FINALIZER))
        .unwrap_or(false)
}

async fn patch_finalizers(api: &Api<OSMOWorkflow>, name: &str, finalizer: Option<&str>) -> Result<()> {
    let workflow = api.get(name).await?;
    let mut finalizers = workflow.metadata.finalizers.unwrap_or_default();
    match finalizer {
        Some(value) if !finalizers.iter().any(|item| item == value) => {
            finalizers.push(value.to_string());
        }
        Some(_) => {}
        None => finalizers.retain(|item| item != FINALIZER),
    }
    api.patch(name, &PatchParams::default(), &Patch::Merge(json!({
        "metadata": {
            "finalizers": if finalizers.is_empty() {
                serde_json::Value::Null
            } else {
                json!(finalizers)
            }
        }
    })))
    .await?;
    Ok(())
}

async fn patch_workflow_status(
    api: &Api<OSMOWorkflow>,
    name: &str,
    status: OSMOWorkflowStatus,
) -> Result<()> {
    api.patch_status(
        name,
        &PatchParams::default(),
        &Patch::Merge(json!({"status": status})),
    )
    .await?;
    Ok(())
}

async fn patch_taskgroup_status(
    api: &Api<OSMOTaskGroup>,
    name: &str,
    status: OSMOTaskGroupStatus,
) -> Result<()> {
    api.patch_status(
        name,
        &PatchParams::default(),
        &Patch::Merge(json!({"status": status})),
    )
    .await?;
    Ok(())
}

async fn ensure_control_cluster_pool(client: Client, namespace: &str) -> Result<()> {
    let clusters: Api<OSMOCluster> = Api::namespaced(client.clone(), namespace);
    let cluster = OSMOCluster {
        metadata: ObjectMeta {
            name: Some(CLUSTER_NAME.to_string()),
            ..Default::default()
        },
        spec: OSMOClusterSpec {
            cluster_id: CLUSTER_NAME.to_string(),
        },
        status: None,
    };
    match clusters.create(&PostParams::default(), &cluster).await {
        Ok(_) => info!(cluster = CLUSTER_NAME, "created OSMOCluster"),
        Err(kube::Error::Api(err)) if err.code == 409 => {}
        Err(err) => return Err(err.into()),
    }

    let pools: Api<OSMOPool> = Api::namespaced(client, namespace);
    let pool = OSMOPool {
        metadata: ObjectMeta {
            name: Some(POOL_NAME.to_string()),
            ..Default::default()
        },
        spec: OSMOPoolSpec {
            cluster_ref: CLUSTER_NAME.to_string(),
            namespace: DEFAULT_BACKEND_NAMESPACE.to_string(),
            scheduler_type: "none".to_string(),
            maintenance: false,
        },
        status: None,
    };
    match pools.create(&PostParams::default(), &pool).await {
        Ok(_) => info!(pool = POOL_NAME, "created OSMOPool"),
        Err(kube::Error::Api(err)) if err.code == 409 => {}
        Err(err) => return Err(err.into()),
    }
    Ok(())
}

async fn patch_cluster_status(client: &Client, namespace: &str, cluster_id: &str, phase: &str, message: &str) -> Result<()> {
    let clusters: Api<OSMOCluster> = Api::namespaced(client.clone(), namespace);
    let name = if cluster_id.is_empty() { CLUSTER_NAME } else { cluster_id };
    clusters
        .patch_status(
            name,
            &PatchParams::default(),
            &Patch::Merge(json!({
                "status": {
                    "phase": phase,
                    "lastSeenTime": Utc::now(),
                    "message": message,
                }
            })),
        )
        .await?;
    Ok(())
}

fn taskgroup_name(workflow_name: &str, group_name: &str) -> String {
    let raw = format!("{workflow_name}-{group_name}");
    raw.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(63)
        .collect()
}

fn workflow_phase(groups: &[WorkflowGroupStatus]) -> String {
    if groups.iter().any(|group| group.phase == "Failed") {
        "Failed".to_string()
    } else if !groups.is_empty() && groups.iter().all(|group| group.phase == "Succeeded") {
        "Succeeded".to_string()
    } else {
        "Pending".to_string()
    }
}
