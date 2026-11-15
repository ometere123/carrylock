import { NextResponse } from "next/server";
import { reconcile } from "../../../lib/engine";
import { getFixture } from "../../../lib/fixtures";
import { createReceipt, type ReviewResponse } from "../../../lib/receipt";
import { canRunLiveReview, extractForWeb, SERV_MODEL } from "../../../lib/serv";
import { canEnforceLiveBudget } from "../../../lib/serv-budget";
import { reviewRequestSchema } from "../../../lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 96_000;
const responseOptions = { headers: { "Cache-Control": "no-store" } };

class PayloadError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new PayloadError(415, "Send an application/json request.");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new PayloadError(413, "The review input is too large.");
  }
  if (!request.body) {
    throw new PayloadError(400, "Provide a review input or a scenario identifier.");
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadError(413, "The review input is too large.");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof PayloadError) throw error;
    throw new PayloadError(400, "The request contains invalid JSON.");
  } finally {
    reader.releaseLock();
  }
}

export function GET() {
  return NextResponse.json({ liveEnabled: canRunLiveReview(), budgetReady: canEnforceLiveBudget(), model: SERV_MODEL }, responseOptions);
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (error) {
    const payloadError = error instanceof PayloadError ? error : new PayloadError(400, "The request could not be read.");
    return NextResponse.json({ error: payloadError.message }, { ...responseOptions, status: payloadError.status });
  }

  const parsed = reviewRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Use a bundled scenario ID or provide two to eight shift notes, equipment, a register array and an action.",
    }, { ...responseOptions, status: 400 });
  }

  if ("scenarioId" in parsed.data) {
    const fixture = getFixture(parsed.data.scenarioId);
    if (!fixture?.demoLabel) {
      return NextResponse.json({ error: "That demonstration scenario was not found." }, { ...responseOptions, status: 404 });
    }

    const { input, events } = fixture;
    const review = reconcile(input, events);
    const receipt = createReceipt(input, review, {
      mode: "synthetic_fixture",
      fixtureId: fixture.id,
      fixtureVersion: fixture.version,
    }, events);
    return NextResponse.json<ReviewResponse>({ input, review, receipt }, responseOptions);
  }

  const { input } = parsed.data;
  const extraction = await extractForWeb(input, request);
  const review = reconcile(input, extraction.events, { issues: extraction.issues });
  const serv = extraction.audit.status === "completed" &&
    review.findings.some((finding) => finding.code === "EVIDENCE_REJECTED")
    ? { ...extraction.audit, status: "partial" as const }
    : extraction.audit;
  const receipt = createReceipt(input, review, { mode: "serv", serv }, extraction.events);
  return NextResponse.json<ReviewResponse>({ input, review, receipt }, responseOptions);
}
