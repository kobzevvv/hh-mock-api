# HH Mock API Architecture

Дата: 2026-04-17

## Текущий статус

Ниже в документе описана целевая архитектура.

Что реально реализовано на текущий момент:

- `TypeScript + Fastify`
- деплой в `Google Cloud Run`
- HH-like HTTP API для основных маршрутов
- control-plane `/_mock/vacancies`
- synthetic кандидаты и delayed replies
- TTL `3 часа` по умолчанию
- **in-memory state**, без durable storage

То есть текущий сервис соответствует MVP для логических тестов, но пока не соответствует полной target-state архитектуре с `Firestore + Cloud Tasks`.

## Цель

Нужен отдельный серверлесс-сервис, который выглядит для клиента почти как HH API работодателя, но работает как управляемая песочница:

- принимает текст вакансии;
- создает 2+ synthetic кандидата;
- по запросу отдает новые отклики и сообщения;
- принимает ответы работодателя;
- продолжает диалог от имени кандидатов;
- автоматически истекает по TTL, по умолчанию через 3 часа;
- позволяет бесшовно переключать клиента между `api.hh.ru` и mock по `baseUrl`.

Это не нагрузочный стенд. Приоритеты другие:

- правдоподобный lifecycle;
- stateful диалоги;
- совместимость по endpoint shape, заголовкам и error payloads;
- простая эксплуатация без VM.

## Короткий вывод

Идеальный pragmatic-вариант: **Google Cloud Run + Firestore + Cloud Tasks + Cloud Scheduler**.

Почему именно так:

- `BigQuery` не подходит как основная state-база: слишком тяжелая и неудобная для частых мелких изменений по сообщениям и TTL.
- `Cloud Run` дает обычный HTTP API и полный контроль над HH-compatible контрактом.
- `Firestore` хорошо подходит под короткоживущие sandbox-сессии, переговорки, сообщения и TTL cleanup.
- `Cloud Tasks` идеально закрывает "кандидат ответит позже" без своей очереди и без VM.
- `Cloud Scheduler` закрывает housekeeping, sweep просроченных вакансий и, если нужно, отложенные массовые действия.

Если хочется еще проще по инфраструктуре, второй хороший вариант: **Yandex Cloud Functions + YDB Serverless + Trigger/Message Queue**. Но на GCP стек зрелее именно для HTTP sandbox + delayed tasks.

## Почему не BigQuery

BigQuery годится для аналитики поверх mock-событий, но не как primary storage:

- плохо подходит для частых point updates;
- неудобен для append-heavy chat state;
- TTL и transactional lifecycle там неестественны;
- polling новых сообщений и смена `updated_at` будут дороже и грубее, чем в document store.

Если нужен аналитический слой, правильнее сделать экспорт событий из Firestore в BigQuery отдельно.

## Целевая топология

```text
Client / Agent
  |
  v
HH-compatible Mock API
  Cloud Run
  |
  +-- Firestore
  |     - sandboxes
  |     - vacancies
  |     - negotiations
  |     - messages
  |     - candidate_profiles
  |     - oauth_tokens (synthetic / pass-through mode)
  |
  +-- Cloud Tasks
  |     - delayed candidate reply
  |     - delayed new applicant creation
  |     - delayed state transition
  |
  +-- Cloud Scheduler
        - cleanup expired sandboxes
        - stuck-task recovery
```

## Главный архитектурный принцип

Клиент должен знать только:

- `baseUrl`
- OAuth/token config
- набор тех же заголовков

Все остальное должно быть максимально совместимо с HH:

- те же path shape;
- те же query params;
- те же поля в payload;
- те же статусы `401/403/404/429`;
- те же auth header names;
- тот же `HH-User-Agent` requirement;
- те же semantics для `updated_at`, `collection`, `messages`.

То есть переключение должно выглядеть как:

```text
HH_API_BASE_URL=https://api.hh.ru
```

или

```text
HH_API_BASE_URL=https://hh-mock-<env>.run.app
```

Без переписывания бизнес-логики агента.

## Режимы работы

Нужны два режима.

### 1. Sandbox mode

Полностью synthetic HH.

Вы создаете вакансию:

- текст вакансии;
- optional настройки сценария;
- `min_candidates`, `max_candidates`;
- TTL;
- optional persona profile.

Сервис сам:

- генерирует negotiation;
- генерирует резюме;
- генерирует первое сообщение;
- выставляет `updated_at`;
- дальше поддерживает диалог.

### 2. Contract mode

Payload shapes и error bodies берутся из fixture library, собранной из реального HH.

Это нужно, чтобы mock оставался не "похожим", а именно совместимым по форме ответа.

Ваш существующий `hh-contract-mock.js` и fixture-подход надо переиспользовать как источник контрактов, но поднять его в отдельный HTTP сервис.

## Минимальный HH-compatible API surface

На старте достаточно поддержать только то, что реально нужно агентам.

### Auth / Context

- `POST /token`
- `GET /me`

### Negotiations

- `GET /negotiations/{collection}?vacancy_id=...&page=...&per_page=...`
- `GET /negotiations/{id}`
- `GET /negotiations/{id}/messages`
- `POST /negotiations/{id}/messages`
- `PUT /negotiations/{id}/state`

### Resume

- `GET /resumes/{id}`

### Optional control plane

Эти методы не должны быть HH-compatible, они нужны только вам для управления песочницей.

- `POST /_mock/vacancies`
- `GET /_mock/vacancies/{id}`
- `POST /_mock/vacancies/{id}/expire`
- `POST /_mock/negotiations/{id}/inject-message`
- `POST /_mock/tasks/run-due`

Правильный паттерн такой:

- HH-compatible endpoints используются агентом;
- `/_mock/*` используются только вами, тестами и админкой.

## Security headers и бесшовный cutover

Для бесшовности mock должен принимать и логировать те же заголовки, что реальный клиент шлет в HH:

- `Authorization: Bearer <access_token>`
- `HH-User-Agent: <app/version (email)>`
- `Accept: application/json`
- `Content-Type: application/json` или `application/x-www-form-urlencoded`

Что важно:

- в sandbox mode токен можно не валидировать криптографически, но нужно валидировать форму и хранить synthetic token state;
- mock должен уметь отвечать `401 expired token`, `403 paid access required`, `429 rate limit`, чтобы агенты учились правильному поведению;
- `X-Request-Id` нужно возвращать всегда;
- стоит поддержать `Idempotency-Key` или `X-Idempotency-Key` в mock send-path даже если HH это не гарантирует, потому что вашим внутренним агентам это полезно для безопасного теста повторов.

Для клиента правило простое:

- auth header и `HH-User-Agent` не меняются;
- меняется только `baseUrl`.

## Модель данных

Firestore-структура:

```text
sandboxes/{sandboxId}
  status
  created_at
  expires_at
  default_ttl_seconds
  mode
  auth_policy

vacancies/{vacancyId}
  sandbox_id
  title
  body
  status
  hh_vacancy_id
  created_at
  expires_at
  candidate_plan
  scenario_config

negotiations/{negotiationId}
  sandbox_id
  vacancy_id
  hh_negotiation_id
  hh_resume_id
  collection
  state
  updated_at
  awaiting_reply
  last_sender
  message_count
  candidate_profile_id
  reply_policy
  expires_at

messages/{messageId}
  sandbox_id
  negotiation_id
  hh_message_id
  direction
  author_type
  text
  created_at
  visible_at

candidate_profiles/{profileId}
  persona_prompt
  seniority
  skills
  tone
  salary_expectation
  response_latency_sec
  dropoff_probability
```

## Как работает сценарий

### Создание вакансии

`POST /_mock/vacancies`

Тело:

- `vacancy_text`
- `ttl_seconds` optional, default `10800`
- `candidate_count` optional
- `scenario` optional

После создания сервис:

1. создает vacancy;
2. генерирует 2..N кандидатов;
3. создает по negotiation на каждого;
4. кладет первое inbound-сообщение не всем сразу, а по расписанию;
5. обновляет `response` collection.

### Запрос "есть ли новые отклики"

Агент вызывает обычный HH-compatible:

- `GET /negotiations/response?vacancy_id=...`
- дальше `GET /negotiations/{id}/messages`

### Ответ работодателя

Агент вызывает:

- `POST /negotiations/{id}/messages`

Сервис:

1. сохраняет outbound;
2. меняет `updated_at`;
3. считает policy кандидата;
4. создает delayed task на следующий inbound ответ, если кандидат не "ушел".

### Следующая реплика кандидата

Cloud Task вызывает внутренний handler:

- генерируется новое сообщение;
- обновляется `updated_at`;
- при необходимости меняется `collection/state`;
- negotiation снова появляется как "горячая".

## Генерация кандидатов и сообщений

Здесь не нужен realtime LLM на каждый запрос. Надежнее и дешевле делать так:

### На create-time

LLM один раз генерирует:

- 2..N candidate personas;
- краткое synthetic resume summary;
- стартовое сообщение;
- reply policy;
- вероятные возражения;
- stop conditions.

### На reply-time

На каждую реплику работодателя можно:

- либо использовать малую модель для next message generation;
- либо использовать rules + шаблоны + persona state;
- либо гибрид.

Рекомендую гибрид:

- по умолчанию small LLM;
- fallback на deterministic templates;
- хранить `conversation_state` в negotiation document.

Так вы получите и правдоподобие, и воспроизводимость.

## Политика TTL

По умолчанию:

- vacancy TTL: `3 часа`
- negotiation TTL: равен TTL вакансии
- messages TTL: равен TTL переговорки

После истечения:

- HH-compatible endpoints начинают возвращать `404` для vacancy/negotiation;
- control plane может еще коротко хранить tombstone для диагностики;
- cleanup выполняет Scheduler.

Важно не делать "мягкое исчезновение" без статуса. Для агента лучше явный конец жизни sandbox-объекта.

## Collections и жизненный цикл

Нужен минимум этих коллекций:

- `response`
- `phone_interview`
- `interview`
- `offer`
- `discard`

Поведение:

- новые кандидаты стартуют в `response`;
- после первого ответа работодателя можно переводить в `phone_interview`;
- часть synthetic кандидатов может уходить в `discard` по сценарию;
- `updated_at` обновляется при inbound, outbound и state change.

Это критично, потому что именно на этом строится pre-filter/polling логика.

## Ошибки, которые mock обязан уметь

- `401` истекший access token
- `403` нет доступа к платному employer API
- `404` negotiation/resume not found
- `409` duplicate send, если включен строгий idempotency mode
- `429` rate limit
- `500/502/503` редкие transient failures

Эти ошибки должны быть не только в payload examples, но и как включаемые сценарии на конкретную sandbox-вакансию.

## Что переиспользовать из уже существующего кода

Из соседних репозиториев уже есть хорошая база:

- `hiring-agent/services/hh-connector/src/hh-api-client.js`
- `hiring-agent/services/hh-connector/src/hh-contract-mock.js`
- `hiring-agent/docs/hh-api-mocking-plan.md`
- `hiring-agent/scripts/hh-mock-server.py`

Правильный путь не писать все заново, а:

1. взять fixture library и contract mock как ядро совместимости;
2. обернуть это HTTP API слоем;
3. заменить in-memory state на Firestore;
4. добавить delayed replies через Cloud Tasks;
5. добавить control plane для создания sandbox-вакансий.

## Рекомендуемый стек приложения

Я бы делал на `TypeScript` и `Fastify`.

Причины:

- тот же язык, что и большая часть ваших соседних HH-интеграций;
- проще переиспользовать типы и fixtures;
- удобно запускать локально и на Cloud Run;
- легче держать один код для local dev и prod serverless.

Минимальный состав:

- `Fastify` для HTTP;
- `zod` для request/response validation;
- `Firestore` SDK;
- `Cloud Tasks` client;
- `Vitest` для contract tests;
- локальный in-memory adapter для dev/test.

## Фазы реализации

### Фаза 1. Contract-compatible mock core

- поднять HTTP сервис;
- поддержать `/token`, `/me`, negotiations, messages, state, resume;
- подключить fixture library;
- прогнать ваш существующий HH connector против него.

### Фаза 2. Stateful sandbox

- `POST /_mock/vacancies`;
- Firestore-backed negotiations/messages;
- TTL;
- candidate personas;
- delayed replies через Cloud Tasks.

### Фаза 3. Scenario engine

- правила поведения кандидатов;
- variability;
- refusal / went-dark / salary objection / reschedule cases;
- 429/401/403 failure injection.

### Фаза 4. Admin UX

- маленькая web-админка или CLI;
- видно vacancy, negotiations, pending tasks, expiry;
- можно вручную инжектить сообщения.

## Что считать Definition of Done

- существующий HH client может работать против mock только через смену `baseUrl`;
- те же auth headers проходят без изменений;
- payload shape на ключевых endpoints совпадает с HH fixtures;
- вакансия по умолчанию живет 3 часа;
- создается минимум 2 кандидата;
- ответы кандидатов появляются не сразу, а по таймерам;
- `GET /negotiations/{collection}` и `updated_at` позволяют тестировать polling/pre-filter;
- mock умеет `401/403/404/429`;
- можно локально поднять сервис без облака;
- можно деплоить на Cloud Run без VM.

## Рекомендация по старту

Не начинать с "идеального генеративного кандидата".

Начать с этого среза:

1. `TypeScript + Fastify`
2. HTTP surface совместимый с HH
3. Firestore state
4. `POST /_mock/vacancies`
5. 2 synthetic кандидата на вакансию
6. delayed reply через Cloud Tasks
7. TTL 3 часа
8. fixture-backed errors

Этого уже хватит, чтобы прокачивать агентов по работе с HH и ловить логические баги, не упираясь в реальный HH.

## Источники

- Локальный документ: [hh-api-mocking-plan.md](/Users/vova/Documents/GitHub/hiring-agent-chat-layout-fix/docs/hh-api-mocking-plan.md)
- Локальный код: [hh-api-client.js](/Users/vova/Documents/GitHub/hiring-agent/services/hh-connector/src/hh-api-client.js)
- Локальный код: [hh-contract-mock.js](/Users/vova/Documents/GitHub/hiring-agent/services/hh-connector/src/hh-contract-mock.js)
- Локальный код: [hh-mock-server.py](/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-mock-server.py)
- HH API authorization: https://raw.githubusercontent.com/hhru/api/master/docs/authorization.md
- HH employer negotiations: https://raw.githubusercontent.com/hhru/api/master/docs/employer_negotiations.md
- HH integration patterns: https://chillai.space/p/hh-api-integration-patterns?password=NJh_zOj6
