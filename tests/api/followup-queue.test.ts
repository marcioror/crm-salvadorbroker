/**
 * Task 8.6 — a fila mostra o agente PINADO no enrollment. Prova a função pura
 * de mapeamento `enrollmentToQueueRow` (o join `ai_agents:agent_id(name)` da
 * rota vira `agent_name`), cobrindo o embed do PostgREST nos dois formatos
 * (objeto único e array de 1) + ausência de agente pinado → null.
 */
import { describe, it, expect, vi } from "vitest";

// A rota importa server-only helpers no topo; mocka-se pra o import não puxar
// next/headers em ambiente jsdom. O último bloco exercita o GET com os dois mocks.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import type { Actor } from "@/lib/api/handlers/types";

import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { GET, enrollmentToQueueRow } from "@/app/api/v1/ai/followups/queue/route";

// manager: irrelevante pra estes testes (agent_name), mas precisa ser alguém
// que `podeVerContatoSensivel` sempre aprova — I1 fez `enrollmentToQueueRow`
// exigir o ator pra decidir se o rótulo do contato pode cair no telefone.
const MANAGER: Actor = { type: "user", id: "tester", role: "manager" };

const base = {
  id: "e1",
  contact_id: "c1",
  current_node_id: "n1",
  next_eval_at: "2026-07-23T00:00:00Z",
  status: "active",
  outcome: null,
  contacts: { id: "c1", name: "Ana", display_name: null, phone_number: null, created_by_user_id: null },
  followup_flow_pointers: { name: "Reativação" },
  ai_agents: null,
};

describe("enrollmentToQueueRow — agent_name", () => {
  it("agente pinado (embed objeto) → agent_name", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: { name: "Vendedor IA" } }, MANAGER);
    expect(row.agent_name).toBe("Vendedor IA");
    expect(row.flow_name).toBe("Reativação");
    expect(row.contact.name).toBe("Ana");
  });

  it("agente pinado (embed array de 1, como o PostgREST às vezes devolve) → agent_name", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: [{ name: "Vendedor IA" }] }, MANAGER);
    expect(row.agent_name).toBe("Vendedor IA");
  });

  it("sem agente pinado (agent_id null) → agent_name null", () => {
    const row = enrollmentToQueueRow({ ...base, ai_agents: null }, MANAGER);
    expect(row.agent_name).toBeNull();
  });
});

// I1 (revisão final): `rotuloDoContato` cai pro telefone quando não há nome —
// sem gate de visibilidade, um lead sem nome que o ator NÃO cadastrou aparecia
// na fila TITULADO pelo próprio telefone, o mesmo dado que /api/v1/contacts
// já protege na resposta.
describe("enrollmentToQueueRow — proteção de telefone no rótulo (I1)", () => {
  const CRIADOR = "11111111-1111-4111-8111-111111111111";
  const OUTRO_AGENT: Actor = { type: "user", id: "22222222-2222-4222-8222-222222222222", role: "agent" };
  const contatoSemNome = {
    id: "c1",
    name: null,
    display_name: null,
    phone_number: "+5531988887777",
    created_by_user_id: CRIADOR,
  };

  it("agent que NÃO cadastrou o lead sem nome vê SEM_NOME, nunca o telefone", () => {
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, OUTRO_AGENT);
    expect(row.contact.name).toBe("Sem nome");
    expect(row.contact.name).not.toContain("5531988887777");
  });

  it("agent que cadastrou o próprio lead sem nome vê o telefone no rótulo (comportamento normal)", () => {
    const criador: Actor = { type: "user", id: CRIADOR, role: "agent" };
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, criador);
    expect(row.contact.name).toBe("+5531988887777");
  });

  it("manager vê o telefone no rótulo mesmo sem ter cadastrado o lead", () => {
    const row = enrollmentToQueueRow({ ...base, contacts: contatoSemNome }, MANAGER);
    expect(row.contact.name).toBe("+5531988887777");
  });
});

// ---------------------------------------------------------------------------
// A ROTA, não só a função: o aviso de reativação (`org_reativada`) manda
// conferir em IA › Follow-ups. Se a rota deixar de selecionar `last_error` ou
// voltar a derivar o status só de enabled/cancelled_at, o disparo único que a
// suspensão desligou reaparece como "concluída" — o contrário do aviso.
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

/** Devolve só as colunas que o `select` pediu, como o PostgREST. */
function projetar(linhas: Linha[], select: string): Linha[] {
  const colunas = select.split(/,(?![^(]*\))/).map((c) => c.trim().split(/[:(]/)[0]!.trim());
  return linhas.map((l) => Object.fromEntries(colunas.filter((c) => c in l).map((c) => [c, l[c]])));
}

function bancoFalso(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      let select = "*";
      const b = {
        select(s: string) { select = s; return b; },
        eq() { return b; }, order() { return b; }, limit() { return b; },
        in() { return b; }, or() { return b; }, is() { return b; }, gt() { return b; },
        then(res: (v: { data: Linha[]; error: null }) => unknown) {
          return Promise.resolve({ data: projetar(tabelas[tabela] ?? [], select), error: null }).then(res);
        },
      };
      return b;
    },
  };
}

describe("GET /api/v1/ai/followups/queue — status da promessa", () => {
  it("disparo único desligado pela suspensão (last_error=org_nao_operante) → 'não disparada', não 'concluída'", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { idioma: "pt-BR" },
      org: { orgId: "o1" },
    } as unknown as Awaited<ReturnType<typeof requireRole>>);
    const promessa = {
      id: "j1", contact_id: "c1", next_run_at: null, payload: {}, cancelled_at: null,
      contacts: { id: "c1", name: "Ana", display_name: null, phone_number: null },
    };
    vi.mocked(createClient).mockResolvedValue(
      bancoFalso({
        followup_enrollments: [],
        cron_jobs: [
          { ...promessa, id: "j1", enabled: false, last_error: "org_nao_operante" },
          { ...promessa, id: "j2", enabled: false, last_error: null },
        ],
      }) as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const res = await GET(new NextRequest("http://localhost/api/v1/ai/followups/queue"));
    const corpo = (await res.json()) as { data: Array<{ id: string; status: string }> };

    expect(res.status).toBe(200);
    expect(Object.fromEntries(corpo.data.map((r) => [r.id, r.status]))).toEqual({
      j1: "não disparada",
      j2: "concluída",
    });
  });
});
