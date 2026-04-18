# Public Sandbox Deploy

Дата: 2026-04-18

## Цель

Поднять отдельный Cloud Run deploy, в который обычный HH-style клиент может ходить по `Authorization: Bearer <token>` без Google identity token.

## Рекомендуемый режим

- отдельный сервис `hh-mock-api-sandbox`
- отдельный URL для manual smoke и внешних integration tests
- app-level auth:
  - `HH_MOCK_AUTH_MODE=bearer`
  - `HH_MOCK_BEARER_TOKEN=<shared synthetic token>`
- Cloud Run access:
  - либо `allow unauthenticated`
  - либо ingress/proxy модель вашей инфраструктуры

Если сервис остаётся private на уровне Cloud Run IAM, обычный HH client не сможет использовать его как drop-in backend.

## GitHub Actions Workflow

В репозитории есть workflow:

- `.github/workflows/deploy-public-sandbox.yml`

Он запускается вручную через `workflow_dispatch`.

## Что положить в GitHub

Repository variables:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `HH_MOCK_SERVICE_NAME`

Repository secrets:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `HH_MOCK_BEARER_TOKEN`

## Что делает workflow

1. запускает `npm ci`
2. гоняет `npm run check`
3. гоняет `npm test`
4. собирает `npm run build`
5. деплоит в Cloud Run
6. пробует `GET /health`

## Ручной локальный deploy

```bash
gcloud run deploy hh-mock-api-sandbox \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,HH_MOCK_AUTH_MODE=bearer,HH_MOCK_BEARER_TOKEN=mock_access_token
```

## После deploy

Проверить:

```bash
BASE=https://<service-url>
TOKEN=mock_access_token

curl -s "$BASE/health"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/me"
```

## Ограничения

- state остаётся in-memory
- deploy пригоден для short-lived smoke и manual e2e
- для стабильного CI backend позже нужен durable state или формально принятый ephemeral contract
