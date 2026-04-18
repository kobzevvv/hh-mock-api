import { describe, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

describe("hh mock api", () => {
  test("creates vacancy and lists negotiations", async () => {
    const app = buildApp({
      now: () => new Date("2026-04-17T12:00:00.000Z")
    });

    const create = await app.inject({
      method: "POST",
      url: "/_mock/vacancies",
      payload: {
        vacancy_text: "Senior Recruiter\nНужен рекрутер с опытом в executive search",
        candidate_count: 2,
        ttl_seconds: 10800
      }
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.negotiation_ids).toHaveLength(2);

    const list = await app.inject({
      method: "GET",
      url: `/negotiations/response?vacancy_id=${created.vacancy_id}`
    });
    expect(list.statusCode).toBe(200);
    const payload = list.json();
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0].resume.url).toContain("localhost");

    await app.close();
  });

  test("employer send schedules applicant reply", async () => {
    let current = new Date("2026-04-17T12:00:00.000Z");
    const app = buildApp({
      now: () => current
    });

    const create = await app.inject({
      method: "POST",
      url: "/_mock/vacancies",
      payload: {
        vacancy_text: "Backend Engineer\nNode.js и интеграции",
        candidate_count: 1,
        ttl_seconds: 10800
      }
    });
    const created = create.json();
    const negotiationId = created.negotiation_ids[0];

    const send = await app.inject({
      method: "POST",
      url: `/negotiations/${negotiationId}/messages`,
      payload: {
        message: "Расскажите, пожалуйста, про ваш опыт и зарплатные ожидания"
      }
    });
    expect(send.statusCode).toBe(201);

    current = new Date("2026-04-17T12:00:30.000Z");
    const messages = await app.inject({
      method: "GET",
      url: `/negotiations/${negotiationId}/messages`
    });
    const payload = messages.json();
    expect(payload.items).toHaveLength(3);
    expect(payload.items.at(-1).author.participant_type).toBe("applicant");

    const negotiation = await app.inject({
      method: "GET",
      url: `/negotiations/${negotiationId}`
    });
    expect(negotiation.json().state.id).toBe("response");

    await app.close();
  });

  test("accepts form-encoded send path compatible with hh client", async () => {
    let current = new Date("2026-04-17T12:00:00.000Z");
    const app = buildApp({
      now: () => current
    });

    const create = await app.inject({
      method: "POST",
      url: "/_mock/vacancies",
      payload: {
        vacancy_text: "Backend Engineer\nNode.js и интеграции",
        candidate_count: 1,
        ttl_seconds: 10800
      }
    });
    const created = create.json();
    const negotiationId = created.negotiation_ids[0];

    const send = await app.inject({
      method: "POST",
      url: `/negotiations/${negotiationId}/messages`,
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      payload: "message=%D0%A2%D0%B5%D1%81%D1%82+form+body"
    });

    expect(send.statusCode).toBe(201);
    current = new Date("2026-04-17T12:00:30.000Z");

    const messages = await app.inject({
      method: "GET",
      url: `/negotiations/${negotiationId}/messages`
    });
    const payload = messages.json();

    expect(payload.items.map((item: { text: string }) => item.text)).toContain("Тест form body");

    await app.close();
  });

  test("accepts form-encoded token exchange", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      payload: "grant_type=authorization_code&code=test-code"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      access_token: "mock_access_token",
      refresh_token: "mock_refresh_token",
      grant_type: "authorization_code"
    });

    await app.close();
  });

  test("supports bearer auth mode for HH-style clients", async () => {
    const app = buildApp({
      env: {
        HH_MOCK_AUTH_MODE: "bearer",
        HH_MOCK_BEARER_TOKEN: "sandbox-token"
      }
    });

    const forbidden = await app.inject({
      method: "GET",
      url: "/me"
    });
    expect(forbidden.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/me",
      headers: {
        authorization: "Bearer sandbox-token"
      }
    });
    expect(ok.statusCode).toBe(200);

    await app.close();
  });

  test("supports forced error scenarios", async () => {
    const app = buildApp();

    const created = await app.inject({
      method: "POST",
      url: "/_mock/errors",
      payload: {
        status: "429",
        method: "GET",
        path_pattern: "/negotiations/response",
        times: 1
      }
    });
    expect(created.statusCode).toBe(201);

    const first = await app.inject({
      method: "GET",
      url: "/negotiations/response"
    });
    expect(first.statusCode).toBe(429);
    expect(first.headers["retry-after"]).toBe("30");

    const second = await app.inject({
      method: "GET",
      url: "/negotiations/response"
    });
    expect(second.statusCode).toBe(200);

    await app.close();
  });

  test("supports pagination on negotiations collection", async () => {
    const app = buildApp({
      now: () => new Date("2026-04-17T12:00:00.000Z")
    });

    const create = await app.inject({
      method: "POST",
      url: "/_mock/vacancies",
      payload: {
        vacancy_text: "Recruiter\nHiring for GTM roles",
        candidate_count: 3,
        ttl_seconds: 10800
      }
    });
    const created = create.json();

    const page0 = await app.inject({
      method: "GET",
      url: `/negotiations/response?vacancy_id=${created.vacancy_id}&page=0&per_page=2`
    });
    const page1 = await app.inject({
      method: "GET",
      url: `/negotiations/response?vacancy_id=${created.vacancy_id}&page=1&per_page=2`
    });

    expect(page0.json().items).toHaveLength(2);
    expect(page1.json().items).toHaveLength(1);

    await app.close();
  });

  test("expires vacancy and negotiations by TTL", async () => {
    let current = new Date("2026-04-17T12:00:00.000Z");
    const app = buildApp({
      now: () => current
    });

    const create = await app.inject({
      method: "POST",
      url: "/_mock/vacancies",
      payload: {
        vacancy_text: "Recruiter\nShort ttl",
        candidate_count: 1,
        ttl_seconds: 1
      }
    });
    const created = create.json();
    const negotiationId = created.negotiation_ids[0];

    current = new Date("2026-04-17T12:00:02.000Z");

    const vacancy = await app.inject({
      method: "GET",
      url: `/_mock/vacancies/${created.vacancy_id}`
    });
    const negotiation = await app.inject({
      method: "GET",
      url: `/negotiations/${negotiationId}`
    });

    expect(vacancy.statusCode).toBe(404);
    expect(negotiation.statusCode).toBe(404);

    await app.close();
  });
});
