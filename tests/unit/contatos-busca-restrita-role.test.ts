/**
 * C4 (revisão final de feat/protecao-contato-corretor) — a busca de contatos
 * é ORÁCULO DE CONFIRMAÇÃO pra quem não pode ver telefone/e-mail: um corretor
 * sem acesso ao dado sensível de um lead que não cadastrou conseguia colar o
 * número inteiro (ou caçar dígito a dígito) no campo de busca e ver se "bate"
 * — o mesmo dado que /api/v1/contacts nula na resposta, vazando pelo FILTRO em
 * vez do resultado. Mesma exposição via MCP `crm_search_contacts` (handler
 * compartilhado).
 *
 * Este teste é sobre o filtro `.or()` MONTADO, igual a
 * contatos-busca-por-nome-visivel.test.ts — não sobre o que o banco (fake)
 * devolve.
 */
import { describe, expect, it } from "vitest";

import { listContactsHandler } from "@/app/api/v1/contacts/_handler";
import type { Actor } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";

/** Client mínimo que só guarda o filtro `.or()` que o handler montou. */
function supabaseEspiao() {
  const filtros: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    // `.is("is_merged_into", null)` — o upstream passou a esconder da lista o
    // contato já fundido em outro (fusão de 2026-09-07). O espião aprende o
    // método; a regra que ele mede (quem pode buscar por telefone/e-mail/cpf)
    // não muda.
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    contains: () => chain,
    or: (expr: string) => {
      filtros.push(expr);
      return chain;
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  };
  return { client: { from: () => chain } as never, filtros };
}

async function filtroDaBusca(termo: string, actor: Actor): Promise<string> {
  const { client, filtros } = supabaseEspiao();
  await listContactsHandler(client, { organization_id: ORG, actor, requestId: "req" }, {
    search: termo,
    limit: 20,
  });
  return filtros[0] ?? "";
}

describe("busca de contatos — restrição por role (C4)", () => {
  it("agent NÃO busca por telefone/e-mail/cpf — só name/display_name", async () => {
    const filtro = await filtroDaBusca("5531988887777", {
      type: "user",
      id: "u-agent",
      role: "agent",
    });
    expect(filtro).toContain("name.imatch");
    expect(filtro).toContain("display_name.imatch");
    expect(filtro).not.toContain("phone_number.");
    expect(filtro).not.toContain("email.");
    expect(filtro).not.toContain("cpf_hash.eq");
  });

  it("viewer também não busca pelas colunas sensíveis", async () => {
    const filtro = await filtroDaBusca("alguem@example.com", {
      type: "user",
      id: "u-viewer",
      role: "viewer",
    });
    expect(filtro).not.toContain("phone_number.");
    expect(filtro).not.toContain("email.");
  });

  it("manager continua buscando por telefone/e-mail/cpf", async () => {
    const digits11 = "31988887777"; // 11 dígitos → dispara o ramo do cpf_hash
    const filtro = await filtroDaBusca(digits11, { type: "user", id: "u-mgr", role: "manager" });
    expect(filtro).toContain("phone_number.imatch");
    expect(filtro).toContain("email.imatch");
    expect(filtro).toContain("cpf_hash.eq");
  });

  it("admin continua buscando por telefone/e-mail/cpf", async () => {
    const filtro = await filtroDaBusca("+5531988887777", {
      type: "user",
      id: "u-admin",
      role: "admin",
    });
    expect(filtro).toContain("phone_number.imatch");
    expect(filtro).toContain("email.imatch");
  });

  it("ator não-humano (ai_agent) continua buscando por telefone/e-mail — não é o corretor tentando levar o cliente", async () => {
    const filtro = await filtroDaBusca("+5531988887777", {
      type: "ai_agent",
      id: "run-1",
      role: "ai_operator",
    });
    expect(filtro).toContain("phone_number.imatch");
    expect(filtro).toContain("email.imatch");
  });
});
