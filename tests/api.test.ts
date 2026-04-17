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
});
