/**
 * Proteção de telefone no contato embutido em conversas — ver
 * docs/superpowers/specs/2026-08-09-protecao-contato-corretor-design.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  listConversationsHandler,
  getConversationHandler,
  patchConversationHandler,
} from "@/app/api/v1/conversations/_handler";
import type { HandlerCtx, Actor } from "@/lib/api/handlers/types";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CRIADOR = "22222222-2222-4222-8222-222222222222";
const OUTRO_USER = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV_ID,
    organization_id: ORG,
    contact_id: "contact-1",
    channel_session_id: "session-1",
    channel: "whatsapp",
    status: "open",
    status_changed_at: "2026-01-01T00:00:00Z",
    assigned_to_user_id: null,
    assignee_kind: null,
    assigned_at: null,
    last_inbound_at: "2026-01-01T00:00:00Z",
    last_outbound_at: null,
    last_message_at: "2026-01-01T00:00:00Z",
    last_message_preview: "oi",
    unread_count_for_assignee: 0,
    is_group: false,
    group_chat_id: null,
    tags: [],
    metadata: {},
    snooze_until: null,
    bot_silenced_until: null,
    last_handoff_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    contacts: {
      id: "contact-1",
      display_name: "Maria",
      name: null,
      phone_number: "+5531988887777",
      is_anonymized: false,
      tags: [],
      is_blocked: false,
      avatar_storage_path: null,
      force_human: false,
      created_by_user_id: CRIADOR,
    },
    ...overrides,
  };
}

function makeSupabase(rows: ReturnType<typeof conversationRow>[]) {
  const client = {
    from(table: string) {
      if (table !== "conversations") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        ilike: () => builder,
        contains: () => builder,
        not: () => builder,
        is: () => builder,
        or: () => builder,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: typeof rows; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

function ctxFor(actor: Actor): HandlerCtx {
  return { organization_id: ORG, actor, requestId: "req-1" };
}

describe("listConversationsHandler — proteção do telefone embutido", () => {
  it("agent que não cadastrou o contato recebe telefone nulo na conversa", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await listConversationsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      // `comando` entrou na v1.16 (migration 0203, "comando da conversa") e,
      // como `status`, é um `.transform()`: a saída do zod infere a chave como
      // OBRIGATÓRIA podendo valer `undefined` — diferente de `.optional()`.
      // Omitir não compila. Mesma pegadinha da fusão de 2026-08-26, e de novo
      // com `tag` na v1.73.0.
      { status: undefined, comando: undefined, tag: undefined, limit: 20 },
    );
    const conv = result.conversations[0] as unknown as { contacts: { phone_number: string | null; contact_protected: boolean } };
    expect(conv.contacts.phone_number).toBeNull();
    expect(conv.contacts.contact_protected).toBe(true);
  });

  it("manager vê o telefone normalmente", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await listConversationsHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "manager" }),
      // `comando` entrou na v1.16 (migration 0203, "comando da conversa") e,
      // como `status`, é um `.transform()`: a saída do zod infere a chave como
      // OBRIGATÓRIA podendo valer `undefined` — diferente de `.optional()`.
      // Omitir não compila. Mesma pegadinha da fusão de 2026-08-26, e de novo
      // com `tag` na v1.73.0.
      { status: undefined, comando: undefined, tag: undefined, limit: 20 },
    );
    const conv = result.conversations[0] as unknown as { contacts: { phone_number: string | null } };
    expect(conv.contacts.phone_number).toBe("+5531988887777");
  });
});

describe("getConversationHandler — proteção do telefone embutido", () => {
  it("agent que cadastrou o próprio contato vê o telefone", async () => {
    const supabase = makeSupabase([conversationRow()]);
    const result = await getConversationHandler(
      supabase,
      ctxFor({ type: "user", id: CRIADOR, role: "agent" }),
      CONV_ID,
    );
    const conv = result as unknown as { contacts: { phone_number: string | null } };
    expect(conv.contacts.phone_number).toBe("+5531988887777");
  });
});

/**
 * Encadeamento livre: o PATCH monta `update(...).select(...).eq().eq()` quando há
 * campo para gravar e `from(...).select(...)` quando não há, e a ordem dos elos
 * mudou de lugar na v1.41.0. Um dublê em forma de árvore fixa quebra a cada
 * reordenação sem que nada de comportamento tenha mudado — este devolve o mesmo
 * elo para tudo e resolve no `maybeSingle`.
 */
function makeSupabaseForPatch(updatedRow: ReturnType<typeof conversationRow>) {
  const elo: Record<string, unknown> = {
    update: () => elo,
    select: () => elo,
    eq: () => elo,
    maybeSingle: async () => ({ data: updatedRow, error: null }),
  };
  const client = {
    // Assumir passa por `fn_conversation_assign` — é ela que cala o automático
    // na conversa. Aqui só precisa não explodir: o que este arquivo mede é o
    // telefone da conversa DEVOLVIDA, depois do update.
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      if (table !== "conversations") throw new Error(`fake_supabase: tabela inesperada '${table}'`);
      return elo;
    },
  };
  return client as unknown as SupabaseClient;
}

describe("patchConversationHandler — proteção do telefone embutido", () => {
  it("agent que não cadastrou o contato recebe telefone nulo na conversa retornada pelo PATCH", async () => {
    const supabase = makeSupabaseForPatch(conversationRow());
    const result = await patchConversationHandler(
      supabase,
      ctxFor({ type: "user", id: OUTRO_USER, role: "agent" }),
      CONV_ID,
      // `tags` e não `status`: desde a v1.41.0 mudar o status sai da tabela e vai
      // para DUAS rpc — `fn_conversation_assign` no client da sessão e
      // `fn_service_status` no client de SERVIÇO, criado dentro do handler. Medir
      // a proteção por ali obrigaria a mockar o módulo do admin e faria este
      // arquivo depender da máquina de estado da conversa, que ele não mede.
      // O que importa aqui é o caminho de escrita + leitura de volta, e `tags` o
      // percorre inteiro.
      { tags: ["quente"] },
    );
    const conv = result as unknown as { contacts: { phone_number: string | null; contact_protected: boolean } };
    expect(conv.contacts.phone_number).toBeNull();
    expect(conv.contacts.contact_protected).toBe(true);
  });
});
