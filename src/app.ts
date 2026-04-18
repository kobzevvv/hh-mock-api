import formbody from "@fastify/formbody";
import Fastify from "fastify";
import { z } from "zod";
import { InMemoryMockStore, type MockStore, type NegotiationCollection } from "./domain.js";

const createVacancySchema = z.object({
  vacancy_text: z.string().min(1),
  ttl_seconds: z.number().int().positive().max(86400).default(10800),
  candidate_count: z.number().int().min(1).max(3).default(2),
  initial_reply_delay_sec: z.number().int().min(0).max(300).default(5),
  follow_up_delay_sec: z.number().int().min(0).max(300).default(20),
  auto_advance_on_employer_message: z.boolean().default(false)
});

const sendMessageSchema = z.object({
  message: z.string().min(1)
});

const changeStateSchema = z.object({
  collection: z.enum(["response", "phone_interview", "interview", "offer", "discard"])
});

const errorScenarioSchema = z.object({
  status: z.enum(["401", "403", "404", "429"]).transform((value) => Number(value) as 401 | 403 | 404 | 429),
  method: z.string().trim().min(1).default("*"),
  path_pattern: z.string().trim().min(1),
  times: z.number().int().positive().max(20).default(1),
  negotiation_id: z.string().trim().min(1).optional()
});

const advanceTimeSchema = z.object({
  ms: z.number().int().min(0).max(86_400_000)
});

const hhCollections = new Set<NegotiationCollection>(["response", "phone_interview", "interview", "offer", "discard"]);

function requestBaseUrl(request: { headers: Record<string, unknown> }) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] ?? "").trim();
  const host = forwardedHost || String(request.headers.host ?? "localhost:8080");
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

function resolveAuthMode(env: NodeJS.ProcessEnv) {
  const mode = String(env.HH_MOCK_AUTH_MODE ?? "none").trim().toLowerCase();
  return mode === "bearer" ? "bearer" : "none";
}

function buildHhError(status: 401 | 403 | 404 | 429) {
  const payloads = {
    401: {
      errors: [{ type: "oauth", value: "token_expired" }],
      error: "invalid_token",
      description: "Access token expired"
    },
    403: {
      errors: [{ type: "forbidden", value: "insufficient_permissions" }],
      error: "forbidden",
      description: "Employer account has no paid access"
    },
    404: {
      errors: [{ type: "not_found", value: "resource not found" }],
      error: "not_found",
      description: "Requested HH resource not found"
    },
    429: {
      errors: [{ type: "rate_limit", value: "too_many_requests" }],
      error: "too_many_requests",
      description: "Rate limit exceeded"
    }
  } as const;
  return payloads[status];
}

export function buildApp({
  store = new InMemoryMockStore(),
  now = () => new Date(),
  env = process.env
}: { store?: MockStore; now?: () => Date; env?: NodeJS.ProcessEnv } = {}) {
  const app = Fastify({ logger: true });
  void app.register(formbody);
  const authMode = resolveAuthMode(env);
  const expectedBearer = env.HH_MOCK_BEARER_TOKEN ? String(env.HH_MOCK_BEARER_TOKEN) : null;
  let clockOffsetMs = 0;

  function effectiveNow() {
    return new Date(now().getTime() + clockOffsetMs);
  }

  function timeSnapshot(current: Date) {
    const delayed = store.getDelayedReplyState(current);
    return {
      now: current.toISOString(),
      offset_ms: clockOffsetMs,
      delayed_replies: {
        pending_count: delayed.pendingCount,
        next_due_at: delayed.nextDueAt,
        latest_due_at: delayed.latestDueAt
      }
    };
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    store.sweep(effectiveNow());
    store.runDue(effectiveNow());

    if (request.url === "/health") return;

    const forced = store.matchErrorScenario({
      method: request.method,
      path: request.url,
      negotiationId: typeof (request.params as Record<string, unknown> | undefined)?.id === "string"
        ? String((request.params as Record<string, unknown>).id)
        : null
    }, effectiveNow());
    if (forced) {
      if (forced.status === 429) {
        reply.header("retry-after", "30");
      }
      return reply.code(forced.status).send(buildHhError(forced.status));
    }

    if (authMode !== "bearer" || request.url === "/token") return;

    const authorization = String(request.headers.authorization ?? "");
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return reply.code(401).send(buildHhError(401));
    }
    if (expectedBearer && match[1] !== expectedBearer) {
      return reply.code(401).send(buildHhError(401));
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    now: effectiveNow().toISOString()
  }));

  app.post("/_mock/vacancies", async (request, reply) => {
    const payload = createVacancySchema.parse(request.body ?? {});
    const vacancy = store.createVacancy({
      vacancyText: payload.vacancy_text,
      ttlSeconds: payload.ttl_seconds,
      candidateCount: payload.candidate_count,
      autoAdvanceOnEmployerMessage: payload.auto_advance_on_employer_message,
      initialReplyDelaySec: payload.initial_reply_delay_sec,
      followUpDelaySec: payload.follow_up_delay_sec
    }, effectiveNow());

    return reply.code(201).send({
      vacancy_id: vacancy.id,
      title: vacancy.title,
      created_at: vacancy.createdAt,
      expires_at: vacancy.expiresAt,
      candidate_count: vacancy.candidateCount,
      negotiation_ids: vacancy.negotiationIds
    });
  });

  app.get("/_mock/vacancies/:vacancyId", async (request, reply) => {
    const { vacancyId } = request.params as { vacancyId: string };
    const vacancy = store.getVacancy(vacancyId);
    if (!vacancy) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "vacancy not found" }]
      });
    }
    const negotiations = store.listNegotiations("response", { vacancyId }, effectiveNow())
      .concat(store.listNegotiations("phone_interview", { vacancyId }, effectiveNow()))
      .concat(store.listNegotiations("interview", { vacancyId }, effectiveNow()))
      .concat(store.listNegotiations("offer", { vacancyId }, effectiveNow()))
      .concat(store.listNegotiations("discard", { vacancyId }, effectiveNow()));

    return {
      vacancy,
      negotiations: negotiations.map((item) => ({
        id: item.id,
        collection: item.collection,
        updated_at: item.updatedAt,
        candidate_name: item.candidate.fullName
      }))
    };
  });

  app.post("/_mock/tasks/run-due", async () => ({
    processed: store.runDue(effectiveNow())
  }));

  app.get("/_mock/state", async () => {
    const current = effectiveNow();
    const snapshot = store.getStateSnapshot(current);
    return {
      now: current.toISOString(),
      offset_ms: clockOffsetMs,
      vacancy_count: snapshot.vacancyCount,
      negotiation_count: snapshot.negotiationCount,
      error_scenario_count: snapshot.errorScenarioCount,
      delayed_replies: {
        pending_count: snapshot.delayedReplies.pendingCount,
        next_due_at: snapshot.delayedReplies.nextDueAt,
        latest_due_at: snapshot.delayedReplies.latestDueAt
      },
      vacancies: snapshot.vacancies,
      negotiations: snapshot.negotiations
    };
  });

  app.get("/_mock/events", async (request) => {
    const { limit = "50" } = request.query as Record<string, string | undefined>;
    const normalized = Math.max(1, Math.min(200, Number(limit || 50)));
    return {
      items: store.listEvents(normalized)
    };
  });

  app.get("/_mock/time", async () => timeSnapshot(effectiveNow()));

  app.post("/_mock/time/advance", async (request) => {
    const payload = advanceTimeSchema.parse(request.body ?? {});
    clockOffsetMs += payload.ms;
    const current = effectiveNow();
    const processed = store.runDue(current);
    return {
      advanced_ms: payload.ms,
      processed,
      ...timeSnapshot(current)
    };
  });

  app.post("/_mock/time/flush-delayed-events", async () => {
    const before = effectiveNow();
    const delayed = store.getDelayedReplyState(before);
    if (!delayed.latestDueAt) {
      return {
        advanced_ms: 0,
        processed: 0,
        ...timeSnapshot(before)
      };
    }

    const latestDueMs = new Date(delayed.latestDueAt).getTime();
    const beforeMs = before.getTime();
    const advancedMs = Math.max(0, latestDueMs - beforeMs);
    clockOffsetMs += advancedMs;
    const current = effectiveNow();
    const processed = store.runDue(current);
    return {
      advanced_ms: advancedMs,
      processed,
      ...timeSnapshot(current)
    };
  });

  app.get("/_mock/errors", async () => ({
    items: store.listErrorScenarios()
  }));

  app.post("/_mock/errors", async (request, reply) => {
    const payload = errorScenarioSchema.parse(request.body ?? {});
    const scenario = store.addErrorScenario({
      status: payload.status,
      method: payload.method.toUpperCase(),
      pathPattern: payload.path_pattern,
      remaining: payload.times,
      negotiationId: payload.negotiation_id ?? null
    }, effectiveNow());
    return reply.code(201).send(scenario);
  });

  app.delete("/_mock/errors", async () => {
    store.clearErrorScenarios(effectiveNow());
    return { ok: true };
  });

  app.post("/_mock/reset", async () => {
    clockOffsetMs = 0;
    store.reset(effectiveNow());
    return {
      ok: true,
      ...timeSnapshot(effectiveNow())
    };
  });

  app.post("/token", async (request) => {
    const payload = request.body as Record<string, unknown> | undefined;
    return {
      access_token: "mock_access_token",
      refresh_token: "mock_refresh_token",
      token_type: "bearer",
      expires_in: 3600,
      grant_type: payload?.grant_type ?? null
    };
  });

  app.get("/me", async (request) => ({
    id: "mock-employer",
    email: "sandbox@hh-mock.local",
    manager: { id: "mock-manager" },
    headers_seen: {
      authorization: request.headers.authorization ?? null,
      hh_user_agent: request.headers["hh-user-agent"] ?? null
    }
  }));

  app.get("/negotiations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const baseUrl = requestBaseUrl(request);
    if (hhCollections.has(id as NegotiationCollection)) {
      const { vacancy_id, page = "0", per_page = "20" } = request.query as Record<string, string | undefined>;
      const pageNum = Math.max(0, Number(page || 0));
      const perPageNum = Math.max(1, Math.min(50, Number(per_page || 20)));
      const items = store.listNegotiations(id as NegotiationCollection, { vacancyId: vacancy_id }, effectiveNow());
      const start = pageNum * perPageNum;
      const chunk = items.slice(start, start + perPageNum);
      return {
        found: items.length,
        page: pageNum,
        pages: Math.max(1, Math.ceil(items.length / perPageNum)),
        per_page: perPageNum,
        items: chunk.map((item) => ({
          id: item.id,
          updated_at: item.updatedAt,
          state: { id: item.collection },
          resume: {
            id: item.resumeId,
            url: `${baseUrl}/resumes/${item.resumeId}`
          },
          vacancy: { id: item.vacancyId }
        }))
      };
    }

    const negotiation = store.getNegotiation(id, effectiveNow());
    if (!negotiation) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "negotiation not found" }]
      });
    }
    return {
      id: negotiation.id,
      updated_at: negotiation.updatedAt,
      state: { id: negotiation.collection },
      resume: {
        id: negotiation.resumeId,
        url: `${baseUrl}/resumes/${negotiation.resumeId}`
      },
      vacancy: { id: negotiation.vacancyId },
      candidate: {
        full_name: negotiation.candidate.fullName,
        title: negotiation.candidate.resumeTitle
      }
    };
  });

  app.get("/negotiations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const messages = store.getMessages(id, effectiveNow());
    if (!messages) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "negotiation not found" }]
      });
    }
    return {
      items: messages.map((message) => ({
        id: message.id,
        created_at: message.createdAt,
        text: message.text,
        author: message.author
      }))
    };
  });

  app.post("/negotiations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = sendMessageSchema.parse(request.body ?? {});
    const sent = store.sendEmployerMessage(id, payload.message, effectiveNow());
    if (!sent) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "negotiation not found" }]
      });
    }
    return reply.code(201).send({ id: sent.hh_message_id, hh_message_id: sent.hh_message_id });
  });

  app.put("/negotiations/:id/state", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = changeStateSchema.parse(request.body ?? {});
    const negotiation = store.changeState(id, payload.collection, effectiveNow());
    if (!negotiation) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "negotiation not found" }]
      });
    }
    return {
      id: negotiation.id,
      collection: negotiation.collection,
      updated_at: negotiation.updatedAt
    };
  });

  app.get("/resumes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const matches = ["response", "phone_interview", "interview", "offer", "discard"]
      .flatMap((collection) => store.listNegotiations(collection as NegotiationCollection, {}, effectiveNow()))
      .find((item) => item.resumeId === id);
    if (!matches) {
      return reply.code(404).send({
        errors: [{ type: "not_found", value: "resume not found" }]
      });
    }
    return {
      id,
      title: matches.candidate.resumeTitle,
      first_name: matches.candidate.fullName.split(" ")[0] ?? matches.candidate.fullName,
      last_name: matches.candidate.fullName.split(" ").slice(1).join(" ") || null,
      area: { name: matches.candidate.location },
      salary: { amount: matches.candidate.salary, currency: "RUR" }
    };
  });

  return app;
}
