import { getLoginInfo } from "@/lib/auth/login-info";

export async function GET() {
  const loginInfo = await getLoginInfo();

  return new Response(JSON.stringify(loginInfo), {
    headers: { "Content-Type": "application/json" },
  });
}
