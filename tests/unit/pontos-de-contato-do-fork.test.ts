import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * OS PONTOS EM QUE ESTE FORK ENCOSTA NO UPSTREAM — E O ALARME DE QUANDO UM SOME.
 *
 * O módulo de imóveis é quase todo arquivo novo, e arquivo novo não conflita com
 * ninguém. O risco mora no punhado de linhas que vive DENTRO de arquivo do
 * upstream: elas somem numa fusão SEM CONFLITO NENHUM, porque o lado de lá
 * reescreve o arquivo inteiro e o git aceita em silêncio. O sintoma aparece
 * longe da causa (tela sem menu, e2e reprovando por tabela ausente, imagem
 * publicada no namespace errado), quando a fusão já está a dez commits daqui.
 *
 * Este arquivo é o alarme. Cada caso abaixo é um ponto de contato, com a
 * mensagem dizendo o que repor e onde está a explicação. Reprovar aqui NÃO é
 * defeito de código: é uma fusão que comeu uma linha nossa.
 *
 * O mapa em prosa, com o porquê de cada escolha e o número que a sustenta, está
 * em `docs/fork/pontos-de-contato.md`. Este teste é a versão que ninguém
 * esquece de ler.
 *
 * ⚠️ QUEM ACRESCENTAR UM PONTO DE CONTATO NOVO acrescenta um caso aqui, no mesmo
 * commit. Ponto de contato não registrado é exatamente o que este arquivo
 * existe para impedir.
 */

const RAIZ = process.cwd();
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

/** Ponto de contato: arquivo do upstream que precisa conter uma marca nossa. */
interface Contato {
  arquivo: string;
  marca: string;
  oQueE: string;
  seSumir: string;
}

const CONTATOS: Contato[] = [
  {
    arquivo: "lib/navigation/catalogo.ts",
    marca: "NAV_CATALOG_LOCAL",
    oQueE: "o spread que junta os destinos desta casa ao catálogo do produto",
    seSumir:
      "reponha o import de `./catalogo-local` e o bloco `export const NAV_CATALOG = [...NAV_CATALOG_BASE, ...NAV_CATALOG_LOCAL]` no fim do arquivo. Sem isso a tela de Imóveis continua existindo e respondendo por URL, e some da navegação inteira, inclusive do ⌘K.",
  },
  {
    arquivo: "components/kanban/LeadDossier.tsx",
    marca: "LeadInterestedProperties",
    oQueE: "o bloco de imóveis de interesse dentro do dossiê do lead",
    seSumir:
      "reponha o import e o `<LeadInterestedProperties leadId={lead.id} />` logo depois do bloco de interesses. Sem isso o vínculo lead↔imóvel continua no banco e some da tela.",
  },
  {
    arquivo: "lib/schemas/index.ts",
    marca: "./properties",
    oQueE: "o re-export dos schemas de imóveis",
    seSumir:
      'reponha `export * from "./properties";`. Sem isso o build da IMAGEM quebra em "propertyCreateSchema doesn\'t exist in target module" — e não o typecheck, porque quem reclama é o bundler.',
  },
  {
    arquivo: "scripts/test-db.sh",
    marca: "aplicar_sql_local_no_molde",
    oQueE: "a chamada que põe o SQL desta casa no banco-molde dos invariantes",
    seSumir:
      "reponha o `source` de `scripts/local-no-molde.sh` no topo e a chamada de `aplicar_sql_local_no_molde` dentro de `aplicar_baseline()`. A aplicação mora no arquivo separado de propósito: `test-db-aplica-o-baseline-num-lugar-so.test.ts` exige que a única linha deste script que alimenta o psql com arquivo seja a do baseline.",
  },
  {
    arquivo: ".github/workflows/e2e.yml",
    marca: "supabase/local",
    oQueE: "o passo que aplica o SQL desta casa no banco do e2e",
    seSumir:
      "reponha o passo `Aplicar o supabase/local`, logo depois do passo do baseline. A instalação real aplica os dois, e o e2e existe justamente para ser igual à instalação real.",
  },
  {
    arquivo: ".github/workflows/e2e.yml",
    marca: "properties.spec.ts",
    oQueE: "a spec do módulo na lista da parte 1 do e2e",
    seSumir:
      "reponha `properties.spec.ts` na lista da parte 1. O gate `e2e-cobertura-completa` pega a ausência, mas o sintoma dele aponta para a lista, não para a fusão que a reescreveu.",
  },
  {
    arquivo: "hostgator-setup-kit/_common.sh",
    marca: 'IMG_NS="ghcr.io/marcioror"',
    oQueE: "o namespace das imagens desta instalação",
    seSumir:
      "reponha o namespace. Com o do upstream, a VPS passa a puxar a imagem DELE: o CRM sobe igual, sem o módulo de imóveis e sem a proteção de contato, e nada no log diz isso.",
  },
  {
    arquivo: "hostgator-setup-kit/_common.sh",
    marca: "aplicar_sql_local",
    oQueE: "a função que aplica `supabase/local/*.sql` depois do baseline",
    seSumir:
      "reponha a função. Sem ela o install e o update deixam de criar (ou de atualizar) as tabelas de imóveis, e o app sobe com a tela apontando para tabela que não existe.",
  },
  {
    arquivo: "hostgator-setup-kit/install.sh",
    marca: "aplicar_sql_local",
    oQueE: "a chamada do SQL local na instalação nova e na reinstalação",
    seSumir: "reponha as duas chamadas, uma em cada ramo: banco novo e schema já existente.",
  },
  {
    arquivo: "hostgator-setup-kit/update.sh",
    marca: "aplicar_sql_local",
    oQueE: "a chamada do SQL local na atualização",
    seSumir:
      "reponha a chamada logo depois do bloco do baseline. Sem ela, versão nova do módulo nunca alcança o banco de quem já tem a instalação de pé.",
  },
  {
    arquivo: "lib/audit/actions.ts",
    marca: '"property.created"',
    oQueE: "os sete verbos de auditoria do módulo de imóveis",
    seSumir:
      "reponha o bloco `property.*` na lista de ações. Sem ele o typecheck reprova em sete rotas de uma vez, com `TS2322` dizendo que o verbo não pertence ao tipo.",
  },
  {
    arquivo: "lib/leads/activity-vocabulary.ts",
    marca: "property_linked",
    oQueE: "os rótulos de vínculo e desvínculo de imóvel na linha do tempo do lead",
    seSumir:
      "reponha `property_linked` e `property_unlinked`, no tipo e no mapa de rótulos. Sem eles a timeline mostra o texto genérico para todo vínculo de imóvel, e o typecheck reprova na rota que grava a atividade.",
  },
  {
    arquivo: ".github/workflows/release.yml",
    marca: "ha-app-de-release",
    oQueE: "o job que pula o corte de release quando não há App de release configurado",
    seSumir:
      "reponha o job e a condição nos dois jobs seguintes. Sem isso, todo merge na main manda um e-mail de falha para sempre, por um workflow que não tinha trabalho a fazer aqui.",
  },
  {
    arquivo: "tests/unit/gatilho-dos-jobs-de-entrega.test.ts",
    marca: "configurado == 'sim'",
    oQueE: "o mapa de gatilhos declarando a condição de release desta casa",
    seSumir:
      "reponha as três entradas com a condição do fork. Elas NÃO vão para o upstream num PR: lá desligariam a cadeia que atualiza o parque instalado inteiro.",
  },
  {
    arquivo: "app/api/v1/contacts/_handler.ts",
    marca: "protegerContato",
    oQueE: "a proteção aplicada em list/get/create/patch de contato",
    seSumir:
      "reponha as chamadas de `protegerContato` e o 403 `contact_protected` no patch. Sem elas o telefone volta a sair cru na API de contatos.",
  },
  {
    arquivo: "app/api/v1/conversations/_handler.ts",
    marca: "protegerConversaComContato",
    oQueE: "a proteção no contato embutido da conversa",
    seSumir:
      "reponha `protegerConversaComContato` em list/get/patch e o `created_by_user_id` no embed.",
  },
  {
    arquivo: "app/api/v1/messages/_handler.ts",
    marca: "comExternalIdNormalizado",
    oQueE: "o external_id que não carrega telefone",
    seSumir:
      "reponha `comExternalIdNormalizado` no retorno de `listMessagesHandler`: o id cru do WAHA embute o número.",
  },
  {
    arquivo: "lib/escalacao/chamados.ts",
    marca: "podeVerContatoSensivel",
    oQueE: "a proteção na fila de casos, que lê com service role",
    seSumir:
      "reponha o `actor` no opts e a marcação `contact_protected`. Esta leitura ignora RLS, então sem o ator o telefone sai para qualquer atendente.",
  },
  {
    arquivo: "lib/crm-b2b/people-handler.ts",
    marca: "protegerContato(c, ctx.actor)",
    oQueE: "a proteção na ficha da pessoa (CRM B2B) e no vínculo contato↔pessoa",
    seSumir:
      "reponha `protegerContato` nos contatos de `getPersonHandler` e `protegerTelefoneDoContatoEmbutido` no retorno de `linkContactToPersonHandler`, com `created_by_user_id` nos dois selects. Sem isso, /api/v1/people/:id devolve telefone e e-mail a qualquer viewer.",
  },
  {
    arquivo: "components/kanban/NewLeadDialog.tsx",
    marca: 'className="max-h-[90vh] overflow-y-auto"',
    oQueE: "o diálogo de lead novo que cabe numa tela de 720 px",
    seSumir:
      "reponha a classe no `DialogContent`. Sem ela, com a lista do seletor de contato aberta, o botão \"Criar lead\" fica fora da tela e o properties.spec reprova em waitForResponse. Se o upstream corrigir do jeito dele, este ponto sai.",
  },
  {
    arquivo: "app/api/v1/contacts/duplicates/route.ts",
    marca: 'requireRole("manager"',
    oQueE: "o gate manager na lista de duplicados, cuja chave é o telefone",
    seSumir:
      "reponha `requireRole(\"manager\", ...)` no GET. O upstream libera para viewer via `orgAtivaDaApi`, e a `chave` do agrupamento é o telefone normalizado: mascarar campo não adianta. Ajuste junto o controle positivo de tests/unit/api-nao-redireciona-org-suspensa.test.ts (19 nesta casa).",
  },
  {
    arquivo: "scripts/conferir-isolamento-do-kit.sh",
    marca: "https://github.com/melgarafael/DeskcommCRM.git",
    oQueE: "a tag fixa v1.63.0 buscada no upstream quando o origin não a tem",
    seSumir:
      "reponha o `|| git fetch ... https://github.com/melgarafael/DeskcommCRM.git` em `update_sh_da`. O origin daqui só publica tags `-sb`, e sem o segundo endereço o job invariants reprova em \"couldn't find remote ref refs/tags/v1.63.0\".",
  },
  {
    arquivo: "tests/unit/busca-de-contatos-normaliza-termo.test.ts",
    marca: 'expect(colunas).toEqual(["name", "display_name"]);',
    oQueE: "o teste de injeção na busca medindo o OR sem telefone e e-mail",
    seSumir:
      "o upstream espera quatro colunas porque não tem o portão `podeBuscarPorDadoSensivel` de contacts/_handler.ts. Com ator sem papel, aqui são só `name` e `display_name`; não ponha o telefone de volta no OR para o teste passar.",
  },
  {
    arquivo: "supabase/local/imoveis.sql",
    marca: "public.fn_is_platform_admin_full()",
    oQueE: "a escrita de imóveis fechada ao suporte só leitura",
    seSumir:
      "a policy `_agent_write` de properties e properties_media volta a usar `fn_is_platform_admin_full()`. Com a função pura, o escopo `support_readonly` escreve no cadastro, e o invariante platform-admin-full-so-escreve reprova.",
  },
  {
    arquivo: "tests/unit/api-nao-redireciona-org-suspensa.test.ts",
    marca: ".toBeGreaterThanOrEqual(19)",
    oQueE: "o controle positivo da cerca de org suspensa, um a menos pela rota de duplicados",
    seSumir:
      "se o upstream subir o número, desconte a rota `contacts/duplicates`, que nesta casa usa `requireRole(\"manager\")` e não `orgAtivaDaApi`.",
  },
  {
    arquivo: "lib/reports/atividades.ts",
    marca: "podeVerContatoSensivel",
    oQueE: "a proteção no relatório de atividades",
    seSumir:
      "reponha o campo obrigatório em `ContextoDoRelatorio`. Ele é obrigatório de propósito: chamador novo vira erro de compilação em vez de vazamento silencioso.",
  },
  {
    arquivo: "lib/leads/nascimento-do-lead.ts",
    marca: "nomeDoContato(contato)",
    oQueE: "o título do lead que não grava telefone",
    seSumir:
      "reponha `nomeDoContato` no lugar de `rotuloDoContato`. O título é texto plano devolvido a qualquer viewer: telefone gravado ali não tem como ser mascarado depois.",
  },
  {
    arquivo: "lib/automation/actions/create-or-move-lead.ts",
    marca: "SEM FALLBACK PARA O TELEFONE",
    oQueE: "o título do lead da automação sem telefone",
    seSumir:
      "apague o `?? contact.phone_number` do `title`. Mesmo motivo do anterior.",
  },
  {
    arquivo: "scripts/cortar-release.ts",
    marca: "proximaVersaoDaCasa",
    oQueE: "a numeração desta casa, que não rouba o número do upstream",
    seSumir:
      "reponha `proximaVersaoDaCasa(changelog)` no lugar de `proximaVersao(base, bump)`. Sem isso o próximo corte publica `1.41.1` (ou a que o bump mandar), que é o número que o upstream vai lançar na semana seguinte — e as duas passam a conviver no mesmo `git tag` de quem sincroniza.",
  },
  {
    arquivo: "lib/release/cabe-na-tela.ts",
    marca: "(?:-[a-z]+",
    oQueE: "a guarda da tela da VPS reconhecendo a série desta casa",
    seSumir:
      "reponha o sufixo opcional no teste de `versao` dentro de `fatiar` (o upstream moveu a função do teste para cá na v1.45.0, e a fusão trouxe a regex sem o sufixo). Sem ele a seção desta casa é lida como `[Não lançado]`, e a guarda mede a seção do upstream logo abaixo — reprovando por um corte de 30 KB que não é o do nosso operador.",
  },
  {
    arquivo: "components/contacts/ContactsTable.tsx",
    marca: "ContatoProtegido",
    oQueE: "o cadeado no lugar do telefone e do e-mail na lista",
    seSumir:
      "reponha o `<ContatoProtegido>` nas duas células. A API já protege; sem isto a tela mostra vazio sem dizer por quê.",
  },
  {
    arquivo: "app/api/v1/contacts/route.ts",
    marca: "role: authz.org.role",
    oQueE: "o papel no ator, que é o que a regra lê",
    seSumir:
      "reponha o `role` no ator do ramo de cookie de `resolveContactsAuth`. Sem papel, `podeVerContatoSensivel` trata todo mundo como corretor comum.",
  },
  {
    arquivo: "lib/agent-engine/edge/crm/drain.ts",
    marca: "knobs.debounceTetoMs",
    oQueE: "o teto da janela deslizante passado a `decidirRajada`",
    seSumir:
      "passe `knobs.debounceTetoMs` como quinto argumento de `decidirRajada`. Sem ele o módulo cai no ramo ancorado do upstream e o agente volta a responder bolha por bolha (issue #196).",
  },
  {
    arquivo: "lib/agent-engine/edge/crm/debounce.ts",
    marca: "SQL_ESTENDER_JANELA",
    oQueE: "a janela deslizante com teto na coalescência da rajada",
    seSumir:
      "reponha `estenderJanelaDoJob` (o `update … greatest/least` com a condição `not (payload ? 'held_run_after')` do upstream) e o parâmetro `tetoMs` de `decidirRajada`. Os dois consertos vivem na mesma query e nenhum substitui o outro. Quem mede é `debounce.casa.test.ts`.",
  },
];

describe("pontos de contato do fork com o upstream", () => {
  it("o inventário não está vazio (guarda de vacuidade)", () => {
    expect(CONTATOS.length).toBeGreaterThan(5);
  });

  it.each(CONTATOS)("$arquivo mantém: $oQueE", ({ arquivo, marca, oQueE, seSumir }) => {
    expect(existsSync(join(RAIZ, arquivo)), `${arquivo} não existe`).toBe(true);
    expect(
      ler(arquivo).includes(marca),
      [
        `PONTO DE CONTATO PERDIDO em ${arquivo}: ${oQueE}.`,
        "",
        "Isto quase sempre é uma fusão com o upstream que reescreveu o arquivo e levou a linha",
        "junto, sem conflito nenhum para avisar.",
        "",
        `O que fazer: ${seSumir}`,
        "",
        "Mapa completo: docs/fork/pontos-de-contato.md",
      ].join("\n"),
    ).toBe(true);
  });

  /**
   * O contrário dos casos acima: o schema desta casa NÃO volta para dentro do
   * baseline. Foi de lá que ele saiu, e o motivo está medido no documento: 729
   * commits do upstream naquele arquivo em duas semanas.
   */
  it("o baseline do upstream continua sem o schema desta casa", () => {
    expect(
      ler("supabase/baseline.sql").includes("create table if not exists public.properties"),
      [
        "O schema de imóveis voltou para dentro do `supabase/baseline.sql`.",
        "",
        "Ele mora em `supabase/local/imoveis.sql` de propósito: o baseline é o arquivo mais quente",
        "do upstream, e resolver conflito à mão num dump de schema é a maneira mais fácil de perder",
        "uma policy de isolamento sem ninguém perceber.",
        "",
        "Tire daqui e ponha lá, ou atualize este teste com a razão escrita.",
      ].join("\n"),
    ).toBe(false);
  });

  /**
   * E a regra que sobra dessa escolha: migration `9xxx` cria objeto NOSSO.
   * Objeto do upstream que precise de ajuste é ajustado no SQL local, porque a
   * cadeia é comparada com o baseline dele por outro gate.
   */
  it("as migrations desta casa não redefinem objeto do upstream", () => {
    const suspeitas = ["crm_lead_links", "contacts", "conversations", "messages"];
    const nossas = [
      "20260807000000_9001_properties.sql",
      "20260807230000_9002_property_media_bucket_size.sql",
      "20260814100000_9004_properties_rbac.sql",
    ];
    for (const arquivo of nossas) {
      const caminho = join("supabase", "migrations", arquivo);
      if (!existsSync(join(RAIZ, caminho))) continue;
      const sql = ler(caminho)
        .split("\n")
        .filter((linha) => !linha.trim().startsWith("--"))
        .join("\n");
      for (const alvo of suspeitas) {
        const altera =
          sql.includes(`alter table ${alvo}`) || sql.includes(`alter table public.${alvo}`);
        expect(
          altera,
          [
            `A migration ${arquivo} altera \`${alvo}\`, que é objeto do upstream.`,
            "",
            "A cadeia de migrations é comparada com o `baseline.sql` dele por",
            "`check-do-baseline-nao-diverge-da-cadeia.test.ts`: a mesma constraint passaria a aceitar",
            "valores diferentes conforme o caminho, e aquele gate reprova com razão.",
            "",
            "Ajuste de objeto do upstream vai em `supabase/local/imoveis.sql`, nunca na cadeia.",
          ].join("\n"),
        ).toBe(false);
      }
    }
  });
});
