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
