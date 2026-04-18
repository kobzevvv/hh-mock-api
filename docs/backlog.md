# Backlog

Дата: 2026-04-18

## P0

- usable external HH-like sandbox over HTTP
- HH-style bearer auth mode without Google identity token requirement
- `application/x-www-form-urlencoded` support for `/token` and `/negotiations/:id/messages`
- one-command smoke path for vacancy -> poll -> reply -> delayed reply
- controlled error scenarios: `401`, `403`, `404`, `429`
- CI that validates the main contract

## P1

- external smoke integration in `hiring-agent-chat-layout-fix`
- scenario presets: happy path, no reply, rate limited, expired token
- explicit supported-contract document
- public sandbox deploy runbook

## P2

- durable state option
- more realistic lifecycle rules
- duplicate-send scenarios
- richer pagination and retry modeling
- optional admin UI
