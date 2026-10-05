#!/usr/bin/env bash
#
# O QUE É NOSSO — inventário vivo das diferenças entre este fork e o upstream.
#
# ── Por que isto é um SCRIPT e não um documento ────────────────────────────
#
# Um documento que lista "o que mudamos" está errado no dia seguinte a cada
# sincronização, e errado em silêncio: ninguém revisa inventário. A auditoria de
# 2026-08-14 deste repositório achou 227 afirmações de estado desatualizadas em
# 393 medidas — e a doutrina que saiu dela é a regra que este arquivo segue:
# onde a afirmação puder virar comando, vire comando.
#
# Então aqui não há número escrito. Tudo é medido na hora, contra o repositório
# como ele está agora.
#
# ── Para quem é ────────────────────────────────────────────────────────────
#
# Para uma sessão de Claude Code que vai mexer no CRM e precisa saber, em trinta
# segundos, o que é customização própria e o que é código do upstream. E para o
# dono, que lê a mesma saída em português.
#
# O PORQUÊ de cada customização não está aqui — está na memória, em
# ~/.claude/projects/-home-marcio/memory/. Este script mede; a memória explica.
#
# Uso:  bash scripts/o-que-e-nosso.sh
#       bash scripts/o-que-e-nosso.sh --arquivos    (lista arquivo por arquivo)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

# ── Modo e cor ─────────────────────────────────────────────────────────────
#
# `--resumo` existe para o hook de SessionStart: uma sessão que começa não
# precisa do inventário inteiro, precisa saber se alguma armadilha está armada.
# São ~12 linhas em vez de ~55.
#
# A cor sai sozinha quando a saída não é um terminal. Um hook captura stdout, e
# sequências ANSI viram lixo dentro do contexto do modelo.
RESUMO=""; ARQUIVOS=""
for a in "$@"; do
  case "$a" in
    --resumo)   RESUMO=1 ;;
    --arquivos) ARQUIVOS=1 ;;
  esac
done

if [ -t 1 ]; then C_B=$'\033[1m'; C_D=$'\033[2m'; C_R=$'\033[31m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_0=$'\033[0m'
else C_B=""; C_D=""; C_R=""; C_G=""; C_Y=""; C_0=""; fi

b() { printf '%s%s%s\n' "$C_B" "$1" "$C_0"; }
dim() { printf '%s%s%s\n' "$C_D" "$1" "$C_0"; }

# ── Quem é quem ────────────────────────────────────────────────────────────
#
# Descobre os remotes pela URL, não pelo nome: o remote do dono já se chamou
# `github-marcio` e pode passar a se chamar `origin`. Nome é convenção; a URL é
# o fato.
NOSSO=""; DELES=""
while read -r nome url _; do
  case "$url" in
    *melgarafael*) DELES="$nome" ;;
    *) [ -z "$NOSSO" ] && NOSSO="$nome" ;;
  esac
done < <(git remote -v | grep fetch)

if [ -z "$NOSSO" ] || [ -z "$DELES" ]; then
  echo "Não consegui identificar os dois repositórios nos remotes. Rode 'git remote -v'."
  exit 1
fi

NOSSA_MAIN="$NOSSO/main"
MAIN_DELES="$DELES/main"

base="$(git merge-base "$NOSSA_MAIN" "$MAIN_DELES" 2>/dev/null || true)"

# Calculado FORA do bloco longo: `--arquivos` também usa, e no modo resumido o
# bloco longo não roda.
so_nossos="$(comm -23 <(git ls-tree -r --name-only "$NOSSA_MAIN" | sort) \
                      <(git ls-tree -r --name-only "$MAIN_DELES" | sort) 2>/dev/null)"

if [ -n "$RESUMO" ]; then
  printf '\n'
  b "CRM Salvador Broker — este repositório é um FORK do melgarafael/DeskcommCRM"
  printf '  fork em %s (base %s) · upstream em %s · %s commits dele pendentes · %s commits nossos\n' \
    "$(git log -1 --format=%h "$NOSSA_MAIN" 2>/dev/null)" \
    "$(git describe --tags --abbrev=0 "$NOSSA_MAIN" 2>/dev/null || echo '—')" \
    "$(git tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || echo '—')" \
    "$(git rev-list --count "$NOSSA_MAIN..$MAIN_DELES" 2>/dev/null || echo '?')" \
    "$(git rev-list --count --no-merges "$MAIN_DELES..$NOSSA_MAIN" 2>/dev/null || echo '?')"
  printf '  inventário completo: bash %s\n' "$(pwd)/scripts/o-que-e-nosso.sh"
  printf '\n'
fi

if [ -z "$RESUMO" ]; then
printf '\n'
b "═══ ONDE CADA COISA ESTÁ ═══"
dim "(sem rede — mostra o que este clone já sabe; rode 'git fetch --all' para atualizar)"
printf '\n'

printf '  %-34s %s\n' "nosso fork ($NOSSO):" "$(git log -1 --format='%h  %ad  %s' --date=short "$NOSSA_MAIN" 2>/dev/null | cut -c1-70)"
printf '  %-34s %s\n' "upstream ($DELES):" "$(git log -1 --format='%h  %ad  %s' --date=short "$MAIN_DELES" 2>/dev/null | cut -c1-70)"
printf '  %-34s %s\n' "base comum:" "$(git log -1 --format='%h  %ad' --date=short "$base" 2>/dev/null)"
printf '\n'
printf '  %-34s %s\n' "versão do upstream na base:" "$(git describe --tags --abbrev=0 "$NOSSA_MAIN" 2>/dev/null || echo '—')"
printf '  %-34s %s\n' "última versão do upstream:" "$(git tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || echo '—')"
printf '  %-34s %s\n' "commits DELE que não temos:" "$(git rev-list --count "$NOSSA_MAIN..$MAIN_DELES" 2>/dev/null || echo '?')"
printf '  %-34s %s\n' "commits NOSSOS (sem merges):" "$(git rev-list --count --no-merges "$MAIN_DELES..$NOSSA_MAIN" 2>/dev/null || echo '?')"

printf '\n'
b "═══ O QUE É CUSTOMIZAÇÃO NOSSA ═══"
printf '\n'

n_so_nossos="$(printf '%s\n' "$so_nossos" | grep -c . || true)"

produto="$(git diff --stat "$MAIN_DELES...$NOSSA_MAIN" -- app/ components/ lib/ workers/ supabase/ 2>/dev/null | tail -1)"

printf '  %-34s %s\n' "arquivos que SÓ existem aqui:" "$n_so_nossos"
printf '  %-34s %s\n' "mudanças em código de produto:" "${produto:-—}"

printf '\n  migrations nossas (fora da numeração do upstream):\n'
comm -23 <(git ls-tree -r --name-only "$NOSSA_MAIN" -- supabase/migrations/ | sort) \
         <(git ls-tree -r --name-only "$MAIN_DELES" -- supabase/migrations/ | sort) 2>/dev/null \
  | sed 's|supabase/migrations/|    |' | head -20
printf '\n'

b "═══ AS CUSTOMIZAÇÕES, POR ÁREA ═══"
dim "(agrupado pelos caminhos que só existem aqui — não é lista escrita à mão)"
printf '\n'
printf '%s\n' "$so_nossos" | grep -vE '^\.(claude|codex|agents|changes)/' \
  | awk -F/ 'NF>1 {print $1"/"$2} NF==1 {print $1}' | sort | uniq -c | sort -rn | head -14 \
  | awk '{printf "    %-44s %s arquivo(s)\n", $2, $1}'
printf '\n'
fi   # fim do bloco longo

b "═══ ARMADILHAS ATIVAS ═══"
printf '\n'

ENVF="$(cd "$(git rev-parse --show-toplevel)" && pwd)/.env"
if [ -r "$ENVF" ]; then
  for k in APP_IMAGE WORKER_IMAGE SCHEDULER_IMAGE; do
    v="$(grep -E "^${k}=" "$ENVF" | head -1 | cut -d= -f2-)"
    case "$v" in
      *melgarafael*) printf '  %s✗%s %-22s aponta para o UPSTREAM: %s\n' "$C_R" "$C_0" "$k" "$v" ;;
      "")            printf '  %s!%s %-22s ausente — cai no default do compose\n' "$C_Y" "$C_0" "$k" ;;
      *)             printf '  %s✓%s %-22s %s\n' "$C_G" "$C_0" "$k" "$v" ;;
    esac
  done
else
  dim "  (.env não legível daqui — rode dentro de /home/marcio/DeskcommCRM)"
fi

ns="$(grep -E '^IMG_NS="' hostgator-setup-kit/_common.sh | head -1 | cut -d'"' -f2)"
case "$ns" in
  *melgarafael*) printf '  %s✗%s %-22s %s — o botão de atualizar instalaria o código DELE\n' "$C_R" "$C_0" "IMG_NS do kit" "$ns" ;;
  *)             printf '  %s✓%s %-22s %s\n' "$C_G" "$C_0" "IMG_NS do kit" "$ns" ;;
esac

if grep -q 'TARGET_TAG="$(ultima_release_estavel)"' hostgator-setup-kit/update.sh 2>/dev/null; then
  printf '  %s✓%s %-22s última release publicada no origin (tag alheia não é candidata)\n' "$C_G" "$C_0" "escolha de versão"
else
  printf '  %s✗%s %-22s não pergunta pela release publicada: pode escolher a tag do upstream\n' "$C_R" "$C_0" "escolha de versão"
fi

sujo="$(git status --porcelain --untracked-files=no 2>/dev/null | grep -c . || true)"
[ "$sujo" -gt 0 ] && printf '  %s!%s %-22s %s arquivo(s) alterados e NAO commitados (git status)\n' "$C_Y" "$C_0" "árvore de trabalho" "$sujo"

printf '\n'
if [ -z "$RESUMO" ]; then
  b "═══ O PORQUÊ DE CADA UMA ═══"
  dim "  Este script mede; ele não explica. As decisões, os incidentes e o que"
  dim "  o dono já recusou estão em:"
  printf '\n'
  for f in /home/marcio/.claude/projects/-home-marcio/memory/project_*.md; do
    [ -r "$f" ] || continue
    d="$(grep -m1 '^description:' "$f" | cut -d: -f2- | tr -d '"' | cut -c1-72)"
    printf '    %-46s %s\n' "$(basename "$f")" "$d"
  done
  printf '\n'
fi

if [ -n "$ARQUIVOS" ]; then
  b "═══ TODOS OS ARQUIVOS SÓ NOSSOS ═══"
  printf '%s\n' "$so_nossos" | sed 's/^/    /'
  printf '\n'
  b "═══ ARQUIVOS DO UPSTREAM QUE NÓS MODIFICAMOS ═══"
  git diff --name-only "$MAIN_DELES...$NOSSA_MAIN" 2>/dev/null \
    | comm -23 - <(printf '%s\n' "$so_nossos" | sort) | sed 's/^/    /'
  printf '\n'
fi

# ── PONTOS DE CONTATO: as linhas nossas que moram em arquivo DELES ───────────
#
# Estas não somem com conflito, que seria o caso fácil. Somem em silêncio, numa
# fusão que reescreve o arquivo inteiro. Aqui é a conferência de trinta
# segundos, sem node e sem banco; a versão completa, com o que repor em cada
# caso, é `tests/unit/pontos-de-contato-do-fork.test.ts`, e o porquê de cada
# escolha está em `docs/fork/pontos-de-contato.md`.
printf '\n'
b "═══ PONTOS DE CONTATO (linha nossa dentro de arquivo deles) ═══"
contato() {
  local arquivo="$1" marca="$2" descricao="$3"
  if [ -f "$arquivo" ] && grep -qF -- "$marca" "$arquivo" 2>/dev/null; then
    printf '    ok     %-46s %s\n' "$arquivo" "$descricao"
  else
    printf '    FALTA  %-46s %s\n' "$arquivo" "$descricao"
    FALTOU=1
  fi
}
FALTOU=0
contato "lib/navigation/catalogo.ts"                  "NAV_CATALOG_LOCAL"        "destinos desta casa no catálogo"
contato "components/kanban/LeadDossier.tsx"           "LeadInterestedProperties" "imóveis de interesse no dossiê"
contato "lib/schemas/index.ts"                        "./properties"             "re-export dos schemas de imóveis"
contato "scripts/test-db.sh"                          "aplicar_sql_local_no_molde" "SQL desta casa no molde dos invariantes"
contato ".github/workflows/e2e.yml"                   "supabase/local"           "SQL desta casa no banco do e2e"
contato ".github/workflows/e2e.yml"                   "properties.spec.ts"       "spec do módulo na parte 1"
contato "hostgator-setup-kit/_common.sh"              "ghcr.io/marcioror"        "namespace das nossas imagens"
contato "hostgator-setup-kit/_common.sh"              "aplicar_sql_local"        "função que aplica supabase/local"
contato "hostgator-setup-kit/install.sh"              "aplicar_sql_local"        "chamada na instalação"
contato "hostgator-setup-kit/update.sh"               "aplicar_sql_local"        "chamada na atualização"
contato "lib/audit/actions.ts"                        "property.created"         "verbos de auditoria do módulo"
contato "lib/leads/activity-vocabulary.ts"            "property_linked"          "rótulos de vínculo de imóvel"
contato ".github/workflows/release.yml"               "ha-app-de-release"        "release não quebra sem App"
contato "tests/unit/gatilho-dos-jobs-de-entrega.test.ts" "configurado == 'sim'"  "mapa de gatilhos desta casa"
contato "app/api/v1/contacts/_handler.ts" "protegerContato" "a proteção aplicada em list/get/create/patch de contato"
contato "app/api/v1/conversations/_handler.ts" "protegerConversaComContato" "a proteção no contato embutido da conversa"
contato "app/api/v1/messages/_handler.ts" "comExternalIdNormalizado" "o external_id que não carrega telefone"
contato "lib/escalacao/chamados.ts" "podeVerContatoSensivel" "a proteção na fila de casos, que lê com service role"
contato "lib/crm-b2b/people-handler.ts" "protegerContato(c, ctx.actor)" "a proteção na ficha da pessoa e no vínculo contato-pessoa"
contato "components/kanban/NewLeadDialog.tsx" 'className="max-h-[90vh] overflow-y-auto"' "o diálogo de lead novo que cabe numa tela de 720 px"
contato "app/api/v1/contacts/duplicates/route.ts" 'requireRole("manager"' "o gate manager na lista de duplicados"
contato "tests/unit/api-nao-redireciona-org-suspensa.test.ts" ".toBeGreaterThanOrEqual(19)" "o controle positivo da cerca de org suspensa"
contato "lib/reports/atividades.ts" "podeVerContatoSensivel" "a proteção no relatório de atividades"
contato "lib/leads/nascimento-do-lead.ts" "nomeDoContato(contato)" "o título do lead que não grava telefone"
contato "lib/automation/actions/create-or-move-lead.ts" "SEM FALLBACK PARA O TELEFONE" "o título do lead da automação sem telefone"
contato "components/contacts/ContactsTable.tsx" "ContatoProtegido" "o cadeado no lugar do telefone e do e-mail na lista"
contato "app/api/v1/contacts/route.ts" "role: authz.org.role" "o papel no ator, que é o que a regra lê"
contato "lib/agent-engine/edge/crm/drain.ts" "knobs.debounceTetoMs" "o teto da janela deslizante passado a decidirRajada"
contato "lib/agent-engine/edge/crm/debounce.ts" "SQL_ESTENDER_JANELA" "a janela deslizante com teto na coalescência da rajada"
contato "scripts/cortar-release.ts" "proximaVersaoDaCasa" "a numeracao desta casa, que nao rouba o numero do upstream"
if [ "$FALTOU" = 1 ]; then
  printf '\n    ⚠ Algum ponto de contato sumiu — quase sempre é fusão que comeu a linha.\n'
  printf '      O que repor, caso a caso: pnpm vitest run tests/unit/pontos-de-contato-do-fork.test.ts\n'
fi
printf '\n'
