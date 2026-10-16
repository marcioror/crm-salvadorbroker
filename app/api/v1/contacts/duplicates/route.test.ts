import { describe, expect, it, vi, beforeEach } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fail } from "@/lib/api/wrappers";

/**
 * DIVERGÊNCIA DESTE FORK, e é ela que este arquivo existe para prender.
 *
 * No upstream a listagem de duplicados é aberta a `viewer`. Aqui é `manager`,
 * porque a resposta agrupa POR TELEFONE E POR E-MAIL — `grupo.chave` É o dado
 * normalizado — e a proteção de contato (`lib/contacts/visibility.ts`) esconde
 * telefone e e-mail do corretor que não cadastrou o lead. Sem o gate, esta rota
 * devolvia os dois em texto puro a qualquer membro da organização.
 *
 * ⚠️ Este teste é a rede que impede a próxima fusão de reverter isso EM
 * SILÊNCIO. O risco não é conflito de merge — é o contrário: o upstream mexer
 * neste arquivo de um jeito que funda limpo e leve o gate junto. Sem uma prova
 * por comportamento, nada acusaria.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG_ID = "22222222-2222-4222-8222-222222222222";

/** Encadeamento que a rota usa: from().select().eq().is().eq().order().limit() */
function supabaseComContatos(linhas: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order"]) b[m] = () => b;
  b.range = () => Promise.resolve({ data: linhas, error: null, count: linhas.length });
  b.limit = () => Promise.resolve({ data: linhas, error: null });
  return { from: () => b };
}

describe("GET /api/v1/contacts/duplicates — o gate é manager, não viewer", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(createClient).mockReset();
  });

  it("cobra o papel `manager` (o mesmo de POST /contacts/merge)", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u1" } as never,
      org: { orgId: ORG_ID, name: "Org", role: "manager" },
    } as never);
    vi.mocked(createClient).mockResolvedValue(supabaseComContatos([]) as never);

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager");
  });

  it("quem não passa no papel recebe a recusa do requireRole, e nenhum contato é lido", async () => {
    const negado = fail("forbidden_role", "Sem permissão.", 403, { requestId: "req-1" });
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: negado } as never);

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(403);
    // A recusa precisa acontecer ANTES do select: um 403 emitido depois de a
    // rota já ter lido telefone e e-mail do banco protegeria a resposta e não o
    // dado — e qualquer log ou erro no meio do caminho carregaria o vazamento.
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
  });
});
