import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";
import { parseModelOutput, triage } from "../triage.mjs";

const MANUAL = { status: "manual_review", topic: null, draft: null };

// чтобы предупреждения из triage не засоряли вывод тестов
console.warn = () => {};

describe("POST /api/triage", () => {
  let server;
  let url;

  before(async () => {
    server = createApp();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/api/triage`;
  });

  after(() => server.close());

  const post = async (body) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    return { status: res.status, body: await res.json() };
  };

  test("ready for a normal request", async () => {
    const res = await post(JSON.stringify({ text: "Сколько стоит ваша цена?" }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ready");
    assert.equal(res.body.topic, "pricing");
    assert.ok(res.body.draft.length > 0);
  });

  for (const [name, body] of [
    ["broken JSON", "{text:"],
    ["missing text", "{}"],
    ["non-string text", JSON.stringify({ text: 42 })],
    ["empty text", JSON.stringify({ text: "" })],
    ["whitespace-only text", JSON.stringify({ text: "  \n\t" })],
    ["JSON null", "null"],
  ]) {
    test(`400 invalid_input: ${name}`, async () => {
      assert.deepEqual(await post(body), { status: 400, body: { status: "invalid_input" } });
    });
  }

  for (const tag of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    test(`manual_review on ${tag}`, async () => {
      assert.deepEqual(await post(JSON.stringify({ text: `Где доставка? ${tag}` })), { status: 200, body: MANUAL });
    });
  }

  test("timeout answers in about 300 ms, not after the model's 1.2 s", async () => {
    const started = performance.now();
    await post(JSON.stringify({ text: "[timeout]" }));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 600, `took ${Math.round(elapsed)} ms`);
  });
});

describe("triage() with a stub model", () => {
  test("model that hangs and ignores abort signal still times out", async () => {
    const hangs = () => new Promise(() => {});
    assert.deepEqual(await triage("x", { classify: hangs, timeoutMs: 50 }), MANUAL);
  });

  test("model returning a non-string is treated as failure", async () => {
    const weird = async () => ({ topic: "other", draft: "ok" });
    assert.deepEqual(await triage("x", { classify: weird }), MANUAL);
  });
});

describe("parseModelOutput", () => {
  test("accepts valid output and trims the draft", () => {
    assert.deepEqual(parseModelOutput('{"topic":"delivery","draft":"  Привет  "}'), { topic: "delivery", draft: "Привет" });
  });

  test("rejects JSON that is not an object", () => {
    assert.equal(parseModelOutput("null"), null);
    assert.equal(parseModelOutput("[]"), null);
  });

  test("rejects non-string draft", () => {
    assert.equal(parseModelOutput('{"topic":"other","draft":123}'), null);
  });
});
