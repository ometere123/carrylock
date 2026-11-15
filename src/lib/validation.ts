import { z } from "zod";
import {
  CONFIDENCE_LEVELS, EVENT_STATUSES, EVENT_TYPES, EVIDENCE_TYPES, REGISTER_ROLES, REGISTER_STATUSES,
  type Event, type ReviewInput,
} from "./types";

const identifier = z.string().min(1).max(80).regex(/^[\p{L}\p{N}_.:/-]+$/u);
const nonblank = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0);

const inputSchema: z.ZodType<ReviewInput> = z.strictObject({
  shifts: z.array(z.strictObject({
    id: identifier,
    label: nonblank(100),
    notes: z.string().max(10_000),
  })).min(2).max(8),
  equipment: z.array(z.strictObject({
    id: identifier,
    aliases: z.array(nonblank(120)).max(12),
    permitIds: z.array(identifier).max(20),
  })).max(32),
  register: z.array(z.strictObject({
    id: identifier,
    shiftId: identifier,
    equipmentId: identifier,
    permitId: identifier.nullable(),
    type: z.enum(EVENT_TYPES),
    status: z.enum(REGISTER_STATUSES),
    evidenceType: z.enum(EVIDENCE_TYPES).nullable(),
    evidenceRef: nonblank(240).nullable(),
    confirmedBy: nonblank(120).nullable(),
    role: z.enum(REGISTER_ROLES).nullable(),
  })).max(80),
  action: z.strictObject({
    description: nonblank(1600),
    equipmentIds: z.array(identifier).max(32),
    permitIds: z.array(identifier).max(32),
  }),
}).superRefine((input, ctx) => {
  for (const key of ["shifts", "equipment", "register"] as const) {
    const ids = input[key].map((entry) => key === "equipment" ? entry.id.toLowerCase() : entry.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: [key], message: "IDs in each section must be unique." });
    }
  }
  if (input.shifts.reduce((length, shift) => length + shift.notes.length, 0) > 28_000) {
    ctx.addIssue({ code: "custom", path: ["shifts"], message: "The review allows up to 28,000 characters of shift notes." });
  }
});

export const reviewRequestSchema = z.union([
  z.strictObject({ scenarioId: identifier }),
  z.strictObject({ input: inputSchema }),
]);

export const modelEventSchema: z.ZodType<Event> = z.strictObject({
  equipmentId: identifier,
  permitId: identifier.nullable(),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  shiftId: identifier,
  quote: nonblank(1600),
  confidence: z.enum(CONFIDENCE_LEVELS),
  followUp: nonblank(240).nullable(),
});

const coverageStatus = ["COMPLETE", "PARTIAL"] as const;
export const modelCoverageSchema = z.strictObject({
  shiftId: identifier,
  status: z.enum(coverageStatus),
  issue: nonblank(240).nullable(),
});

export const modelResultSchema = z.strictObject({
  events: z.array(z.unknown()).max(160),
  coverage: z.array(z.unknown()).max(8),
});

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const enumeration = (values: readonly string[]) => ({ type: "string", enum: values });
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items: Record<string, unknown>) => ({ type: "array", items });

export const servResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "carrylock_handover_events_v1",
    strict: true,
    schema: strictObject({
      events: list(strictObject({
        equipmentId: string,
        permitId: nullableString,
        type: enumeration(EVENT_TYPES),
        status: enumeration(EVENT_STATUSES),
        shiftId: string,
        quote: string,
        confidence: enumeration(CONFIDENCE_LEVELS),
        followUp: nullableString,
      })),
      coverage: list(strictObject({
        shiftId: string,
        status: enumeration(coverageStatus),
        issue: nullableString,
      })),
    }),
  },
};
