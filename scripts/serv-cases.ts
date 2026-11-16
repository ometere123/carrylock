import { getFixture, type Fixture } from "../src/lib/fixtures";
import type { Event } from "../src/lib/types";

export const DATASET_VERSION = "carrylock.serv-eval.v2.0.0";

const existing = [
  "relief-reinstatement", "bypass-omitted", "permit-suspended", "closure-verified",
  "equipment-alias", "prompt-injection", "wrong-permit", "unverified-closure",
  "missing-information", "unrelated-equipment",
];

const heldOut: Fixture[] = [
  {
    id: "unseen-alias-restriction", version: DATASET_VERSION, title: "Alias with nearby equipment",
    summary: "An active bypass is attributed only to its catalogue alias.",
    input: {
      shifts: [
        { id: "a", label: "A", notes: "The west cooling trip is on active bypass. SIS-805 is normal." },
        { id: "b", label: "B", notes: "Water samples logged." },
      ],
      equipment: [
        { id: "SIS-804", aliases: ["west cooling trip"], permitIds: [] },
        { id: "SIS-805", aliases: ["east cooling trip"], permitIds: [] },
      ],
      register: [],
      action: { description: "Review restart of SIS-804.", equipmentIds: ["SIS-804"], permitIds: [] },
    },
    events: [{
      shiftId: "a", equipmentId: "SIS-804", permitId: null, type: "SAFETY_BYPASS", status: "ACTIVE",
      quote: "The west cooling trip is on active bypass.", confidence: "HIGH", followUp: null,
    }],
    expected: {
      verdict: "HOLD", findingCodes: ["OMITTED_FROM_HANDOVER"], omittedShiftIds: ["b"],
      obligations: [{ equipmentId: "SIS-804", permitId: null, type: "SAFETY_BYPASS", state: "OPEN" }],
    },
  },
  {
    id: "unseen-unsupported-reinstatement", version: DATASET_VERSION, title: "Claim without a register",
    summary: "Two notes mention the same relief valve but provide no verified closure.",
    input: {
      shifts: [
        { id: "a", label: "A", notes: "The relief valve PSV-861 is out for inspection." },
        { id: "b", label: "B", notes: "PSV-861 reportedly reinstated. Independent sign-off is missing." },
      ],
      equipment: [{ id: "PSV-861", aliases: [], permitIds: [] }],
      register: [],
      action: { description: "Review restart dependent on PSV-861.", equipmentIds: ["PSV-861"], permitIds: [] },
    },
    events: [
      { shiftId: "a", equipmentId: "PSV-861", permitId: null, type: "RELIEF_BARRIER", status: "ACTIVE", quote: "The relief valve PSV-861 is out for inspection.", confidence: "HIGH", followUp: null },
      { shiftId: "b", equipmentId: "PSV-861", permitId: null, type: "RELIEF_BARRIER", status: "CLOSURE_CLAIM", quote: "PSV-861 reportedly reinstated.", confidence: "HIGH", followUp: null },
    ],
    expected: {
      verdict: "HOLD", findingCodes: ["UNVERIFIED_CLOSURE"], omittedShiftIds: [],
      obligations: [{ equipmentId: "PSV-861", permitId: null, type: "RELIEF_BARRIER", state: "OPEN" }],
    },
  },
];

export const evaluationCases = [
  ...existing.map(id => {
    const fixture = getFixture(id);
    if (!fixture) throw new Error("Missing evaluation fixture " + id);
    if (id === "permit-suspended") {
      // A reported release conflicts with the active register and lacks authorized closure.
      return { ...fixture, expected: { ...fixture.expected, findingCodes: ["CONFLICTING_EVIDENCE", "UNVERIFIED_CLOSURE"] as Fixture["expected"]["findingCodes"] } };
    }
    return fixture;
  }),
  ...heldOut,
];

export function eventKey(event: Pick<Event, "shiftId" | "equipmentId" | "permitId" | "type" | "status">) {
  return JSON.stringify([event.shiftId, event.equipmentId, event.permitId, event.type, event.status]);
}
