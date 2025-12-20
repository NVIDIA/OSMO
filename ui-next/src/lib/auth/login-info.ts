/**
 * Login info from the backend auth endpoint.
 */

export interface LoginInfo {
  auth_enabled: boolean;
  device_endpoint: string;
  device_client_id: string;
  browser_endpoint: string;
  browser_client_id: string;
  token_endpoint: string;
  logout_endpoint: string;
}

const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "fernandol-dev.osmo.nvidia.com";
const authHostname = process.env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME || "auth-staging.osmo.nvidia.com";
const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
const scheme = sslEnabled ? "https" : "http";

export async function getLoginInfo(): Promise<LoginInfo> {
  // Default login info (fallback if backend doesn't respond)
  let loginInfo: LoginInfo = {
    auth_enabled: true,
    device_endpoint: "",
    device_client_id: "",
    browser_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/auth`,
    browser_client_id: "osmo-browser-flow",
    token_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/token`,
    logout_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/logout`,
  };

  // Avoid network calls during static generation
  const isStaticGeneration =
    typeof window === "undefined" &&
    (process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NEXT_PHASE === "phase-export");

  if (isStaticGeneration) {
    return loginInfo;
  }

  try {
    const res = await fetch(`${scheme}://${apiHostname}/api/auth/login`, {
      cache: "no-store",
    });
    loginInfo = (await res.json()) as LoginInfo;
    loginInfo.auth_enabled = Boolean(loginInfo.device_endpoint);
  } catch (error) {
    console.warn(
      `Host does not support /api/auth/login: ${(error as Error).message}`
    );
  }

  return loginInfo;
}

