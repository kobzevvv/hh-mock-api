# Security

## Supported Use

This repository is intended for sandbox and integration testing against an HH-like API.
Do not use it as a production authentication or candidate data system.

## Secrets

Do not commit:

- OAuth client secrets
- access or refresh tokens
- API keys
- database URLs with credentials
- Cloud service account keys
- private webhook secrets
- real candidate personal data

Use environment variables or your deployment platform secret manager instead.

## Sensitive Test Data

Only synthetic fixtures and synthetic candidate messages should be committed.
If you capture real HH payloads, redact:

- names
- emails
- phone numbers
- resume URLs
- vacancy and negotiation ids tied to real accounts
- message text from real candidates

## Reporting

If you discover a security issue in this repository, do not open a public issue with exploit details.
Share a private report with the repository maintainer instead.
