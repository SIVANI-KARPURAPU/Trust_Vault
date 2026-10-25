# TrustVault

Secure Document Sharing with an Auditable Access Trail

## Features
- JWT authentication
- Admin, owner, and viewer roles
- Document upload, download, edit, and delete
- Read/edit permissions with grant and revoke
- Group management
- Audit logs and verification

## Technology Stack
- Frontend: React, TypeScript, Vite
- Backend: Python, Flask
- Database: SQLAlchemy, PostgreSQL for deployment
- Deployment: Render

## Run Locally
Backend: `pip install -r requirements.txt` then `python -m backend.run`
Frontend: `cd frontend`, `npm ci`, then `npm run dev`

## Tests
Run `python -m pytest -q` from the repository root. Last verified locally: 83 tests passed.

## Documentation
- [API](API.md)
- [Threat Model](THREATS.md)
- [AI Usage Log](PROMPTS.md)

## Deployment Status
Live deployment, demo accounts, and persistent file storage still need verification.
