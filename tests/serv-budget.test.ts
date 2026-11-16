import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { getFixture } from "../src/lib/fixtures";
import { extractWithServ } from "../src/lib/serv";
import { canEnforceLiveBudget } from "../src/lib/serv-budget";

const fixture = getFixture("bypass-omitted")!;
const fakeKey = "mock-only-key";

async function setUp(t: TestContext, values: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "carrylock-serv-test-"));
  const path = join(directory, "ledger.json");
  const overrides = {
    SERV_BUDGET_LEDGER_PATH: path,
    SERV_BUDGET_USED_CALLS: "0",
    SERV_BUDGET_USED_USD: "0",
    SERV_DEV_MAX_CALLS: "20",
    SERV_MAX_SPEND_USD: "1.00",
    SERV_LIVE_MAX_PER_HOUR: "3",
    SERV_BUDGET_REDIS_URL: "",
    SERV_BUDGET_REDIS_TOKEN: "",
    VERCEL: "0",
    ...values,
  };
  const original = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(async () => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.equal(request.model, "gpt-5.4-mini");
    assert.equal(request.reasoning_effort, "low");
    assert.equal(request.response_format.json_schema.strict, true);
    return Response.json({
      id: "mock-completion",
      model: "mock-gpt-5.4-mini",
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            events: fixture.events,
            coverage: fixture.input.shifts.map(({ id }) => ({ shiftId: id, status: "COMPLETE", issue: null })),
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  });
  return { path, fetchMock };
}

const alternateInput = (index: number) => ({
  ...fixture.input,
  action: { ...fixture.input.action, description: fixture.input.action.description + " Mock " + index },
});

test("counts reserved analyses durably and reuses identical normalized input without another provider request", async (t) => {
  const { path, fetchMock } = await setUp(t, { SERV_BUDGET_USED_CALLS: "17" });
  const regular = await extractWithServ(fixture.input, fakeKey);
  assert.equal(regular.audit.attempted, false);
  assert.equal(regular.audit.status, "rate_limited");

  const reserved = await extractWithServ(fixture.input, fakeKey, { finalDemo: true });
  assert.equal(reserved.audit.attempted, true);
  assert.equal(reserved.audit.status, "completed");
  const cached = await extractWithServ(fixture.input, fakeKey);
  assert.equal(cached.audit.cacheHit, true);
  assert.equal(cached.audit.attempted, false);
  assert.equal(cached.audit.completionId, reserved.audit.completionId);

  for (let index = 1; index <= 3; index++) {
    const result = await extractWithServ(alternateInput(index), fakeKey, { finalDemo: true });
    assert.equal(result.audit.attempted, index < 3);
  }
  assert.equal(fetchMock.mock.callCount(), 3);
  const raw = await readFile(path, "utf8");
  const ledger = JSON.parse(raw);
  assert.equal(ledger.calls, 20);
  assert.equal(ledger.records.length, 3);
  assert.equal(ledger.records[0].estimatedListUsd, 0.0004);
  assert.equal(ledger.records[0].inputTokens, 100);
  assert.equal(raw.includes(fakeKey), false);
  assert.equal(raw.includes(fixture.events[0].quote), false);
  assert.equal(JSON.stringify(ledger.records).includes(fixture.input.shifts[0].notes), false);
});

test("limits a client's new analyses while allowing cache hits and other clients", async (t) => {
  const { fetchMock } = await setUp(t);
  for (let index = 0; index < 4; index++) {
    const result = await extractWithServ(alternateInput(index), fakeKey, { client: "first-client" });
    assert.equal(result.audit.attempted, index < 3);
  }
  const cached = await extractWithServ(alternateInput(0), fakeKey, { client: "first-client" });
  assert.equal(cached.audit.cacheHit, true);
  const other = await extractWithServ(alternateInput(3), fakeKey, { client: "another-client" });
  assert.equal(other.audit.attempted, true);
  assert.equal(fetchMock.mock.callCount(), 4);
});

test("blocks paid provider calls before spending or without a shared Vercel ledger", async (t) => {
  const { fetchMock } = await setUp(t, { SERV_MAX_SPEND_USD: "0.001" });
  const budgetRejected = await extractWithServ(fixture.input, fakeKey, { finalDemo: true });
  assert.equal(budgetRejected.audit.attempted, false);
  assert.match(budgetRejected.issues[0], /spending budget/);
  process.env.VERCEL = "1";
  assert.equal(canEnforceLiveBudget(), false);
  const noStore = await extractWithServ(fixture.input, fakeKey, { finalDemo: true });
  assert.equal(noStore.audit.attempted, false);
  assert.match(noStore.issues[0], /budget could not be confirmed/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("never submits parallel identical requests more than once", async (t) => {
  const { fetchMock } = await setUp(t);
  const results = await Promise.all([
    extractWithServ(fixture.input, fakeKey),
    extractWithServ(fixture.input, fakeKey),
  ]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(results.filter((result) => result.audit.attempted).length, 1);
});

test("requires an explicit shared allowance and preserves historical usage in Redis", async (t) => {
  const { fetchMock } = await setUp(t, {
    SERV_BUDGET_REDIS_URL: "https://mock-redis.invalid",
    SERV_BUDGET_REDIS_TOKEN: "mock-token",
    SERV_SHARED_MAX_CALLS: "",
    SERV_BUDGET_USED_CALLS: "17",
    SERV_BUDGET_USED_USD: "0.26",
    VERCEL: "1",
  });
  const provider = fetchMock.mock.calls;
  let ledger: string | null = null;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (String(url) !== "https://mock-redis.invalid/") {
      calls++;
      return Response.json({
        id: "mock-shared-completion", model: "mock-model",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          events: fixture.events,
          coverage: fixture.input.shifts.map(({ id }) => ({ shiftId: id, status: "COMPLETE", issue: null })),
        }) } }],
      });
    }
    const command = JSON.parse(String(init.body)) as string[];
    if (command[0] === "GET") return Response.json({ result: ledger });
    if (command[0] === "SET") return Response.json({ result: "OK" });
    if (command[2] === "2") ledger = command[6];
    return Response.json({ result: 1 });
  });
  assert.equal(canEnforceLiveBudget(), false);
  assert.equal((await extractWithServ(fixture.input, fakeKey)).audit.attempted, false);
  process.env.SERV_SHARED_MAX_CALLS = "24";
  assert.equal(canEnforceLiveBudget(), true);
  assert.equal((await extractWithServ(fixture.input, fakeKey)).audit.attempted, true);
  assert.equal((await extractWithServ(alternateInput(1), fakeKey)).audit.attempted, false);
  assert.equal(calls, 1);
  assert.equal(provider.length, 0);
  assert.equal(JSON.parse(ledger!).calls, 19);
});

test("failed Redis settlement surfaces accounting uncertainty and fences an expired duplicate", async (t) => {
  await setUp(t, {
    SERV_BUDGET_REDIS_URL: "https://failing-redis.invalid",
    SERV_BUDGET_REDIS_TOKEN: "mock-token",
    SERV_SHARED_MAX_CALLS: "30",
    VERCEL: "1",
  });
  let ledger: string | null = null;
  let writes = 0;
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (String(url) !== "https://failing-redis.invalid/") {
      providerCalls++;
      return Response.json({
        id: "mock-settlement", model: "mock-model",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          events: fixture.events,
          coverage: fixture.input.shifts.map(({ id }) => ({ shiftId: id, status: "COMPLETE", issue: null })),
        }) } }],
      });
    }
    const command = JSON.parse(String(init.body)) as string[];
    if (command[0] === "GET") return Response.json({ result: ledger });
    if (command[0] === "SET") return Response.json({ result: "OK" });
    if (command[2] === "2") {
      writes++;
      if (writes === 2) return new Response(null, { status: 503 });
      ledger = command[6];
    }
    return Response.json({ result: 1 });
  });
  const result = await extractWithServ(fixture.input, fakeKey);
  assert.equal(result.audit.status, "partial");
  assert.equal(result.audit.accounting, "unconfirmed");
  assert.match(result.issues.join(" "), /settlement could not be confirmed/);
  const saved = JSON.parse(ledger!);
  assert.equal(saved.records[0].status, "reserved");
  assert.ok(saved.spendMicros > 262_480);
  for (const pending of Object.values(saved.pending) as { expires: number }[]) pending.expires = 1;
  ledger = JSON.stringify(saved);
  const retry = await extractWithServ(fixture.input, fakeKey);
  assert.equal(retry.audit.status, "unavailable");
  assert.equal(retry.audit.attempted, false);
  assert.equal(providerCalls, 1);
});

test("independent evaluation runs make fresh requests and the same run reuses its completion", async (t) => {
  const { fetchMock } = await setUp(t);
  const run = (runId: string) => extractWithServ(fixture.input, fakeKey, { evaluation: { pipeline: "v2", runId } });
  assert.equal((await run("first")).audit.attempted, true);
  assert.equal((await run("first")).audit.cacheHit, true);
  assert.equal((await run("second")).audit.attempted, true);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("provider timeout and malformed response keep the review incomplete and settle accounting", async (t) => {
  await setUp(t);
  let calls = 0;
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
  t.mock.method(globalThis, "fetch", async () => {
    if (++calls === 1) throw new DOMException("timeout", "TimeoutError");
    return Response.json({ malformed: true });
  });
  const timedOut = await extractWithServ(fixture.input, fakeKey);
  const malformed = await extractWithServ(alternateInput(1), fakeKey);
  assert.equal(timedOut.audit.status, "timeout");
  assert.equal(malformed.audit.status, "invalid_response");
  for (const result of [timedOut, malformed]) {
    assert.equal(result.audit.accounting, "settled");
    assert.equal(result.events.length, 0);
    assert.ok(result.issues.length);
  }
});
