const BACKUP_TABLES = [
  "active_bot_users",
  "chat_sessions",
  "comment_likes",
  "comment_reactions",
  "comments",
  "custom_emojis",
  "follows",
  "likes",
  "mentions",
  "lime_drops",
  "news_summaries",
  "notifications",
  "post_reactions",
  "posts",
  "profiles",
  "push_subscriptions",
] as const;

const CRITICAL_TABLES = [
  "profiles",
  "posts",
  "comments",
  "likes",
  "comment_likes",
  "post_reactions",
  "comment_reactions",
  "follows",
  "mentions",
  "notifications",
  "push_subscriptions",
] as const;

const SECONDARY_TABLES = [
  "active_bot_users",
  "chat_sessions",
  "custom_emojis",
  "lime_drops",
  "news_summaries",
] as const;

const allowedTables = new Set<string>(BACKUP_TABLES);

type BackupRequest = {
  table?: string;
  tables?: string[];
  mode?: "posts" | "critical" | "secondary" | "all";
};

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
};

const supabaseUrl = env("SUPABASE_URL").replace(/\/+$/, "");
const supabaseServiceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
const firebaseStorageBucket = env("BACKUP_FIREBASE_STORAGE_BUCKET");
const googleClientEmail = env("BACKUP_GOOGLE_CLIENT_EMAIL");
const googlePrivateKey = env("BACKUP_GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
const prefix = (Deno.env.get("BACKUP_STORAGE_PREFIX") ?? "supabase-backups")
  .replace(/^\/+|\/+$/g, "");

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });

const selectTables = (payload: BackupRequest) => {
  if (payload.table) return [payload.table];
  if (payload.tables?.length) return payload.tables;

  if (payload.mode === "posts") return ["posts"];
  if (payload.mode === "critical") return [...CRITICAL_TABLES];
  if (payload.mode === "secondary") return [...SECONDARY_TABLES];
  if (payload.mode === "all") return [...BACKUP_TABLES];

  return ["posts"];
};

const encoder = new TextEncoder();

const base64UrlEncode = (value: string | ArrayBuffer) => {
  const bytes = typeof value === "string"
    ? encoder.encode(value)
    : new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
};

const importGooglePrivateKey = async () => {
  const pemBody = googlePrivateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(pemBody);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(bytes),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
};

let cachedAccessToken: { token: string; expiresAt: number } | undefined;

const getGoogleAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);

  if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > now) {
    return cachedAccessToken.token;
  }

  const header = base64UrlEncode(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
  }));
  const claim = base64UrlEncode(JSON.stringify({
    iss: googleClientEmail,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsignedJwt = `${header}.${claim}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importGooglePrivateKey(),
    encoder.encode(unsignedJwt),
  );
  const assertion = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google token request failed: ${response.status} ${detail}`);
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in,
  };

  return data.access_token;
};

const gzip = async (text: string) => {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const uploadJsonGzip = async (key: string, value: unknown) => {
  const body = await gzip(JSON.stringify(value));
  const token = await getGoogleAccessToken();
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${
      encodeURIComponent(firebaseStorageBucket)
    }/o`,
  );
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("name", key);

  const response = await fetch(url, {
    method: "POST",
    body,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Encoding": "gzip",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Upload failed: ${response.status} ${detail}`);
  }
};

const fetchTablePage = async (table: string, from: number, limit: number) => {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("offset", String(from));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      "apikey": supabaseServiceRoleKey,
      "Authorization": `Bearer ${supabaseServiceRoleKey}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${table}: ${response.status} ${detail}`);
  }

  return await response.json() as unknown[];
};

const backupTable = async (table: string, startedAt: Date) => {
  if (!allowedTables.has(table)) {
    throw new Error(`Table is not allowlisted: ${table}`);
  }

  const rows: unknown[] = [];
  const pageSize = Number(Deno.env.get("BACKUP_PAGE_SIZE") ?? "1000");
  let from = 0;

  while (true) {
    const data = await fetchTablePage(table, from, pageSize);
    if (!data.length) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const iso = startedAt.toISOString();
  const date = iso.slice(0, 10);
  const hour = iso.slice(11, 13);
  const stamp = iso.replace(/[:.]/g, "-");
  const key = `${prefix}/${table}/${date}/${hour}/${stamp}.json.gz`;

  await uploadJsonGzip(key, {
    table,
    backed_up_at: iso,
    row_count: rows.length,
    rows,
  });

  return {
    table,
    row_count: rows.length,
    key,
  };
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }

    const expectedSecret = env("BACKUP_CRON_SECRET");
    const actualSecret = req.headers.get("x-backup-secret");

    if (!actualSecret || actualSecret !== expectedSecret) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as BackupRequest;
    const tables = selectTables(payload);
    const invalidTable = tables.find((table) => !allowedTables.has(table));

    if (invalidTable) {
      return jsonResponse({ error: `table not allowed: ${invalidTable}` }, 400);
    }

    const startedAt = new Date();
    const results = [];

    for (const table of tables) {
      results.push(await backupTable(table, startedAt));
    }

    const manifestKey = `${prefix}/manifests/${startedAt
      .toISOString()
      .slice(0, 10)}/${startedAt
      .toISOString()
      .replace(/[:.]/g, "-")}.json.gz`;

    await uploadJsonGzip(manifestKey, {
      backed_up_at: startedAt.toISOString(),
      requested: payload,
      results,
    });

    return jsonResponse({
      ok: true,
      backed_up_at: startedAt.toISOString(),
      manifest_key: manifestKey,
      results,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
