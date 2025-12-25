import { getLoginInfo } from "@/lib/auth/login-info";
import { getAuthClientSecret } from "@/lib/config";

export async function GET(request: Request) {
  const loginInfo = await getLoginInfo();
  const refreshToken = request.headers.get("x-refresh-token") ?? "";
  const clientSecret = getAuthClientSecret();

  if (!refreshToken) {
    return Response.json({ isFailure: true, error: "No refresh token provided" }, { status: 400 });
  }

  if (!loginInfo.token_endpoint) {
    return Response.json({ isFailure: true, error: "Token endpoint not configured" }, { status: 500 });
  }

  // Build params - client_secret is required for confidential clients
  const params = new URLSearchParams({
    client_id: loginInfo.browser_client_id,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(loginInfo.token_endpoint, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      method: "POST",
    });

    const data = await response.json();

    if (response.status !== 200) {
      // Return the actual error from the auth server
      return Response.json(
        {
          isFailure: true,
          error: data.error_description || data.error || `Auth server returned ${response.status}`,
          authError: data.error, // e.g., "invalid_grant" for expired refresh token
        },
        { status: response.status },
      );
    }

    return Response.json({
      isFailure: false,
      id_token: data.id_token,
      refresh_token: data.refresh_token,
    });
  } catch (error) {
    // Network error reaching auth server
    return Response.json(
      {
        isFailure: true,
        error: `Failed to reach auth server: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 502 },
    );
  }
}
