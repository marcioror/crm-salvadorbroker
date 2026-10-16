/**
 * C3 (revisão final de feat/protecao-contato-corretor): o id composto do WAHA
 * (`{fromMe}_{chatId}_{bareId}`) embute o telefone do contato dentro do
 * `chatId` (`5531988887777@c.us`). `listMessagesHandler` é o caminho da caixa
 * de entrada do próprio corretor (GET /api/v1/conversations/[id]/messages) —
 * sem normalizar, o telefone que /api/v1/contacts protege vazava de volta por
 * um campo que não passa por `protegerContato`.
 *
 * O teste prova a RESPOSTA, não o storage: `bareWaMessageId` (reaproveitado de
 * lib/waha/message-id.ts, o mesmo helper do ingest) só corta a cauda depois do
 * último `_` — então isto é sobre o que o handler DEVOLVE, nunca sobre o que
 * fica gravado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { listMessagesHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const BARE = "3EB0ABCDEF0123456789";
/** Forma que o webhook do WAHA entrega — carrega o telefone dentro do chatId. */
const COMPOSTO = `false_5531988887777@c.us_${BARE}`;

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: ORG,
    conversation_id: CONV,
    channel_session_id: "55555555-5555-4555-8555-555555555555",
    contact_id: "66666666-6666-4666-8666-666666666666",
    external_id: COMPOSTO,
    type: "text",
    direction: "inbound",
    status: "delivered",
    ack: 2,
    error_code: null,
    error_message: null,
    body: "Oi",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "system",
    sent_by_user_id: null,
    sent_at: "2026-08-01T10:00:00Z",
    delivered_at: null,
    read_at: null,
    metadata: {},
    created_at: "2026-08-01T10:00:00Z",
    ...overrides,
  };
}

const TABELAS_VAZIAS = ["conversations", "contacts"];

function fakeSupabase(rows: ReturnType<typeof messageRow>[]) {
  const client = {
    from(table: string) {
      // As consultas que o upstream acrescentou ao caminho (contatos pessoais,
      // spec 21) devolvem vazio: nenhum contato daqui é pessoal.
      if (TABELAS_VAZIAS.includes(table)) {
        const vazio = {
          select: () => vazio, eq: () => vazio, limit: () => vazio, in: () => vazio,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (v: { data: never[]; error: null }) => void) => resolve({ data: [], error: null }),
        };
        return vazio;
      }
      if (table !== "messages") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        or: () => builder,
        then: (resolve: (v: { data: typeof rows; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

function ctx(): HandlerCtx {
  return { organization_id: ORG, actor: { type: "user", id: USER, role: "agent" }, requestId: "req-1" };
}

describe("listMessagesHandler — normalização de external_id (C3)", () => {
  it("devolve o id BARE, sem o chatId que carrega o telefone do contato", async () => {
    const supabase = fakeSupabase([messageRow()]);
    const result = await listMessagesHandler(supabase, ctx(), CONV, { limit: 20 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.external_id).toBe(BARE);
    // Nunca o composto — nem o telefone que ele carrega.
    expect(result.messages[0]?.external_id).not.toContain("5531988887777");
    expect(result.messages[0]?.external_id).not.toContain("@c.us");
  });

  it("external_id nulo (envio ainda em voo) continua nulo", async () => {
    const supabase = fakeSupabase([messageRow({ external_id: null, status: "queued" })]);
    const result = await listMessagesHandler(supabase, ctx(), CONV, { limit: 20 });
    expect(result.messages[0]?.external_id).toBeNull();
  });

  it("id já bare (sem underscore) passa intacto", async () => {
    const supabase = fakeSupabase([messageRow({ external_id: BARE })]);
    const result = await listMessagesHandler(supabase, ctx(), CONV, { limit: 20 });
    expect(result.messages[0]?.external_id).toBe(BARE);
  });

  /**
   * Regressão da fusão com o upstream (terceiro canal, migration 0132): o
   * adapter guarda o `messageId` opaco do provedor, que pode ter `_` e NÃO
   * carrega telefone. O corte cego pelo último `_` — que é o que a primeira
   * versão fazia — devolvia na resposta um id que não existe no provedor, sem
   * esconder nada em troca. Só a forma composta do WAHA (miolo com `@`) é que
   * tem telefone dentro para esconder.
   */
  it("id de canal que não é WAHA passa intacto, mesmo tendo underscore", async () => {
    const OPACO = "msg_01HXY_9f3a2b";
    const supabase = fakeSupabase([messageRow({ external_id: OPACO })]);
    const result = await listMessagesHandler(supabase, ctx(), CONV, { limit: 20 });
    expect(result.messages[0]?.external_id).toBe(OPACO);
  });
});
