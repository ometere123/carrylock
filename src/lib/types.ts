export const EVENT_TYPES = [
  'RELIEF_BARRIER',
  'SAFETY_BYPASS',
  'PERMIT_RESTRICTION',
  'ISOLATION',
  'OTHER_RESTRICTION',
] as const;
export const EVENT_STATUSES = ['ACTIVE', 'CLOSURE_CLAIM', 'UNKNOWN'] as const;
export const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const EVIDENCE_TYPES = [
  'REINSTATEMENT_RECORD',
  'BYPASS_REMOVAL_RECORD',
  'PERMIT_RELEASE',
  'ISOLATION_RELEASE',
  'RESTRICTION_RELEASE',
] as const;
export const REGISTER_ROLES = ['SHIFT_SUPERVISOR', 'PERMIT_AUTHORITY', 'SAFETY_AUTHORITY'] as const;
export const REGISTER_STATUSES = ['ACTIVE', 'CLOSED'] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type RegisterRole = (typeof REGISTER_ROLES)[number];

export type Shift = { id: string; label: string; notes: string };
export type Equipment = { id: string; aliases: string[]; permitIds: string[] };
export type RegisterRecord = {
  id: string;
  shiftId: string;
  equipmentId: string;
  permitId: string | null;
  type: EventType;
  status: (typeof REGISTER_STATUSES)[number];
  evidenceType: EvidenceType | null;
  evidenceRef: string | null;
  confirmedBy: string | null;
  role: RegisterRole | null;
};
export type ProposedAction = { description: string; equipmentIds: string[]; permitIds: string[] };
export type ReviewInput = {
  shifts: Shift[];
  equipment: Equipment[];
  register: RegisterRecord[];
  action: ProposedAction;
};

export type Event = {
  equipmentId: string;
  permitId: string | null;
  type: EventType;
  status: EventStatus;
  shiftId: string;
  quote: string;
  confidence: Confidence;
  followUp: string | null;
};

export type EvidenceLocation = {
  source: 'shift' | 'register';
  sourceId: string;
  start: number;
  end: number;
  line: number;
};

export type VerifiedEvent = Omit<Event, 'status'> & {
  status: EventStatus | 'VERIFIED_CLOSURE';
  evidence: EvidenceLocation;
};

export type State = 'OPEN' | 'CLOSED_VERIFIED' | 'CONFLICT' | 'UNKNOWN';
export type Verdict = 'HOLD' | 'REVIEW_REQUIRED' | 'NO_CONFLICT_FOUND';

export type RuleCode =
  | 'ACTIVE_OBSERVED'
  | 'CARRIED_FORWARD'
  | 'OMITTED_FROM_HANDOVER'
  | 'UNVERIFIED_CLOSURE'
  | 'CONFLICTING_EVIDENCE'
  | 'VERIFIED_CLOSURE'
  | 'UNKNOWN_STATUS'
  | 'EVIDENCE_REJECTED'
  | 'REGISTER_RECORD_REJECTED'
  | 'INPUT_INCOMPLETE'
  | 'ACTION_DEPENDENCY_UNKNOWN'
  | 'ACTION_RESTRICTION'
  | 'REVIEW_REQUIRED'
  | 'NO_CONFLICT_FOUND';

export type Obligation = {
  id: string;
  equipmentId: string;
  permitId: string | null;
  type: EventType;
  state: State;
  firstShiftId: string;
  lastMentionShiftId: string;
  evidence: VerifiedEvent[];
  missingEvidence: string[];
  followUp: string | null;
};

export type Finding = {
  code: RuleCode;
  kind: 'OMISSION' | 'CONFLICT' | 'UNVERIFIED_CLOSURE' | 'UNKNOWN' | 'VERIFIED_CLOSURE';
  title: string;
  detail: string;
  shiftId: string | null;
  obligationId: string | null;
  evidence: VerifiedEvent[];
};

export type Transition = {
  obligationId: string;
  from: State | null;
  to: State;
  rule: RuleCode;
};

export type TimelineStep = {
  shiftId: string;
  label: string;
  obligations: { id: string; state: State; omitted: boolean }[];
  transitions: Transition[];
};

export type ActionReview = {
  matchedObligationIds: string[];
  blockingObligationIds: string[];
  unresolvedObligationIds: string[];
};

export type Review = {
  verdict: Verdict;
  actionReview: ActionReview;
  obligations: Obligation[];
  findings: Finding[];
  timeline: TimelineStep[];
  rulesTriggered: RuleCode[];
  missingEvidence: string[];
  events: VerifiedEvent[];
};
