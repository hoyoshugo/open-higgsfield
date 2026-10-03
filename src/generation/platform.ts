/* LumaForge provider layer. Two backends behind one queue-shaped interface so
   the studio's submit → poll flow is unchanged:
     "pol/<model>"  Pollinations — keyless, instant URL (draft quality)
     "fal/<endpoint>" fal.ai queue — premium image/video, key lives server-side
   A request id is self-describing (provider prefix + base64url payload), so
   status polling needs no server state. Intentionally has no relative
   imports so it can be exercised directly by the node test runner. */

const FAL_QUEUE_HOST = "queue.fal.run";
const POLLINATIONS_HOST = "image.pollinations.ai";
const MODEL_PATH = /^(pol|fal)\/[a-z0-9][a-z0-9._/-]*$/i;

export class PlatformError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(messageFromBody(status, body));
    this.name = "PlatformError";
    this.status = status;
    this.body = body;
  }
}

export type QueuedGeneration = {
  status: string;
  requestId: string;
  statusUrl: string;
  cancelUrl: string;
};

export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  video?: { url: string };
  error?: unknown;
};

/** One request's answer inside a batched status poll. A request that errors
    carries its reason alone, so it cannot lose the answers standing beside it. */
export type StatusResult =
  | { requestId: string; status: GenerationStatus }
  | { requestId: string; error: string };

export type PlatformClientOptions = {
  /** fal.ai key, server-side only. Without it, "fal/" models report a clear error. */
  falKey?: string;
  fetch?: typeof fetch;
};

export function isModelId(model: string): boolean {
  return MODEL_PATH.test(model) && !model.includes("..");
}

export function createPlatformClient(options: PlatformClientOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const falKey = options.falKey?.trim();

  async function falSend(method: "GET" | "POST", url: string, body?: Record<string, unknown>) {
    if (!falKey) {
      throw new PlatformError(503, {
        detail:
          "Premium generation is not configured on the server (missing FAL_KEY). Use the free Draft model or ask the owner to add it.",
      });
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Key ${falKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await readJson(response);
    if (!response.ok) throw new PlatformError(response.status, payload);
    return payload;
  }

  return {
    async submit(model: string, input: Record<string, unknown>): Promise<QueuedGeneration> {
      if (!isModelId(model)) throw new PlatformError(400, { detail: "Invalid model" });
      const slash = model.indexOf("/");
      const provider = model.slice(0, slash);
      const target = model.slice(slash + 1);

      if (provider === "pol") return submitPollinations(target, input);

      const data = asRecord(await falSend("POST", `https://${FAL_QUEUE_HOST}/${target}`, input));
      const upstreamId = stringField(data, "request_id");
      const statusUrl = stringField(data, "status_url");
      const responseUrl = stringField(data, "response_url");
      if (!upstreamId || !statusUrl || !responseUrl) {
        throw new PlatformError(502, { detail: "Provider response missing request details" });
      }
      assertFalUrl(statusUrl);
      assertFalUrl(responseUrl);
      return {
        status: "queued",
        requestId: `fal.${encode({ s: statusUrl, r: responseUrl, i: upstreamId })}`,
        statusUrl,
        cancelUrl: stringField(data, "cancel_url") ?? "",
      };
    },

    async status(requestId: string): Promise<GenerationStatus> {
      if (!requestId) throw new PlatformError(400, { detail: "Missing request id" });
      const dot = requestId.indexOf(".");
      const provider = dot > 0 ? requestId.slice(0, dot) : "";
      const payload = dot > 0 ? requestId.slice(dot + 1) : "";

      if (provider === "pol") {
        const { u } = decode(payload);
        assertPollinationsUrl(String(u));
        return { status: "completed", requestId, images: [{ url: String(u) }] };
      }
      if (provider !== "fal") throw new PlatformError(400, { detail: "Unknown request id" });

      const { s, r } = decode(payload);
      assertFalUrl(String(s));
      assertFalUrl(String(r));
      const state = asRecord(await falSend("GET", String(s)));
      const raw = (stringField(state, "status") ?? "").toUpperCase();
      if (raw !== "COMPLETED") {
        return { status: raw === "IN_QUEUE" ? "queued" : "in_progress", requestId };
      }
      if (state.error !== undefined && state.error !== null && state.error !== "") {
        return { status: "failed", requestId, error: state.error };
      }
      const result = asRecord(await falSend("GET", String(r)));
      return mapResult(requestId, result);
    },
  };
}

function submitPollinations(model: string, input: Record<string, unknown>): QueuedGeneration {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) throw new PlatformError(400, { detail: "Prompt is empty" });
  const width = clampInt(input.width, 1024);
  const height = clampInt(input.height, 576);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url =
    `https://${POLLINATIONS_HOST}/prompt/${encodeURIComponent(prompt)}` +
    `?model=${encodeURIComponent(model)}&width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;
  return {
    status: "queued",
    requestId: `pol.${encode({ u: url })}`,
    statusUrl: "",
    cancelUrl: "",
  };
}

function mapResult(requestId: string, result: Record<string, unknown>): GenerationStatus {
  const images = Array.isArray(result.images)
    ? result.images.flatMap((item) => {
        const url = asRecord(item).url;
        return typeof url === "string" ? [{ url }] : [];
      })
    : [];
  const single = asRecord(result.image).url;
  if (typeof single === "string") images.push({ url: single });
  const videoUrl = asRecord(result.video).url;

  if (!images.length && typeof videoUrl !== "string") {
    return { status: "failed", requestId, error: "The provider returned no media." };
  }
  return {
    status: "completed",
    requestId,
    ...(images.length ? { images } : {}),
    ...(typeof videoUrl === "string" ? { video: { url: videoUrl } } : {}),
  };
}

/* The request id comes back from the browser, so anything it names must be a
   host we expect before the server calls it with a key attached. */
function assertFalUrl(value: string) {
  let host = "";
  try {
    const parsed = new URL(value);
    host = parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    /* falls through to the rejection below */
  }
  if (host !== FAL_QUEUE_HOST) throw new PlatformError(400, { detail: "Invalid request id" });
}

function assertPollinationsUrl(value: string) {
  let host = "";
  try {
    const parsed = new URL(value);
    host = parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    /* falls through to the rejection below */
  }
  if (host !== POLLINATIONS_HOST) throw new PlatformError(400, { detail: "Invalid request id" });
}

function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(payload: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw new PlatformError(400, { detail: "Invalid request id" });
  }
}

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? Math.round(value) : fallback;
  return Math.min(1536, Math.max(256, n));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFromBody(status: number, body: unknown): string {
  const record = asRecord(body);
  const detail = record.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = asRecord(detail[0]).msg;
    if (typeof first === "string") return first;
  }
  if (status === 401 || status === 403) return "The generation provider rejected the server key.";
  if (status === 402) return "The generation provider reports no remaining credit on the server account.";
  if (status === 429) return "The generation provider is rate limiting requests. Try again shortly.";
  return `Platform request failed (${status})`;
}