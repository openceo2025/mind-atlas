# Mind Atlas Promotion Experiments

Status: append-only promotion ledger

Created: 2026-07-16

Read `docs/promotion-operations.md` before using this ledger.

## Rules

- Never delete a completed experiment or silently replace its result.
- Record the hypothesis and decision thresholds before publication.
- Use one primary variable per experiment.
- Separate productivity/business creator and VTuber batches.
- Observe at 24 hours, 72 hours, and seven days.
- Record zeroes and failures. They are evidence, not missing data.
- Store public campaign codes here, but keep private contacts, credentials,
  contracts, invoices, and unpublished terms outside the repository.
- Cash CPA and owner time are reported separately. For comparison, effective
  CPA may value owner time at JPY 3,000 per hour.

## Baseline

| As of | Experiment | State | Human PV (30d) | Approx. visitor-days (30d) | Google users | Cloud files | MAU (7d) | Share/open/import | Client coverage | Decision |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| 2026-07-16 UTC | `pre_promotion_baseline` | complete | 677 | 442 | 2 | 6 | 1 | 0 / 0 / 0 | 1.36% | Fix attribution before paid promotion. |
| 2026-07-17 09:55 UTC | `service_observation_20260717` | complete | 878 | 572 | 2 | 6 | 1 | 0 / 0 / 0 | 1.92% | VPS healthy; attribution remains the promotion blocker. |

Notes:

- Acquisition attribution was unknown for 100% of traffic.
- Bot ratio was 28.3%.
- HTTP 5xx count was zero; HTTP 4xx count was 277.
- Existing conversion rates are not trustworthy because client event coverage
  and campaign-to-user attribution are incomplete.
- On 2026-07-17, the public health endpoint returned HTTP 200; `mind-atlas`,
  nginx, PostgreSQL, and the analytics timer were active. The next analytics
  run was scheduled for 2026-07-18 00:16 JST, disk usage was 8%, and there were
  no `mind-atlas` warning-or-higher journal entries in the preceding 24 hours.

## Planned experiments

| Experiment ID | Earliest slot | Primary variable | Audience | Cash ceiling | Owner-time target | Publication gate |
| --- | --- | --- | --- | ---: | ---: | --- |
| `sticky_2026w29_00_attribution` | Week 0 | Measurement | Internal | JPY 0 | 15 min | New-user attribution and reporting pass end to end. |
| `sticky_2026w30_01_owned_short` | Week 1 | Opening hook | Owned multi-platform audience | JPY 0 | 60 min | One real-UI master and trackable links are ready. |
| `sticky_2026w31_02_discovery` | Week 2 | Creator-audience fit | 1 JP productivity micro-creator | JPY 10,000 max | 30 min | Attribution passes end to end; owned sample may be directional. |
| `sticky_2026w32_03_business` | Week 3 | Creator-audience fit | Remaining JP and EN productivity/business creators | JPY 36,000 max | 30 min | Combined traffic reaches at least 20 G and passes the scale gate. |
| `sticky_2026w33_04_vtuber` | Week 4 | Creator-audience fit | 1 JP and 1 EN adult independent VTubers | JPY 54,000 max | 30 min | Business batch is measured and VTuber content is disclosed. |

The week numbers are scheduling labels, not promises to spend. A failed gate
stops the next paid experiment until the cause is revised and retested.

## Implementation checkpoints

| Date | Experiment ID | State | Evidence | Remaining gate |
| --- | --- | --- | --- | --- |
| 2026-07-17 | `sticky_2026w29_00_attribution` | server deployed, end-to-end pending | Short campaign routes, OAuth attribution cookie, new-vs-returning Google-user event, login triggers, campaign funnel, 24-hour save, and age-eligible Google-user D1/D7/D30 reporting implemented. Analytics and hosted-service verification passed; report queries executed against production; the server-only deployment passed live `/health`, short-link redirect, OAuth-cookie, report, and journal checks. The unrelated calendar/explicit-save public UI was not deployed because its current UI checks fail. | Complete one real OAuth callback with a new test Google account and confirm `google_user_created` in the VPS report. Resolve the unrelated UI regressions before the next full hosted build. |

## Result template

Copy this block for each experiment and fill it without removing the planned
record above.

```text
Experiment ID:
State: planned | live | observed-24h | observed-72h | complete
Start/end time and timezone:
Audience:
Primary hypothesis:
Primary variable:
Hook:
Call to action:
Asset URL or repository reference:
Campaign / partner / asset code:
Platform and locale:
Cash spend (JPY):
Owner time (minutes):

Results at 24h / 72h / 7d:
- Qualified views:
- Trackable landing sessions:
- Google login starts:
- Google login completions:
- Attributed new Google-linked users (G):
- G with cloud save within 24h (Q):
- Meaningful seven-day returners (R7):
- Share actions / share opens / share imports:
- Cash CPA-G:
- Effective CPA-G including owner time:

Predeclared threshold result:
Decision: scale | revise | stop
Evidence-based explanation:
Exactly one primary change for the next loop:
```

## Decision log

| Date | Decision | Evidence |
| --- | --- | --- |
| 2026-07-16 | Reject novel, worldbuilding, and TRPG as the primary acquisition target. | The product is intended to serve the broader everyday loose-note behavior represented by Windows Sticky Notes. |
| 2026-07-16 | Use a real-UI, CapCut-assisted vertical master instead of a fully generated ad. | Product truth and fast multilingual reuse matter more than synthetic visual novelty. |
| 2026-07-16 | Block paid creator spend until attribution is repaired. | The live baseline cannot reliably connect campaigns to newly created Google-linked users. |
| 2026-07-16 | Use the current JPY 10,000 for one JP productivity micro-creator discovery pilot, not X paid promotion. | The owned X audiences are topic-mismatched; a carefully selected creator provides relevant traffic and a credible workflow demonstration. |
