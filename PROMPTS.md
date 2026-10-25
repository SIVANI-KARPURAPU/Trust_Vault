# TrustVault — AI Usage Log

This document records AI-assisted development work for the TrustVault project. Entries should reflect actual interactions and be updated with the relevant commit links before submission.

## Entry 1 — Document authorization review
- Date: 2026-10-25
- Goal: Review document access control and identify authorization gaps.
- AI assistance: Helped reason about ownership and permission checks.
- Validation: Run the relevant authorization tests and inspect the route implementation.
- Outcome: Record only verified fixes and their commit links here.

## Entry 2 — Audit logging for role changes
- Date: 2026-10-25
- Goal: Investigate why the admin role-promotion audit test failed.
- AI assistance: Compared the expected audit action with the implementation.
- Change: Updated the role-promotion audit action to use `role_promoted` when promoting a viewer to owner.
- Validation: `python -m pytest -q` passed: 83 tests.
- Commit: `aaa9e5d` — Fix admin role promotion audit logging.

## Entry 3 — Frontend production build
- Date: 2026-10-25
- Goal: Verify the frontend can build for production.
- AI assistance: Guided execution of the frontend build command.
- Validation: `npm run build` completed successfully.
- Outcome: TypeScript and Vite production build passed.

## Entry 4 — Deployment configuration review
- Date: 2026-10-25
- Goal: Review Render configuration and required runtime dependencies.
- AI assistance: Helped inspect `render.yaml`, `backend/run.py`, `backend/app/config.py`, and `requirements.txt`.
- Findings: Render configuration defines backend, frontend, and PostgreSQL services. Frontend API URL currently points to localhost in its local `.env`.
- Status: Live deployment and production connectivity still require verification.

## Entry 5 — Threat model documentation
- Date: 2026-10-25
- Goal: Document key security threats, mitigations, and remaining risks.
- AI assistance: Helped draft `THREATS.md`.
- Validation: File creation confirmed locally.
- Status: Review the threat model against the actual implementation before submission.

## Update policy
Add dated entries for significant AI-assisted work. Record the actual prompt or task, the useful output, mistakes or limitations discovered, what was changed or rejected, and a relevant commit link when available. Do not invent prompts, test results, or commit history.
