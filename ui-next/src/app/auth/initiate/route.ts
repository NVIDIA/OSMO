import { getLoginInfo } from "@/lib/auth/login-info";

export async function GET(request: Request) {
  const loginInfo = await getLoginInfo();

  const redirectUri = new URL("/auth/callback", request.url);

  return new Response(
    JSON.stringify({
      redirectTo:
        `${loginInfo.browser_endpoint}` +
        `?client_id=${loginInfo.browser_client_id}` +
        `&response_type=code` +
        `&redirect_uri=${redirectUri.toString()}` +
        `&scope=${encodeURIComponent("openid offline_access profile email")}` +
        `&state=${encodeURIComponent(request.headers.get("referer") ?? redirectUri.origin)}`,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
