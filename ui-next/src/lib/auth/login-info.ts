/**
 * Login info from the backend auth endpoint.
 */

import { getApiHostname, isSslEnabled } from "@/lib/config";
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

/**
 * Auth disabled fallback - returned when backend is unavailable.
 */
const AUTH_DISABLED: LoginInfo = {
  auth_enabled: false,
  device_endpoint: "",
  device_client_id: "",
  browser_endpoint: "",
  browser_client_id: "",
  token_endpoint: "",
  logout_endpoint: "",
};

export async function getLoginInfo(): Promise<LoginInfo> {
  const scheme = isSslEnabled() ? "https" : "http";
  const apiHostname = getApiHostname();
  const backendUrl = `${scheme}://${apiHostname}`;

  try {
    const res = await fetch(`${backendUrl}/api/auth/login`, {
      cache: "no-store",
    });
    if (!res.ok) {
      logWarn(`Backend auth endpoint unavailable: ${res.status} ${res.statusText}`);
      return AUTH_DISABLED;
    }
    const loginInfo = (await res.json()) as LoginInfo;
    loginInfo.auth_enabled = Boolean(loginInfo.device_endpoint);
    return loginInfo;
  } catch (error) {
    logWarn(`Backend unavailable, auth disabled: ${(error as Error).message}`);
    return AUTH_DISABLED;
  }
}
