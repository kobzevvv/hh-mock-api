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

## Stable Behavioral Rules

These rules are intended to be stable for external integration tests:

- `POST /_mock/vacancies` creates vacancy and negotiations immediately
- new negotiations start in collection `response`
- one initial applicant message is seeded per negotiation
- `initial_reply_delay_sec` shifts the timestamp of the initial seeded applicant message
- `initial_reply_delay_sec` does not delay negotiation creation itself
- `follow_up_delay_sec` applies only after employer sends a message
- follow-up applicant reply appears only after a prior employer message exists
- by default, employer send does not auto-move negotiation out of `response`
- delayed follow-up replies can be materialized via virtual time control endpoints

## Stable Fields For External Clients

The following fields should be treated as stable for smoke/e2e clients:

- vacancy create response:
  - `vacancy_id`
  - `created_at`
  - `expires_at`
  - `candidate_count`
  - `negotiation_ids`
- negotiations list/item:
  - `id`
  - `updated_at`
  - `state.id`
  - `resume.id`
  - `resume.url`
  - `vacancy.id`
- messages:
  - `items[].id`
  - `items[].created_at`
  - `items[].text`
  - `items[].author.participant_type`
- debug/time:
  - `offset_ms`
  - `delayed_replies.pending_count`
  - `delayed_replies.next_due_at`

## Synthetic / Sandbox-Only Surfaces

These are intentionally sandbox-only and should not be confused with real HH:

- all `/_mock/*` endpoints
- synthetic candidate names, resume titles, salary values, and message texts
- virtual time control
- forced error scenarios
- event log and state snapshot endpoints

## Intentional Simplifications vs Real HH

- only a subset of HH endpoints is implemented
- negotiation lifecycle is synthetic and configurable, not fully HH-accurate
- delayed replies are generated from simple rules, not from a real queue or actor system
- sandbox state is in-memory only
- seeded initial inbound is a test convenience, not a claim about exact HH internal behavior

## Known Limitations

- in-memory state only
- no durable storage
- no full HH coverage
- synthetic negotiation lifecycle
- delayed replies are timer-based, not queue-backed
