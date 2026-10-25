# TrustVault — Threat Model

## 1. Purpose
TrustVault is a secure document-sharing application. This document records key threats, mitigations, and remaining risks.

## 2. Assets to Protect
- Uploaded documents and their contents
- User credentials and authentication tokens
- Document ownership and sharing permissions
- Audit logs and security event history
- Database records and application secrets

## 3. Trust Boundaries
- Browser to backend API
- Authenticated user to protected document endpoints
- Backend application to database
- Backend application to uploaded-file storage
- Administrator actions affecting user roles

## 4. Threats and Mitigations

| Threat | Potential Impact | Mitigation / Verification |
|---|---|---|
| Unauthenticated API access | Exposure or modification of data | JWT authentication on protected routes; test unauthorized requests |
| Broken object-level authorization | Users access another user's documents | Check ownership or active permission on each document request |
| Permission revocation failure | Formerly authorized users retain access | Re-check current permissions on every protected request |
| Privilege escalation | Viewer obtains owner/admin privileges | Enforce roles server-side; restrict role changes to admins |
| Malicious file upload | Unsafe or invalid content is stored | Validate extensions, MIME types, file signatures, and size |
| Path traversal | Access to files outside upload storage | Use server-controlled paths and validate resolved paths |
| Audit log omission | Security events cannot be investigated | Record document and permission events; test audit persistence |
| Audit log tampering | Loss of trustworthy history | Restrict audit modification and deletion; independently verify tamper resistance |
| Credential or token theft | Unauthorized account access | Use password hashing, HTTPS in deployment, and short-lived access tokens |
| Secret exposure | Application compromise | Store secrets in environment variables; never commit `.env` |
| Database or storage loss | Loss of documents or metadata | Configure persistent database and durable file storage |
| Excessive requests | Service degradation | Apply rate limiting and request-size limits |

## 5. Security Verification
The local automated test suite currently reports 83 passing tests. This confirms the tested scenarios only; it does not prove that every threat is mitigated. Review authorization, permission revocation, audit coverage, and upload handling before release.

## 6. Remaining Risks
- Local uploaded files may be lost when deployed on ephemeral hosting storage.
- Audit tamper resistance must be verified from the implementation; an audit trail alone does not guarantee immutability.
- Production HTTPS, environment variables, database access, CORS origins, and demo-account credentials must be checked after deployment.
- External security testing and a complete endpoint-by-endpoint authorization review remain necessary.

## 7. Deployment Checklist
- [ ] Confirm all protected routes enforce server-side authorization.
- [ ] Confirm revoked permissions stop working immediately.
- [ ] Confirm denied access attempts are audited where required.
- [ ] Confirm audit records cannot be modified by ordinary users.
- [ ] Configure persistent file storage.
- [ ] Configure HTTPS and production secrets.
- [ ] Verify database migrations and health endpoint.
- [ ] Remove sensitive credentials from logs and repository history.
