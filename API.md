\# TrustVault API Documentation



\## 1. Overview



TrustVault provides a REST API for authentication, document management, sharing permissions, groups, administration, and audit logs.



\*\*Base URL:\*\* `/api/v1`



\*\*Authentication:\*\* Protected endpoints use a JWT access token in the header:



`Authorization: Bearer <access\_token>`



\*\*Content types:\*\* JSON for ordinary request bodies; `multipart/form-data` for document uploads.



\## 2. Health and Authentication



| Method | Endpoint | Access | Purpose |

|---|---|---|---|

| GET | `/health` | Public health check | Check API availability |

| POST | `/register` | Public | Register a user |

| POST | `/login` | Public | Authenticate and obtain a token |

| GET | `/me` | Authenticated | Retrieve the current user's profile |



\## 3. Documents



| Method | Endpoint | Intended access |

|---|---|---|

| GET | `/documents` | Authenticated; only documents the user is permitted to see |

| POST | `/documents` | Authenticated owner; uploads a document |

| GET | `/documents/{document\_id}/download` | Owner or user with active read/edit permission |

| PATCH | `/documents/{document\_id}` | Owner or user with appropriate edit permission |

| DELETE | `/documents/{document\_id}` | Owner or user with appropriate edit permission, subject to implementation |



Uploads support PDF, PNG, JPG/JPEG, and TXT according to the route implementation. The configured maximum request size is 10 MB.



\## 4. Direct Permissions



| Method | Endpoint | Purpose |

|---|---|---|

| POST | `/documents/{document\_id}/permissions` | Grant document access |

| DELETE | `/documents/{document\_id}/permissions/{permission\_id}` | Revoke document access |



Permission changes must be authorized server-side. Revoked access should be rejected on subsequent protected requests.



\*\*Note:\*\* Confirm the exact DELETE path and request/response fields against `backend/app/routes/permissions.py` before release.



\## 5. Groups



| Method | Endpoint | Purpose |

|---|---|---|

| GET, POST | `/groups` | List or create groups |

| PATCH, DELETE | `/groups/{group\_id}` | Update or delete a group |

| GET, POST | `/groups/{group\_id}/members` | List or add members |

| DELETE | `/groups/{group\_id}/members/{target\_user\_id}` | Remove a member |

| GET, POST | `/groups/{group\_id}/documents` | List or associate documents |

| DELETE | `/groups/{group\_id}/documents/{document\_id}` | Remove a document association |



Group routes must enforce membership and ownership/administrative rules on the server.



\## 6. Administration and Audit



| Method | Endpoint | Intended access |

|---|---|---|

| GET | `/users` | Admin |

| PATCH | `/users/{user\_id}/role` | Admin |

| GET | `/admin/audit-logs` | Admin |

| GET | `/admin/audit-logs/stats` | Admin |

| GET | `/admin/audit-logs/verify` | Admin; audit verification |



The role update endpoint accepts `owner` or `viewer`; admin accounts cannot be changed through this endpoint. Viewer-to-owner promotion records a `role\_promoted` audit action.



\## 7. Error Handling



Clients should handle HTTP errors, including:

\- `400` — invalid request

\- `401` — missing or invalid authentication

\- `403` — forbidden action

\- `404` — resource not found

\- `409` — conflicting operation

\- `413` — request too large

\- `429` — rate limit exceeded

\- `500` — unexpected server error



Actual status codes depend on the specific endpoint and failure condition.



\## 8. Security Requirements



\- Validate authorization on every protected request.

\- Do not trust frontend role checks as an authorization boundary.

\- Check active permissions again when reading, downloading, editing, or deleting documents.

\- Audit sensitive actions and denied attempts where required.

\- Do not expose secrets or production credentials in API responses or source control.

\- Use HTTPS in deployment.



\## 9. Verification Status



The local automated test suite passed 83 tests on 25 October 2026, and the frontend production build succeeded. These checks do not by themselves confirm that every documented endpoint or permission rule is correct.



Before submission, verify exact route prefixes, payload schemas, response formats, authorization decorators, and error codes against the current implementation. Add example requests and seed/demo credentials only after they have been tested.



