import { OutlinedIcon } from "~/components/Icon";
import { Colors, Tag } from "~/components/Tag";
import { type ServiceConfig } from "~/models/config/service-config";

export const ServiceConfigCard = ({
  serviceConfig,
  isShowingJSON,
  canEdit,
}: {
  serviceConfig: ServiceConfig;
  isShowingJSON: boolean;
  canEdit: boolean;
}) => {
  if (isShowingJSON) {
    return <pre className="p-global text-sm font-mono">{JSON.stringify(serviceConfig, null, 2)}</pre>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-global p-global w-full">
      <section
        aria-labelledby="general-title"
        className="body-component shadow-xl"
      >
        <div className="popup-header body-header">
          <h2 id="general-title">General</h2>
          {canEdit && (
            <button
              className="btn btn-secondary"
              aria-label="Edit Profile"
              onClick={() => {
                console.log("todo");
              }}
            >
              <OutlinedIcon name="edit" />
              Edit
            </button>
          )}
        </div>
        <dl
          aria-labelledby="general-title"
          className="p-global"
        >
          <dt>Service Base URL</dt>
          <dd>{serviceConfig.service_base_url}</dd>
          <dt>Max Pod Restart Limit</dt>
          <dd>{serviceConfig.max_pod_restart_limit}</dd>
          <dt>Agent Queue Size</dt>
          <dd>{serviceConfig.agent_queue_size}</dd>
        </dl>
      </section>
      <section
        aria-labelledby="cli_config-title"
        className="body-component shadow-xl"
      >
        <div className="popup-header body-header">
          <h2 id="cli_config-title">CLI Config</h2>
          {canEdit && (
            <button
              className="btn btn-secondary"
              aria-label="Edit Profile"
              onClick={() => {
                console.log("todo");
              }}
            >
              <OutlinedIcon name="edit" />
              Edit
            </button>
          )}
        </div>
        <dl
          aria-labelledby="cli_config-title"
          className="p-global"
        >
          <dt>Latest Version</dt>
          <dd>{serviceConfig.cli_config.latest_version}</dd>
          <dt>Min Supported Version</dt>
          <dd>{serviceConfig.cli_config.min_supported_version}</dd>
        </dl>
      </section>
      <section
        aria-labelledby="auth-title"
        className="body-component shadow-xl"
      >
        <div className="popup-header body-header">
          <h2 id="auth-title">Authentication</h2>
          {canEdit && (
            <button
              className="btn btn-secondary"
              aria-label="Edit Profile"
              onClick={() => {
                console.log("todo");
              }}
            >
              <OutlinedIcon name="edit" />
              Edit
            </button>
          )}
        </div>
        <dl
          aria-labelledby="auth-title"
          className="p-global"
        >
          <dt>Issuer</dt>
          <dd>{serviceConfig.service_auth.issuer}</dd>
          <dt>Audience</dt>
          <dd>{serviceConfig.service_auth.audience}</dd>
          <dt>User Roles</dt>
          <dd>
            <div className="flex flex-wrap gap-1">
              {serviceConfig.service_auth.user_roles.map((role) => (
                <Tag
                  color={Colors.tag}
                  key={role}
                  className="inline-block"
                >
                  {role}
                </Tag>
              ))}
            </div>
          </dd>
          <dt>Ctrl Roles</dt>
          <dd>
            <div className="flex flex-wrap gap-1">
              {serviceConfig.service_auth.ctrl_roles.map((role) => (
                <Tag
                  color={Colors.pool}
                  key={role}
                  className="inline-block"
                >
                  {role}
                </Tag>
              ))}
            </div>
          </dd>
          <dt>Max Token Duration</dt>
          <dd>{serviceConfig.service_auth.max_token_duration}</dd>
        </dl>
      </section>
      <section
        aria-labelledby="login_info-title"
        className="body-component shadow-xl xl:col-span-3"
      >
        <div className="popup-header body-header">
          <h2 id="login_info-title">Login Info</h2>
          {canEdit && (
            <button
              className="btn btn-secondary"
              aria-label="Edit Profile"
              onClick={() => {
                console.log("todo");
              }}
            >
              <OutlinedIcon name="edit" />
              Edit
            </button>
          )}
        </div>
        <dl
          aria-labelledby="login_info-title"
          className="p-global"
        >
          <dt>Device Client ID</dt>
          <dd>{serviceConfig.service_auth.login_info.device_client_id}</dd>
          <dt>Browser Client ID</dt>
          <dd>{serviceConfig.service_auth.login_info.browser_client_id}</dd>
          <dt>Device Endpoint</dt>
          <dd>{serviceConfig.service_auth.login_info.device_endpoint}</dd>
          <dt>Browser Endpoint</dt>
          <dd>{serviceConfig.service_auth.login_info.browser_endpoint}</dd>
          <dt>Token Endpoint</dt>
          <dd>{serviceConfig.service_auth.login_info.token_endpoint}</dd>
          <dt>Logout Endpoint</dt>
          <dd>{serviceConfig.service_auth.login_info.logout_endpoint}</dd>
        </dl>
      </section>
    </div>
  );
};
