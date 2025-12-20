import { getLoginInfo } from "@/lib/auth/login-info";
import { getAuthClientSecret } from "@/lib/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const loginInfo = await getLoginInfo();

  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("client_id", `${loginInfo.browser_client_id}`);
  params.append("client_secret", getAuthClientSecret());
  params.append("code", code);
  params.append("redirect_uri", `${url.origin}/auth/callback`);

  const response = await fetch(`${loginInfo.token_endpoint}`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    method: "POST",
  });

  if (!response.ok) {
    // Log to server stderr, not client console
    const errorText = await response.text();
    return new Response(`Token exchange failed: ${errorText}`, { status: 500 });
  }

  const data = (await response.json()) as {
    id_token: string;
    refresh_token: string;
  };

  const redirectTo = new URL(`/auth/success`, url.origin);
  redirectTo.searchParams.append("id_token", data.id_token);
  redirectTo.searchParams.append("refresh_token", data.refresh_token);
  redirectTo.searchParams.append("redirect_to", state);

  return Response.redirect(redirectTo.toString());
}
