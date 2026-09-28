/**
 * A CASCA CABE NO CELULAR — issue upstream #203, medida num browser real.
 *
 * ## O defeito
 *
 * A barra lateral era `w-60` fixa com `ml-60` no conteúdo, e o arquivo não tinha
 * NENHUM breakpoint. Em 390px (iPhone 14/15, a resolução mais comum) ela comia
 * 240px — 62% da tela —, sobravam 150px de conteúdo, e o cabeçalho vazava:
 * `scrollWidth = 462` contra `clientWidth = 390`, 72px para fora, idêntico em
 * cinco telas diferentes porque o defeito é da CASCA, não das páginas.
 *
 * Num CRM cujo canal é o WhatsApp, quem atende está no celular. Isto não era
 * acabamento: era o produto inutilizável no aparelho onde o trabalho acontece.
 *
 * ## Por que medir com ferramenta e num browser
 *
 * Media query, `translate`, `visibility` e largura em flex são cálculo de
 * LAYOUT. O jsdom não tem engine de layout — mediria zero em tudo e passaria
 * feliz, o falso verde mais barato que existe. E "olhar a tela e achar que
 * coube" não é medida: os números saem de `document.scrollWidth` e
 * `getBoundingClientRect`, nunca do olho.
 *
 * ## O que esta spec cobre
 *
 * Três telas de rotas diferentes (o defeito era da casca, então uma só poderia
 * ser coincidência), no celular e no desktop, com a gaveta fechada e aberta.
 * Inclui o desktop de propósito: a correção só presta se NÃO regredir quem já
 * usava no computador, que hoje é todo mundo.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "./helpers/test";

const APP_URL = `http://localhost:${process.env.E2E_PORT ?? "3001"}`;
const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

interface Creds {
  password: string;
  users: Record<string, { email: string }>;
}

function loadCreds(): Creds {
  const precisa = (): boolean => {
    if (!fs.existsSync(CREDS_PATH)) return true;
    const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    return !c.users?.agent;
  };
  if (precisa()) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

const creds = loadCreds();

/**
 * Os alvos são ESCOPADOS na barra lateral, e não buscados na página inteira: a
 * própria tela de contatos tem links com o texto "Contatos" (título, migalha),
 * e um seletor solto mediria um deles — dizendo "o menu está visível" quando o
 * menu está fechado. O `<main>` também é o da casca, o primeiro do documento.
 */
/**
 * ⚠️ FUSÃO DE 2026-08-20: a gaveta passou a ser a do UPSTREAM (`MobileSidebar`,
 * sobre o `Sheet` do Radix), e a nossa implementação paralela foi descartada —
 * duas gavetas conflitariam em toda sincronização, e a do upstream fecha ao
 * tocar no item pelo mesmo `onNavigate`. Só os RÓTULOS e o CONTINENTE mudaram:
 * o botão chama-se "Abrir navegação", o fechar é o "Close" do Sheet, e os links
 * abertos vivem num `role="dialog"`, não no `<aside>` (que agora é só o desktop,
 * dentro de um `hidden md:block`). O que esta spec MEDE é o mesmo.
 */
const CELULAR = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** As três telas medidas — rotas diferentes, para não medir uma coincidência. */
const TELAS = ["/app/inbox", "/app/kanban", "/app/contacts"] as const;

async function login(page: Page, email: string): Promise<void> {
  await page.goto(`${APP_URL}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app\//);
}

/**
 * A gaveta aberta é o `SheetContent` do Radix — um `role="dialog"`. Escopar
 * nele é o mesmo cuidado que o `<aside>` resolvia antes: a própria tela de
 * contatos tem links com o texto "Contatos", e um seletor solto mediria um
 * deles, dizendo "a gaveta abriu" com a gaveta fechada.
 */
function gaveta(page: Page) {
  return page.getByRole("dialog");
}

/** O número que o usuário sente: quanto a página vaza para fora da tela. */
async function estouroHorizontal(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
}

test.describe("casca no celular (#203)", () => {
  test.setTimeout(180_000);

  test("em 390px nenhuma tela vaza, e a gaveta abre e fecha", async ({ page }) => {
    await page.setViewportSize(CELULAR);
    await login(page, creds.users.agent!.email);

    for (const rota of TELAS) {
      await page.goto(`${APP_URL}${rota}`);
      await page.waitForLoadState("networkidle");

      // 1. NADA vaza. Era 72px em todas.
      const estouro = await estouroHorizontal(page);
      expect(estouro, `${rota} vazou ${estouro}px para fora da tela`).toBeLessThanOrEqual(0);

      // 2. A barra não pode estar ocupando espaço: com ela fechada, o conteúdo
      //    tem a largura inteira do aparelho (eram 150px de 390).
      const larguraMain = await page.locator("main").first().evaluate((el) => el.getBoundingClientRect().width);
      expect(larguraMain, `${rota}: conteúdo com ${larguraMain}px`).toBeGreaterThan(380);

      // 3. Fechada, a navegação some de VERDADE — `translate` sozinho deixaria
      //    os links focáveis por Tab e audíveis por leitor de tela, fora da tela.
      const menuFechado = page.locator("aside").getByRole("link", { name: "Contatos" });
      await expect(menuFechado).toBeHidden();
    }

    // 4. O botão existe e abre a gaveta. Sem ele, trocaríamos "menu ocupa tudo"
    //    por "não há menu", que é pior.
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await expect(gaveta(page).getByRole("link", { name: "Contatos" })).toBeVisible();

    // 5. Aberta, ela ainda não pode fazer a página vazar.
    expect(await estouroHorizontal(page)).toBeLessThanOrEqual(0);

    // 6. Dá para fechar sem navegar. No Sheet do upstream quem faz isso é o
    //    botão de fechar do próprio componente (rótulo "Close", só para leitor
    //    de tela) — o véu do Radix também fecha, mas clicar nele por coordenada
    //    é medida frágil.
    await gaveta(page).getByRole("button", { name: /close|fechar/i }).click();
    await expect(gaveta(page).getByRole("link", { name: "Contatos" })).toBeHidden();

    // 7. Tocar num item fecha — nos DOIS casos, e eles são mecanismos
    //    diferentes. Trocar de tela é coberto pelo efeito de rota; tocar no
    //    item da tela ATUAL não muda o `pathname` e só fecha pelo `onNavegar`
    //    do clique. Este segundo caso é o que reprovou no e2e de 2026-08-16 —
    //    a gaveta ficava aberta e, para o usuário, o toque não fazia nada.
    const linkContatos = gaveta(page).getByRole("link", { name: "Contatos" });

    // 7a. rota DIFERENTE (estamos em /app/contacts, vamos para o funil)
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await gaveta(page).getByRole("link", { name: "Funis" }).click();
    await page.waitForURL(/\/app\/kanban/);
    await expect(linkContatos).toBeHidden();

    // 7b. MESMA rota — o caso que passava despercebido
    await page.getByRole("button", { name: "Abrir navegação" }).click();
    await gaveta(page).getByRole("link", { name: "Funis" }).click();
    await expect(linkContatos).toBeHidden();
  });

  test("no desktop nada mudou: a barra continua fixa e visível", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await login(page, creds.users.agent!.email);

    for (const rota of TELAS) {
      await page.goto(`${APP_URL}${rota}`);
      await page.waitForLoadState("networkidle");

      // A barra é permanente aqui — nunca gaveta.
      await expect(page.locator("aside").getByRole("link", { name: "Contatos" })).toBeVisible();
      expect(await estouroHorizontal(page)).toBeLessThanOrEqual(0);
    }

    // E o botão de gaveta não aparece: no desktop ele não tem função.
    await expect(page.getByRole("button", { name: "Abrir navegação" })).toBeHidden();
  });
});
