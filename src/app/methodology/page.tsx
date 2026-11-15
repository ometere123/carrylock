import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSearch, Layers3, ShieldAlert } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site";

export const metadata: Metadata = { title: "Methodology" };

const rules = [
  ["01", "Evidence must be traceable", "A note observation points to an exact quotation and its source location. The server checks the quotation against the submitted text and rejects unknown or ambiguous identifiers."],
  ["02", "Silence carries the previous state", "If an unresolved obligation disappears from the next note, the engine adds an omission for that shift and carries the same obligation forward."],
  ["03", "A closure claim needs corroboration", "A note alone cannot verify closure. The dataset must contain the configured evidence reference and a named confirmer with the required role for that obligation type."],
  ["04", "Contradictions stay visible", "A closure assertion and an applicable active restriction can coexist. The engine records their evidence and prevents a clear verdict for a dependent action."],
  ["05", "An incomplete read requires a person", "Missing identifiers, uncertain extraction, an unavailable provider, or a malformed response can leave the review incomplete. Known restrictions still take precedence."],
];

export default function Methodology() {
  return <><SiteHeader current="methodology"/><main className="method shell">
    <div className="eyebrow"><i/> THE REVIEW METHOD</div><h1>From handover notes<br/>to an auditable review.</h1>
    <p className="method-lede">SERV interprets the language. Deterministic rules reconcile state. Authorized people make operational decisions.</p>
    <div className="method-flow"><div><FileSearch size={22}/><strong>Read</strong><span>Extract candidate events from shift notes.</span></div><div><Layers3 size={22}/><strong>Reconcile</strong><span>Track each obligation across the full history.</span></div><div><ShieldAlert size={22}/><strong>Review</strong><span>Show evidence and blockers for the proposed action.</span></div></div>
    <div className="method-rules">{rules.map(([n,t,d])=><article key={n}><span>{n}</span><div><h2>{t}</h2><p>{d}</p></div></article>)}</div>
    <section className="method-verdicts"><h2>What the verdict tells you</h2><dl>
      <div><dt><span className="badge hold">HOLD</span></dt><dd>A relevant open restriction or unresolved conflict blocks a clear advisory review.</dd></div>
      <div><dt><span className="badge review">REVIEW REQUIRED</span></dt><dd>The evidence, action scope, or extraction is incomplete. An authorized person needs to investigate.</dd></div>
      <div><dt><span className="badge closed">NO CONFLICT FOUND</span></dt><dd>No relevant conflict was found in the supplied evidence. This is not permission to operate.</dd></div>
    </dl></section>
    <section className="method-boundary"><h2>What the prototype can verify</h2><p>The public examples use labeled, synthetic annotations. A live SERV review, where enabled, sends the supplied notes and equipment catalog to OpenServ. The prototype checks the evidence and role represented in the supplied dataset. It cannot authenticate the signer, validate the referenced proof, or recover restrictions from shifts that were never supplied. Use synthetic or de-identified data. Never submit confidential plant information.</p><p>Each receipt records source references, input hashes, evidence gaps, rule decisions and provider metadata where available. The receipt is a review artifact and contains source quotations.</p></section>
    <Link className="button primary" href="/app">Open workspace <ArrowRight size={18}/></Link>
  </main><SiteFooter/></>;
}
