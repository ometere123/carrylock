import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ServResult } from "./serv";

const DEFAULT_TOTAL_CALLS = 20;
const RESERVED_CALLS = 5;
const DEFAULT_HOURLY_PER_CLIENT = 3;
const DEFAULT_MAX_SPEND_USD = 1;
const BASELINE_CALLS = 18;
const BASELINE_MICROS = 262_480;
const HOUR_MS = 3_600_000;
const PENDING_MS = 75_000;
const LOCK_TIMEOUT_MS = 3_000;


type Pending = { id: string; expires: number; reservedMicros: number };
type CallRecord = {
  sequence: number;
  reservationId: string;
  at: string;
  requestedModel: string;
  estimatedConservativeUsd: number;
  status: string;
  httpStatus?: number | null;
  returnedModel?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  estimatedListUsd?: number | null;
  reportedUsd?: number | null;
};
type CacheEntry = { expires: number } & ({ sealed: string } | { result: ServResult });
type Ledger = {
  version: 1;
  calls: number;
  spendMicros: number;
  clients: Record<string, number[]>;
  pending: Record<string, Pending>;
  cache: Record<string, CacheEntry>;
  records: CallRecord[];
};

type BudgetOutcome =
  | { kind: "cached"; result: ServResult }
  | { kind: "blocked"; reason: string; unavailable?: true }
  | { kind: "allowed"; reservation: Pending };

function nonnegativeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
}

function configuredNumber(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function initialLedger(shared: boolean): Ledger {
  const calls = Math.max(shared ? BASELINE_CALLS : 0, Math.ceil(configuredNumber(process.env.SERV_BUDGET_USED_CALLS, BASELINE_CALLS)));
  const spendMicros = Math.max(shared ? BASELINE_MICROS : 0,
    Math.ceil(configuredNumber(process.env.SERV_BUDGET_USED_USD, BASELINE_MICROS / 1_000_000) * 1_000_000));
  return { version: 1, calls, spendMicros, clients: {}, pending: {}, cache: {}, records: [] };
}

function readLedger(raw: string | null, shared = false): Ledger {
  const baseline = initialLedger(shared);
  if (raw === null) return baseline;
  const ledger = JSON.parse(raw) as Partial<Ledger>;
  if (ledger.version !== 1 || !nonnegativeInteger(ledger.calls) || !nonnegativeInteger(ledger.spendMicros) ||
      !ledger.clients || !ledger.pending || !ledger.cache) {
    throw new Error("Unexpected SERV ledger format.");
  }
  return {
    version: 1,
    calls: Math.max(ledger.calls, baseline.calls),
    spendMicros: Math.max(ledger.spendMicros, baseline.spendMicros),
    clients: ledger.clients,
    pending: ledger.pending,
    cache: ledger.cache,
    records: ledger.records ?? [],
  };
}

function redisConfig() {
  const address = process.env.SERV_BUDGET_REDIS_URL?.trim();
  const token = process.env.SERV_BUDGET_REDIS_TOKEN?.trim();
  if (!address || !token) return null;
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid SERV budget store URL.");
  return { url, token };
}

async function withRedisLedger<T>(
  config: NonNullable<ReturnType<typeof redisConfig>>,
  operation: (ledger: Ledger) => T,
): Promise<T> {
  const ledgerKey = process.env.SERV_BUDGET_REDIS_KEY?.trim() || "carrylock:serv-budget:v1";
  const lockKey = ledgerKey + ":lock";
  const token = randomUUID();

  async function command(command: string[]): Promise<string | number | null> {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error("SERV budget store unavailable.");
    const data = await response.json() as { result?: string | number | null; error?: unknown };
    if (data.error || data.result === undefined) throw new Error("SERV budget command failed.");
    return data.result;
  }

  const started = Date.now();
  for (;;) {
    if (await command(["SET", lockKey, token, "NX", "PX", "20000"]) === "OK") break;
    if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("SERV budget lock unavailable.");
    await delay(60);
  }

  try {
    const raw = await command(["GET", ledgerKey]);
    if (raw !== null && typeof raw !== "string") throw new Error("Unexpected SERV ledger response.");
    const ledger = readLedger(raw, true);
    const result = operation(ledger);
    const save = await command([
      "EVAL",
      "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[2], ARGV[2]) return 1",
      "2", lockKey, ledgerKey, token, JSON.stringify(ledger),
    ]);
    if (save !== 1) throw new Error("SERV budget changed while locked.");
    return result;
  } finally {
    await command([
      "EVAL",
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      "1", lockKey, token,
    ]).catch(() => undefined);
  }
}

function missingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function withLocalLedger<T>(operation: (ledger: Ledger) => T): Promise<T> {
  const ledgerPath = resolve(/* turbopackIgnore: true */ process.env.SERV_BUDGET_LEDGER_PATH || ".carrylock/serv-ledger.json");
  const lockPath = ledgerPath + ".lock";
  const ledgerDirectory = dirname(ledgerPath);
  await mkdir(/* turbopackIgnore: true */ ledgerDirectory, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      const lock = await open(/* turbopackIgnore: true */ lockPath, "wx", 0o600);
      await lock.close();
      break;
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") throw error;
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("SERV budget lock unavailable.");
      await delay(40);
    }
  }

  const tempPath = ledgerPath + "." + randomUUID() + ".tmp";
  try {
    const raw = await readFile(/* turbopackIgnore: true */ ledgerPath, "utf8").catch((error) => {
      if (missingFile(error)) return null;
      throw error;
    });
    const ledger = readLedger(raw);
    const result = operation(ledger);
    await writeFile(/* turbopackIgnore: true */ tempPath, JSON.stringify(ledger), { mode: 0o600, flag: "wx" });
    await rename(/* turbopackIgnore: true */ tempPath, /* turbopackIgnore: true */ ledgerPath);
    return result;
  } finally {
    await rm(/* turbopackIgnore: true */ tempPath, { force: true }).catch(() => undefined);
    await rm(/* turbopackIgnore: true */ lockPath, { force: true }).catch(() => undefined);
  }
}

async function withLedger<T>(operation: (ledger: Ledger) => T): Promise<T> {
  const config = redisConfig();
  if (config) return withRedisLedger(config, operation);
  if (process.env.VERCEL === "1") throw new Error("A shared SERV budget store is required on Vercel.");
  return withLocalLedger(operation);
}

export function canEnforceLiveBudget(): boolean {
  try {
    if (redisConfig()) return configuredNumber(process.env.SERV_SHARED_MAX_CALLS, 0) > 0;
    return process.env.VERCEL !== "1";
  } catch {
    return false;
  }
}

export async function verifySharedBudget(): Promise<boolean> {
  try {
    const config = redisConfig();
    if (!config || !canEnforceLiveBudget()) return false;
    return await withRedisLedger(config, ledger =>
      ledger.calls < Math.floor(configuredNumber(process.env.SERV_SHARED_MAX_CALLS, 0)) - RESERVED_CALLS &&
      ledger.spendMicros < configuredNumber(process.env.SERV_MAX_SPEND_USD, DEFAULT_MAX_SPEND_USD) * 1_000_000);
  } catch {
    return false;
  }
}

export function budgetClient(request?: Request): string {
  const forwarded = process.env.VERCEL === "1" ? request?.headers.get("x-vercel-forwarded-for") : null;
  const address = forwarded?.split(",")[0].trim();
  if (address && isIP(address)) {
    return createHash("sha256").update(address).digest("hex");
  }
  return process.env.VERCEL === "1" ? "shared-unknown-web-client" : "local-client";
}

export function reservedDemoAuthorized(request: Request): boolean {
  const expected = process.env.SERV_FINAL_DEMO_TOKEN?.trim();
  const received = request.headers.get("x-carrylock-final-demo");
  if (!expected || expected.length < 24 || !received) {
    return process.env.VERCEL !== "1" && process.env.SERV_FINAL_DEMO_LOCAL === "1";
  }
  const secret = Buffer.from(expected);
  const supplied = Buffer.from(received);
  return secret.length === supplied.length && timingSafeEqual(secret, supplied);
}

function cacheCipherKey(apiKey: string): Buffer {
  return createHash("sha256").update("carrylock-cache-v1\u0000").update(apiKey).digest();
}

function sealCache(result: ServResult, hash: string, apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cacheCipherKey(apiKey), iv);
  cipher.setAAD(Buffer.from(hash));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(result), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function openCache(sealed: string, hash: string, apiKey: string): ServResult {
  const payload = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", cacheCipherKey(apiKey), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(hash));
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8")) as ServResult;
}


function cleanUp(ledger: Ledger, now: number) {
  for (const [key, calls] of Object.entries(ledger.clients)) {
    const active = calls.filter((timestamp) => timestamp > now - HOUR_MS);
    if (active.length) ledger.clients[key] = active;
    else delete ledger.clients[key];
  }
  for (const [key, entry] of Object.entries(ledger.cache)) {
    if (entry.expires <= now) delete ledger.cache[key];
  }
  for (const [key, pending] of Object.entries(ledger.pending)) {
    if (pending.expires <= now) delete ledger.pending[key];
  }
}

export async function reserveServCall(
  hash: string,
  client: string,
  finalDemo: boolean,
  reservedMicros: number,
  model: string,
  apiKey: string,
): Promise<BudgetOutcome> {
  try {
    return await withLedger((ledger) => {
      const now = Date.now();
      cleanUp(ledger, now);
      const cached = ledger.cache[hash];
      if (cached) {
        if ("sealed" in cached) return { kind: "cached", result: openCache(cached.sealed, hash, apiKey) };
        // Existing pre-encryption synthetic evidence can be reused without a new billable call.
        ledger.cache[hash] = { expires: cached.expires, sealed: sealCache(cached.result, hash, apiKey) };
        return { kind: "cached", result: cached.result };
      }
      if (ledger.pending[hash]) return { kind: "blocked", reason: "An identical extraction is already in progress." };
      const shared = redisConfig() !== null;
      const totalCalls = Math.floor(shared
        ? configuredNumber(process.env.SERV_SHARED_MAX_CALLS, 0)
        : configuredNumber(process.env.SERV_DEV_MAX_CALLS, DEFAULT_TOTAL_CALLS));
      const callLimit = finalDemo ? totalCalls : Math.max(0, totalCalls - RESERVED_CALLS);
      if (ledger.calls >= callLimit) {
        return { kind: "blocked", reason: finalDemo
          ? "The total SERV request budget has been reached."
          : "The regular SERV request budget is spent. Remaining requests are reserved for the final demo." };
      }
      const clientCalls = ledger.clients[client] ?? [];
      const hourlyLimit = Math.floor(configuredNumber(process.env.SERV_LIVE_MAX_PER_HOUR, DEFAULT_HOURLY_PER_CLIENT));
      if (clientCalls.length >= hourlyLimit) {
        return { kind: "blocked", reason: "This client has reached its limit of " + hourlyLimit + " live requests in one hour." };
      }
      const spendLimit = configuredNumber(process.env.SERV_MAX_SPEND_USD, DEFAULT_MAX_SPEND_USD) * 1_000_000;
      if (ledger.spendMicros + reservedMicros > spendLimit) {
        return { kind: "blocked", reason: "The SERV spending budget does not have capacity for this request." };
      }

      const reservation = { id: randomUUID(), reservedMicros, expires: now + PENDING_MS };
      ledger.pending[hash] = reservation;
      ledger.calls += 1;
      ledger.spendMicros += reservedMicros;
      ledger.clients[client] = [...clientCalls, now];
      ledger.records.push({
        sequence: ledger.calls,
        reservationId: reservation.id,
        at: new Date(now).toISOString(),
        requestedModel: model,
        estimatedConservativeUsd: reservedMicros / 1_000_000,
        status: "reserved",
      });
      return { kind: "allowed", reservation };
    });
  } catch {
    return { kind: "blocked", unavailable: true, reason: "The shared SERV budget could not be confirmed. No provider request was sent." };
  }
}

export async function settleServCall(hash: string, reservation: Pending, result: ServResult, apiKey: string) {
  await withLedger((ledger) => {
    if (ledger.pending[hash]?.id !== reservation.id) return;
    delete ledger.pending[hash];
    const { usage } = result.audit;
    const catalogMicros = usage?.inputTokens != null && usage.outputTokens != null
      ? usage.inputTokens + usage.outputTokens * 6
      : null;
    const costMicros = usage?.reportedCostUsd != null ? Math.ceil(usage.reportedCostUsd * 1_000_000) : catalogMicros;
    if (costMicros !== null) ledger.spendMicros += costMicros - reservation.reservedMicros;
    const record = ledger.records.find((entry) => entry.reservationId === reservation.id);
    if (record) {
      record.status = result.audit.status;
      record.httpStatus = result.audit.httpStatus;
      record.returnedModel = result.audit.returnedModel;
      record.inputTokens = usage?.inputTokens ?? null;
      record.outputTokens = usage?.outputTokens ?? null;
      record.latencyMs = result.audit.latencyMs;
      record.estimatedListUsd = catalogMicros === null ? null : catalogMicros / 1_000_000;
      record.reportedUsd = usage?.reportedCostUsd ?? null;
    }
    if (result.audit.status === "completed" || result.audit.status === "partial") {
      ledger.cache[hash] = { expires: Date.now() + HOUR_MS, sealed: sealCache(result, hash, apiKey) };
    }
  }).catch(() => undefined);
}
