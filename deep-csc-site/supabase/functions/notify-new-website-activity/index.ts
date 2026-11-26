const siteOrigin = "https://deepcsc.dpdns.org";
const corsHeaders = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, { sent: false, error: "Method not allowed." });
  if (request.headers.get("origin") !== siteOrigin) return response(403, { sent: false, error: "Origin not allowed." });

  const authorization = request.headers.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return response(401, { sent: false, error: "Sign in to submit a request." });

  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  const alertRecipient = (Deno.env.get("WHATSAPP_ALERT_TO") || "").replace(/\D/g, "");
  const templateName = Deno.env.get("WHATSAPP_ALERT_TEMPLATE") || "";
  const templateLanguage = Deno.env.get("WHATSAPP_ALERT_TEMPLATE_LANGUAGE") || "en";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v27.0";
  if (!projectUrl || !publishableKey || !serviceKey || !accessToken || !phoneNumberId || !alertRecipient || !templateName) {
    return response(503, { sent: false, reason: "not_configured", error: "Owner alerts are not connected yet." });
  }
  if (!/^[1-9][0-9]{7,14}$/.test(alertRecipient) || !/^[0-9]+$/.test(phoneNumberId) || !/^[a-z0-9_]{1,512}$/.test(templateName)) {
    return response(503, { sent: false, reason: "invalid_configuration", error: "Owner alert settings need correction." });
  }

  let payload: { requestId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return response(400, { sent: false, error: "Request body is not valid JSON." });
  }
  const requestId = payload.requestId;
  if (!validUuid(requestId)) return response(400, { sent: false, error: "Request reference is not valid." });

  let authResult: Response;
  try {
    authResult = await fetch(`${projectUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${tokenMatch[1]}` },
      cache: "no-store",
    });
  } catch {
    return response(503, { sent: false, error: "Could not confirm the signed-in account." });
  }
  if (!authResult.ok) return response(401, { sent: false, error: "Sign in again to submit a request." });
  const user = await authResult.json().catch(() => null);
  if (!user?.id || String(user.email || "").toLowerCase() === "sandeepharmen@gmail.com") {
    return response(403, { sent: false, error: "This alert is only for customer requests." });
  }

  const serviceHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const recentSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const applicationQuery = new URLSearchParams({
    select: "id",
    id: `eq.${requestId}`,
    owner_id: `eq.${user.id}`,
    status: "eq.new",
    created_at: `gte.${recentSince}`,
    limit: "1",
  });
  let applicationResponse: Response;
  try {
    applicationResponse = await fetch(`${projectUrl}/rest/v1/customer_applications?${applicationQuery}`, {
      headers: serviceHeaders,
      cache: "no-store",
    });
  } catch {
    return response(503, { sent: false, error: "Could not verify the saved request." });
  }
  const applications = applicationResponse.ok ? await applicationResponse.json().catch(() => []) : [];
  if (!applicationResponse.ok || !Array.isArray(applications) || applications.length !== 1) {
    return response(403, { sent: false, error: "No new website request was found for this account." });
  }

  const cooldownQuery = new URLSearchParams({
    select: "application_id",
    owner_id: `eq.${user.id}`,
    created_at: `gte.${new Date(Date.now() - 30 * 1000).toISOString()}`,
    limit: "1",
  });
  const cooldownResponse = await fetch(`${projectUrl}/rest/v1/website_alert_dispatches?${cooldownQuery}`, {
    headers: serviceHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!cooldownResponse?.ok) return response(503, { sent: false, error: "Could not apply the alert limit." });
  const recentAlerts = await cooldownResponse.json().catch(() => []);
  if (Array.isArray(recentAlerts) && recentAlerts.length) return response(200, { sent: false, reason: "cooldown" });

  const claimResponse = await fetch(`${projectUrl}/rest/v1/website_alert_dispatches`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ application_id: requestId, owner_id: user.id, delivery_status: "sending" }),
    cache: "no-store",
  }).catch(() => null);
  if (claimResponse?.status === 409) return response(200, { sent: false, reason: "already_attempted" });
  if (!claimResponse?.ok) return response(503, { sent: false, error: "Could not safely queue the owner alert." });

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
    await fetch(`${projectUrl}/rest/v1/website_alert_dispatches?application_id=eq.${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ delivery_status: "failed" }),
      cache: "no-store",
    }).catch(() => {});
    return response(502, { sent: false, error: "The generic WhatsApp alert could not be delivered. The website request is still saved." });
  }

  await fetch(`${projectUrl}/rest/v1/website_alert_dispatches?application_id=eq.${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ delivery_status: "sent", sent_at: new Date().toISOString() }),
    cache: "no-store",
  }).catch(() => {});

  return response(200, { sent: true });
});
