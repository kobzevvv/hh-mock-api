import { randomUUID } from "node:crypto";

export type ParticipantType = "applicant" | "employer";
export type NegotiationCollection = "response" | "phone_interview" | "interview" | "offer" | "discard";

export interface MockMessage {
  id: string;
  negotiationId: string;
  text: string;
  createdAt: string;
  author: {
    participant_type: ParticipantType;
  };
}

export interface CandidateProfile {
  id: string;
  fullName: string;
  resumeTitle: string;
  location: string;
  salary: number;
  tone: "warm" | "neutral" | "direct";
  responseLatencySec: number;
  followUpLatencySec: number;
}

export interface Negotiation {
  id: string;
  vacancyId: string;
  resumeId: string;
  collection: NegotiationCollection;
  updatedAt: string;
  expiresAt: string;
  candidate: CandidateProfile;
  messages: MockMessage[];
  scheduledReplyAt: string | null;
  nextApplicantPrompt: string | null;
}

export interface Vacancy {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  expiresAt: string;
  candidateCount: number;
  negotiationIds: string[];
}

export interface CreateVacancyInput {
  vacancyText: string;
  ttlSeconds: number;
  candidateCount: number;
}

export interface MockStore {
  createVacancy(input: CreateVacancyInput, now: Date): Vacancy;
  getVacancy(vacancyId: string): Vacancy | null;
  listNegotiations(collection: NegotiationCollection, filters: { vacancyId?: string | undefined }, now: Date): Negotiation[];
  getNegotiation(negotiationId: string, now: Date): Negotiation | null;
  getMessages(negotiationId: string, now: Date): MockMessage[] | null;
  sendEmployerMessage(negotiationId: string, text: string, now: Date): { hh_message_id: string } | null;
  changeState(negotiationId: string, collection: NegotiationCollection, now: Date): Negotiation | null;
  sweep(now: Date): void;
  runDue(now: Date): number;
}

function iso(date: Date): string {
  return date.toISOString();
}

function plusSeconds(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

function parseVacancy(vacancyText: string): { title: string; body: string } {
  const normalized = vacancyText.trim();
  const [firstLine, ...rest] = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    title: firstLine || "Synthetic vacancy",
    body: rest.join("\n") || normalized
  };
}

function buildInitialCandidateMessage(candidate: CandidateProfile, vacancyTitle: string): string {
  if (candidate.tone === "warm") {
    return `Здравствуйте. Откликаюсь на вакансию "${vacancyTitle}". У меня релевантный опыт и готов(а) коротко рассказать, как закрывал(а) похожие задачи.`;
  }
  if (candidate.tone === "direct") {
    return `Добрый день. Вакансия "${vacancyTitle}" подходит. Могу быстро пройтись по опыту, стеку и ожиданиям по формату работы.`;
  }
  return `Здравствуйте. Мне интересна вакансия "${vacancyTitle}". Подскажите, пожалуйста, какие у вас сейчас приоритеты по кандидату.`;
}

function buildReply(candidate: CandidateProfile, employerText: string): string {
  const text = employerText.toLowerCase();
  if (text.includes("зарплат")) {
    return `По компенсации ориентируюсь примерно на ${candidate.salary.toLocaleString("ru-RU")} рублей gross, но готов(а) обсуждать детали после короткого знакомства с задачами.`;
  }
  if (text.includes("стек") || text.includes("опыт")) {
    return `Если коротко: основной опыт у меня вокруг роли "${candidate.resumeTitle}", плюс умею быстро входить в новые процессы и держать коммуникацию без потерь по срокам.`;
  }
  if (text.includes("созвон") || text.includes("интервью")) {
    return "Да, могу выйти на короткий созвон. Лучше заранее понимать формат, длительность и кто будет на встрече.";
  }
  return "Спасибо, вижу сообщение. Да, готов(а) продолжить диалог и ответить на уточняющие вопросы по опыту, мотивации и формату работы.";
}

export class InMemoryMockStore implements MockStore {
  private vacancies = new Map<string, Vacancy>();
  private negotiations = new Map<string, Negotiation>();

  createVacancy(input: CreateVacancyInput, now: Date): Vacancy {
    const vacancyId = randomUUID();
    const parsed = parseVacancy(input.vacancyText);
    const expiresAt = plusSeconds(now, input.ttlSeconds);
    const candidatePlan = makeCandidates(input.candidateCount);
    const negotiationIds: string[] = [];

    for (const candidate of candidatePlan) {
      const negotiationId = randomUUID();
      const resumeId = `resume-${negotiationId}`;
      const initialMessage: MockMessage = {
        id: randomUUID(),
        negotiationId,
        text: buildInitialCandidateMessage(candidate, parsed.title),
        createdAt: iso(plusSeconds(now, candidate.responseLatencySec)),
        author: { participant_type: "applicant" }
      };
      this.negotiations.set(negotiationId, {
        id: negotiationId,
        vacancyId,
        resumeId,
        collection: "response",
        updatedAt: initialMessage.createdAt,
        expiresAt: iso(expiresAt),
        candidate,
        messages: [initialMessage],
        scheduledReplyAt: null,
        nextApplicantPrompt: null
      });
      negotiationIds.push(negotiationId);
    }

    const vacancy: Vacancy = {
      id: vacancyId,
      title: parsed.title,
      body: parsed.body,
      createdAt: iso(now),
      expiresAt: iso(expiresAt),
      candidateCount: input.candidateCount,
      negotiationIds
    };
    this.vacancies.set(vacancyId, vacancy);
    return structuredClone(vacancy);
  }

  getVacancy(vacancyId: string): Vacancy | null {
    return this.cloneOrNull(this.vacancies.get(vacancyId));
  }

  listNegotiations(collection: NegotiationCollection, filters: { vacancyId?: string | undefined }, now: Date): Negotiation[] {
    this.sweep(now);
    this.runDue(now);
    const items = [...this.negotiations.values()]
      .filter((item) => item.collection === collection)
      .filter((item) => (filters.vacancyId ? item.vacancyId === filters.vacancyId : true))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return items.map((item) => structuredClone(item));
  }

  getNegotiation(negotiationId: string, now: Date): Negotiation | null {
    this.sweep(now);
    this.runDue(now);
    return this.cloneOrNull(this.negotiations.get(negotiationId));
  }

  getMessages(negotiationId: string, now: Date): MockMessage[] | null {
    const negotiation = this.getNegotiation(negotiationId, now);
    return negotiation ? structuredClone(negotiation.messages) : null;
  }

  sendEmployerMessage(negotiationId: string, text: string, now: Date): { hh_message_id: string } | null {
    this.sweep(now);
    this.runDue(now);
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return null;

    const messageId = randomUUID();
    const message: MockMessage = {
      id: messageId,
      negotiationId,
      text,
      createdAt: iso(now),
      author: { participant_type: "employer" }
    };
    negotiation.messages.push(message);
    negotiation.updatedAt = message.createdAt;
    negotiation.scheduledReplyAt = iso(plusSeconds(now, negotiation.candidate.followUpLatencySec));
    negotiation.nextApplicantPrompt = text;
    if (negotiation.collection === "response") {
      negotiation.collection = "phone_interview";
    }
    return { hh_message_id: messageId };
  }

  changeState(negotiationId: string, collection: NegotiationCollection, now: Date): Negotiation | null {
    this.sweep(now);
    const negotiation = this.negotiations.get(negotiationId);
    if (!negotiation) return null;
    negotiation.collection = collection;
    negotiation.updatedAt = iso(now);
    return structuredClone(negotiation);
  }

  sweep(now: Date): void {
    for (const [vacancyId, vacancy] of this.vacancies.entries()) {
      if (new Date(vacancy.expiresAt).getTime() <= now.getTime()) {
        this.vacancies.delete(vacancyId);
        for (const negotiationId of vacancy.negotiationIds) {
          this.negotiations.delete(negotiationId);
        }
      }
    }
  }

  runDue(now: Date): number {
    let processed = 0;
    for (const negotiation of this.negotiations.values()) {
      if (!negotiation.scheduledReplyAt) continue;
      if (new Date(negotiation.scheduledReplyAt).getTime() > now.getTime()) continue;
      const messageId = randomUUID();
      const text = buildReply(negotiation.candidate, negotiation.nextApplicantPrompt ?? "");
      const message: MockMessage = {
        id: messageId,
        negotiationId: negotiation.id,
        text,
        createdAt: iso(now),
        author: { participant_type: "applicant" }
      };
      negotiation.messages.push(message);
      negotiation.updatedAt = message.createdAt;
      negotiation.scheduledReplyAt = null;
      negotiation.nextApplicantPrompt = null;
      processed += 1;
    }
    return processed;
  }

  private cloneOrNull<T>(value: T | undefined): T | null {
    return value ? structuredClone(value) : null;
  }
}

function makeCandidates(candidateCount: number): CandidateProfile[] {
  const base: CandidateProfile[] = [
    {
      id: "candidate-1",
      fullName: "Анна Смирнова",
      resumeTitle: "Product Manager",
      location: "Москва",
      salary: 280000,
      tone: "warm",
      responseLatencySec: 5,
      followUpLatencySec: 20
    },
    {
      id: "candidate-2",
      fullName: "Илья Крылов",
      resumeTitle: "Senior Backend Engineer",
      location: "Санкт-Петербург",
      salary: 350000,
      tone: "direct",
      responseLatencySec: 10,
      followUpLatencySec: 25
    },
    {
      id: "candidate-3",
      fullName: "Мария Павлова",
      resumeTitle: "Recruiter",
      location: "Екатеринбург",
      salary: 180000,
      tone: "neutral",
      responseLatencySec: 15,
      followUpLatencySec: 30
    }
  ];
  return base.slice(0, Math.max(1, Math.min(candidateCount, base.length)));
}
