/**
 * O fragmento que cada PR traz em `.changes/` — leitura, validação e o cálculo
 * do número que eles produzem juntos.
 *
 * A lei está em `docs/doctrine/versionamento.md`. O que este módulo carrega e a
 * prosa não consegue carregar é a RECUSA: um fragmento malformado reprova o
 * `verify` em vez de virar defeito visível na tela do dono da VPS, que é onde a
 * seção montada termina (`lib/system/changelog.ts` a extrai e a rota de sistema
 * a entrega).
 *
 * Por que o autor declara o EFEITO e não o número: a régua anterior — "mudança
 * de comportamento visível = minor" — transformava todo conserto em minor,
 * porque conserto muda comportamento visível por definição. Medido: seis minors
 * e duas patches em trinta dias. Pedir `impacto: minor` convidaria o mesmo erro
 * de volta; pedir "o operador precisa fazer alguma coisa?" não tem como ser
 * respondido errado por quem sabe o que fez.
 *
 * Módulo PURO: recebe texto, devolve dado. Quem toca disco é o CLI.
 */
import { z } from "zod";

/**
 * O que acontece com quem JÁ roda o sistema numa VPS. Os nomes são a pergunta,
 * não a resposta — o número é consequência, e vem de `BUMP_DO_IMPACTO`.
 */
export const Impacto = z.enum(["nada_mudou", "capacidade_nova", "exige_acao"]);
export type Impacto = z.infer<typeof Impacto>;

/** As três de Keep a Changelog que este produto usa de fato. */
export const Secao = z.enum(["adicionado", "alterado", "corrigido"]);
export type Secao = z.infer<typeof Secao>;

export type Bump = "patch" | "minor" | "major";

/**
 * Fonte ÚNICA da tradução efeito → número. `calcularBump` deriva daqui em vez
 * de repetir as strings: uma segunda lista com um nome digitado errado devolve
 * `patch` em silêncio para uma mudança que exigia ação do operador, e o
 * typecheck não pega string literal comparada com string literal.
 */
export const BUMP_DO_IMPACTO = {
  nada_mudou: "patch",
  capacidade_nova: "minor",
  // Não é major. Decisão do dono (07/10): "Major update é somente quando eu
  // pedir. IA nem nenhum workflow decide isso!" O aviso de ação continua em
  // destaque — ele vem de `atencao`, não do número (`montar-secao.ts`).
  exige_acao: "minor",
} as const satisfies Record<Impacto, Bump>;

/** Severidade crescente. `calcularBump` devolve o máximo do conjunto. */
const SEVERIDADE: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export interface Fragmento {
  /** Nome do arquivo, para a mensagem de erro apontar o culpado. */
  arquivo: string;
  impacto: Impacto;
  secao: Secao;
  titulo: string;
  /** Prosa em pt-BR, verbatim — nunca reflua: veja `montar-secao.ts`. */
  corpo: string;
  /** Presente só quando `impacto: exige_acao`. */
  atencao: string | null;
}

const Frontmatter = z.object({
  impacto: Impacto,
  secao: Secao,
  titulo: z.string().trim().min(1, "titulo vazio"),
});

/**
 * Cada regra abaixo é um comportamento MEDIDO do parser da tela
 * (`lib/system/changelog.ts`), não gosto:
 *
 * - `^#` — `VERSION_HEADING` corta a seção inteira em `^##\s+\[`, e
 *   `findAttentionRange` encerra o bloco de atenção no primeiro `^#{2,4}\s`.
 *   Um heading no corpo do fragmento decapita a seção de alguém.
 * - `⚠` — quem emite o heading de atenção é o gerador, uma vez só. Um segundo
 *   no corpo faz `findAttentionRange` casar na linha errada.
 * - referência de link — `cleanBody` só a remove no FIM do corpo; no meio, ela
 *   aparece crua na tela.
 */
const PROIBIDO: ReadonlyArray<{ re: RegExp; porque: string }> = [
  { re: /^#/, porque: "heading no corpo corta a seção na tela (VERSION_HEADING / findAttentionRange)" },
  { re: /⚠/, porque: "o heading de atenção é do gerador; um segundo aqui desloca o bloco" },
  { re: /^\s*\[[^\]]+\]:\s+https?:\/\//, porque: "referência de link fora do fim do arquivo aparece crua na tela" },
];

/** Campos cujo valor é uma palavra de uma lista: só neles ` #` inicia comentário. */
const VOCABULARIO_FECHADO = new Set(["impacto", "secao"]);

/** `**` precisa fechar na MESMA linha: a regex do renderizador é single-line. */
function negritoAberto(linha: string): boolean {
  return ((linha.match(/\*\*/g)?.length ?? 0) % 2) !== 0;
}

export class FragmentoInvalido extends Error {}

/** Frontmatter à mão: o projeto não tem parser de YAML entre as dependências. */
function separarFrontmatter(texto: string): { campos: Record<string, string>; corpo: string } {
  const linhas = texto.replace(/^﻿/, "").split("\n");
  if ((linhas[0] ?? "").trim() !== "---") {
    throw new FragmentoInvalido("falta o bloco `---` de abertura na primeira linha");
  }
  const fim = linhas.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (fim === -1) throw new FragmentoInvalido("falta o `---` que fecha o frontmatter");

  const campos: Record<string, string> = {};
  for (const linha of linhas.slice(1, fim)) {
    if (!linha.trim() || linha.trim().startsWith("#")) continue;
    const sep = linha.indexOf(":");
    if (sep === -1) throw new FragmentoInvalido(`linha de frontmatter sem \`:\` → ${linha.trim()}`);
    const chave = linha.slice(0, sep).trim();
    // Comentário à direita só existe em campo de vocabulário FECHADO. Em
    // `titulo`, que é texto livre, ` #` é conteúdo: metade dos títulos deste
    // repo cita uma issue (`conserta o #351`), e comer isso silenciosamente
    // entregaria à tela do dono da VPS um título cortado no meio.
    const cru = linha.slice(sep + 1);
    const valor = (VOCABULARIO_FECHADO.has(chave) ? cru.replace(/\s+#.*$/, "") : cru).trim();
    // ⚠️ SÓ TIRA ASPA COM PAR. O `replace(/^["']|["']$/g, "")` que morava aqui
    // tirava cada ponta INDEPENDENTE, e um título com aspa no meio saía torto:
    //
    //     titulo: "Quero 2 iPhone 15" volta a encontrar o iPhone 15
    //          →  Quero 2 iPhone 15" volta a encontrar o iPhone 15
    //
    // A aspa de abertura some, a do meio fica órfã, e é ISSO que chega ao
    // CHANGELOG que o dono da VPS lê antes de atualizar. Aspa citando o que o
    // cliente digita é o caso natural num produto de atendimento — o título
    // acima é real, e passou pelo gate.
    const aspas = /^(["'])([\s\S]*)\1$/.exec(valor);
    campos[chave] = aspas ? aspas[2]! : valor;
  }
  return { campos, corpo: linhas.slice(fim + 1).join("\n").trim() };
}

/** O bloco de aviso é opcional e marcado por `## Requer atenção` no fragmento. */
const MARCA_ATENCAO = /^##\s+Requer atenção\s*$/i;

export function parseFragmento(arquivo: string, texto: string): Fragmento {
  const { campos, corpo } = separarFrontmatter(texto);

  const parsed = Frontmatter.safeParse(campos);
  if (!parsed.success) {
    const detalhe = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    throw new FragmentoInvalido(`frontmatter inválido → ${detalhe}`);
  }

  // A marca de atenção é a única exceção à proibição de heading, e some antes
  // da varredura: quem emite o heading de verdade é o gerador.
  const linhas = corpo.split("\n");
  const iAtencao = linhas.findIndex((l) => MARCA_ATENCAO.test(l.trim()));
  const linhasCorpo = iAtencao === -1 ? linhas : linhas.slice(0, iAtencao);
  const linhasAtencao = iAtencao === -1 ? [] : linhas.slice(iAtencao + 1);

  for (const [n, linha] of [...linhasCorpo, ...linhasAtencao].entries()) {
    for (const { re, porque } of PROIBIDO) {
      if (re.test(linha)) throw new FragmentoInvalido(`linha ${n + 1}: ${porque} → ${linha.trim()}`);
    }
    if (negritoAberto(linha)) {
      throw new FragmentoInvalido(
        `linha ${n + 1}: \`**\` que não fecha na mesma linha chega à tela com os asteriscos literais`,
      );
    }
  }

  const textoCorpo = linhasCorpo.join("\n").trim();
  if (!textoCorpo) throw new FragmentoInvalido("corpo vazio: é ele que o dono da VPS lê na tela");

  const atencao = linhasAtencao.join("\n").trim() || null;

  // As duas direções do cruzamento, porque cada uma é um defeito distinto:
  // aviso sem `exige_acao` some da caixa destacada; `exige_acao` sem aviso põe
  // o operador para agir sem dizer o quê.
  if (parsed.data.impacto === "exige_acao" && !atencao) {
    throw new FragmentoInvalido(
      "`impacto: exige_acao` sem bloco `## Requer atenção`: o operador precisa saber o que fazer",
    );
  }
  if (atencao && parsed.data.impacto !== "exige_acao") {
    throw new FragmentoInvalido(
      `bloco \`## Requer atenção\` com \`impacto: ${parsed.data.impacto}\`: se há ação a fazer, o impacto é \`exige_acao\``,
    );
  }

  return { arquivo, ...parsed.data, corpo: textoCorpo, atencao };
}

/**
 * O número que o conjunto produz. Sem fragmento não há resposta — e devolver
 * `patch` no vazio seria inventar uma release que ninguém descreveu.
 *
 * `major` só sai com `pedidoMajor` — o pedido explícito de quem corta
 * (`--major` no script, input `major` no workflow). Nenhum fragmento o produz.
 */
export function calcularBump(impactos: readonly Impacto[], pedidoMajor = false): Bump {
  if (impactos.length === 0) {
    throw new FragmentoInvalido("nenhum fragmento em `.changes/`: não há versão a cortar");
  }
  if (pedidoMajor) return "major";
  return impactos
    .map((i) => BUMP_DO_IMPACTO[i])
    .reduce((a, b) => (SEVERIDADE[b] > SEVERIDADE[a] ? b : a));
}

/** `1.6.0` + `minor` → `1.7.0`. Recusa o que não for `X.Y.Z` de inteiros. */
export function proximaVersao(atual: string, bump: Bump): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(atual.trim().replace(/^v/i, ""));
  if (!m) throw new FragmentoInvalido(`versão base não é X.Y.Z → ${atual}`);
  const [maior, menor, correcao] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${maior + 1}.0.0`;
  if (bump === "minor") return `${maior}.${menor + 1}.0`;
  return `${maior}.${menor}.${correcao + 1}`;
}

/**
 * A SÉRIE DESTA CASA, e por que ela não é um número inventado.
 *
 * Este repositório é um fork: a numeração X.Y.Z é do upstream e continua sendo
 * dele. Cortar `1.41.1` aqui roubaria o número que ele vai publicar na semana
 * que vem (foram 25 versões em duas semanas), e as duas `1.41.1` conviveriam no
 * mesmo `git tag` de quem sincroniza.
 *
 * A saída é a que o próprio upstream já carrega de outro fork: sufixo de série.
 * O CHANGELOG dele tem `v1.1.1-jmpo.1`, e `scripts/cortar-release.ts` cita as
 * duas justamente como "numeração que não colide com a daqui".
 *
 * Aqui a série é `sb` (Salvador Broker), e o número segue sendo CALCULADO:
 * a base é a última versão do upstream que o CHANGELOG já registra, e o
 * contador anda de um a cada corte nosso sobre a mesma base. Quando a base
 * muda, o contador volta a 1 — é o que mantém a leitura óbvia ("esta é a
 * primeira desta casa sobre a 1.41.0").
 *
 * A VPS não escolhe a versão pelo número: desde a v1.51.0 ela pergunta ao
 * GitHub pela última release PUBLICADA do `origin` (`ultima_release_estavel`,
 * no kit), e só este repositório publica releases `-sb`. Tag desta casa sem
 * release publicada nunca chega à produção.
 */
export const SERIE_DA_CASA = "sb";

const SECAO_DO_CHANGELOG = /^##\s+\[(\d+\.\d+\.\d+)(?:-([a-z]+)\.(\d+))?\]/;

export interface VersaoDeSecao {
  /** O texto completo, como vai para a tag: `1.41.0-sb.1`. */
  versao: string;
  /** A parte do upstream: `1.41.0`. */
  base: string;
  /** `sb` quando a seção é desta casa; `null` quando é do upstream. */
  serie: string | null;
  /** O contador da série, ou `null`. */
  n: number | null;
}

/** A primeira seção `## [versão]` do CHANGELOG, que é sempre a mais nova. */
export function versaoDoTopo(changelog: string): VersaoDeSecao {
  for (const linha of changelog.split("\n")) {
    const m = SECAO_DO_CHANGELOG.exec(linha);
    if (!m) continue;
    const [, base, serie, n] = m;
    return {
      versao: serie ? `${base}-${serie}.${n}` : base!,
      base: base!,
      serie: serie ?? null,
      n: n ? Number(n) : null,
    };
  }
  throw new FragmentoInvalido("CHANGELOG.md sem nenhuma seção `## [X.Y.Z]`");
}

/**
 * O próximo número DESTA CASA a partir do topo do CHANGELOG.
 *
 * O `bump` dos fragmentos não entra na conta, e isso é deliberado: ele responde
 * "o operador precisa fazer alguma coisa?", que continua valendo para o texto da
 * seção e para o bloco de atenção. Quem manda no número é a base do upstream,
 * porque é ela que diz qual código está rodando.
 */
export function proximaVersaoDaCasa(changelog: string): string {
  const topo = versaoDoTopo(changelog);
  const n = topo.serie === SERIE_DA_CASA ? (topo.n ?? 0) + 1 : 1;
  return `${topo.base}-${SERIE_DA_CASA}.${n}`;
}
