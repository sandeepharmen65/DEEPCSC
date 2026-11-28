const siteOrigin = "https://deepcsc.dpdns.org";
const ownerEmails = new Set(["sandeepharmen@gmail.com", "punjabcsco6@gmail.com"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function configuredKey(legacyName: string, keySetName: string): string {
  const legacy = Deno.env.get(legacyName) || "";
  if (legacy) return legacy;
  try {
    const keySet = JSON.parse(Deno.env.get(keySetName) || "{}");
    return typeof keySet.default === "string" ? keySet.default : "";
  } catch {
    return "";
  }
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json(405, { sent: false, error: "Method not allowed." });
  if (request.headers.get("origin") !== siteOrigin) return json(403, { sent: false, error: "Origin not allowed." });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) return json(415, { sent: false, error: "Request must use JSON." });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1024) return json(413, { sent: false, error: "Request body is too large." });
  try {
    const body = await readBodyLimited(request, 1024);
    if (body === null) return json(413, { sent: false, error: "Request body is too large." });
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) {
      return json(400, { sent: false, error: "Request body must be an empty JSON object." });
    }
  } catch {
    return json(400, { sent: false, error: "Request body is not valid JSON." });
  }

  const token = (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return json(401, { sent: false, error: "Sign in to create a customer account." });

  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = configuredKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = configuredKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  const alertRecipient = (Deno.env.get("WHATSAPP_ALERT_TO") || "").replace(/\D/g, "");
  const templateName = Deno.env.get("WHATSAPP_ALERT_TEMPLATE") || "";
  const templateLanguage = Deno.env.get("WHATSAPP_ALERT_TEMPLATE_LANGUAGE") || "en";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v27.0";
  if (!projectUrl || !publishableKey || !serviceKey || !accessToken || !phoneNumberId || !alertRecipient || !templateName) {
    return json(503, { sent: false, reason: "not_configured", error: "Owner alerts are not connected yet." });
  }
  if (alertRecipient !== "917986630948" || !/^[0-9]+$/.test(phoneNumberId) || !/^[a-z0-9_]{1,512}$/.test(templateName)) {
    return json(503, { sent: false, reason: "invalid_configuration", error: "Owner alert settings need correction." });
  }

  let authResponse: Response;
  try {
    authResponse = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return json(503, { sent: false, error: "Could not confirm the signed-in account." });
  }
  if (!authResponse.ok) return json(401, { sent: false, error: "Sign in again to continue." });
  const user = await authResponse.json().catch(() => null);
  const userId = String(user?.id || "");
  if (!userId || ownerEmails.has(String(user?.email || "").toLowerCase())) return json(403, { sent: false, error: "This alert is only for new customer profiles." });

  const serviceHeaders = {
    apikey: serviceKey,
    ...(serviceKey.startsWith("eyJ") ? { Authorization: `Bearer ${serviceKey}` } : {}),
    "Content-Type": "application/json",
  };
  const recentSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const profileQuery = new URLSearchParams({ select: "user_id", user_id: `eq.${userId}`, created_at: `gte.${recentSince}`, limit: "1" });
  let profileResponse: Response;
  try {
    profileResponse = await fetch(`${projectUrl}/rest/v1/customer_profiles?${profileQuery}`, { headers: serviceHeaders, cache: "no-store" });
  } catch {
    return json(503, { sent: false, error: "Could not verify the new customer profile." });
  }
  const profiles = profileResponse.ok ? await profileResponse.json().catch(() => []) : [];
  if (!profileResponse.ok) return json(503, { sent: false, error: "Could not verify the new customer profile." });
  if (!Array.isArray(profiles) || profiles.length !== 1) return json(200, { sent: false, reason: "not_new_customer" });

  const cooldownQuery = new URLSearchParams({ select: "user_id", created_at: `gte.${new Date(Date.now() - 60 * 1000).toISOString()}`, limit: "1" });
  const cooldownResponse = await fetch(`${projectUrl}/rest/v1/website_customer_alert_dispatches?${cooldownQuery}`, {
    headers: serviceHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!cooldownResponse?.ok) return json(503, { sent: false, error: "Could not apply the owner-alert rate limit." });
  if ((await cooldownResponse.json().catch(() => [])).length) return json(200, { sent: false, reason: "cooldown" });

  const existingQuery = new URLSearchParams({ select: "user_id", user_id: `eq.${userId}`, limit: "1" });
  const existingResponse = await fetch(`${projectUrl}/rest/v1/website_customer_alert_dispatches?${existingQuery}`, {
    headers: serviceHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!existingResponse?.ok) return json(503, { sent: false, error: "Could not apply the owner-alert duplicate check." });
  if ((await existingResponse.json().catch(() => [])).length) return json(200, { sent: false, reason: "already_attempted" });

  const claimResponse = await fetch(`${projectUrl}/rest/v1/website_customer_alert_dispatches`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, delivery_status: "sending" }),
    cache: "no-store",
  }).catch(() => null);
  if (claimResponse?.status === 409) return json(200, { sent: false, reason: "already_attempted" });
  if (!claimResponse?.ok) return json(503, { sent: false, error: "Could not safely queue the owner alert." });

  let messageResponse: Response;
  try {
    messageResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: alertRecipient,
        type: "template",
        template: { name: templateName, language: { code: templateLanguage } },
      }),
    });
  } catch {
    messageResponse = new Response(null, { status: 503 });
  }

  if (!messageResponse.ok) {
    await fetch(`${projectUrl}/rest/v1/website_customer_alert_dispatches?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ delivery_status: "failed" }),
      cache: "no-store",
    }).catch(() => {});
    return json(502, { sent: false, error: "The generic WhatsApp owner alert could not be delivered. The new account is still available on the website." });
  }

  await fetch(`${projectUrl}/rest/v1/website_customer_alert_dispatches?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ delivery_status: "sent", sent_at: new Date().toISOString() }),
    cache: "no-store",
  }).catch(() => {});

  return json(200, { sent: true });
});
