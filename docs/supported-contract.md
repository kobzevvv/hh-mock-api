# Supported Contract

Дата: 2026-04-18

## Supported HH-like Endpoints

- `POST /token`
- `GET /me`
- `GET /negotiations/{collection}`
- `GET /negotiations/{id}`
- `GET /negotiations/{id}/messages`
- `POST /negotiations/{id}/messages`
- `PUT /negotiations/{id}/state`
- `GET /resumes/{id}`

## Supported Control Endpoints

- `GET /health`
- `POST /_mock/vacancies`
- `GET /_mock/vacancies/{vacancyId}`
- `POST /_mock/tasks/run-due`
- `GET /_mock/errors`
- `POST /_mock/errors`
- `DELETE /_mock/errors`
- `GET /_mock/state`
- `GET /_mock/events`
- `POST /_mock/reset`
- `GET /_mock/time`
- `POST /_mock/time/advance`
- `POST /_mock/time/flush-delayed-events`

## Supported Body Formats

- `/token`: `application/x-www-form-urlencoded`
- `/negotiations/{id}/messages`: `application/x-www-form-urlencoded` and JSON
- control routes: JSON

## Auth Modes

- `HH_MOCK_AUTH_MODE=none`: no app-level auth
- `HH_MOCK_AUTH_MODE=bearer`: requires `Authorization: Bearer <token>`

If `HH_MOCK_BEARER_TOKEN` is set, the bearer token must match exactly.

## Supported Error Scenarios

Via `POST /_mock/errors` you can force:

- `401`
- `403`
- `404`
- `429`

Each scenario can be scoped by:

- HTTP method
- path prefix
- optional negotiation id
- repetition count

## Deterministic Time Control

- `GET /_mock/time`: current virtual time and delayed-reply queue summary
- `POST /_mock/time/advance`: advance virtual time by `ms`
- `POST /_mock/time/flush-delayed-events`: jump to the latest scheduled delayed reply and process due events

## Diagnostics

- `GET /_mock/state`: current sandbox snapshot
- `GET /_mock/events`: recent sandbox events, supports `?limit=...`
- `POST /_mock/reset`: clears vacancies, negotiations, errors, event log, and resets virtual time offset

## Known Limitations

- in-memory state only
- no durable storage
- no full HH coverage
- synthetic negotiation lifecycle
- delayed replies are timer-based, not queue-backed
