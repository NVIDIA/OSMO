/**
 * Login info from the backend auth endpoint.
 */

import { getApiHostname, getAuthHostname, isSslEnabled, isBuildPhase } from "@/lib/config";
import { logWarn } from "@/lib/logger";

export interface LoginInfo {
  auth_enabled: boolean;
  device_endpoint: string;
  device_client_id: string;
  browser_endpoint: string;
  browser_client_id: string;
  token_endpoint: string;
  logout_endpoint: string;
}

export async function getLoginInfo(): Promise<LoginInfo> {
  const scheme = isSslEnabled() ? "https" : "http";
  const apiHostname = getApiHostname();
  const authHostname = getAuthHostname();
  const backendUrl = `${scheme}://${apiHostname}`;

  // Default login info (fallback if backend doesn't respond)
  const defaultLoginInfo: LoginInfo = {
    auth_enabled: true,
    device_endpoint: "",
    device_client_id: "",
    browser_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/auth`,
    browser_client_id: "osmo-browser-flow",
    token_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/token`,
    logout_endpoint: `${scheme}://${authHostname}/realms/osmo/protocol/openid-connect/logout`,
  };

  // Avoid network calls during static generation
  if (isBuildPhase()) {
    return defaultLoginInfo;
  }

  try {
    const res = await fetch(`${backendUrl}/api/auth/login`, {
      cache: "no-store",
    });
    const loginInfo = (await res.json()) as LoginInfo;
    loginInfo.auth_enabled = Boolean(loginInfo.device_endpoint);
    return loginInfo;
  } catch (error) {
    logWarn(`Host does not support /api/auth/login: ${(error as Error).message}`);
    return defaultLoginInfo;
  }
}
