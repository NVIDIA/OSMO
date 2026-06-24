use anyhow::{anyhow, bail, Context, Result};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use futures::{StreamExt, TryStreamExt};
use kube::api::{Api, DeleteParams, ListParams, Patch, PatchParams, PostParams};
use kube::core::{ApiResource, DynamicObject, GroupVersionKind, ObjectMeta};
use kube::runtime::watcher::{watcher, Config as WatcherConfig, Event};
use kube::{Client, CustomResource, Resource, ResourceExt};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
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
    backend_envelope, control_envelope, BackendEnvelope, CleanupAck, ControlEnvelope,
    DesiredTaskGroup, Heartbeat, Hello, HelloAck, PruneWorkflowTarget, ResyncRequest,
    TaskGroupAck, TaskGroupStatus, TaskGroupSync,
};

const FINALIZER: &str = "spike.osmo.nvidia.com/cleanup";
const CLEANUP_PENDING_ANNOTATION: &str = "spike.osmo.nvidia.com/cleanup-pending-targets";
const DEFAULT_CONTROL_NAMESPACE: &str = "osmo-exp";
const DEFAULT_BACKEND_NAMESPACE: &str = "osmo-phase1a";
const DEFAULT_CLUSTER_ID: &str = "osmo-backend";
const CLUSTER_NAME: &str = "osmo-backend";
const POOL_NAME: &str = "default";

#[derive(Clone)]
struct ApiState {
    client: Client,
    namespace: String,
    authz_policy: Vec<ApiPrincipal>,
}

#[derive(Clone, Deserialize)]
struct ApiPrincipal {
    token: String,
    subject: String,
    #[serde(default)]
    pools: Vec<String>,
}

#[derive(Deserialize)]
struct SubmitQuery {
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    validation_only: bool,
}

#[derive(Deserialize)]
struct TemplateData {
    file: String,
    #[serde(default)]
    set_variables: Vec<String>,
    #[serde(default)]
    set_string_variables: Vec<String>,
    #[serde(default)]
    uploaded_templated_spec: Option<String>,
}

#[derive(Serialize)]
struct SubmitResponse {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    spec: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logs: Option<String>,
}

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
    #[serde(default)]
    pub runtime_type: Option<String>,
    #[serde(default)]
    pub runtime_config: Option<serde_json::Value>,
    #[serde(default)]
    pub pool_ref: Option<String>,
    #[serde(default)]
    pub rendered_objects: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OSMOWorkflowStatus {
    pub phase: Option<String>,
    pub message: Option<String>,
    pub completion_time: Option<DateTime<Utc>>,
    pub observed_generation: Option<i64>,
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
    #[serde(default)]
    pub workflow_uid: Option<String>,
    #[serde(default)]
    pub desired_task_group_uid: Option<String>,
    #[serde(default)]
    pub desired_generation: Option<i64>,
    pub group_name: String,
    #[serde(rename = "clusterID", alias = "clusterId")]
    pub cluster_id: String,
    pub target_namespace: String,
    #[serde(default)]
    pub runtime_type: Option<String>,
    #[serde(default)]
    pub runtime_config: Option<serde_json::Value>,
    #[serde(default)]
    pub pool_ref: Option<String>,
    #[serde(default)]
    pub rendered_objects: Vec<serde_json::Value>,
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

#[derive(Clone, Debug)]
struct PoolPlacement {
    pool_name: String,
    cluster_id: String,
    namespace: String,
    scheduler_type: String,
}

#[derive(Clone, Debug)]
struct RuntimeObjectRef {
    api_resource: ApiResource,
    namespace: String,
    name: String,
}

#[derive(Clone, Debug)]
struct RuntimeStatus {
    phase: String,
    message: String,
}

#[derive(Clone)]
struct BackendState {
    monitors: Arc<Mutex<HashMap<String, RuntimeMonitor>>>,
}

struct RuntimeMonitor {
    marker: String,
    handle: JoinHandle<()>,
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
            if let Err(err) = sync_assigned_taskgroups(&sync_state, &sync_cluster_id, true, Vec::new(), Vec::new(), Vec::new()).await {
                warn!(cluster_id = %sync_cluster_id, %err, "taskgroup resync failed");
            }
        });

        let state = self.state.clone();
        tokio::spawn(async move {
            info!(%cluster_id, "backend session connected");
            while let Ok(Some(envelope)) = inbound.message().await {
                match envelope.msg {
                    Some(backend_envelope::Msg::Status(status)) => {
                        if !is_current_session(&state, &cluster_id, generation).await {
                            warn!(%cluster_id, "dropped status from stale backend session");
                            continue;
                        }
                        if let Err(err) = state.statuses_tx.send(status).await {
                            warn!(%cluster_id, %err, "failed to forward status event");
                        }
                    }
                    Some(backend_envelope::Msg::Ack(ack)) => {
                        if !is_current_session(&state, &cluster_id, generation).await {
                            warn!(%cluster_id, "dropped ack from stale backend session");
                            continue;
                        }
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
                    Some(backend_envelope::Msg::CleanupAck(ack)) => {
                        if !is_current_session(&state, &cluster_id, generation).await {
                            warn!(%cluster_id, "dropped cleanup ack from stale backend session");
                            continue;
                        }
                        if let Err(err) = handle_cleanup_ack(&state, ack).await {
                            warn!(%cluster_id, %err, "cleanup ack handling failed");
                        }
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

async fn is_current_session(state: &ControlState, cluster_id: &str, generation: u64) -> bool {
    state
        .sessions
        .lock()
        .await
        .get(cluster_id)
        .map(|entry| entry.generation == generation)
        .unwrap_or(false)
}

async fn handle_cleanup_ack(state: &ControlState, ack: CleanupAck) -> Result<()> {
    if !ack.ok {
        return Err(anyhow!("backend cleanup failed for {}: {}", ack.workflow_name, ack.message));
    }
    let workflows: Api<OSMOWorkflow> = Api::namespaced(state.client.clone(), &state.namespace);
    let workflow = match workflows.get(&ack.workflow_name).await {
        Ok(workflow) => workflow,
        Err(kube::Error::Api(err)) if err.code == 404 => return Ok(()),
        Err(err) => return Err(err.into()),
    };
    let current_uid = workflow.metadata.uid.clone().unwrap_or_default();
    if !ack.workflow_uid.is_empty() && ack.workflow_uid != current_uid {
        warn!(
            workflow = %ack.workflow_name,
            ack_uid = %ack.workflow_uid,
            current_uid = %current_uid,
            "ignored cleanup ack for stale workflow uid"
        );
        return Ok(());
    }
    if workflow.meta().deletion_timestamp.is_none() {
        info!(workflow = %ack.workflow_name, "cleanup ack received before workflow deletion; keeping finalizer");
        return Ok(());
    }
    let pending = cleanup_pending_targets(&workflow);
    if !pending.is_empty() {
        let ack_key = cleanup_target_key(&ack.cluster_id, &ack.namespace);
        let remaining = pending
            .into_iter()
            .filter(|target| target != &ack_key)
            .collect::<Vec<_>>();
        patch_cleanup_pending_annotation(&workflows, &ack.workflow_name, &remaining).await?;
        if !remaining.is_empty() {
            info!(
                workflow = %ack.workflow_name,
                namespace = %ack.namespace,
                remaining = remaining.len(),
                "recorded backend cleanup ack; waiting for remaining targets"
            );
            return Ok(());
        }
    }
    patch_finalizers(&workflows, &ack.workflow_name, None).await?;
    info!(workflow = %ack.workflow_name, namespace = %ack.namespace, "removed workflow finalizer after backend cleanup ack");
    Ok(())
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
    let api_bind = env::var("API_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let token = env::var("CLUSTER_TOKEN").context("CLUSTER_TOKEN is required")?;
    let authz_policy = load_api_authz_policy()?;
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
    tokio::spawn(run_api_server(ApiState {
        client: client.clone(),
        namespace: namespace.clone(),
        authz_policy,
    }, api_bind));
    tokio::spawn(status_writer(client.clone(), namespace.clone(), statuses_rx));
    tokio::spawn(ttl_scanner(client.clone(), namespace.clone()));
    watch_workflows(client, namespace, state).await
}

async fn run_api_server(state: ApiState, bind: String) {
    let addr: SocketAddr = match bind.parse() {
        Ok(addr) => addr,
        Err(err) => {
            error!(%bind, %err, "invalid API_BIND");
            return;
        }
    };
    let app = Router::new()
        .route("/api/pool/:pool/workflow", post(submit_workflow_api))
        .layer(DefaultBodyLimit::max(api_body_limit()))
        .with_state(state);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            error!(%bind, %err, "failed to bind workflow API");
            return;
        }
    };
    info!(%bind, "starting workflow API");
    if let Err(err) = axum::serve(listener, app).await {
        error!(%err, "workflow API failed");
    }
}

async fn submit_workflow_api(
    State(state): State<ApiState>,
    Path(pool): Path<String>,
    Query(query): Query<SubmitQuery>,
    headers: HeaderMap,
    Json(template): Json<TemplateData>,
) -> impl IntoResponse {
    let principal = match authorize_api_request(&headers, &state.authz_policy) {
        Ok(principal) => principal,
        Err(err) => {
            let response = SubmitResponse {
                name: String::new(),
                spec: None,
                logs: Some(format!("{err:#}")),
            };
            return (StatusCode::UNAUTHORIZED, Json(response)).into_response();
        }
    };
    if !principal.pools.iter().any(|allowed| allowed == "*" || allowed == &pool) {
        let response = SubmitResponse {
            name: String::new(),
            spec: None,
            logs: Some(format!("subject {} is not authorized for pool {pool}", principal.subject)),
        };
        return (StatusCode::FORBIDDEN, Json(response)).into_response();
    }
    match submit_workflow_from_template(&state, &pool, &principal.subject, &template, query.dry_run, query.validation_only).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(err) => {
            let response = SubmitResponse {
                name: String::new(),
                spec: None,
                logs: Some(format!("{err:#}")),
            };
            (StatusCode::BAD_REQUEST, Json(response)).into_response()
        }
    }
}

fn authorize_api_request(headers: &HeaderMap, policy: &[ApiPrincipal]) -> Result<ApiPrincipal> {
    let actual = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| anyhow!("missing bearer token"))?;
    policy
        .iter()
        .find(|principal| principal.token == actual)
        .cloned()
        .ok_or_else(|| anyhow!("invalid bearer token"))
}

fn load_api_authz_policy() -> Result<Vec<ApiPrincipal>> {
    let raw = env::var("API_AUTHZ_POLICY_JSON").context("API_AUTHZ_POLICY_JSON is required")?;
    let policy: Vec<ApiPrincipal> = serde_json::from_str(&raw).context("parse API_AUTHZ_POLICY_JSON")?;
    if policy.is_empty() {
        bail!("API_AUTHZ_POLICY_JSON must define at least one principal");
    }
    for principal in &policy {
        if principal.token.is_empty() {
            bail!("API_AUTHZ_POLICY_JSON principal token cannot be empty");
        }
        if principal.subject.is_empty() {
            bail!("API_AUTHZ_POLICY_JSON principal subject cannot be empty");
        }
        if principal.pools.is_empty() {
            bail!("API_AUTHZ_POLICY_JSON principal {} must allow at least one pool", principal.subject);
        }
    }
    Ok(policy)
}

fn api_body_limit() -> usize {
    env::var("API_BODY_LIMIT_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024)
}

async fn submit_workflow_from_template(
    state: &ApiState,
    pool: &str,
    subject: &str,
    template: &TemplateData,
    dry_run: bool,
    validation_only: bool,
) -> Result<SubmitResponse> {
    if template
        .uploaded_templated_spec
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        bail!("uploaded_templated_spec is not supported by the Phase 1 API adapter");
    }
    let rendered = render_osmo_template(&template.file, &template.set_variables, &template.set_string_variables)?;
    let workflow_value: serde_yaml::Value = serde_yaml::from_str(&rendered).context("parse rendered OSMO workflow YAML")?;
    validate_osmo_yaml_contract(&workflow_value)?;
    let workflow_name = yaml_path(&workflow_value, &["workflow", "name"])
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("workflow.name is required"))?;
    let crd_name = sanitize_k8s_name(workflow_name);
    if dry_run {
        return Ok(SubmitResponse {
            name: crd_name,
            spec: Some(rendered),
            logs: None,
        });
    }
    let workflow = osmo_yaml_to_workflow_crd(&workflow_value, &crd_name, pool, subject)?;
    if validation_only {
        let spec = serde_yaml::to_string(&workflow.spec)?;
        return Ok(SubmitResponse {
            name: crd_name,
            spec: Some(spec),
            logs: Some("Workflow validation succeeded.".to_string()),
        });
    }
    let workflows: Api<OSMOWorkflow> = Api::namespaced(state.client.clone(), &state.namespace);
    match workflows.create(&PostParams::default(), &workflow).await {
        Ok(_) => {}
        Err(kube::Error::Api(err)) if err.code == 409 => {
            workflows
                .patch(
                    &crd_name,
                    &PatchParams::default(),
                    &Patch::Merge(json!({
                        "metadata": {
                            "labels": workflow.metadata.labels,
                            "annotations": workflow.metadata.annotations,
                        },
                        "spec": workflow.spec,
                    })),
                )
                .await?;
        }
        Err(err) => return Err(err.into()),
    }
    Ok(SubmitResponse {
        name: crd_name,
        spec: None,
        logs: Some("Workflow submitted.".to_string()),
    })
}

fn render_osmo_template(raw: &str, set_variables: &[String], set_string_variables: &[String]) -> Result<String> {
    let mut context = serde_json::Map::new();
    if let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(raw) {
        merge_template_defaults(&mut context, yaml_path(&value, &["default-values"]))?;
        merge_template_defaults(&mut context, yaml_path(&value, &["workflow", "default-values"]))?;
    }
    for item in set_variables {
        let (key, value) = parse_set_variable(item)?;
        let parsed = match serde_yaml::from_str::<serde_yaml::Value>(value) {
            Ok(value) => yaml_to_json(&value)?,
            Err(_) => serde_json::Value::String(value.to_string()),
        };
        context.insert(key.to_string(), parsed);
    }
    for item in set_string_variables {
        let (key, value) = parse_set_variable(item)?;
        context.insert(key.to_string(), serde_json::Value::String(value.to_string()));
    }
    let env = minijinja::Environment::new();
    env.template_from_str(raw)
        .context("parse Jinja workflow template")?
        .render(serde_json::Value::Object(context))
        .context("render Jinja workflow template")
}

fn merge_template_defaults(context: &mut serde_json::Map<String, serde_json::Value>, defaults: Option<&serde_yaml::Value>) -> Result<()> {
    let Some(defaults) = defaults.and_then(|value| value.as_mapping()) else {
        return Ok(());
    };
    for (key, value) in defaults {
        if let Some(key) = key.as_str() {
            context.insert(key.to_string(), yaml_to_json(value)?);
        }
    }
    Ok(())
}

fn parse_set_variable(item: &str) -> Result<(&str, &str)> {
    item.split_once('=')
        .ok_or_else(|| anyhow!("set variable {item:?} must be formatted as key=value"))
}

fn osmo_yaml_to_workflow_crd(value: &serde_yaml::Value, crd_name: &str, pool: &str, subject: &str) -> Result<OSMOWorkflow> {
    let workflow = yaml_path(value, &["workflow"]).ok_or_else(|| anyhow!("workflow section is required"))?;
    let mut task_groups = Vec::new();
    if let Some(groups) = yaml_path(workflow, &["groups"]).and_then(|value| value.as_sequence()) {
        for group in groups {
            let group_name = yaml_path(group, &["name"])
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow!("workflow.groups[].name is required"))?;
            let tasks = yaml_path(group, &["tasks"])
                .and_then(|value| value.as_sequence())
                .ok_or_else(|| anyhow!("workflow.groups[{group_name}].tasks is required"))?;
            task_groups.push(osmo_tasks_to_task_group(crd_name, group_name, tasks, workflow, pool)?);
        }
    } else {
        let tasks = yaml_path(workflow, &["tasks"])
            .and_then(|value| value.as_sequence())
            .ok_or_else(|| anyhow!("workflow.tasks is required"))?;
        for task in tasks {
            let task_name = yaml_path(task, &["name"])
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow!("workflow.tasks[].name is required"))?;
            task_groups.push(osmo_tasks_to_task_group(crd_name, task_name, std::slice::from_ref(task), workflow, pool)?);
        }
    }
    if task_groups.is_empty() {
        bail!("workflow must define at least one task");
    }
    Ok(OSMOWorkflow {
        metadata: ObjectMeta {
            name: Some(crd_name.to_string()),
            labels: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/source".to_string(), "osmo-yaml-api".to_string()),
                ("spike.osmo.nvidia.com/pool".to_string(), pool.to_string()),
            ])),
            annotations: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/compatibility".to_string(), "osmo-yaml-v1".to_string()),
                ("spike.osmo.nvidia.com/submitted-by".to_string(), subject.to_string()),
            ])),
            ..Default::default()
        },
        spec: OSMOWorkflowSpec {
            cluster_id: DEFAULT_CLUSTER_ID.to_string(),
            namespace: DEFAULT_BACKEND_NAMESPACE.to_string(),
            task_groups,
            ttl_seconds_after_finished: Some(300),
        },
        status: None,
    })
}

fn validate_osmo_yaml_contract(value: &serde_yaml::Value) -> Result<()> {
    validate_keys(value, "root", &["workflow", "default-values"])?;
    let workflow = yaml_path(value, &["workflow"]).ok_or_else(|| anyhow!("workflow section is required"))?;
    validate_keys(workflow, "workflow", &["name", "resources", "tasks", "groups", "default-values"])?;
    if yaml_path(workflow, &["tasks"]).is_some() && yaml_path(workflow, &["groups"]).is_some() {
        bail!("workflow cannot define both tasks and groups in the Phase 1 API adapter");
    }
    validate_resources(yaml_path(workflow, &["resources"]), "workflow.resources")?;
    if let Some(tasks) = yaml_path(workflow, &["tasks"]).and_then(|value| value.as_sequence()) {
        for task in tasks {
            validate_task(task, "workflow.tasks[]")?;
        }
    }
    if let Some(groups) = yaml_path(workflow, &["groups"]).and_then(|value| value.as_sequence()) {
        for group in groups {
            validate_keys(group, "workflow.groups[]", &["name", "tasks"])?;
            let group_name = yaml_path(group, &["name"])
                .and_then(|value| value.as_str())
                .unwrap_or("<unnamed>");
            let tasks = yaml_path(group, &["tasks"])
                .and_then(|value| value.as_sequence())
                .ok_or_else(|| anyhow!("workflow.groups[{group_name}].tasks is required"))?;
            for task in tasks {
                validate_task(task, &format!("workflow.groups[{group_name}].tasks[]"))?;
            }
        }
    }
    Ok(())
}

fn validate_task(task: &serde_yaml::Value, path: &str) -> Result<()> {
    validate_keys(
        task,
        path,
        &["name", "image", "command", "args", "environment", "resources", "files"],
    )?;
    validate_resources(yaml_path(task, &["resources"]), &format!("{path}.resources"))?;
    if let Some(files) = yaml_path(task, &["files"]).and_then(|value| value.as_sequence()) {
        for file in files {
            validate_keys(file, &format!("{path}.files[]"), &["path", "contents"])?;
        }
    }
    Ok(())
}

fn validate_resources(value: Option<&serde_yaml::Value>, path: &str) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    validate_keys(value, path, &["default", "cpu", "memory", "gpu", "storage"])?;
    if let Some(defaults) = yaml_path(value, &["default"]) {
        validate_keys(defaults, &format!("{path}.default"), &["cpu", "memory", "gpu", "storage"])?;
    }
    Ok(())
}

fn validate_keys(value: &serde_yaml::Value, path: &str, allowed: &[&str]) -> Result<()> {
    let Some(mapping) = value.as_mapping() else {
        return Ok(());
    };
    for key in mapping.keys() {
        let Some(key) = key.as_str() else {
            bail!("{path} keys must be strings");
        };
        if !allowed.iter().any(|allowed| allowed == &key) {
            bail!("{path}.{key} is not supported by the Phase 1 API adapter");
        }
    }
    Ok(())
}

fn osmo_tasks_to_task_group(
    workflow_name: &str,
    group_name: &str,
    tasks: &[serde_yaml::Value],
    workflow: &serde_yaml::Value,
    pool: &str,
) -> Result<WorkflowTaskGroup> {
    let mut objects = Vec::new();
    for task in tasks {
        objects.extend(osmo_task_to_runtime_objects(workflow_name, group_name, task, workflow)?);
    }
    Ok(WorkflowTaskGroup {
        name: sanitize_k8s_name(group_name),
        runtime_type: Some("kubernetesObjects".to_string()),
        runtime_config: None,
        pool_ref: Some(pool.to_string()),
        rendered_objects: objects,
    })
}

fn osmo_task_to_runtime_objects(
    workflow_name: &str,
    group_name: &str,
    task: &serde_yaml::Value,
    workflow: &serde_yaml::Value,
) -> Result<Vec<serde_json::Value>> {
    let task_name = yaml_path(task, &["name"])
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("task.name is required"))?;
    let image = yaml_path(task, &["image"])
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("task {task_name} image is required"))?;
    let job_name = truncate_name(&sanitize_k8s_name(&format!("{workflow_name}-{task_name}")), 63);
    let mut objects = Vec::new();
    let mut volumes = Vec::new();
    let mut volume_mounts = Vec::new();
    if let Some(files) = yaml_path(task, &["files"]).and_then(|value| value.as_sequence()) {
        for (index, file) in files.iter().enumerate() {
            let path = yaml_path(file, &["path"])
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow!("task {task_name} files[].path is required"))?;
            let contents = yaml_path(file, &["contents"])
                .and_then(|value| value.as_str())
                .ok_or_else(|| anyhow!("task {task_name} files[].contents is required"))?;
            let config_name = truncate_name(&sanitize_k8s_name(&format!("{job_name}-file-{index}")), 63);
            let file_key = path.rsplit('/').next().filter(|name| !name.is_empty()).unwrap_or("file");
            objects.push(json!({
                "apiVersion": "v1",
                "kind": "ConfigMap",
                "metadata": {
                    "name": config_name,
                    "labels": {
                        "spike.osmo.nvidia.com/workflow": workflow_name,
                        "spike.osmo.nvidia.com/group": group_name,
                        "spike.osmo.nvidia.com/task": task_name,
                    },
                },
                "data": {
                    file_key: contents,
                },
            }));
            let volume_name = truncate_name(&sanitize_k8s_name(&format!("file-{index}")), 63);
            volumes.push(json!({
                "name": volume_name,
                "configMap": {
                    "name": config_name,
                    "defaultMode": 493,
                },
            }));
            volume_mounts.push(json!({
                "name": volume_name,
                "mountPath": path,
                "subPath": file_key,
            }));
        }
    }
    let mut container = json!({
        "name": sanitize_k8s_name(task_name),
        "image": image,
    });
    if let Some(command) = yaml_string_array(task, "command")? {
        container["command"] = json!(command);
    }
    if let Some(args) = yaml_string_array(task, "args")? {
        container["args"] = json!(args);
    }
    if let Some(env) = osmo_env(task)? {
        container["env"] = json!(env);
    }
    if let Some(resources) = osmo_resources(task, workflow)? {
        container["resources"] = resources;
    }
    if !volume_mounts.is_empty() {
        container["volumeMounts"] = serde_json::Value::Array(volume_mounts);
    }
    let mut pod_spec = json!({
        "restartPolicy": "Never",
        "containers": [container],
    });
    if !volumes.is_empty() {
        pod_spec["volumes"] = serde_json::Value::Array(volumes);
    }
    objects.push(json!({
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "name": job_name,
            "labels": {
                "spike.osmo.nvidia.com/workflow": workflow_name,
                "spike.osmo.nvidia.com/group": group_name,
                "spike.osmo.nvidia.com/task": task_name,
            },
        },
        "spec": {
            "backoffLimit": 0,
            "template": {
                "spec": pod_spec,
            },
        },
    }));
    Ok(objects)
}

fn yaml_string_array(value: &serde_yaml::Value, field: &str) -> Result<Option<Vec<String>>> {
    let Some(sequence) = yaml_path(value, &[field]).and_then(|value| value.as_sequence()) else {
        return Ok(None);
    };
    sequence
        .iter()
        .map(|item| {
            item.as_str()
                .map(ToString::to_string)
                .ok_or_else(|| anyhow!("{field} entries must be strings"))
        })
        .collect::<Result<Vec<_>>>()
        .map(Some)
}

fn osmo_env(task: &serde_yaml::Value) -> Result<Option<Vec<serde_json::Value>>> {
    let Some(mapping) = yaml_path(task, &["environment"]).and_then(|value| value.as_mapping()) else {
        return Ok(None);
    };
    let mut env = Vec::with_capacity(mapping.len());
    for (key, value) in mapping {
        let name = key.as_str().ok_or_else(|| anyhow!("environment keys must be strings"))?;
        env.push(json!({
            "name": name,
            "value": yaml_scalar_to_string(value)?,
        }));
    }
    Ok(Some(env))
}

fn osmo_resources(task: &serde_yaml::Value, workflow: &serde_yaml::Value) -> Result<Option<serde_json::Value>> {
    let resources = yaml_path(task, &["resources"])
        .or_else(|| yaml_path(workflow, &["resources", "default"]));
    let Some(resources) = resources else {
        return Ok(None);
    };
    let cpu = yaml_path(resources, &["cpu"]).map(yaml_scalar_to_string).transpose()?;
    let memory = yaml_path(resources, &["memory"]).map(yaml_scalar_to_string).transpose()?;
    let gpu = yaml_path(resources, &["gpu"]).map(yaml_scalar_to_string).transpose()?;
    let storage = yaml_path(resources, &["storage"]).map(yaml_scalar_to_string).transpose()?;
    let mut requests = serde_json::Map::new();
    let mut limits = serde_json::Map::new();
    if let Some(cpu) = cpu {
        requests.insert("cpu".to_string(), json!(cpu));
    }
    if let Some(memory) = memory {
        requests.insert("memory".to_string(), json!(memory));
    }
    if let Some(gpu) = gpu.filter(|value| value != "0") {
        requests.insert("nvidia.com/gpu".to_string(), json!(gpu));
        limits.insert("nvidia.com/gpu".to_string(), json!(gpu));
    }
    if let Some(storage) = storage {
        requests.insert("ephemeral-storage".to_string(), json!(storage));
    }
    if requests.is_empty() && limits.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({
        "requests": requests,
        "limits": limits,
    })))
}

fn yaml_path<'a>(value: &'a serde_yaml::Value, path: &[&str]) -> Option<&'a serde_yaml::Value> {
    let mut current = value;
    for segment in path {
        current = current.get(serde_yaml::Value::String(segment.to_string()))?;
    }
    Some(current)
}

fn yaml_to_json(value: &serde_yaml::Value) -> Result<serde_json::Value> {
    serde_json::to_value(value).context("convert YAML value to JSON")
}

fn yaml_scalar_to_string(value: &serde_yaml::Value) -> Result<String> {
    match value {
        serde_yaml::Value::String(value) => Ok(value.clone()),
        serde_yaml::Value::Number(value) => Ok(value.to_string()),
        serde_yaml::Value::Bool(value) => Ok(value.to_string()),
        _ => Err(anyhow!("expected scalar value")),
    }
}

fn sanitize_k8s_name(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut last_dash = false;
    for ch in input.chars().flat_map(|ch| ch.to_lowercase()) {
        let valid = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        if valid {
            output.push(ch);
            last_dash = false;
        } else if !last_dash {
            output.push('-');
            last_dash = true;
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "workflow".to_string()
    } else {
        truncate_name(trimmed, 63)
    }
}

fn truncate_name(input: &str, max_len: usize) -> String {
    if input.len() <= max_len {
        return input.to_string();
    }
    input[..max_len].trim_matches('-').to_string()
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
    if status.observed_generation == workflow.metadata.generation && !status.groups.is_empty() {
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
    let current_status = workflow.status.clone().unwrap_or_default();
    let same_generation = current_status.observed_generation == workflow.metadata.generation;
    let mut groups = Vec::with_capacity(workflow.spec.task_groups.len());
    let mut desired_otg_names = Vec::with_capacity(workflow.spec.task_groups.len());
    let mut clusters_to_sync = Vec::new();
    let mut pruned_targets = Vec::new();
    for group in &workflow.spec.task_groups {
        let placement = resolve_pool_placement(state, workflow, group).await?;
        if let Some(old_target) = ensure_control_taskgroup(&taskgroups, workflow, group, &placement).await? {
            pruned_targets.push(old_target);
        }
        if !clusters_to_sync.iter().any(|item| item == &placement.cluster_id) {
            clusters_to_sync.push(placement.cluster_id.clone());
        }
        let otg_name = taskgroup_name(&name, &group.name, workflow.metadata.uid.as_deref().unwrap_or_default());
        desired_otg_names.push(otg_name.clone());
        let previous = current_status.groups.iter().find(|item| item.name == group.name);
        groups.push(WorkflowGroupStatus {
            name: group.name.clone(),
            otg_name,
            namespace: placement.namespace,
            phase: if same_generation {
                previous.map(|item| item.phase.clone()).unwrap_or_else(|| "Pending".to_string())
            } else {
                "Pending".to_string()
            },
            message: if same_generation {
                previous.and_then(|item| item.message.clone())
            } else {
                Some("workflow generation changed; waiting for backend reconciliation".to_string())
            },
        });
    }
    pruned_targets.extend(prune_removed_control_taskgroups(state, &name, &desired_otg_names).await?);
    for (cluster_id, _) in &pruned_targets {
        if !clusters_to_sync.iter().any(|item| item == cluster_id) {
            clusters_to_sync.push(cluster_id.clone());
        }
    }
    let pending = OSMOWorkflowStatus {
        phase: Some(workflow_phase(&groups)),
        message: Some("desired taskgroups recorded and synced via ClusterSession".to_string()),
        completion_time: if same_generation { current_status.completion_time } else { None },
        observed_generation: workflow.metadata.generation,
        groups,
    };
    patch_workflow_status(workflows, &name, pending).await?;
    for cluster_id in clusters_to_sync {
        let prune_namespaces = pruned_targets
            .iter()
            .filter(|(target_cluster, _)| target_cluster == &cluster_id)
            .map(|(_, namespace)| namespace.clone())
            .collect::<Vec<_>>();
        sync_assigned_taskgroups(state, &cluster_id, true, Vec::new(), Vec::new(), prune_namespaces).await?;
    }
    Ok(())
}

async fn reconcile_workflow_delete(
    workflows: &Api<OSMOWorkflow>,
    state: &ControlState,
    workflow: OSMOWorkflow,
) -> Result<()> {
    let name = workflow.name_any();
    let workflow_uid = workflow.metadata.uid.clone().unwrap_or_default();
    let mut targets = workflow_prune_targets(state, &name, &workflow_uid).await?;
    let pending = cleanup_pending_targets(&workflow);
    if !pending.is_empty() {
        targets = pending
            .into_iter()
            .filter_map(|target| cleanup_target_from_key(&name, &workflow_uid, &target))
            .collect();
    } else if !targets.is_empty() {
        let pending_targets = targets
            .iter()
            .map(|(cluster_id, target)| cleanup_target_key(cluster_id, &target.namespace))
            .collect::<Vec<_>>();
        patch_cleanup_pending_annotation(workflows, &name, &pending_targets).await?;
    }
    let mut sent = false;
    for (cluster_id, target) in targets {
        sent = true;
        if let Err(err) = sync_assigned_taskgroups(state, &cluster_id, false, Vec::new(), vec![target], Vec::new()).await {
            warn!(%name, %cluster_id, %err, "taskgroup prune sync failed; keeping finalizer");
            return Ok(());
        }
    }
    if !sent {
        let target = PruneWorkflowTarget {
            workflow_name: name.clone(),
            workflow_uid,
            namespace: workflow.spec.namespace.clone(),
        };
        patch_cleanup_pending_annotation(
            workflows,
            &name,
            &[cleanup_target_key(&workflow.spec.cluster_id, &workflow.spec.namespace)],
        )
        .await?;
        if let Err(err) = sync_assigned_taskgroups(state, &workflow.spec.cluster_id, false, Vec::new(), vec![target], Vec::new()).await {
            warn!(%name, %err, "taskgroup prune sync failed; keeping finalizer");
            return Ok(());
        }
    }
    delete_control_taskgroups(state, &name).await?;
    Ok(())
}

async fn ensure_control_taskgroup(
    taskgroups: &Api<OSMOTaskGroup>,
    workflow: &OSMOWorkflow,
    group: &WorkflowTaskGroup,
    placement: &PoolPlacement,
) -> Result<Option<(String, String)>> {
    let workflow_name = workflow.name_any();
    let workflow_uid = workflow.metadata.uid.clone().unwrap_or_default();
    let name = taskgroup_name(&workflow_name, &group.name, &workflow_uid);
    let otg = OSMOTaskGroup {
        metadata: ObjectMeta {
            name: Some(name.clone()),
            labels: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/workflow".to_string(), workflow_name.clone()),
                ("spike.osmo.nvidia.com/group".to_string(), group.name.clone()),
                ("spike.osmo.nvidia.com/cluster".to_string(), placement.cluster_id.clone()),
                ("spike.osmo.nvidia.com/pool".to_string(), placement.pool_name.clone()),
                ("spike.osmo.nvidia.com/scheduler".to_string(), placement.scheduler_type.clone()),
                ("spike.osmo.nvidia.com/role".to_string(), "desired".to_string()),
            ])),
            ..Default::default()
        },
        spec: OSMOTaskGroupSpec {
            workflow_name,
            workflow_uid: Some(workflow_uid),
            desired_task_group_uid: None,
            desired_generation: None,
            group_name: group.name.clone(),
            cluster_id: placement.cluster_id.clone(),
            target_namespace: placement.namespace.clone(),
            runtime_type: group.runtime_type.clone(),
            runtime_config: group.runtime_config.clone(),
            pool_ref: Some(placement.pool_name.clone()),
            rendered_objects: group.rendered_objects.clone(),
        },
        status: None,
    };
    let mut old_target = None;
    match taskgroups.create(&PostParams::default(), &otg).await {
        Ok(_) => info!(%name, "created desired OSMOTaskGroup"),
        Err(kube::Error::Api(err)) if err.code == 409 => {
            let existing = taskgroups.get(&name).await?;
            if existing.spec.cluster_id != placement.cluster_id || existing.spec.target_namespace != placement.namespace {
                old_target = Some((existing.spec.cluster_id.clone(), existing.spec.target_namespace.clone()));
            }
            taskgroups.patch(&name, &PatchParams::default(), &Patch::Merge(json!({
                "metadata": {
                    "labels": {
                        "spike.osmo.nvidia.com/workflow": otg.spec.workflow_name,
                        "spike.osmo.nvidia.com/group": otg.spec.group_name,
                        "spike.osmo.nvidia.com/cluster": otg.spec.cluster_id,
                        "spike.osmo.nvidia.com/pool": placement.pool_name.clone(),
                        "spike.osmo.nvidia.com/scheduler": placement.scheduler_type.clone(),
                        "spike.osmo.nvidia.com/role": "desired"
                    }
                },
                "spec": otg.spec
            }))).await?;
            info!(%name, "patched desired OSMOTaskGroup");
        }
        Err(err) => return Err(err.into()),
    }
    Ok(old_target)
}

async fn resolve_pool_placement(
    state: &ControlState,
    workflow: &OSMOWorkflow,
    group: &WorkflowTaskGroup,
) -> Result<PoolPlacement> {
    let pool_name = group.pool_ref.as_deref().unwrap_or(POOL_NAME);
    let pools: Api<OSMOPool> = Api::namespaced(state.client.clone(), &state.namespace);
    let pool = match pools.get(pool_name).await {
        Ok(pool) => pool,
        Err(kube::Error::Api(err)) if err.code == 404 && group.pool_ref.is_none() => {
            return Ok(PoolPlacement {
                pool_name: pool_name.to_string(),
                cluster_id: workflow.spec.cluster_id.clone(),
                namespace: workflow.spec.namespace.clone(),
                scheduler_type: "none".to_string(),
            });
        }
        Err(err) => return Err(err.into()),
    };
    if pool.spec.maintenance {
        return Err(anyhow!("pool {pool_name} is in maintenance"));
    }
    let clusters: Api<OSMOCluster> = Api::namespaced(state.client.clone(), &state.namespace);
    let cluster_id = match clusters.get(&pool.spec.cluster_ref).await {
        Ok(cluster) => cluster.spec.cluster_id,
        Err(kube::Error::Api(err)) if err.code == 404 => pool.spec.cluster_ref.clone(),
        Err(err) => return Err(err.into()),
    };
    Ok(PoolPlacement {
        pool_name: pool_name.to_string(),
        cluster_id,
        namespace: pool.spec.namespace,
        scheduler_type: pool.spec.scheduler_type,
    })
}

async fn prune_removed_control_taskgroups(
    state: &ControlState,
    workflow_name: &str,
    desired_names: &[String],
) -> Result<Vec<(String, String)>> {
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let list = taskgroups
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/workflow={workflow_name},spike.osmo.nvidia.com/role=desired")))
        .await?;
    let mut targets = Vec::new();
    for otg in list {
        let name = otg.name_any();
        if desired_names.iter().any(|item| item == &name) {
            continue;
        }
        let target = (otg.spec.cluster_id.clone(), otg.spec.target_namespace.clone());
        if !targets.iter().any(|item| item == &target) {
            targets.push(target);
        }
        match taskgroups.delete(&name, &DeleteParams::default()).await {
            Ok(_) => info!(%name, workflow = %workflow_name, "deleted removed desired OSMOTaskGroup"),
            Err(kube::Error::Api(err)) if err.code == 404 => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(targets)
}

async fn workflow_prune_targets(
    state: &ControlState,
    workflow_name: &str,
    workflow_uid: &str,
) -> Result<Vec<(String, PruneWorkflowTarget)>> {
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let list = taskgroups
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/workflow={workflow_name},spike.osmo.nvidia.com/role=desired")))
        .await?;
    let mut targets = Vec::new();
    for otg in list {
        let cluster_id = otg.spec.cluster_id.clone();
        let namespace = otg.spec.target_namespace.clone();
        if targets.iter().any(|(existing_cluster, existing): &(String, PruneWorkflowTarget)| {
            existing_cluster == &cluster_id && existing.namespace == namespace
        }) {
            continue;
        }
        targets.push((cluster_id, PruneWorkflowTarget {
            workflow_name: workflow_name.to_string(),
            workflow_uid: workflow_uid.to_string(),
            namespace,
        }));
    }
    Ok(targets)
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
    prune_targets: Vec<PruneWorkflowTarget>,
    prune_namespaces: Vec<String>,
) -> Result<()> {
    let taskgroups: Api<OSMOTaskGroup> = Api::namespaced(state.client.clone(), &state.namespace);
    let list = taskgroups
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/cluster={cluster_id},spike.osmo.nvidia.com/role=desired")))
        .await?;
    let desired = list
        .into_iter()
        .filter(|otg| {
            !prune_targets.iter().any(|target| {
                target.workflow_name == otg.spec.workflow_name
                    && (target.workflow_uid.is_empty()
                        || otg.spec.workflow_uid.as_deref().unwrap_or_default() == target.workflow_uid)
            })
        })
        .map(|otg| DesiredTaskGroup {
            workflow_name: otg.spec.workflow_name.clone(),
            task_group_name: otg.spec.group_name.clone(),
            task_group_namespace: otg.spec.target_namespace.clone(),
            uid: otg.metadata.uid.unwrap_or_default(),
            generation: otg.metadata.generation.unwrap_or_default(),
            workflow_uid: otg.spec.workflow_uid.unwrap_or_default(),
            cluster_id: otg.spec.cluster_id,
            runtime_type: otg.spec.runtime_type.unwrap_or_else(|| "osmoContainerGroup".to_string()),
            runtime_config_json: otg.spec.runtime_config.map(|value| value.to_string()).unwrap_or_default(),
            pool_ref: otg.spec.pool_ref.unwrap_or_else(|| POOL_NAME.to_string()),
            rendered_objects_json: serde_json::to_string(&otg.spec.rendered_objects).unwrap_or_else(|_| "[]".to_string()),
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
            prune_targets,
            prune_namespaces,
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
        let workflow = match workflows.get(&status.workflow_name).await {
            Ok(workflow) => workflow,
            Err(err) => {
                warn!(workflow = %status.workflow_name, %err, "status for unknown workflow");
                continue;
            }
        };
        let workflow_uid = workflow.metadata.uid.clone().unwrap_or_default();
        if !status.workflow_uid.is_empty() && status.workflow_uid != workflow_uid {
            warn!(
                workflow = %status.workflow_name,
                status_uid = %status.workflow_uid,
                current_uid = %workflow_uid,
                "dropped status for stale workflow uid"
            );
            continue;
        }
        let otg_name = taskgroup_name(&status.workflow_name, &status.task_group_name, &workflow_uid);
        let current_otg = match taskgroups.get(&otg_name).await {
            Ok(otg) => otg,
            Err(err) => {
                warn!(taskgroup = %otg_name, %err, "status for unknown desired taskgroup");
                continue;
            }
        };
        if !status.cluster_id.is_empty() && status.cluster_id != current_otg.spec.cluster_id {
            warn!(
                workflow = %status.workflow_name,
                status_cluster = %status.cluster_id,
                taskgroup_cluster = %current_otg.spec.cluster_id,
                "dropped status for wrong cluster"
            );
            continue;
        }
        let current_otg_uid = current_otg.metadata.uid.clone().unwrap_or_default();
        if !status.task_group_uid.is_empty() && status.task_group_uid != current_otg_uid {
            warn!(
                taskgroup = %otg_name,
                status_uid = %status.task_group_uid,
                current_uid = %current_otg_uid,
                "dropped status for stale taskgroup uid"
            );
            continue;
        }
        let current_generation = current_otg.metadata.generation.unwrap_or_default();
        if status.observed_generation > 0 && status.observed_generation < current_generation {
            warn!(
                taskgroup = %otg_name,
                observed_generation = status.observed_generation,
                current_generation,
                "dropped status for stale taskgroup generation"
            );
            continue;
        }
        let otg_status = OSMOTaskGroupStatus {
            phase: Some(status.phase.clone()),
            message: Some(status.message.clone()),
            observed_time: Some(Utc::now()),
            observed_generation: Some(status.observed_generation),
        };
        if let Err(err) = patch_taskgroup_status(&taskgroups, &otg_name, otg_status).await {
            warn!(taskgroup = %otg_name, %err, "patch desired taskgroup status failed");
        }
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
        wf_status.observed_generation = workflow.metadata.generation;
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
    let token = env::var("CLUSTER_TOKEN").context("CLUSTER_TOKEN is required")?;
    let client = Client::try_default().await?;
    let state = BackendState {
        monitors: Arc::new(Mutex::new(HashMap::new())),
    };
    let mut backoff = Duration::from_secs(2);
    loop {
        match backend_session(state.clone(), client.clone(), &operator_url, operator_authority.as_deref(), &cluster_id, &namespace, &token).await {
            Ok(()) => warn!("backend session ended"),
            Err(err) => warn!(error = ?err, "backend session failed"),
        }
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
    }
}

async fn backend_session(
    state: BackendState,
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
                handle_taskgroup_sync(state.clone(), client.clone(), namespace, cluster_id, &tx, sync).await?;
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
    state: BackendState,
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
    let mut desired_namespaces = Vec::new();
    for desired in sync.task_groups {
        let namespace = desired_namespace(default_namespace, &desired);
        let key = format!("{}/{}", namespace, taskgroup_name(&desired.workflow_name, &desired.task_group_name, &desired.workflow_uid));
        desired_keys.insert(key, ());
        if !desired_namespaces.iter().any(|item| item == &namespace) {
            desired_namespaces.push(namespace.clone());
        }
        let reconcile_client = client.clone();
        let reconcile_state = state.clone();
        let reconcile_tx = tx.clone();
        let reconcile_cluster_id = local_cluster_id.to_string();
        tokio::spawn(async move {
            if let Err(err) = reconcile_desired_taskgroup(
                reconcile_state,
                reconcile_client,
                &namespace,
                &reconcile_cluster_id,
                &reconcile_tx,
                desired,
            )
            .await
            {
                warn!(%err, "desired taskgroup reconcile failed");
            }
        });
    }
    for workflow_name in sync.prune_workflows {
        prune_workflow_taskgroups(state.clone(), client.clone(), default_namespace, local_cluster_id, tx, &workflow_name, "").await?;
    }
    for target in sync.prune_targets {
        let namespace = if target.namespace.is_empty() {
            default_namespace.to_string()
        } else {
            target.namespace.clone()
        };
        prune_workflow_taskgroups(
            state.clone(),
            client.clone(),
            &namespace,
            local_cluster_id,
            tx,
            &target.workflow_name,
            &target.workflow_uid,
        )
        .await?;
    }
    if sync.full {
        for namespace in sync.prune_namespaces {
            if !namespace.is_empty() && !desired_namespaces.iter().any(|item| item == &namespace) {
                desired_namespaces.push(namespace);
            }
        }
        if desired_namespaces.is_empty() {
            desired_namespaces.push(default_namespace.to_string());
        }
        prune_absent_taskgroups(state, client, &desired_namespaces, local_cluster_id, tx, &desired_keys).await?;
    }
    Ok(())
}

async fn reconcile_desired_taskgroup(
    state: BackendState,
    client: Client,
    namespace: &str,
    local_cluster_id: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    desired: DesiredTaskGroup,
) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client.clone(), namespace);
    let name = taskgroup_name(&desired.workflow_name, &desired.task_group_name, &desired.workflow_uid);
    let cluster_id = desired_cluster_id(local_cluster_id, &desired);
    let runtime_config = parse_json_value(&desired.runtime_config_json);
    let rendered_objects = parse_json_array(&desired.rendered_objects_json);
    let otg = OSMOTaskGroup {
        metadata: ObjectMeta {
            name: Some(name.clone()),
            labels: Some(BTreeMap::from([
                ("spike.osmo.nvidia.com/workflow".to_string(), desired.workflow_name.clone()),
                ("spike.osmo.nvidia.com/group".to_string(), desired.task_group_name.clone()),
                ("spike.osmo.nvidia.com/cluster".to_string(), cluster_id.clone()),
                ("spike.osmo.nvidia.com/role".to_string(), "mirror".to_string()),
            ])),
            ..Default::default()
        },
        spec: OSMOTaskGroupSpec {
            workflow_name: desired.workflow_name.clone(),
            workflow_uid: Some(desired.workflow_uid.clone()),
            desired_task_group_uid: Some(desired.uid.clone()),
            desired_generation: Some(desired.generation),
            group_name: desired.task_group_name.clone(),
            cluster_id: cluster_id.clone(),
            target_namespace: namespace.to_string(),
            runtime_type: Some(desired.runtime_type.clone()),
            runtime_config,
            pool_ref: Some(desired.pool_ref.clone()),
            rendered_objects,
        },
        status: None,
    };
    match api.create(&PostParams::default(), &otg).await {
        Ok(_) => info!(%name, %namespace, "created mirrored OSMOTaskGroup"),
        Err(kube::Error::Api(err)) if err.code == 409 => {
            let existing = api.get(&name).await?;
            if runtime_spec_changed(&existing.spec, &otg.spec) {
                cleanup_runtime_confirmed(client.clone(), namespace, &name, &existing.spec).await?;
            }
            api.patch(&name, &PatchParams::default(), &Patch::Merge(json!({
                "metadata": {
                    "labels": {
                        "spike.osmo.nvidia.com/workflow": desired.workflow_name,
                        "spike.osmo.nvidia.com/group": desired.task_group_name,
                        "spike.osmo.nvidia.com/cluster": cluster_id.clone(),
                        "spike.osmo.nvidia.com/role": "mirror"
                    }
                },
                "spec": otg.spec
            }))).await?;
            info!(%name, %namespace, "patched mirrored OSMOTaskGroup");
        }
        Err(err) => return Err(err.into()),
    };
    let mirror = api.get(&name).await?;
    let mirror_uid = mirror.metadata.uid.clone().unwrap_or_default();
    if let Err(err) = reconcile_runtime(client.clone(), namespace, &name, &mirror_uid, &otg.spec).await {
        let runtime_status = RuntimeStatus {
            phase: "Failed".to_string(),
            message: format!("runtime reconcile failed: {err:#}"),
        };
        patch_backend_taskgroup_and_report(
            client.clone(),
            &api,
            &name,
            tx,
            &desired,
            namespace,
            &cluster_id,
            &otg.spec,
            &runtime_status,
            true,
        )
        .await?;
        return Ok(());
    }

    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Ack(TaskGroupAck {
            workflow_name: desired.workflow_name.clone(),
            task_group_name: desired.task_group_name.clone(),
            task_group_namespace: namespace.to_string(),
            observed_generation: desired.generation,
            ok: true,
            message: "runtime accepted by TaskGroup Controller".to_string(),
            workflow_uid: desired.workflow_uid.clone(),
            task_group_uid: desired.uid.clone(),
            cluster_id: cluster_id.clone(),
        })),
    })
    .await?;
    let running_status = RuntimeStatus {
        phase: "Running".to_string(),
        message: "runtime accepted; monitoring backend resource status".to_string(),
    };
    patch_backend_taskgroup_and_report(
        client.clone(),
        &api,
        &name,
        tx,
        &desired,
        namespace,
        &cluster_id,
        &otg.spec,
        &running_status,
        false,
    )
    .await?;

    replace_runtime_monitor(
        state,
        client.clone(),
        namespace.to_string(),
        name,
        tx.clone(),
        desired,
        cluster_id,
        otg.spec,
    )
    .await?;
    Ok(())
}

async fn replace_runtime_monitor(
    state: BackendState,
    client: Client,
    namespace: String,
    mirror_name: String,
    tx: mpsc::Sender<BackendEnvelope>,
    desired: DesiredTaskGroup,
    cluster_id: String,
    spec: OSMOTaskGroupSpec,
) -> Result<()> {
    let key = monitor_key(&namespace, &mirror_name);
    let marker = format!("{}:{}", desired.uid, desired.generation);
    if let Some(old) = state.monitors.lock().await.remove(&key) {
        old.handle.abort();
    }
    let task_state = state.clone();
    let task_key = key.clone();
    let task_marker = marker.clone();
    let handle = tokio::spawn(async move {
        let api: Api<OSMOTaskGroup> = Api::namespaced(client.clone(), &namespace);
        let runtime_status = match wait_runtime_ready(client.clone(), &namespace, &mirror_name, &spec).await {
            Ok(status) => status,
            Err(err) => RuntimeStatus {
                phase: "Failed".to_string(),
                message: format!("runtime readiness failed: {err:#}"),
            },
        };
        if runtime_status.phase != "Superseded" {
            if let Err(err) = patch_backend_taskgroup_and_report(
                client,
                &api,
                &mirror_name,
                &tx,
                &desired,
                &namespace,
                &cluster_id,
                &spec,
                &runtime_status,
                false,
            )
            .await
            {
                warn!(%err, taskgroup = %mirror_name, namespace = %namespace, "runtime monitor status update failed");
            }
        } else {
            info!(taskgroup = %mirror_name, namespace = %namespace, "runtime monitor superseded");
        }
        let mut monitors = task_state.monitors.lock().await;
        if monitors
            .get(&task_key)
            .map(|entry| entry.marker.as_str())
            == Some(task_marker.as_str())
        {
            monitors.remove(&task_key);
        }
    });
    state.monitors.lock().await.insert(key, RuntimeMonitor { marker, handle });
    Ok(())
}

async fn abort_runtime_monitor(state: &BackendState, namespace: &str, mirror_name: &str) {
    if let Some(old) = state.monitors.lock().await.remove(&monitor_key(namespace, mirror_name)) {
        old.handle.abort();
    }
}

fn monitor_key(namespace: &str, mirror_name: &str) -> String {
    format!("{namespace}/{mirror_name}")
}

async fn patch_backend_taskgroup_and_report(
    client: Client,
    api: &Api<OSMOTaskGroup>,
    mirror_name: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    desired: &DesiredTaskGroup,
    namespace: &str,
    cluster_id: &str,
    spec: &OSMOTaskGroupSpec,
    runtime_status: &RuntimeStatus,
    send_ack: bool,
) -> Result<()> {
    let status = OSMOTaskGroupStatus {
        phase: Some(runtime_status.phase.clone()),
        message: Some(runtime_status.message.clone()),
        observed_time: Some(Utc::now()),
        observed_generation: Some(desired.generation),
    };
    match patch_taskgroup_status(api, mirror_name, status).await {
        Ok(()) => {}
        Err(err) if is_kube_not_found(&err) => {
            cleanup_runtime_confirmed(client, namespace, mirror_name, spec).await?;
            info!(
                taskgroup = %mirror_name,
                %namespace,
                "mirror disappeared during runtime reconcile; cleaned applied runtime"
            );
            return Ok(());
        }
        Err(err) => return Err(err),
    }
    if send_ack {
        tx.send(BackendEnvelope {
            msg: Some(backend_envelope::Msg::Ack(TaskGroupAck {
                workflow_name: desired.workflow_name.clone(),
                task_group_name: desired.task_group_name.clone(),
                task_group_namespace: namespace.to_string(),
                observed_generation: desired.generation,
                ok: runtime_status.phase != "Failed",
                message: runtime_status.message.clone(),
                workflow_uid: desired.workflow_uid.clone(),
                task_group_uid: desired.uid.clone(),
                cluster_id: cluster_id.to_string(),
            })),
        })
        .await?;
    }
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::Status(TaskGroupStatus {
            workflow_name: desired.workflow_name.clone(),
            task_group_name: desired.task_group_name.clone(),
            task_group_namespace: namespace.to_string(),
            phase: runtime_status.phase.clone(),
            message: runtime_status.message.clone(),
            workflow_uid: desired.workflow_uid.clone(),
            task_group_uid: desired.uid.clone(),
            observed_generation: desired.generation,
            cluster_id: cluster_id.to_string(),
        })),
    })
    .await?;
    Ok(())
}

async fn prune_workflow_taskgroups(
    state: BackendState,
    client: Client,
    namespace: &str,
    local_cluster_id: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    workflow_name: &str,
    workflow_uid: &str,
) -> Result<()> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client.clone(), namespace);
    let list = api
        .list(&ListParams::default().labels(&format!("spike.osmo.nvidia.com/workflow={workflow_name},spike.osmo.nvidia.com/role=mirror")))
        .await?;
    for otg in list {
        if !workflow_uid.is_empty() && otg.spec.workflow_uid.as_deref().unwrap_or_default() != workflow_uid {
            continue;
        }
        let name = otg.name_any();
        abort_runtime_monitor(&state, namespace, &name).await;
        match api.delete(&name, &DeleteParams::default()).await {
            Ok(_) => info!(%name, %namespace, workflow = %workflow_name, "pruned mirrored OSMOTaskGroup"),
            Err(kube::Error::Api(err)) if err.code == 404 => {}
            Err(err) => return Err(err.into()),
        }
        cleanup_runtime_confirmed(client.clone(), namespace, &name, &otg.spec).await?;
    }
    tx.send(BackendEnvelope {
        msg: Some(backend_envelope::Msg::CleanupAck(CleanupAck {
            workflow_name: workflow_name.to_string(),
            workflow_uid: workflow_uid.to_string(),
            cluster_id: local_cluster_id.to_string(),
            namespace: namespace.to_string(),
            ok: true,
            message: "pruned mirrored taskgroups".to_string(),
        })),
    })
    .await?;
    Ok(())
}

async fn prune_absent_taskgroups(
    state: BackendState,
    client: Client,
    namespaces: &[String],
    local_cluster_id: &str,
    tx: &mpsc::Sender<BackendEnvelope>,
    desired_keys: &HashMap<String, ()>,
) -> Result<()> {
    for namespace in namespaces {
        let api: Api<OSMOTaskGroup> = Api::namespaced(client.clone(), namespace);
        let list = api
            .list(&ListParams::default().labels("spike.osmo.nvidia.com/role=mirror"))
            .await?;
        for otg in list {
            let name = otg.name_any();
            let key = format!("{}/{}", namespace, name);
            if desired_keys.contains_key(&key) {
                continue;
            }
            let workflow_name = otg.spec.workflow_name.clone();
            let workflow_uid = otg.spec.workflow_uid.clone().unwrap_or_default();
            abort_runtime_monitor(&state, namespace, &name).await;
            match api.delete(&name, &DeleteParams::default()).await {
                Ok(_) => info!(%name, %namespace, "pruned stale mirrored OSMOTaskGroup after full sync"),
                Err(kube::Error::Api(err)) if err.code == 404 => {}
                Err(err) => return Err(err.into()),
            }
            cleanup_runtime_confirmed(client.clone(), namespace, &name, &otg.spec).await?;
            tx.send(BackendEnvelope {
                msg: Some(backend_envelope::Msg::CleanupAck(CleanupAck {
                    workflow_name,
                    workflow_uid,
                    cluster_id: local_cluster_id.to_string(),
                    namespace: namespace.to_string(),
                    ok: true,
                    message: "pruned stale mirrored taskgroup after full sync".to_string(),
                })),
            })
            .await?;
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

fn desired_cluster_id(default_cluster_id: &str, desired: &DesiredTaskGroup) -> String {
    if desired.cluster_id.is_empty() {
        default_cluster_id.to_string()
    } else {
        desired.cluster_id.clone()
    }
}

fn parse_json_value(raw: &str) -> Option<serde_json::Value> {
    if raw.trim().is_empty() {
        return None;
    }
    match serde_json::from_str(raw) {
        Ok(value) => Some(value),
        Err(err) => {
            warn!(%err, "failed to decode runtimeConfig JSON");
            None
        }
    }
}

fn parse_json_array(raw: &str) -> Vec<serde_json::Value> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(err) => {
            warn!(%err, "failed to decode renderedObjects JSON");
            Vec::new()
        }
    }
}

async fn reconcile_runtime(
    client: Client,
    namespace: &str,
    taskgroup_name: &str,
    taskgroup_uid: &str,
    spec: &OSMOTaskGroupSpec,
) -> Result<()> {
    for object in runtime_objects(namespace, taskgroup_name, spec)? {
        apply_dynamic_object(client.clone(), namespace, taskgroup_name, taskgroup_uid, object).await?;
    }
    Ok(())
}

async fn cleanup_runtime_confirmed(client: Client, namespace: &str, taskgroup_name: &str, spec: &OSMOTaskGroupSpec) -> Result<()> {
    let objects = match runtime_objects(namespace, taskgroup_name, spec) {
        Ok(objects) => objects,
        Err(err) => {
            warn!(%namespace, taskgroup = %taskgroup_name, %err, "runtime spec could not be reconstructed during cleanup; assuming no runtime objects were created");
            return Ok(());
        }
    };
    let refs = objects
        .iter()
        .map(|object| dynamic_ref(object, namespace))
        .collect::<Result<Vec<_>>>()?;
    for object in &objects {
        delete_dynamic_object(client.clone(), namespace, object).await?;
    }
    let deadline = std::time::Instant::now() + cleanup_timeout();
    for object_ref in refs {
        wait_dynamic_absent(client.clone(), &object_ref, deadline).await?;
    }
    Ok(())
}

fn runtime_objects(namespace: &str, taskgroup_name: &str, spec: &OSMOTaskGroupSpec) -> Result<Vec<serde_json::Value>> {
    match spec.runtime_type.as_deref().unwrap_or("osmoContainerGroup") {
        "osmoContainerGroup" | "osmoWorkflow" | "kubernetesObjects" => {
            let mut objects = Vec::with_capacity(spec.rendered_objects.len());
            for object in &spec.rendered_objects {
                let mut value = object.clone();
                ensure_object_identity(&mut value, namespace, taskgroup_name)?;
                add_runtime_labels(&mut value)?;
                objects.push(value);
            }
            Ok(objects)
        }
        "rayJob" => Ok(vec![ray_object("RayJob", namespace, taskgroup_name, spec)?]),
        "rayCluster" => Ok(vec![ray_object("RayCluster", namespace, taskgroup_name, spec)?]),
        other => bail!("unsupported runtimeType {other} for taskgroup {taskgroup_name}"),
    }
}

async fn wait_runtime_ready(client: Client, namespace: &str, taskgroup_name: &str, spec: &OSMOTaskGroupSpec) -> Result<RuntimeStatus> {
    let objects = runtime_objects(namespace, taskgroup_name, spec)?;
    if objects.is_empty() {
        return Ok(RuntimeStatus {
            phase: "Succeeded".to_string(),
            message: "no runtime objects required".to_string(),
        });
    }
    let refs = objects
        .iter()
        .map(|object| dynamic_ref(object, namespace))
        .collect::<Result<Vec<_>>>()?;
    let deadline = runtime_monitor_deadline();
    loop {
        if !mirror_still_current(client.clone(), namespace, taskgroup_name, spec).await? {
            return Ok(RuntimeStatus {
                phase: "Superseded".to_string(),
                message: "runtime monitor superseded by a newer mirrored taskgroup spec".to_string(),
            });
        }
        let mut messages = Vec::with_capacity(refs.len());
        let mut all_succeeded = true;
        for object_ref in &refs {
            let status = runtime_object_status(client.clone(), object_ref).await?;
            messages.push(status.message.clone());
            match status.phase.as_str() {
                "Succeeded" => {}
                "Failed" => {
                    return Ok(RuntimeStatus {
                        phase: "Failed".to_string(),
                        message: messages.join("; "),
                    });
                }
                _ => all_succeeded = false,
            }
        }
        if all_succeeded {
            return Ok(RuntimeStatus {
                phase: "Succeeded".to_string(),
                message: messages.join("; "),
            });
        }
        if deadline
            .map(|deadline| std::time::Instant::now() >= deadline)
            .unwrap_or(false)
        {
            return Ok(RuntimeStatus {
                phase: "Failed".to_string(),
                message: format!("runtime readiness timed out: {}", messages.join("; ")),
            });
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

async fn mirror_still_current(client: Client, namespace: &str, taskgroup_name: &str, spec: &OSMOTaskGroupSpec) -> Result<bool> {
    let api: Api<OSMOTaskGroup> = Api::namespaced(client, namespace);
    let mirror = match api.get(taskgroup_name).await {
        Ok(mirror) => mirror,
        Err(kube::Error::Api(err)) if err.code == 404 => return Ok(false),
        Err(err) => return Err(err.into()),
    };
    Ok(mirror.spec.desired_task_group_uid == spec.desired_task_group_uid
        && mirror.spec.desired_generation == spec.desired_generation
        && !runtime_spec_changed(&mirror.spec, spec))
}

async fn runtime_object_status(client: Client, object_ref: &RuntimeObjectRef) -> Result<RuntimeStatus> {
    let api: Api<DynamicObject> = Api::namespaced_with(client, &object_ref.namespace, &object_ref.api_resource);
    let object = match api.get(&object_ref.name).await {
        Ok(object) => object,
        Err(kube::Error::Api(err)) if err.code == 404 => {
            return Ok(RuntimeStatus {
                phase: "Pending".to_string(),
                message: format!("{}/{} not created yet", object_ref.api_resource.kind, object_ref.name),
            });
        }
        Err(err) => return Err(err.into()),
    };
    let value = serde_json::to_value(&object)?;
    Ok(map_runtime_status(&object_ref.api_resource.kind, &object_ref.name, &value))
}

fn map_runtime_status(kind: &str, name: &str, value: &serde_json::Value) -> RuntimeStatus {
    let null = serde_json::Value::Null;
    let status = value.get("status").unwrap_or(&null);
    match kind {
        "ConfigMap" => RuntimeStatus {
            phase: "Succeeded".to_string(),
            message: format!("{kind}/{name} exists"),
        },
        "Job" => {
            let succeeded = status.get("succeeded").and_then(|value| value.as_i64()).unwrap_or_default();
            let failed = status.get("failed").and_then(|value| value.as_i64()).unwrap_or_default();
            if job_condition_is_true(status, "Complete") || succeeded > 0 {
                RuntimeStatus {
                    phase: "Succeeded".to_string(),
                    message: format!("Job/{name} completed"),
                }
            } else if job_condition_is_true(status, "Failed") {
                RuntimeStatus {
                    phase: "Failed".to_string(),
                    message: format!("Job/{name} failed={failed}"),
                }
            } else {
                RuntimeStatus {
                    phase: "Running".to_string(),
                    message: format!("Job/{name} waiting for completion"),
                }
            }
        }
        "RayJob" => match status.get("jobStatus").and_then(|value| value.as_str()).unwrap_or_default() {
            "SUCCEEDED" => RuntimeStatus {
                phase: "Succeeded".to_string(),
                message: format!("RayJob/{name} SUCCEEDED"),
            },
            "FAILED" => RuntimeStatus {
                phase: "Failed".to_string(),
                message: format!("RayJob/{name} FAILED"),
            },
            job_status => RuntimeStatus {
                phase: "Running".to_string(),
                message: format!("RayJob/{name} jobStatus={job_status}"),
            },
        },
        "RayCluster" => match status.get("state").and_then(|value| value.as_str()).unwrap_or_default() {
            "ready" | "Ready" | "READY" | "Running" | "RUNNING" => RuntimeStatus {
                phase: "Succeeded".to_string(),
                message: format!("RayCluster/{name} is ready"),
            },
            "failed" | "Failed" | "FAILED" => RuntimeStatus {
                phase: "Failed".to_string(),
                message: format!("RayCluster/{name} failed"),
            },
            state => RuntimeStatus {
                phase: "Running".to_string(),
                message: format!("RayCluster/{name} state={state}"),
            },
        },
        _ => RuntimeStatus {
            phase: "Succeeded".to_string(),
            message: format!("{kind}/{name} exists"),
        },
    }
}

fn job_condition_is_true(status: &serde_json::Value, condition_type: &str) -> bool {
    status
        .get("conditions")
        .and_then(|value| value.as_array())
        .map(|conditions| {
            conditions.iter().any(|condition| {
                condition.get("type").and_then(|value| value.as_str()) == Some(condition_type)
                    && condition.get("status").and_then(|value| value.as_str()) == Some("True")
            })
        })
        .unwrap_or(false)
}

async fn wait_dynamic_absent(client: Client, object_ref: &RuntimeObjectRef, deadline: std::time::Instant) -> Result<()> {
    let api: Api<DynamicObject> = Api::namespaced_with(client, &object_ref.namespace, &object_ref.api_resource);
    loop {
        match api.get(&object_ref.name).await {
            Ok(_) if std::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            Ok(_) => {
                return Err(anyhow!(
                    "timed out waiting for {}/{} to be deleted",
                    object_ref.api_resource.kind,
                    object_ref.name
                ));
            }
            Err(kube::Error::Api(err)) if err.code == 404 => return Ok(()),
            Err(err) => return Err(err.into()),
        }
    }
}

fn dynamic_ref(value: &serde_json::Value, default_namespace: &str) -> Result<RuntimeObjectRef> {
    let (api_resource, namespace, name) = dynamic_target(value, default_namespace)?;
    Ok(RuntimeObjectRef {
        api_resource,
        namespace,
        name,
    })
}

fn runtime_spec_changed(old: &OSMOTaskGroupSpec, new: &OSMOTaskGroupSpec) -> bool {
    old.runtime_type != new.runtime_type
        || old.runtime_config != new.runtime_config
        || old.rendered_objects != new.rendered_objects
}

fn runtime_monitor_deadline() -> Option<std::time::Instant> {
    env::var("RUNTIME_MONITOR_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .map(|seconds| std::time::Instant::now() + Duration::from_secs(seconds))
}

fn cleanup_timeout() -> Duration {
    env::var("CLEANUP_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(300))
}

fn is_kube_not_found(err: &anyhow::Error) -> bool {
    err.downcast_ref::<kube::Error>()
        .and_then(|err| match err {
            kube::Error::Api(api_err) => Some(api_err.code == 404),
            _ => None,
        })
        .unwrap_or(false)
}

fn ray_object(kind: &str, namespace: &str, taskgroup_name: &str, spec: &OSMOTaskGroupSpec) -> Result<serde_json::Value> {
    let runtime = spec.runtime_config.clone().unwrap_or_else(|| json!({}));
    let name = runtime
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or(taskgroup_name);
    let ray_spec = runtime
        .get("spec")
        .cloned()
        .or_else(|| runtime.get("raySpec").cloned())
        .unwrap_or_else(|| runtime.clone());
    Ok(json!({
        "apiVersion": "ray.io/v1",
        "kind": kind,
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": runtime_labels(&spec.workflow_name, spec.workflow_uid.as_deref().unwrap_or_default(), &spec.group_name, &spec.cluster_id),
        },
        "spec": ray_spec,
    }))
}

async fn apply_dynamic_object(
    client: Client,
    default_namespace: &str,
    taskgroup_name: &str,
    taskgroup_uid: &str,
    mut value: serde_json::Value,
) -> Result<()> {
    ensure_object_identity(&mut value, default_namespace, taskgroup_name)?;
    add_runtime_labels(&mut value)?;
    add_runtime_owner_reference(&mut value, taskgroup_name, taskgroup_uid)?;
    let (api_resource, namespace, name) = dynamic_target(&value, default_namespace)?;
    let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &api_resource);
    let object: DynamicObject = serde_json::from_value(value)?;
    api.patch(
        &name,
        &PatchParams::apply("osmo-rust-spike").force(),
        &Patch::Apply(&object),
    )
    .await?;
    info!(%namespace, %name, kind = %api_resource.kind, "applied runtime object");
    Ok(())
}

async fn delete_dynamic_object(client: Client, default_namespace: &str, value: &serde_json::Value) -> Result<()> {
    let (api_resource, namespace, name) = dynamic_target(value, default_namespace)?;
    let api: Api<DynamicObject> = Api::namespaced_with(client, &namespace, &api_resource);
    match api.delete(&name, &DeleteParams::default()).await {
        Ok(_) => info!(%namespace, %name, kind = %api_resource.kind, "deleted runtime object"),
        Err(kube::Error::Api(err)) if err.code == 404 => {}
        Err(err) => return Err(err.into()),
    }
    Ok(())
}

fn ensure_object_identity(value: &mut serde_json::Value, default_namespace: &str, default_name: &str) -> Result<()> {
    if value.get("apiVersion").and_then(|item| item.as_str()).unwrap_or_default().is_empty() {
        return Err(anyhow!("rendered runtime object is missing apiVersion"));
    }
    if value.get("kind").and_then(|item| item.as_str()).unwrap_or_default().is_empty() {
        return Err(anyhow!("rendered runtime object is missing kind"));
    }
    let metadata = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("rendered runtime object must be an object"))?
        .entry("metadata")
        .or_insert_with(|| json!({}));
    let metadata = metadata
        .as_object_mut()
        .ok_or_else(|| anyhow!("rendered runtime object metadata must be an object"))?;
    metadata.entry("name").or_insert_with(|| json!(default_name));
    metadata.entry("namespace").or_insert_with(|| json!(default_namespace));
    Ok(())
}

fn add_runtime_labels(value: &mut serde_json::Value) -> Result<()> {
    let Some(metadata) = value.get_mut("metadata").and_then(|item| item.as_object_mut()) else {
        return Ok(());
    };
    let labels = metadata.entry("labels").or_insert_with(|| json!({}));
    let labels = labels
        .as_object_mut()
        .ok_or_else(|| anyhow!("runtime object labels must be an object"))?;
    labels.entry("spike.osmo.nvidia.com/runtime-managed".to_string()).or_insert_with(|| json!("true"));
    Ok(())
}

fn add_runtime_owner_reference(value: &mut serde_json::Value, taskgroup_name: &str, taskgroup_uid: &str) -> Result<()> {
    if taskgroup_uid.is_empty() {
        return Ok(());
    }
    let Some(metadata) = value.get_mut("metadata").and_then(|item| item.as_object_mut()) else {
        return Ok(());
    };
    metadata.insert("ownerReferences".to_string(), json!([{
        "apiVersion": "spike.osmo.nvidia.com/v1alpha1",
        "kind": "OSMOTaskGroup",
        "name": taskgroup_name,
        "uid": taskgroup_uid,
        "controller": true,
        "blockOwnerDeletion": true,
    }]));
    Ok(())
}

fn dynamic_target(value: &serde_json::Value, default_namespace: &str) -> Result<(ApiResource, String, String)> {
    let api_version = value
        .get("apiVersion")
        .and_then(|item| item.as_str())
        .ok_or_else(|| anyhow!("runtime object missing apiVersion"))?;
    let kind = value
        .get("kind")
        .and_then(|item| item.as_str())
        .ok_or_else(|| anyhow!("runtime object missing kind"))?;
    let metadata = value
        .get("metadata")
        .and_then(|item| item.as_object())
        .ok_or_else(|| anyhow!("runtime object missing metadata"))?;
    let name = metadata
        .get("name")
        .and_then(|item| item.as_str())
        .ok_or_else(|| anyhow!("runtime object missing metadata.name"))?
        .to_string();
    let namespace = metadata
        .get("namespace")
        .and_then(|item| item.as_str())
        .unwrap_or(default_namespace)
        .to_string();
    validate_runtime_kind(api_version, kind)?;
    let (group, version) = split_api_version(api_version);
    let gvk = GroupVersionKind::gvk(&group, &version, kind);
    Ok((ApiResource::from_gvk(&gvk), namespace, name))
}

fn validate_runtime_kind(api_version: &str, kind: &str) -> Result<()> {
    match (api_version, kind) {
        ("v1", "ConfigMap") | ("batch/v1", "Job") | ("ray.io/v1", "RayJob" | "RayCluster") => Ok(()),
        _ => bail!("runtime object {api_version}/{kind} is outside the Phase 1 backend allowlist"),
    }
}

fn split_api_version(api_version: &str) -> (String, String) {
    if let Some((group, version)) = api_version.split_once('/') {
        (group.to_string(), version.to_string())
    } else {
        ("".to_string(), api_version.to_string())
    }
}

fn runtime_labels(workflow_name: &str, workflow_uid: &str, group_name: &str, cluster_id: &str) -> serde_json::Value {
    json!({
        "spike.osmo.nvidia.com/runtime-managed": "true",
        "spike.osmo.nvidia.com/workflow": workflow_name,
        "spike.osmo.nvidia.com/workflow-uid": workflow_uid,
        "spike.osmo.nvidia.com/group": group_name,
        "spike.osmo.nvidia.com/cluster": cluster_id,
    })
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
                workflow_name: otg.spec.workflow_name.clone(),
                task_group_name: otg.spec.group_name.clone(),
                task_group_namespace: namespace.to_string(),
                phase: status.phase.unwrap_or_else(|| "Pending".to_string()),
                message: status.message.unwrap_or_else(|| "resync".to_string()),
                workflow_uid: otg.spec.workflow_uid.unwrap_or_default(),
                task_group_uid: otg.spec.desired_task_group_uid.unwrap_or_default(),
                observed_generation: otg
                    .spec
                    .desired_generation
                    .or(status.observed_generation)
                    .unwrap_or_default(),
                cluster_id: otg.spec.cluster_id,
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

fn cleanup_target_key(cluster_id: &str, namespace: &str) -> String {
    format!("{cluster_id}|{namespace}")
}

fn cleanup_target_from_key(
    workflow_name: &str,
    workflow_uid: &str,
    key: &str,
) -> Option<(String, PruneWorkflowTarget)> {
    let (cluster_id, namespace) = key.split_once('|')?;
    Some((cluster_id.to_string(), PruneWorkflowTarget {
        workflow_name: workflow_name.to_string(),
        workflow_uid: workflow_uid.to_string(),
        namespace: namespace.to_string(),
    }))
}

fn cleanup_pending_targets(workflow: &OSMOWorkflow) -> Vec<String> {
    workflow
        .metadata
        .annotations
        .as_ref()
        .and_then(|annotations| annotations.get(CLEANUP_PENDING_ANNOTATION))
        .map(|raw| {
            raw.split(',')
                .filter(|item| !item.trim().is_empty())
                .map(|item| item.trim().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn patch_cleanup_pending_annotation(api: &Api<OSMOWorkflow>, name: &str, targets: &[String]) -> Result<()> {
    let value = if targets.is_empty() {
        serde_json::Value::Null
    } else {
        json!(targets.join(","))
    };
    api.patch(
        name,
        &PatchParams::default(),
        &Patch::Merge(json!({
            "metadata": {
                "annotations": {
                    CLEANUP_PENDING_ANNOTATION: value
                }
            }
        })),
    )
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

fn taskgroup_name(workflow_name: &str, group_name: &str, workflow_uid: &str) -> String {
    let raw = format!("{workflow_name}-{group_name}");
    let hash_input = format!("{workflow_name}/{group_name}/{workflow_uid}");
    let mut hasher = DefaultHasher::new();
    hash_input.hash(&mut hasher);
    let suffix = format!("{:010x}", hasher.finish() & 0xffffffffff);
    let base = raw.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' { ch.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(52)
        .collect::<String>();
    let base = if base.is_empty() { "taskgroup".to_string() } else { base };
    format!("{base}-{suffix}")
}

fn workflow_phase(groups: &[WorkflowGroupStatus]) -> String {
    if groups.iter().any(|group| group.phase == "Failed") {
        "Failed".to_string()
    } else if !groups.is_empty() && groups.iter().all(|group| group.phase == "Succeeded") {
        "Succeeded".to_string()
    } else if groups.iter().any(|group| group.phase == "Running") {
        "Running".to_string()
    } else {
        "Pending".to_string()
    }
}
