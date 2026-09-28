/**
 * E2E do módulo de Imóveis (Task 14 — verificação final da spec de módulo).
 *
 * Cenário (agent do seed E2E): cadastra um imóvel pela tela (exercitando de
 * verdade os dois `Select` de Tipo/Finalidade — nenhuma task anterior do plano
 * clicou neles num browser real), cria um lead novo pelo `NewLeadDialog` do
 * Kanban (a org de teste não tem lead "de sobra" garantido, e reaproveitar o
 * lead fixo do `seed-e2e-kanban.ts` acumularia atividade entre execuções e
 * arriscaria a timeline colapsar o item novo num bloco de dia — ver
 * `lib/leads/timeline-grouping.ts`; um lead fresco por execução evita o
 * problema por construção), abre o dossiê, vincula o imóvel recém-criado,
 * confere que o vínculo aparece nos DOIS lados (lead→imóvel e imóvel→lead) e
 * que a timeline do lead registra a atividade. Fecha conferindo que VIEWER
 * não vê o botão "Novo imóvel".
 *
 * Self-contido: títulos com sufixo de timestamp. Limpa o vínculo e desativa o
 * imóvel criado ao final (try/finally) — o DELETE de
 * `/api/v1/properties/[id]` é soft (marca `status=inactive`, não apaga a
 * linha; ver `app/api/v1/properties/[id]/route.ts`). O lead criado NÃO é
 * apagado: não existe `DELETE /api/v1/leads/[id]` na API (leads não são
 * deletáveis por design), mesmo racional do `LEAD_NAME` nunca limpo em
 * `webhooks.spec.ts`.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page, type Locator } from "./helpers/test";

const APP_URL = `http://localhost:${process.env.E2E_PORT ?? "3001"}`;
const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
  kanban?: { pipeline_id: string };
}

// Mesmo padrão de auto-seed do kanban-owner-filter.spec.ts: garante
// credenciais base + o pipeline seedado antes de rodar (spec não pode
// depender de alguém ter rodado os scripts manualmente antes). Só o
// `pipeline_id` é reaproveitado do seed de kanban — o lead é criado do zero
// nesta spec (ver cabeçalho do arquivo).
function loadCreds(): Creds {
  const needsBase = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    return !c.users?.agent || !c.users?.viewer;
  };
  if (needsBase()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  let c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!c.kanban?.pipeline_id) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-kanban.ts"], { stdio: "inherit" });
    c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  return c;
}

const creds = loadCreds();

async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${APP_URL}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//);
}

async function selectOption(page: Page, combobox: Locator, optionName: string): Promise<void> {
  await combobox.click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });

/**
 * O caminho até Imóveis passa pelo HUB do grupo CRM, não pelo menu lateral.
 *
 * `lib/navigation/catalogo-local.ts` declara este destino SEM `sidebar`, e é
 * decisão, não esquecimento: o menu está no limite medido (`navegacao.spec.ts`
 * exige que ele caiba sem rolagem em 900px) e o próprio upstream já tirou
 * Prospecção de lá pelo mesmo motivo. Enquanto a issue #1290 do upstream não
 * entra, a porta é o hub ("Ver tudo em CRM") e o ⌘K.
 *
 * Percorrer o caminho INTEIRO, como `navegacao.spec.ts` faz com Produtos, é o
 * que prova que tirar do menu não virou tela órfã. Clicar num link "Imóveis"
 * que não existe mais dava `TimeoutError` sem dizer nada sobre a tela.
 */
async function irParaImoveis(page: Page): Promise<void> {
  await sidebar(page).getByRole("link", { name: "Ver tudo em CRM" }).click();
  await page.waitForURL(/\/app\/crm$/);
  await page.getByRole("link", { name: /Imóveis/ }).click();
  await page.waitForURL(/\/app\/properties/);
}

test.describe("módulo de imóveis — fluxo completo", () => {
  test.setTimeout(180_000);
  test.use({ actionTimeout: 10_000 });

  test("agent cadastra imóvel, cria lead, vincula os dois, timeline reflete, viewer sem botão de criar", async ({
    page,
    browser,
  }) => {
    const ts = Date.now();
    const propertyTitle = `Casa E2E ${ts}`;
    const leadTitle = `Lead E2E Imóveis ${ts}`;
    let createdPropertyId: string | undefined;
    let createdLeadId: string | undefined;
    let linked = false;

    try {
      await login(page, creds.users.agent!.email);

      // --- 1. Cadastrar imóvel pela tela, exercitando os dois Select de verdade ---
      await irParaImoveis(page);
      await page.getByRole("button", { name: "Novo imóvel" }).click();
      const createDialog = page.getByRole("dialog");
      await expect(createDialog).toBeVisible();
      await createDialog.locator("#title").fill(propertyTitle);
      // Tipo: default é "Apartamento" — troca pra "Casa" pra provar que o
      // Select realmente muda o valor submetido (nunca exercitado num browser
      // real antes desta task, por achado das tasks anteriores do plano).
      await selectOption(page, createDialog.getByRole("combobox").nth(0), "Casa");
      // Finalidade: default é "Venda" — troca pra "Locação".
      await selectOption(page, createDialog.getByRole("combobox").nth(1), "Locação");

      const [createRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/v1/properties") && r.request().method() === "POST",
        ),
        createDialog.getByRole("button", { name: "Cadastrar imóvel" }).click(),
      ]);
      expect(createRes.ok()).toBeTruthy();
      const createBody = (await createRes.json()) as { data: { id: string } };
      createdPropertyId = createBody.data.id;
      // Não assertamos o toast "Imóvel cadastrado" diretamente: contra o
      // Supabase remoto real, o toast do sonner some (auto-dismiss ~4s) antes
      // do próximo poll do Playwright em runs mais lentos — visto na prática
      // com o toast irmão "Lead criado" mais abaixo (9 polls, sempre "hidden").
      // A prova de que a criação funcionou é o card novo na grade (estado
      // durável), não o toast (transiente); checamos isso a seguir.
      //
      // Criar NÃO navega automaticamente pro detalhe (useCreateProperty só
      // invalida a query da lista) — o card novo aparece na grade e a
      // navegação real é clicar nele, não um waitForURL especulativo (o
      // rascunho da task assumia redirect automático; não existe).
      const newCard = page.getByRole("link").filter({ hasText: propertyTitle });
      await expect(newCard).toBeVisible({ timeout: 15_000 });
      await newCard.click();
      await page.waitForURL(new RegExp(`/app/properties/${createdPropertyId}$`));
      await expect(page.getByRole("heading", { name: propertyTitle, level: 1 })).toBeVisible();
      // Prova que os dois Select persistiram o valor escolhido, não o default.
      // Rótulo em pt-BR (não o enum cru "house"/"rent") — Task 15 trocou a
      // tela de detalhe pra usar PROPERTY_TYPE_LABEL/PROPERTY_PURPOSE_LABEL
      // (lib/types/properties.ts); a asserção acompanha o rótulo exibido, e
      // ainda prova o round-trip: se caísse no default ("apartment"/"sale")
      // apareceria "Apartamento"/"Venda", não "Casa"/"Locação".
      await expect(page.locator("dd", { hasText: /^Casa$/ })).toBeVisible();
      await expect(page.locator("dd", { hasText: /^Locação$/ })).toBeVisible();

      // --- 2. Criar um lead novo no pipeline seedado e abrir o dossiê ---
      await page.goto(`${APP_URL}/app/pipelines/${creds.kanban!.pipeline_id}`);
      // O seletor de contato do diálogo busca a lista ao abrir, e quando ela
      // chega o formulário cresce e empurra o botão "Criar lead" para baixo.
      // Visto na v1.61.0: a lista chegou 90 ms antes do clique, o clique caiu
      // onde o botão ESTAVA, e nenhum POST saiu. Esperar a lista tira a corrida.
      const contatosDoSeletor = page.waitForResponse(
        (r) => r.url().includes("/api/v1/contacts") && r.request().method() === "GET",
      );
      await page.getByRole("button", { name: "Novo Lead" }).click();
      await contatosDoSeletor;
      const newLeadDialog = page.getByRole("dialog").filter({ hasText: "Novo Lead" });
      await expect(newLeadDialog).toBeVisible();
      await newLeadDialog.locator("#title").fill(leadTitle);
      const submitLead = newLeadDialog.getByRole("button", { name: "Criar lead" });
      await expect(submitLead).toBeEnabled();

      const [leadRes] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/v1/leads") && r.request().method() === "POST",
        ),
        submitLead.click(),
      ]);
      expect(leadRes.ok()).toBeTruthy();
      const leadBody = (await leadRes.json()) as { data: { id: string } };
      createdLeadId = leadBody.data.id;
      // Prova durável de que a criação foi processada pelo cliente (não só
      // pelo servidor): o diálogo fecha (onSubmit chama onOpenChange(false)
      // só depois do mutateAsync resolver). Não assertamos o toast "Lead
      // criado" — contra o Supabase remoto real ele chegou a aparecer e sumir
      // (auto-dismiss do sonner, ~4s) antes do primeiro poll do Playwright
      // neste ambiente (9 tentativas, sempre "hidden"); flake de timing da
      // biblioteca de toast, não do fluxo em si.
      await expect(newLeadDialog).toBeHidden();

      await page.getByRole("button", { name: leadTitle }).click();
      await expect(page.getByText("Imóveis de interesse")).toBeVisible();
      await expect(page.getByText("Nenhum imóvel vinculado ainda.")).toBeVisible();

      // --- 3. Vincular o imóvel recém-criado ao lead recém-criado ---
      const dossier = page.getByRole("dialog");
      await dossier.getByRole("button", { name: "Vincular" }).click();
      const linkDialog = page.getByRole("dialog").filter({ hasText: "Vincular imóvel" });
      await expect(linkDialog).toBeVisible();
      await linkDialog.getByPlaceholder("Buscar imóvel pelo título...").fill(propertyTitle);

      const [linkRes] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().includes(`/api/v1/properties/${createdPropertyId}/leads`) &&
            r.request().method() === "POST",
        ),
        linkDialog.getByText(propertyTitle).first().click(),
      ]);
      expect(linkRes.ok()).toBeTruthy();
      linked = true;

      // --- 4. Confere os DOIS lados do vínculo concordam ---
      // Lado do lead: "Imóveis de interesse" mostra o imóvel.
      await expect(page.getByRole("link", { name: propertyTitle })).toBeVisible();

      // Timeline do lead reflete o vínculo (realtime; rótulo real de
      // activity-vocabulary.ts, não "imóvel vinculado" como o rascunho supunha).
      await expect(page.getByText("Vinculado a um imóvel")).toBeVisible({ timeout: 15_000 });

      // Lado do imóvel: "Leads interessados" mostra o lead.
      await page.goto(`${APP_URL}/app/properties/${createdPropertyId}`);
      await expect(page.getByText("Leads interessados")).toBeVisible();
      await expect(page.getByText(leadTitle)).toBeVisible();

      // --- 5. viewer não vê o botão de criar ---
      const viewerEmail = creds.users.viewer?.email;
      if (viewerEmail) {
        const viewerContext = await browser.newContext();
        const viewerPage = await viewerContext.newPage();
        try {
          await login(viewerPage, viewerEmail);
          await irParaImoveis(viewerPage);
          // A lista continua visível pro viewer (permissão "viewer" no GET) —
          // só o botão de criar (POST exige "agent") deve sumir.
          await expect(viewerPage.getByRole("heading", { name: "Imóveis" })).toBeVisible();
          await expect(viewerPage.getByRole("button", { name: "Novo imóvel" })).toHaveCount(0);
        } finally {
          await viewerContext.close();
        }
      } else {
        test.info().annotations.push({
          type: "skip-parcial",
          description: "usuário viewer de teste não seedado — verificação de RBAC pulada",
        });
      }
    } finally {
      // Nunca deixa uma falha de cleanup mascarar o erro real do bloco try.
      try {
        if (linked && createdPropertyId && createdLeadId) {
          await page.request
            .delete(`${APP_URL}/api/v1/properties/${createdPropertyId}/leads/${createdLeadId}`)
            .catch(() => undefined);
        }
        if (createdPropertyId) {
          await page.request.delete(`${APP_URL}/api/v1/properties/${createdPropertyId}`).catch(() => undefined);
        }
      } catch (cleanupErr) {
        console.error("[cleanup] falhou (não mascara o erro do teste):", cleanupErr);
      }
    }
  });
});
