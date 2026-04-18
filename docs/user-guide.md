# User Guide

Дата: 2026-04-17

## Для чего это

Сервис нужен, чтобы тренировать агентов и тестировать бизнес-логику работы с HH-подобным API без реального HH.

Сейчас он умеет:

- принять текст вакансии
- создать synthetic кандидатов
- отдать отклики через HH-like API
- принять ответ работодателя
- прислать следующее сообщение от кандидата с задержкой
- принять `application/x-www-form-urlencoded` там, где это ожидает обычный HH client
- управляемо отдать `401`, `403`, `404`, `429` через control API

## Как думать про сервис

Это не production backend и не нагрузочный стенд.

Это sandbox для логики:

- polling новых откликов
- чтение переговорок
- ответы кандидатам
- переходы между состояниями
- поведение агента при многошаговом диалоге

## Самый короткий сценарий

1. Подготовить base URL и token:

```bash
BASE=https://your-hh-mock.example.com
TOKEN=mock_access_token
```

Если deploy private, вместо synthetic bearer можно использовать identity token Cloud Run.

2. Создать вакансию:

```bash
CREATE=$(curl -s -X POST "$BASE/_mock/vacancies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vacancy_text": "Senior Backend Engineer\nNode.js, Postgres, integrations",
    "candidate_count": 2,
    "ttl_seconds": 10800
  }')
```

3. Взять `vacancy_id` и `negotiation_ids` из ответа.

4. Спросить новые отклики:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/negotiations/response?vacancy_id=<vacancy_id>"
```

5. Прочитать сообщения:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/negotiations/<negotiation_id>/messages"
```

6. Ответить кандидату:

```bash
curl -s -X POST "$BASE/negotiations/<negotiation_id>/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Расскажите, пожалуйста, подробнее про опыт и ожидания по деньгам"}'
```

7. Через 20-30 секунд снова запросить messages.

## Управляемые ошибки

Пример: один раз вернуть `429 Too Many Requests` на следующий `GET /negotiations/.../messages`:

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

Очистить все error scenarios:

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$BASE/_mock/errors"
```

## Что важно помнить

- TTL по умолчанию `3 часа`
- состояние сейчас in-memory
- после рестарта Cloud Run или новой ревизии sandbox может исчезнуть
- режим доступа зависит от деплоя: сервис может быть private или public sandbox

## Что использовать агенту

Для агента важно только:

- заменить `baseUrl`
- продолжать слать привычные HH-like запросы
- продолжать слать `Authorization` и `HH-User-Agent`, если у клиента это уже есть

Поддерживаемый контракт и ограничения:

- [supported-contract.md](supported-contract.md)
- [backlog.md](backlog.md)
- [public-sandbox-deploy.md](public-sandbox-deploy.md)

## Чего пока нет

- durable state
- Firestore
- Cloud Tasks
- real HH fixtures как строгий contract layer на все endpoints

Это сознательно отложено, потому что для текущей цели MVP уже полезен.
