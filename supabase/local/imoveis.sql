-- ---- properties + properties_media + bucket property-media (migration 9001) ----
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(title) > 0),
  description text,
  property_type text not null check (property_type in ('house','apartment','land','commercial','rural','other')),
  purpose text not null check (purpose in ('sale','rent','both')),
  status text not null default 'available' check (status in ('available','reserved','sold','rented','inactive')),
  price_sale_cents bigint,
  price_rent_cents bigint,
  currency text not null default 'BRL',
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text,
  address_zip text,
  address_country text not null default 'BR',
  latitude numeric,
  longitude numeric,
  area_total_m2 numeric,
  area_useful_m2 numeric,
  bedrooms int,
  bathrooms int,
  suites int,
  parking_spots int,
  floor int,
  construction_year int,
  condo_fee_cents bigint,
  iptu_cents bigint,
  furnished boolean not null default false,
  accepts_pets boolean not null default false,
  features text[] not null default '{}',
  owner_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_properties_org_status on public.properties (organization_id, status);
create index if not exists idx_properties_org_type_purpose on public.properties (organization_id, property_type, purpose);
create index if not exists idx_properties_org_price_sale on public.properties (organization_id, price_sale_cents);
create index if not exists idx_properties_org_price_rent on public.properties (organization_id, price_rent_cents);
create index if not exists idx_properties_features_gin on public.properties using gin (features);
drop trigger if exists trg_properties_updated_at on public.properties;
create trigger trg_properties_updated_at before update on public.properties for each row execute function public.fn_set_updated_at();

create table if not exists public.properties_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_properties_media_property on public.properties_media (property_id, position);
create index if not exists idx_properties_media_org on public.properties_media (organization_id);

do $$
declare t text;
begin
  foreach t in array array['properties', 'properties_media'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format(
      'create policy tenant_isolation_%s_all on public.%I for all
         using (organization_id in (select * from public.fn_user_org_ids()))
         with check (organization_id in (select * from public.fn_user_org_ids()))',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

alter table public.crm_lead_links drop constraint if exists crm_lead_links_target_kind_enum;
alter table public.crm_lead_links add constraint crm_lead_links_target_kind_enum
  check (target_kind in ('order','conversation','message','appointment','contact','lead','external','property'));

insert into storage.buckets (id, name, public, file_size_limit)
values ('property-media', 'property-media', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ---- bucket property-media file_size_limit 10MB -> 50MB (migration 9002) ----
insert into storage.buckets (id, name, public, file_size_limit)
values ('property-media', 'property-media', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- ---- imóveis: escrita exige papel, não só organização (migration 9004) ----
--
-- A 9001 criou estas duas tabelas com policy `for all` org-flat, e a API sempre
-- foi mais estrita: ler é `viewer`, escrever é `agent` (route.ts:35,95;
-- [id]/route.ts:26,53,122; [id]/media/route.ts:22). Rota não é fronteira — a
-- anon key vai para o browser e o `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- TABLES TO anon, authenticated` deste baseline alcança toda tabela criada
-- depois dele, então um `viewer` escrevia no cadastro de imóveis pelo PostgREST.
-- Mesmo defeito da 0150 (8 tabelas) e da 0143; estas ficaram de fora por serem
-- deste fork. Forma canônica: SELECT org-flat + escrita com fn_role_at_least.
-- As permissivas se somam por OR, então a org-flat PRECISA sair junto.
--
-- Na escrita, o admin da plataforma é `fn_is_platform_admin_full()`, e não a
-- função pura: a pura também vale para o escopo `support_readonly`, que assim
-- escrevia no cadastro de imóveis. É o mesmo conserto que o upstream fez nas
-- tabelas dele (#2115, migration 0533), e a cerca
-- `tests/invariants/platform-admin-full-so-escreve.test.ts` conta toda policy
-- de escrita de `public`, inclusive estas. A leitura continua com a pura.
do $$
declare t text;
begin
  foreach t in array array['properties', 'properties_media'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_isolation_%s_all on public.%I', t, t);
    execute format('drop policy if exists %s_select on public.%I', t, t);
    execute format('drop policy if exists %s_agent_write on public.%I', t, t);
    execute format(
      'create policy %s_select on public.%I
         for select using (
           (organization_id in (select * from public.fn_user_org_ids()))
           or public.fn_is_platform_admin()
         )',
      t, t
    );
    execute format(
      'create policy %s_agent_write on public.%I
         using (
           public.fn_is_platform_admin_full()
           or ((organization_id in (select * from public.fn_user_org_ids()))
               and public.fn_role_at_least(organization_id, ''agent''))
         )
         with check (
           public.fn_is_platform_admin_full()
           or ((organization_id in (select * from public.fn_user_org_ids()))
               and public.fn_role_at_least(organization_id, ''agent''))
         )',
      t, t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---- as varreduras finais do baseline, de novo, agora que as tabelas existem ----
--
-- ⚠️ ISTO É CONSEQUÊNCIA DIRETA DE O SCHEMA DESTA CASA VIVER FORA DO BASELINE, e
-- foi o CI que mostrou: `travas-de-suporte-cobrem-toda-tabela-na-instalacao`
-- reprovou dizendo que `properties` e `properties_media` estavam sem as três
-- travas restritivas do modo somente-leitura do suporte.
--
-- A razão é de ORDEM, não de policy: o baseline termina varrendo todas as
-- tabelas com `organization_id` e aplicando as travas (`fn_aplicar_travas_de_
-- suporte`, migration 0274). Quando ele roda, as tabelas deste arquivo ainda não
-- existem — elas nascem duas linhas abaixo, no passo seguinte do install.sh.
--
-- Então a varredura se repete aqui, no fim, depois de criar. É idempotente (a
-- própria função foi escrita para ser reaplicada pelo update.sh a cada versão) e
-- é barata: ela lê o catálogo e cria o que faltar.
--
-- ⚠️ TODA TABELA NOVA DESTA CASA HERDA ESTA REGRA. Se um dia houver outro
-- arquivo em `supabase/local/`, ou ele termina com esta chamada, ou as tabelas
-- dele nascem fora do modo suporte — e o gate do upstream vai dizer isso, o que
-- é o comportamento desejado.
do $$
begin
  if to_regprocedure('public.fn_aplicar_travas_de_suporte()') is not null then
    perform public.fn_aplicar_travas_de_suporte();
  end if;
end $$;
