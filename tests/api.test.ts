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
});
