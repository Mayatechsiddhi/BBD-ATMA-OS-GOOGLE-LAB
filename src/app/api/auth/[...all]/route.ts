import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { trustedAuthRequest } from "@/lib/auth-proxy";
export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
export async function GET(request: Request) {
  const trusted = trustedAuthRequest(request);
  return trusted instanceof Response ? trusted : handlers.GET(trusted);
}
export async function POST(request: Request) {
  const trusted = trustedAuthRequest(request);
  return trusted instanceof Response ? trusted : handlers.POST(trusted);
}
