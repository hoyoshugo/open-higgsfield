import assert from "node:assert/strict";
import { test } from "node:test";

import { PlatformError, createPlatformClient, isModelId } from "../src/generation/platform.ts";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("isModelId accepts provider paths and rejects traversal", () => {
  assert.equal(isModelId("fal/fal-ai/flux/schnell"), true);
  assert.equal(isModelId("pol/flux"), true);
  assert.equal(isModelId("evil/x"), false);
  assert.equal(isModelId("fal/../etc"), false);
});

test("draft: instant completed image URL, no key needed", async () => {
  const c = createPlatformClient({ fetch: () => assert.fail("no network for draft") });
  const q = await c.submit("pol/flux", { prompt: "a cat", width: 1024, height: 576 });
  assert.match(q.requestId, /^pol\./);
  const s = await c.status(q.requestId);
  assert.equal(s.status, "completed");
  assert.match(s.images[0].url, /^https:\/\/image\.pollinations\.ai\/prompt\/a%20cat\?model=flux&width=1024&height=576/);
});

test("draft: empty prompt rejected", async () => {
  const c = createPlatformClient();
  await assert.rejects(() => c.submit("pol/flux", { prompt: "  " }), PlatformError);
});

test("fal without key: clear 503 message", async () => {
  const c = createPlatformClient({ fetch: () => assert.fail("must not call network") });
  await assert.rejects(
    () => c.submit("fal/fal-ai/flux/schnell", { prompt: "x" }),
    (e) => e instanceof PlatformError && e.status === 503 && /FAL_KEY/.test(e.message),
  );
});

test("fal: submit → queued → in progress → completed video", async () => {
  const calls = [];
  let polls = 0;
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), method: init.method, auth: init.headers.Authorization });
    if (init.method === "POST")
      return json({
        request_id: "abc",
        status_url: "https://queue.fal.run/fal-ai/veo3/fast/requests/abc/status",
        response_url: "https://queue.fal.run/fal-ai/veo3/fast/requests/abc",
        cancel_url: "https://queue.fal.run/fal-ai/veo3/fast/requests/abc/cancel",
      });
    if (String(url).endsWith("/status")) {
      polls += 1;
      return json({ status: polls === 1 ? "IN_QUEUE" : polls === 2 ? "IN_PROGRESS" : "COMPLETED" });
    }
    return json({ video: { url: "https://v3.fal.media/files/x.mp4" } });
  };
  const c = createPlatformClient({ falKey: "k:s", fetch: fetchMock });
  const q = await c.submit("fal/fal-ai/veo3/fast", { prompt: "x" });
  assert.equal(calls[0].url, "https://queue.fal.run/fal-ai/veo3/fast");
  assert.equal(calls[0].auth, "Key k:s");
  assert.equal((await c.status(q.requestId)).status, "queued");
  assert.equal((await c.status(q.requestId)).status, "in_progress");
  const done = await c.status(q.requestId);
  assert.equal(done.status, "completed");
  assert.equal(done.video.url, "https://v3.fal.media/files/x.mp4");
});

test("fal: image result and provider error mapping", async () => {
  const mk = (statusBody, resultBody) => async (url, init) => {
    if (init.method === "POST")
      return json({
        request_id: "r",
        status_url: "https://queue.fal.run/m/requests/r/status",
        response_url: "https://queue.fal.run/m/requests/r",
      });
    return String(url).endsWith("/status") ? json(statusBody) : json(resultBody);
  };
  const ok = createPlatformClient({ falKey: "k", fetch: mk({ status: "COMPLETED" }, { images: [{ url: "https://v3.fal.media/a.png" }] }) });
  const q1 = await ok.submit("fal/m", { prompt: "x" });
  assert.deepEqual((await ok.status(q1.requestId)).images, [{ url: "https://v3.fal.media/a.png" }]);

  const bad = createPlatformClient({ falKey: "k", fetch: mk({ status: "COMPLETED", error: "boom" }, {}) });
  const q2 = await bad.submit("fal/m", { prompt: "x" });
  const s2 = await bad.status(q2.requestId);
  assert.equal(s2.status, "failed");
  assert.equal(s2.error, "boom");

  const empty = createPlatformClient({ falKey: "k", fetch: mk({ status: "COMPLETED" }, {}) });
  const q3 = await empty.submit("fal/m", { prompt: "x" });
  assert.equal((await empty.status(q3.requestId)).status, "failed");
});

test("fal: 401/402/429 produce friendly errors", async () => {
  for (const [code, re] of [[401, /rejected/], [402, /no remaining credit/], [429, /rate limiting/]]) {
    const c = createPlatformClient({ falKey: "k", fetch: async () => json({}, code) });
    await assert.rejects(() => c.submit("fal/m", { prompt: "x" }), (e) => e instanceof PlatformError && re.test(e.message));
  }
});

test("SSRF guard: forged request ids never reach foreign hosts", async () => {
  const c = createPlatformClient({ falKey: "secret", fetch: () => assert.fail("must not fetch") });
  const forged = "fal." + Buffer.from(JSON.stringify({ s: "https://evil.example/x", r: "https://evil.example/y" })).toString("base64url");
  await assert.rejects(() => c.status(forged), (e) => e instanceof PlatformError && e.status === 400);
  const http = "fal." + Buffer.from(JSON.stringify({ s: "http://queue.fal.run/x", r: "https://queue.fal.run/y" })).toString("base64url");
  await assert.rejects(() => c.status(http), PlatformError);
  const pol = "pol." + Buffer.from(JSON.stringify({ u: "https://evil.example/i.png" })).toString("base64url");
  await assert.rejects(() => c.status(pol), PlatformError);
  await assert.rejects(() => c.status("garbage"), PlatformError);
});