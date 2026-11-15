# SERV Hackathon Edition 02 · CARRYLOCK

[Official submission form](https://openserv.typeform.com/submissions02) · [Official event and submission requirements](https://www.openserv.ai/hackathon-2)

## X draft

> A hazard doesn’t end because a shift does. I built CARRYLOCK for the @openservai SERV Hackathon 02 Open Track. It uses SERV Reasoning to read shift notes, then shows which safety obligations went missing and why a proposed action may need a hold. Advisory only.

Attach [the landing screenshot](../evidence/browser/landing-share.png). Keep the URL of the actual published post for the form.

## Form answers

| Official field | Prepared answer |
| --- | --- |
| Full name and email | Entrant details supplied privately for submission |
| New to building with OpenServ? | Yes |
| Track | Open Track |
| New project or existing project? | A new project |
| Project name | CARRYLOCK |
| Project description | Use the write-up below |
| Project URL | https://carrylock.vercel.app |
| URL of tagged X post | Enter the real public post URL |
| Additional project URL | https://github.com/ometere123/carrylock |
| Project logo | Optional: [mark](../public/mark.svg) |
| Data collection | No for the submitted public demo; see disclosure below |
| Team | I’m participating solo |
| Experience, country, affiliation, role, profile and sharing consent | Optional; leave blank unless the entrant chooses to answer |

### Project write-up

A hazard doesn’t end because a shift does. Carrylock is a review desk for shift supervisors and industrial operations teams. It reconciles outgoing and incoming notes, equipment and permit identifiers, an optional status register, and a proposed action. SERV Reasoning extracts events from free text and normalizes equivalent observations. The server checks each accepted quotation against the original notes. A deterministic engine carries open obligations across shifts, flags where evidence vanished, surfaces conflicts, and records closure only when the dataset supplies the configured evidence and authorized confirmation. It returns a human advisory and a downloadable evidence receipt. It never authorizes plant operation.

Four synthetic examples let reviewers inspect missing relief valve reinstatement, an omitted safety bypass, a suspended permit, and a verified closure. We tested the engine on 16 annotated cases and tested authentic SERV extraction separately. Evaluation results include live failures and estimated cost. The proposed revenue model is a site-level subscription for industrial handover review and evidence reconciliation.

### Data disclosure

The public synthetic examples use bundled records and require no account. There is no analytics tracker or application facility to store submitted plant dossiers. Where enabled, custom analysis sends notes and equipment aliases to OpenServ. Short-lived extracted results may be cached in encrypted form and minimal budget metadata is recorded. The prototype is intended for synthetic and de-identified inputs.

Optional SERV feedback: Strict structured output made validation and receipts straightforward. Early runs produced real completions but some quotes or category assignments failed our grounding checks. The engine surfaced these gaps rather than claiming closure. One guarded run of the revised prompt matched the verified-closure scenario; this single result does not establish general reliability.
