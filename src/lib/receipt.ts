import { createHash } from "node:crypto";
import type { Event, Review, ReviewInput } from "./types";

export type ServStatus =
  | "not_configured"
  | "disabled"
  | "rate_limited"
  | "completed"
  | "partial"
  | "timeout"
  | "unavailable"
  | "http_error"
  | "invalid_response";

export interface ServUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reportedCostUsd: number | null;
}

export interface ServAudit {
  status: ServStatus;
  requestedModel: string;
  returnedModel: string | null;
  requestId: string | null;
  completionId: string | null;
  attempted: boolean;
  cacheHit?: boolean;
  originalLatencyMs?: number | null;
  latencyMs: number | null;
  httpStatus: number | null;
  finishReason: string | null;
  usage: ServUsage | null;
  promptVersion: string;
  schemaVersion: string;
}

type ExtractionSource =
  | { mode: "synthetic_fixture"; fixtureId: string; fixtureVersion: string }
  | { mode: "serv"; serv: ServAudit };

export function hashInput(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function createReceipt(input: ReviewInput, review: Review, extraction: ExtractionSource, candidates: Event[]) {
  return {
    schemaVersion: "carrylock.review-receipt.v1",
    timestamp: new Date().toISOString(),
    inputHashes: {
      algorithm: "SHA-256",
      encoding: "UTF-8 canonical JSON; object keys sorted; array order preserved",
      dataset: hashInput(input),
      shifts: input.shifts.map(({ id, label, notes }) => ({
        id,
        hash: hashInput({ id, label, notes }),
        notesHash: hashInput(notes),
      })),
      equipment: hashInput(input.equipment),
      register: hashInput(input.register),
      action: hashInput(input.action),
    },
    action: input.action,
    extraction,
    extractedEvents: review.events,
    extractedCandidateCount: candidates.length,
    obligations: review.obligations,
    timeline: review.timeline,
    findings: review.findings,
    rulesTriggered: review.rulesTriggered,
    actionReview: review.actionReview,
    verdict: review.verdict,
    unknownOrMissingEvidence: review.missingEvidence,
    advisory: "Prototype review only. Qualified site personnel retain responsibility for any operating decision.",
  };
}

export type ReviewReceipt = ReturnType<typeof createReceipt>;
export type ReviewResponse = { input: ReviewInput; review: Review; receipt: ReviewReceipt };
