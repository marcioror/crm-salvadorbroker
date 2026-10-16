import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Achado I2 da revisão final (2ª rodada) — `title` da rota de captação
 * pública NUNCA pode cair no telefone/e-mail do payload: é coluna de texto
 * plano que `app/api/v1/leads/route.ts` devolve a QUALQUER viewer, e a
 * proteção per-viewer de contato não alcança essa cópia. Antes do fix, o
 * fallback era `mapped.name ?? mapped.phone ?? mapped.email ?? "Lead sem
 * nome"` — os dois testes abaixo mandam payload SEM nome (com telefone, e
 * com e-mail) e provam que o `title` gravado é o rótulo neutro, nunca o dado
 * de contato.
 */

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const createLeadHandler = vi.fn();
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (...args: unknown[]) => createLeadHandler(...args),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { POST } from "./route";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "tok_teste_captacao_1234567890";

interface AdminCfg {
  contactSelectResult?: { id: string } | null;
  contactInsertResult?: { id: string } | null;
}

function makeAdmin(cfg: AdminCfg = {}) {
  return {
    from(table: string) {
      if (table === "webhook_sources") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: SOURCE_ID,
                    organization_id: ORG_ID,
                    secret_encrypted: null,
                    default_pipeline_id: "pipe-1",
                    default_stage_id: "stage-1",
                    field_map: {},
                    redirect_to: null,
                    is_active: true,
                  },
                  error: null,
                }),
            }),
          }),
          // Duas igualdades desde a v1.83.0 (organização e id da fonte).
          update: () => {
            const fim = Promise.resolve({ data: null, error: null });
            const cadeia = Object.assign(fim, { eq: () => cadeia });
            return cadeia;
          },
        };
      }
      if (table === "webhook_events_log") {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      if (table === "crm_leads") {
        // Só usado no dedup por external_id — os testes abaixo não mandam
        // external_id, então `findLeadByExternalId` nunca chega a chamar isto.
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
          }),
        };
      }
      if (table === "contacts") {
        // ⚠️ CADEIA FLUENTE, e não literais aninhados, porque agora são DUAS
        // formas de consulta contra a mesma tabela. Na fusão de 2026-09-07 o
        // upstream trocou a busca por telefone por `buscarPorVariantes`
        // (`lib/channels/contato-por-telefone.ts`), que encadeia
        // `.select().eq().in().is().limit()` — enquanto o caminho antigo é
        // `.select().eq().eq().is().maybeSingle()`. Um literal aninhado só sabe
        // a forma que foi digitada, e a forma nova morria em
        // "in is not a function", que se lê como defeito do produto.
        //
        // `limit` resolve LISTA (é o que `buscarPorVariantes` consome antes de
        // `escolherContatoCanonico`) e `maybeSingle` resolve LINHA — os dois
        // saem do mesmo `contactSelectResult`, então o teste continua sendo
        // configurado por um campo só.
        const contatos: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "is", "order"]) contatos[m] = () => contatos;
        contatos.maybeSingle = () =>
          Promise.resolve({ data: cfg.contactSelectResult ?? null, error: null });
        contatos.limit = () =>
          Promise.resolve({
            data: cfg.contactSelectResult ? [cfg.contactSelectResult] : [],
            error: null,
          });
        return {
          ...contatos,
          insert: () => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: cfg.contactInsertResult ?? { id: "contact-novo" }, error: null }),
            }),
          }),
        };
      }
      if (table === "webhook_lead_captures") {
        // O histórico de captação da 1.5.0: `registrarCaptacao` dá um insert e
        // só lê o `error`. Gravar não é o que este arquivo mede — ele mede que
        // o `title` do lead nunca vira telefone/e-mail.
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      }
      throw new Error(`tabela inesperada no stub: ${table}`);
    },
  };
}

function postJson(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/v1/webhooks/in/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/webhooks/in/[token] — title nunca vira telefone/e-mail", () => {
  beforeEach(() => {
    createLeadHandler.mockReset();
    createLeadHandler.mockResolvedValue({ id: "lead-novo" });
  });

  it("payload com telefone e SEM nome: title cai no rótulo neutro, não no telefone", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ contactSelectResult: null, contactInsertResult: { id: "contact-novo" } }) as never,
    );

    const res = await POST(postJson({ phone: "31999998888" }), { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(200);
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    const input = createLeadHandler.mock.calls[0]![2] as { title: string };
    expect(input.title).toBe("Lead sem nome");
    expect(input.title).not.toContain("31999998888");
    expect(input.title).not.toContain("+5531999998888");
  });

  it("payload com e-mail e SEM nome: title cai no rótulo neutro, não no e-mail", async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeAdmin() as never);

    const res = await POST(postJson({ email: "cliente@example.com" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(res.status).toBe(200);
    expect(createLeadHandler).toHaveBeenCalledTimes(1);
    const input = createLeadHandler.mock.calls[0]![2] as { title: string };
    expect(input.title).toBe("Lead sem nome");
    expect(input.title).not.toContain("cliente@example.com");
  });

  it("payload COM nome: title continua sendo o nome (comportamento preservado)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeAdmin({ contactSelectResult: null, contactInsertResult: { id: "contact-novo" } }) as never,
    );

    const res = await POST(postJson({ name: "Fulano da Silva", phone: "31999998888" }), {
      params: Promise.resolve({ token: TOKEN }),
    });

    expect(res.status).toBe(200);
    const input = createLeadHandler.mock.calls[0]![2] as { title: string };
    expect(input.title).toBe("Fulano da Silva");
  });
});
