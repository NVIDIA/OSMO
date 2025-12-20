import { getLoginInfo } from "@/lib/auth/login-info";
import { getAuthClientSecret } from "@/lib/config";

export async function GET(request: Request) {
  const loginInfo = await getLoginInfo();
  const refreshToken = request.headers.get("x-refresh-token") ?? "";

  if (!refreshToken) {
    return new Response(
      JSON.stringify({ isFailure: true, error: "No refresh token provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const params = new URLSearchParams({
    client_id: loginInfo.browser_client_id,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_secret: getAuthClientSecret(),
  });

  try {
    const response = await fetch(loginInfo.token_endpoint, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      method: "POST",
    });

    const data = await response.json();

    return new Response(
      JSON.stringify({
        isFailure: response.status !== 200,
        id_token: data.id_token,
        refresh_token: data.refresh_token,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        isFailure: true,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
