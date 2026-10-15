---
name: bring-us-upstream
description: Review and port t3code upstream changes, defaulting to compatible work while preserving Supaterm's deliberate fork differences.
---

# Bring upstream changes

Use when asked to sync or port code from upstream.

## Review first

Before editing:

- Read repository instructions and identify the baseline and upstream ref or range.
- Read the PRs and its content of every PRs that are merged during the range to get a sense of what's been added.
- Default to bringing compatible upstream work, including new capabilities and architectural changes. Size, implementation effort, new dependencies, and routine branding or integration work belong in the port plan.
- Classify every change:
  - **Bring:** compatible with Supaterm's goals, including changes that need adaptation, migrations, or additional tests.
  - **Skip:** already present, tied to an intentionally absent subsystem, outside the requested range, or contrary to a deliberate fork decision. Name the evidence for the exclusion.
  - **Decide:** a concrete conflict or consequential choice that cannot be resolved from the user's instructions and existing fork behavior. State the alternatives, consequences, and recommendation.
- Highlight compatibility consequences inside the proposed port. Reserve separate decisions for unresolved choices, such as whether existing users must re-pair or which conflicting local behavior to retain.
- Use source evidence. Do not rely on commit titles alone.

Review before implementation. When the user has not already authorized the scope, present it and get approval before editing. Existing approval persists; "bring all" approves the proposed ports and decision bundles unless the user gives a narrower boundary.

## Present and wait

Show the user:

- the baseline and upstream range;
- proposed ports, behavior, affected surfaces, dependencies, and tests;
- skipped items with reasons;
- open decisions and non-goals;
- the exact implementation boundary.

If approval is still needed, ask whether to approve the proposed scope or revise it, then wait. Do not turn routine integration work into a menu of optional upstream features or ask again for approved work.

## Implement after approval

Implement the approved scope and resolve routine adaptation choices autonomously. Seek another decision only for a material expansion or a newly discovered conflict that the existing authorization does not settle. Preserve deliberate fork behavior, add focused tests, update docs when needed, and run targeted checks. Report what changed, what was skipped, validation, and remaining manual checks. Commit, push, and create a PR only when authorized.
