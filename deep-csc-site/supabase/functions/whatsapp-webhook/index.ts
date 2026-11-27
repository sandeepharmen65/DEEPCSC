const MAX_BODY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function isValidSignature(body: Uint8Array, header: string, appSecret: string): Promise<boolean> {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header);
  if (!match) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  return bytesEqual(encoder.encode(hex(digest)), encoder.encode(match[1].toLowerCase()));
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    const verifyToken = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "";
    if (!verifyToken) return json(503, { error: "Webhook verification is not configured." });

    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode") || "";
    const suppliedToken = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !challenge || challenge.length > 512) {
      return json(400, { error: "Invalid webhook verification request." });
    }
    if (!bytesEqual(encoder.encode(verifyToken), encoder.encode(suppliedToken))) {
      return json(403, { error: "Webhook verification token does not match." });
    }

    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  const appSecret = Deno.env.get("META_APP_SECRET") || "";
  if (!appSecret) return json(503, { error: "Webhook signature verification is not configured." });

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json(413, { error: "Webhook payload is too large." });

  let body: Uint8Array;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json(400, { error: "Could not read webhook payload." });
  }
  if (body.length > MAX_BODY_BYTES) return json(413, { error: "Webhook payload is too large." });

  const signature = request.headers.get("x-hub-signature-256") || "";
  let signatureValid = false;
  try {
    signatureValid = await isValidSignature(body, signature, appSecret);
  } catch {
    return json(500, { error: "Could not validate webhook signature." });
  }
  if (!signatureValid) return json(401, { error: "Webhook signature is invalid." });

  let payload: { object?: unknown; entry?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json(400, { error: "Webhook payload is not valid JSON." });
  }

  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return json(400, { error: "Unsupported WhatsApp webhook payload." });
  }

  // Acknowledge valid events without logging or storing message text, phone numbers, or payloads.
  return json(200, { received: true });
});

