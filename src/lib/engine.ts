import {
  CONFIDENCE_LEVELS,
  EVENT_STATUSES,
  EVENT_TYPES,
  REGISTER_STATUSES,
  type Equipment,
  type Event,
  type EventType,
  type EvidenceType,
  type Finding,
  type Obligation,
  type RegisterRecord,
  type RegisterRole,
  type Review,
  type ReviewInput,
  type RuleCode,
  type State,
  type TimelineStep,
  type VerifiedEvent,
} from './types';

const CLOSURE_POLICY: Record<EventType, { evidenceType: EvidenceType; roles: readonly RegisterRole[] }> = {
  RELIEF_BARRIER: {
    evidenceType: 'REINSTATEMENT_RECORD',
    roles: ['SHIFT_SUPERVISOR', 'SAFETY_AUTHORITY'],
  },
  SAFETY_BYPASS: {
    evidenceType: 'BYPASS_REMOVAL_RECORD',
    roles: ['SHIFT_SUPERVISOR', 'SAFETY_AUTHORITY'],
  },
  PERMIT_RESTRICTION: {
    evidenceType: 'PERMIT_RELEASE',
    roles: ['PERMIT_AUTHORITY'],
  },
  ISOLATION: {
    evidenceType: 'ISOLATION_RELEASE',
    roles: ['SHIFT_SUPERVISOR', 'SAFETY_AUTHORITY'],
  },
  OTHER_RESTRICTION: {
    evidenceType: 'RESTRICTION_RELEASE',
    roles: ['SHIFT_SUPERVISOR', 'SAFETY_AUTHORITY'],
  },
};

const TYPE_LABELS: Record<EventType, string> = {
  RELIEF_BARRIER: 'relief barrier',
  SAFETY_BYPASS: 'safety system bypass',
  PERMIT_RESTRICTION: 'permit restriction',
  ISOLATION: 'isolation',
  OTHER_RESTRICTION: 'restriction',
};

const identifierCharacter = /[\p{L}\p{N}_-]/u;
const identifierSeparator = /[./]/;

function identifierContinues(source: string, index: number, direction: 1 | -1): boolean {
  const character = source[index] ?? '';
  return identifierCharacter.test(character) ||
    (identifierSeparator.test(character) && identifierCharacter.test(source[index + direction] ?? ''));
}

export function mentionsIdentifier(text: string, identifier: string): boolean {
  const source = text.toLowerCase();
  const needle = identifier.trim().toLowerCase();
  if (!needle) return false;

  for (let start = source.indexOf(needle); start !== -1; start = source.indexOf(needle, start + 1)) {
    if (!identifierContinues(source, start - 1, -1) &&
        !identifierContinues(source, start + needle.length, 1)) return true;
  }
  return false;
}

function sameIdentifier(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolveEquipment(input: ReviewInput, observedId: string): Equipment | undefined {
  const exact = input.equipment.filter((asset) => sameIdentifier(asset.id, observedId));
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const candidates = input.equipment.filter((asset) =>
    asset.aliases.some((alias) => sameIdentifier(alias, observedId)),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function mentionsEquipment(input: ReviewInput, quote: string, equipment: Equipment): boolean {
  if (resolveEquipment(input, equipment.id) !== equipment) return false;
  if (mentionsIdentifier(quote, equipment.id)) return true;
  return equipment.aliases.some((alias) =>
    resolveEquipment(input, alias)?.id === equipment.id && mentionsIdentifier(quote, alias),
  );
}

function obligationKey(event: Pick<Event, 'equipmentId' | 'type' | 'permitId'>): string {
  return JSON.stringify([event.equipmentId, event.type, event.permitId]);
}

function locationOfShiftQuote(shiftId: string, notes: string, quote: string): VerifiedEvent['evidence'] | null {
  if (!quote.trim()) return null;
  const start = notes.indexOf(quote);
  if (start < 0) return null;
  return {
    source: 'shift',
    sourceId: shiftId,
    start,
    end: start + quote.length,
    line: notes.slice(0, start).split('\n').length,
  };
}

function groundedShiftEvent(input: ReviewInput, event: Event): VerifiedEvent | null {
  const shift = input.shifts.find(({ id }) => id === event.shiftId);
  const equipment = resolveEquipment(input, event.equipmentId);
  if (!shift || !equipment ||
      !EVENT_TYPES.includes(event.type) ||
      !EVENT_STATUSES.includes(event.status) ||
      !CONFIDENCE_LEVELS.includes(event.confidence)) return null;

  const evidence = locationOfShiftQuote(shift.id, shift.notes, event.quote);
  if (!evidence) return null;

  const observedPermitId = event.permitId;
  const permitId = observedPermitId === null
    ? null
    : equipment.permitIds.find((permit) => sameIdentifier(permit, observedPermitId));
  if (observedPermitId !== null && (!permitId || !mentionsIdentifier(event.quote, permitId))) return null;

  const permitBindsEquipment = Boolean(event.type === 'PERMIT_RESTRICTION' && permitId &&
    input.equipment.filter((asset) =>
      asset.permitIds.some((permit) => sameIdentifier(permit, permitId)),
    ).length === 1);
  if (!mentionsEquipment(input, event.quote, equipment) && !permitBindsEquipment) return null;

  // A quote naming a configured permit cannot be shortened into an unscoped event.
  if (!permitId && equipment.permitIds.some((permit) => mentionsIdentifier(event.quote, permit))) return null;

  return { ...event, equipmentId: equipment.id, permitId: permitId ?? null, evidence };
}

function meaningful(value: string | null): boolean {
  return Boolean(value?.trim() && !/^(?:-|n\/?a|none|pending|tbd|unknown)$/i.test(value.trim()));
}

function closureDeficits(record: RegisterRecord): string[] {
  const policy = CLOSURE_POLICY[record.type];
  const missing: string[] = [];
  if (record.evidenceType !== policy.evidenceType) missing.push('Provide ' + policy.evidenceType + '.');
  if (!meaningful(record.evidenceRef)) missing.push('Provide a closure evidence reference.');
  if (!meaningful(record.confirmedBy)) missing.push('Identify the confirmer.');
  if (record.role === null || !policy.roles.includes(record.role)) {
    missing.push('Confirmation requires the role ' + policy.roles.join(' or ') + '.');
  }
  return missing;
}

function groundedRegisterEvent(input: ReviewInput, row: RegisterRecord): VerifiedEvent | null {
  const shift = input.shifts.find(({ id }) => id === row.shiftId);
  const equipment = resolveEquipment(input, row.equipmentId);
  if (!shift || !equipment || !sameIdentifier(equipment.id, row.equipmentId) ||
      !row.id.trim() || !EVENT_TYPES.includes(row.type) ||
      !REGISTER_STATUSES.includes(row.status)) return null;

  const declaredPermitId = row.permitId;
  const permitId = declaredPermitId === null
    ? null
    : equipment.permitIds.find((permit) => sameIdentifier(permit, declaredPermitId));
  if ((declaredPermitId !== null && !permitId) || (row.type === 'PERMIT_RESTRICTION' && !permitId)) return null;

  const quote = JSON.stringify(row);
  const deficits = row.status === 'CLOSED' ? closureDeficits(row) : [];
  const status = row.status === 'ACTIVE' ? 'ACTIVE'
    : deficits.length ? 'CLOSURE_CLAIM' : 'VERIFIED_CLOSURE';
  return {
    equipmentId: equipment.id,
    permitId: permitId ?? null,
    type: row.type,
    status,
    shiftId: row.shiftId,
    quote,
    confidence: 'HIGH',
    followUp: deficits.length ? deficits.join(' ') : null,
    evidence: { source: 'register', sourceId: row.id, start: 0, end: quote.length, line: 1 },
  };
}

function deduplicateEvents(events: VerifiedEvent[]): VerifiedEvent[] {
  const byLocation = new Map<string, VerifiedEvent>();
  for (const event of events) {
    const key = JSON.stringify([
      obligationKey(event), event.status, event.evidence.source, event.evidence.sourceId,
      event.evidence.start, event.evidence.end,
    ]);
    if (!byLocation.has(key)) byLocation.set(key, event);
  }
  return [...byLocation.values()];
}

function scopeForAction(input: ReviewInput) {
  const namedEquipment = new Set<string>();
  const namedPermits = new Set<string>();
  const issues: string[] = [];

  for (const id of input.action.equipmentIds) {
    const asset = resolveEquipment(input, id);
    if (asset) namedEquipment.add(asset.id);
    else issues.push('Unmapped proposed action equipment: ' + id + '.');
  }
  for (const equipment of input.equipment) {
    if (mentionsEquipment(input, input.action.description, equipment)) namedEquipment.add(equipment.id);
  }

  const permitIds = [...new Set(input.equipment.flatMap((equipment) => equipment.permitIds))];
  for (const id of input.action.permitIds) {
    const permitId = permitIds.find((permit) => sameIdentifier(permit, id));
    if (permitId) namedPermits.add(permitId);
    else issues.push('Unmapped proposed action permit: ' + id + '.');
  }
  for (const permitId of permitIds) {
    if (mentionsIdentifier(input.action.description, permitId)) namedPermits.add(permitId);
  }

  if (!input.action.description.trim()) issues.push('A proposed action was not provided.');
  if (!namedEquipment.size && !namedPermits.size) {
    issues.push('Map the action to equipment or permit identifiers before reviewing it.');
  }

  const permitEquipment = new Set<string>();
  for (const equipment of input.equipment) {
    if (equipment.permitIds.some((permitId) => namedPermits.has(permitId))) {
      permitEquipment.add(equipment.id);
    }
  }

  function matches(obligation: Obligation): boolean {
    if (obligation.permitId !== null && namedPermits.has(obligation.permitId)) return true;
    // A specifically scoped permit review does not substitute another permit on the same equipment.
    if (obligation.type === 'PERMIT_RESTRICTION' && obligation.permitId &&
        permitEquipment.has(obligation.equipmentId)) return false;
    return namedEquipment.has(obligation.equipmentId) || permitEquipment.has(obligation.equipmentId);
  }
  return { namedEquipment, namedPermits, issues, matches };
}

function describe(event: Pick<Event, 'equipmentId' | 'permitId' | 'type'>): string {
  const permit = event.permitId ? ' / ' + event.permitId : '';
  return event.equipmentId + permit + ' ' + TYPE_LABELS[event.type];
}

function evidenceNeeded(event: Pick<Event, 'equipmentId' | 'permitId' | 'type'>): string {
  const policy = CLOSURE_POLICY[event.type];
  return describe(event) + ' requires ' + policy.evidenceType + ' and confirmation by ' +
    policy.roles.join(' or ') + '.';
}

type Signals = {
  active: VerifiedEvent[];
  closures: VerifiedEvent[];
  claims: VerifiedEvent[];
  uncertain: VerifiedEvent[];
};

function classify(events: VerifiedEvent[]): Signals {
  return {
    active: events.filter(({ status }) => status === 'ACTIVE'),
    closures: events.filter(({ status }) => status === 'VERIFIED_CLOSURE'),
    claims: events.filter(({ status }) => status === 'CLOSURE_CLAIM'),
    uncertain: events.filter(({ confidence, status }) => confidence === 'LOW' || status === 'UNKNOWN'),
  };
}

function nextState(
  previous: State | null,
  signals: Signals,
  activeRegister: VerifiedEvent | undefined,
): { state: State; rule: RuleCode; conflicts: VerifiedEvent[] } {
  const { active, closures, claims, uncertain } = signals;
  const conflicts = active.length && (claims.length || closures.length)
    ? [...active, ...claims, ...closures]
    : activeRegister && claims.length && !closures.length
      ? [activeRegister, ...claims]
      : [];
  if (conflicts.length) return { state: 'CONFLICT', rule: 'CONFLICTING_EVIDENCE', conflicts };
  if (closures.length && uncertain.length) {
    return { state: 'CONFLICT', rule: 'CONFLICTING_EVIDENCE', conflicts: [...closures, ...uncertain] };
  }
  if (closures.length) return { state: 'CLOSED_VERIFIED', rule: 'VERIFIED_CLOSURE', conflicts };
  if (previous === 'CONFLICT') return { state: previous, rule: 'CARRIED_FORWARD', conflicts };
  if (active.length) return { state: 'OPEN', rule: 'ACTIVE_OBSERVED', conflicts };
  if (previous === 'CLOSED_VERIFIED' && claims.some(({ evidence }) => evidence.source === 'register')) {
    return { state: 'UNKNOWN', rule: 'UNVERIFIED_CLOSURE', conflicts };
  }
  if (uncertain.length && previous !== 'OPEN') {
    return { state: 'UNKNOWN', rule: 'UNKNOWN_STATUS', conflicts };
  }
  if (claims.length && previous !== 'CLOSED_VERIFIED') {
    return { state: previous ?? 'UNKNOWN', rule: 'UNVERIFIED_CLOSURE', conflicts };
  }
  return { state: previous ?? 'UNKNOWN', rule: 'CARRIED_FORWARD', conflicts };
}

function collectGroundedEvidence(
  input: ReviewInput,
  events: readonly Event[],
  recordIssue: (code: RuleCode, title: string, detail: string, shiftId?: string) => void,
): VerifiedEvent[] {
  const grounded: VerifiedEvent[] = [];
  for (const event of events) {
    const supported = groundedShiftEvent(input, event);
    if (supported) grounded.push(supported);
    else recordIssue('EVIDENCE_REJECTED', 'Extraction evidence rejected',
      'An extracted event could not be tied to an exact quotation and known identifiers.', event.shiftId);
  }

  const rowCounts = new Map<string, number>();
  for (const row of input.register) rowCounts.set(row.id, (rowCounts.get(row.id) ?? 0) + 1);
  for (const row of input.register) {
    const supported = rowCounts.get(row.id) === 1 ? groundedRegisterEvent(input, row) : null;
    if (supported) grounded.push(supported);
    else recordIssue('REGISTER_RECORD_REJECTED', 'Register record rejected',
      'A register record has an ambiguous identity, unknown shift or mismatched equipment and permit.', row.shiftId);
  }
  return deduplicateEvents(grounded);
}

export function reconcile(input: ReviewInput, extraction: readonly Event[], options: { issues?: string[] } = {}): Review {
  const findings: Finding[] = [];
  const rules = new Set<RuleCode>();
  const reviewIssues = new Set(options.issues ?? []);
  const timeline: TimelineStep[] = [];
  const obligations = new Map<string, Obligation>();
  const registerRestrictions = new Map<string, VerifiedEvent>();

  function finding(
    code: RuleCode,
    kind: Finding['kind'],
    title: string,
    detail: string,
    shiftId: string | null = null,
    obligationId: string | null = null,
    evidence: VerifiedEvent[] = [],
  ) {
    rules.add(code);
    findings.push({ code, kind, title, detail, shiftId, obligationId, evidence });
  }

  function recordIssue(code: RuleCode, title: string, detail: string, shiftId?: string) {
    reviewIssues.add(detail);
    finding(code, 'UNKNOWN', title, detail, shiftId);
  }

  for (const issue of options.issues ?? []) {
    finding('INPUT_INCOMPLETE', 'UNKNOWN', 'Extraction incomplete', issue);
  }
  if (input.shifts.length < 2) {
    recordIssue('INPUT_INCOMPLETE', 'Shift history incomplete', 'A cross-shift review needs at least two shifts.');
  }
  for (const shift of input.shifts) {
    if (!shift.notes.trim()) {
      recordIssue('INPUT_INCOMPLETE', 'Shift notes missing', shift.label + ' has no source notes.', shift.id);
    }
  }

  const events = collectGroundedEvidence(input, extraction, recordIssue);

  for (const shift of input.shifts) {
    const shiftsEvents = events.filter((event) => event.shiftId === shift.id);
    const grouped = new Map<string, VerifiedEvent[]>();
    for (const event of shiftsEvents) {
      const key = obligationKey(event);
      const members = grouped.get(key) ?? [];
      members.push(event);
      grouped.set(key, members);
    }

    const keys = new Set([...obligations.keys(), ...grouped.keys()]);
    const step: TimelineStep = { shiftId: shift.id, label: shift.label, obligations: [], transitions: [] };
    for (const key of keys) {
      const previous = obligations.get(key);
      const current = grouped.get(key) ?? [];
      const signals = classify(current);
      const { state, rule, conflicts } = nextState(previous?.state ?? null, signals, registerRestrictions.get(key));
      const template = current[0] ?? previous!;
      const noteMention = current.some((event) => event.evidence.source === 'shift');
      const omitted = Boolean(previous && previous.state !== 'CLOSED_VERIFIED' &&
        !noteMention && state !== 'CLOSED_VERIFIED');
      const label = describe(template);
      const registerActive = signals.active.find((event) => event.evidence.source === 'register');

      if (registerActive) registerRestrictions.set(key, registerActive);
      if (state === 'CLOSED_VERIFIED') registerRestrictions.delete(key);
      if (rule !== 'CARRIED_FORWARD' || previous?.state !== 'CLOSED_VERIFIED') rules.add(rule);
      if (state !== previous?.state) {
        step.transitions.push({ obligationId: key, from: previous?.state ?? null, to: state, rule });
      }

      if (omitted && previous) {
        rules.add('CARRIED_FORWARD');
        const lastMention = input.shifts.find(({ id }) => id === previous.lastMentionShiftId)?.label;
        const lastNote = previous.evidence.findLast((event) => event.evidence.source === 'shift');
        const carryEvidence = [lastNote, registerActive ?? registerRestrictions.get(key)].filter(
          (event): event is VerifiedEvent => Boolean(event),
        );
        finding('OMITTED_FROM_HANDOVER', 'OMISSION', label + ' omitted',
          'No grounded mention in ' + shift.label + '. The obligation carries forward from ' +
            (lastMention ?? previous.lastMentionShiftId) + '.', shift.id, key,
          carryEvidence.length ? carryEvidence : previous.evidence.slice(-1));
      }
      if (conflicts.length) {
        finding('CONFLICTING_EVIDENCE', 'CONFLICT', label + ' has conflicting evidence',
          'Active, uncertain or closure evidence disagrees for the same equipment, obligation and permit.',
          shift.id, key, conflicts);
      }
      if (signals.claims.length && state !== 'CLOSED_VERIFIED') {
        const recordDeficits = signals.claims
          .filter(({ evidence }) => evidence.source === 'register')
          .map(({ followUp }) => followUp)
          .filter((detail): detail is string => detail !== null);
        finding('UNVERIFIED_CLOSURE', 'UNVERIFIED_CLOSURE', label + ' closure is unverified',
          recordDeficits.length ? [...new Set(recordDeficits)].join(' ') : evidenceNeeded(template),
          shift.id, key, signals.claims);
      }
      if (signals.uncertain.length) {
        finding('UNKNOWN_STATUS', 'UNKNOWN', label + ' has uncertain evidence',
          'A source statement could not be interpreted with sufficient confidence.', shift.id, key, signals.uncertain);
      }
      if (state === 'CLOSED_VERIFIED' && signals.closures.length) {
        finding('VERIFIED_CLOSURE', 'VERIFIED_CLOSURE', label + ' closure recorded',
          'The register includes the required evidence reference and an allowed confirmation role.',
          shift.id, key, signals.closures);
      }

      const missingEvidence = state === 'CLOSED_VERIFIED' ? [] : [evidenceNeeded(template)];
      if (state === 'CONFLICT') missingEvidence.push('Resolve conflicting evidence for ' + label + '.');
      if (state === 'UNKNOWN') missingEvidence.push('Confirm current status for ' + label + '.');
      if (state !== 'CLOSED_VERIFIED' && template.type === 'PERMIT_RESTRICTION' && !template.permitId) {
        missingEvidence.push('Identify the exact permit for ' + label + '.');
      }
      const followUp = state === 'CLOSED_VERIFIED' ? null
        : current.findLast((event) => Boolean(event.followUp))?.followUp
          ?? previous?.followUp ?? missingEvidence[0] ?? null;

      obligations.set(key, {
        id: key, equipmentId: template.equipmentId, permitId: template.permitId, type: template.type,
        state, firstShiftId: previous?.firstShiftId ?? shift.id,
        lastMentionShiftId: noteMention ? shift.id : previous?.lastMentionShiftId ?? shift.id,
        evidence: [...(previous?.evidence ?? []), ...current], missingEvidence, followUp,
      });
      step.obligations.push({ id: key, state, omitted });
    }
    timeline.push(step);
  }

  const scope = scopeForAction(input);
  for (const issue of scope.issues) {
    recordIssue('ACTION_DEPENDENCY_UNKNOWN', 'Action dependency requires review', issue);
  }

  const register = [...obligations.values()];
  const related = register.filter(scope.matches);
  for (const equipmentId of scope.namedEquipment) {
    if (!related.some((obligation) => obligation.equipmentId === equipmentId)) {
      recordIssue('ACTION_DEPENDENCY_UNKNOWN', 'Action equipment evidence missing',
        'No grounded obligation status was found for action equipment ' + equipmentId + '.');
    }
  }
  for (const permitId of scope.namedPermits) {
    if (!related.some((obligation) => obligation.permitId === permitId)) {
      recordIssue('ACTION_DEPENDENCY_UNKNOWN', 'Action permit evidence missing',
        'No grounded obligation status was found for action permit ' + permitId + '.');
    }
  }

  const actionReview = {
    matchedObligationIds: related.map(({ id }) => id),
    blockingObligationIds: related.filter(({ state }) => state === 'OPEN' || state === 'CONFLICT').map(({ id }) => id),
    unresolvedObligationIds: related.filter(({ state }) => state === 'UNKNOWN').map(({ id }) => id),
  };
  const verdict = actionReview.blockingObligationIds.length ? 'HOLD'
    : actionReview.unresolvedObligationIds.length || reviewIssues.size ? 'REVIEW_REQUIRED' : 'NO_CONFLICT_FOUND';
  rules.add(verdict === 'HOLD' ? 'ACTION_RESTRICTION' : verdict);

  return {
    verdict, actionReview, obligations: register, findings, timeline, rulesTriggered: [...rules],
    missingEvidence: [...new Set([...reviewIssues, ...register.flatMap((item) => item.missingEvidence)])],
    events,
  };
}
