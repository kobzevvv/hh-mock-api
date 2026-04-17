import formbody from "@fastify/formbody";
import Fastify from "fastify";
import { z } from "zod";
import { InMemoryMockStore, type MockStore, type NegotiationCollection } from "./domain.js";

const createVacancySchema = z.object({
  vacancy_text: z.string().min(1),
  ttl_seconds: z.number().int().positive().max(86400).default(10800),
  candidate_count: z.number().int().min(1).max(3).default(2)
});

const sendMessageSchema = z.object({
  message: z.string().min(1)
});

const changeStateSchema = z.object({
  collection: z.enum(["response", "phone_interview", "interview", "offer", "discard"])
});

const hhCollections = new Set<NegotiationCollection>(["response", "phone_interview", "interview", "offer", "discard"]);

function requestBaseUrl(request: { headers: Record<string, unknown> }) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "").trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] ?? "").trim();
  const host = forwardedHost || String(request.headers.host ?? "localhost:8080");
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

export function buildApp({ store = new InMemoryMockStore(), now = () => new Date() }: { store?: MockStore; now?: () => Date } = {}) {
  const app = Fastify({ logger: true });
  void app.register(formbody);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    store.sweep(now());
    store.runDue(now());
  });

  app.get("/health", async () => ({
    status: "ok",
    now: now().toISOString()
  }));

  app.post("/_mock/vacancies", async (request, reply) => {
    const payload = createVacancySchema.parse(request.body ?? {});
    const vacancy = store.createVacancy({
      vacancyText: payload.vacancy_text,
      ttlSeconds: payload.ttl_seconds,
      candidateCount: payload.candidate_count
    }, now());

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
    const negotiations = store.listNegotiations("response", { vacancyId }, now())
      .concat(store.listNegotiations("phone_interview", { vacancyId }, now()))
      .concat(store.listNegotiations("interview", { vacancyId }, now()))
      .concat(store.listNegotiations("offer", { vacancyId }, now()))
      .concat(store.listNegotiations("discard", { vacancyId }, now()));

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
    processed: store.runDue(now())
  }));

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
      const items = store.listNegotiations(id as NegotiationCollection, { vacancyId: vacancy_id }, now());
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

    const negotiation = store.getNegotiation(id, now());
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
    const messages = store.getMessages(id, now());
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
    const sent = store.sendEmployerMessage(id, payload.message, now());
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
    const negotiation = store.changeState(id, payload.collection, now());
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
      .flatMap((collection) => store.listNegotiations(collection as NegotiationCollection, {}, now()))
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
