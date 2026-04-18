# HH Mock API

HH-compatible mock service for testing recruiter-agent logic against an HH-like API.

Current deployment:

- Cloud Run service: `hh-mock-api`
- Region: `us-central1`
- URL: deploy-specific, set your own value in `BASE`
- Auth mode: deployment-dependent

## What Works Now

- `POST /_mock/vacancies` creates a sandbox vacancy from plain vacancy text
- 1-3 synthetic candidates are created automatically
- HH-like endpoints work for negotiations, messages, states, resumes, `/token`, `/me`
- employer replies trigger delayed applicant replies
- vacancy TTL defaults to `10800` seconds = `3 hours`
- `application/x-www-form-urlencoded` is supported on `/token` and `POST /negotiations/{id}/messages`
- app-level auth supports `HH_MOCK_AUTH_MODE=none|bearer`
- forced error scenarios support `401`, `403`, `404`, `429`
- the service has been smoke-tested in Cloud Run

## Current Limitation

State is **in-memory** inside the Cloud Run instance.

That means:

- good for logic testing and agent training
- not durable across restarts, new revisions, or scale-to-zero cold replacement
- not intended yet for long-lived sandboxes or audit/history retention

For the current use case this is acceptable.

## API Summary

HH-compatible routes:

- `POST /token`
- `GET /me`
- `GET /negotiations/{collection}?vacancy_id=...&page=...&per_page=...`
- `GET /negotiations/{id}`
- `GET /negotiations/{id}/messages`
- `POST /negotiations/{id}/messages`
- `PUT /negotiations/{id}/state`
- `GET /resumes/{id}`

Mock control routes:

- `POST /_mock/vacancies`
- `GET /_mock/vacancies/{vacancyId}`
- `POST /_mock/tasks/run-due`
- `GET /_mock/errors`
- `POST /_mock/errors`
- `DELETE /_mock/errors`
- `GET /health`

Contract and roadmap:

- [docs/supported-contract.md](docs/supported-contract.md)
- [docs/backlog.md](docs/backlog.md)
- [docs/public-sandbox-deploy.md](docs/public-sandbox-deploy.md)

## User Quickstart

1. Set your base URL and auth mode:

```bash
BASE=https://your-hh-mock.example.com
TOKEN=mock_access_token
```

For private Cloud Run deployments you can still use an identity token instead.

2. Check health:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/health"
```

3. Create a vacancy:

```bash
curl -s -X POST "$BASE/_mock/vacancies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vacancy_text": "Senior Recruiter\nНужен рекрутер для найма AI engineer и product roles",
    "candidate_count": 2,
    "ttl_seconds": 10800
  }'
```

Example response:

```json
{
  "vacancy_id": "9f6d0b09-26ec-496b-9b31-ab3e81e5d384",
  "title": "Senior Recruiter",
  "created_at": "2026-04-16T22:49:06.194Z",
  "expires_at": "2026-04-17T01:49:06.194Z",
  "candidate_count": 2,
  "negotiation_ids": [
    "b819c338-745b-47e3-a559-038864e04843",
    "492fa332-727a-4986-9e21-5c2853c8cc18"
  ]
}
```

4. Ask for new responses:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/negotiations/response?vacancy_id=<vacancy_id>"
```

5. Read a negotiation thread:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/negotiations/<negotiation_id>/messages"
```

6. Reply to a candidate:

```bash
curl -s -X POST "$BASE/negotiations/<negotiation_id>/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Расскажите, пожалуйста, про опыт и зарплатные ожидания"}'
```

7. Wait about 20-30 seconds and poll messages again. The candidate will answer.

## Error Injection

Force one `429` for the next messages read:

```bash
curl -s -X POST "$BASE/_mock/errors" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": 429,
    "method": "GET",
    "path_prefix": "/negotiations/",
    "repeat": 1
  }'
```

List active error scenarios:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/_mock/errors"
```

## Local Development

```bash
npm install
npm run dev
```

Local base URL:

```bash
http://localhost:8080
```

Example local sandbox with HH-style bearer auth:

```bash
HH_MOCK_AUTH_MODE=bearer \
HH_MOCK_BEARER_TOKEN=mock_access_token \
npm run dev
```

Verification:

```bash
npm run check
npm test
npm run build
```

## Deploy

This repo deploys to Cloud Run using Dockerfile-based source deploy:

```bash
gcloud run deploy hh-mock-api \
  --source . \
  --clear-base-image \
  --region us-central1 \
  --set-env-vars NODE_ENV=production
```

Public vs authenticated access depends on how you deploy the service.
If you deploy to a private Cloud Run service, call it with an identity token.
If you deploy a public sandbox instance, `BASE` alone is enough.

For a GitHub Actions deploy workflow and required repo secrets, see
[docs/public-sandbox-deploy.md](docs/public-sandbox-deploy.md).

## Repo Structure

- [src/app.ts](src/app.ts): Fastify HTTP routes
- [src/domain.ts](src/domain.ts): in-memory sandbox state and reply logic
- [src/index.ts](src/index.ts): service entrypoint
- [tests/api.test.ts](tests/api.test.ts): local smoke-style tests
- [docs/hh-mock-architecture.md](docs/hh-mock-architecture.md): target architecture and rollout direction
- [docs/user-guide.md](docs/user-guide.md): user-facing quickstart
