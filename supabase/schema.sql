-- Garden Planner v2 — Supabase schema.
-- Idempotent: safe to paste into the SQL editor and re-run.
-- Access model: every row belongs to a garden; garden_members grants owner|editor|viewer.
-- Public gardens (is_public) are readable by anyone, including signed-out visitors.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.gardens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null default 'My Garden',
  place        text,
  zone         text,
  last_frost   text not null default '04-15' check (last_frost ~ '^\d\d-\d\d$'),
  first_frost  text not null default '10-25' check (first_frost ~ '^\d\d-\d\d$'),
  origin_lat   double precision,
  origin_lng   double precision,
  lot          jsonb not null default '[]'::jsonb,   -- [[x_ft, y_ft], ...]
  structures   jsonb not null default '[]'::jsonb,   -- [{id, kind, name, x, y, w, h, rotation, locked}] feet, centre-based
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.garden_members (
  garden_id  uuid not null references public.gardens(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (garden_id, user_id)
);

create table if not exists public.beds (
  id           uuid primary key default gen_random_uuid(),
  garden_id    uuid not null references public.gardens(id) on delete cascade,
  name         text not null,
  kind         text not null default 'raised' check (kind in ('raised','container','ground','tray','plan')),
  area         text,                                -- "Backyard", "Front yard", "Indoors"…
  length_ft    real not null default 4 check (length_ft > 0),
  width_ft     real not null default 4 check (width_ft > 0),
  height_ft    real,
  x_ft         real not null default 0,
  y_ft         real not null default 0,
  rotation_deg real not null default 0,
  color        text,
  notes        text,
  sort         integer not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Added after launch: pin a bed so a stray drag in the yard can't move it.
alter table public.beds add column if not exists locked boolean not null default false;
-- Round beds / pots (length_ft = width_ft = diameter) and pot size in gallons.
alter table public.beds add column if not exists shape text not null default 'rect';
alter table public.beds add column if not exists volume_gal real;
do $$ begin
  alter table public.beds add constraint beds_shape_check check (shape in ('rect','round'));
exception when duplicate_object then null; end $$;

create table if not exists public.plantings (
  id               uuid primary key default gen_random_uuid(),
  garden_id        uuid not null references public.gardens(id) on delete cascade,
  bed_id           uuid references public.beds(id) on delete set null,
  plant_key        text not null,
  variety          text,
  qty              integer not null default 1 check (qty >= 0),
  x_ft             real,
  y_ft             real,
  status           text not null default 'planned'
                   check (status in ('planned','started','planted','harvesting','done','failed')),
  season           integer not null default extract(year from now())::int,
  method           text check (method in ('direct','transplant','start','perennial')),
  sow_date         date,
  transplant_date  date,
  expected_harvest date,
  done_date        date,
  source           text,
  notes            text,
  locked           boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Where each individual plant of a planting sits in its bed: [[x_ft, y_ft], ...], length = qty.
-- NULL means "lay them out in a row from (x_ft, y_ft) at the plant's spacing".
alter table public.plantings add column if not exists positions jsonb;

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  garden_id   uuid not null references public.gardens(id) on delete cascade,
  type        text not null check (type in ('harvest','note','task')),
  date        date not null default current_date,
  planting_id uuid references public.plantings(id) on delete set null,
  bed_id      uuid references public.beds(id) on delete set null,
  plant_key   text,
  amount      real,
  unit        text,
  text        text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.custom_plants (
  id         uuid primary key default gen_random_uuid(),
  garden_id  uuid not null references public.gardens(id) on delete cascade,
  key        text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (garden_id, key)
);

create index if not exists beds_garden_idx          on public.beds(garden_id);
create index if not exists plantings_garden_idx     on public.plantings(garden_id);
create index if not exists plantings_bed_idx        on public.plantings(bed_id);
create index if not exists events_garden_date_idx   on public.events(garden_id, date desc);
create index if not exists custom_plants_garden_idx on public.custom_plants(garden_id);
create index if not exists members_user_idx         on public.garden_members(user_id);

-- ---------------------------------------------------------------- triggers

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['gardens','beds','plantings','events','custom_plants'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- private helpers
-- Security-definer helpers live in a schema the API doesn't expose, so policies can use them
-- without them being callable as RPCs. Definer rights stop garden_members policies from
-- recursing into themselves.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- The first version of this file put these in public; drop them (and dependent policies).
drop function if exists public.garden_role(uuid) cascade;
drop function if exists public.can_read_garden(uuid) cascade;
drop function if exists public.can_edit_garden(uuid) cascade;
drop function if exists public.add_owner_member() cascade;

create or replace function private.garden_role(gid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.garden_members where garden_id = gid and user_id = (select auth.uid())
$$;

create or replace function private.can_read_garden(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.garden_members where garden_id = gid and user_id = (select auth.uid()))
      or exists (select 1 from public.gardens where id = gid and is_public)
$$;

create or replace function private.can_edit_garden(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.garden_role(gid) in ('owner','editor'), false)
$$;

-- The creator of a garden becomes its owner member.
create or replace function private.add_owner_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.garden_members (garden_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (garden_id, user_id) do update set role = 'owner';
  return new;
end $$;

revoke all on all functions in schema private from public;
grant execute on function private.garden_role(uuid), private.can_read_garden(uuid), private.can_edit_garden(uuid)
  to anon, authenticated;

drop trigger if exists gardens_add_owner on public.gardens;
create trigger gardens_add_owner after insert on public.gardens
  for each row execute function private.add_owner_member();

-- ---------------------------------------------------------------- RLS
-- One policy per table+action (the linter flags overlapping permissive policies), and
-- auth.uid() wrapped in a subselect so it's evaluated once per statement, not per row.

alter table public.gardens        enable row level security;
alter table public.garden_members enable row level security;
alter table public.beds           enable row level security;
alter table public.plantings      enable row level security;
alter table public.events         enable row level security;
alter table public.custom_plants  enable row level security;

drop policy if exists gardens_read   on public.gardens;
drop policy if exists gardens_insert on public.gardens;
drop policy if exists gardens_update on public.gardens;
drop policy if exists gardens_delete on public.gardens;
-- owner_id check: INSERT … RETURNING is evaluated before the after-insert member trigger fires.
create policy gardens_read   on public.gardens for select
  using (is_public or owner_id = (select auth.uid()) or private.garden_role(id) is not null);
create policy gardens_insert on public.gardens for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy gardens_update on public.gardens for update to authenticated
  using (private.can_edit_garden(id)) with check (private.can_edit_garden(id));
create policy gardens_delete on public.gardens for delete to authenticated
  using (private.garden_role(id) = 'owner');

drop policy if exists members_read   on public.garden_members;
drop policy if exists members_write  on public.garden_members;
drop policy if exists members_insert on public.garden_members;
drop policy if exists members_update on public.garden_members;
drop policy if exists members_delete on public.garden_members;
create policy members_read   on public.garden_members for select to authenticated
  using (user_id = (select auth.uid()) or private.garden_role(garden_id) is not null);
create policy members_insert on public.garden_members for insert to authenticated
  with check (private.garden_role(garden_id) = 'owner');
create policy members_update on public.garden_members for update to authenticated
  using (private.garden_role(garden_id) = 'owner') with check (private.garden_role(garden_id) = 'owner');
create policy members_delete on public.garden_members for delete to authenticated
  using (private.garden_role(garden_id) = 'owner');

do $$
declare t text;
begin
  foreach t in array array['beds','plantings','events','custom_plants'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (private.can_read_garden(garden_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated
                    with check (private.can_edit_garden(garden_id))', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated
                    using (private.can_edit_garden(garden_id)) with check (private.can_edit_garden(garden_id))', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated
                    using (private.can_edit_garden(garden_id))', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- realtime
-- Lets a second device see edits live. Ignore "already member" errors on re-run.

do $$
declare t text;
begin
  foreach t in array array['gardens','beds','plantings','events','custom_plants'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- keep-alive
-- Free-tier projects pause after ~7 days without API traffic. The app pings this on
-- every open; it's also cheap enough for an external cron if the garden goes quiet in winter.

create or replace function public.ping() returns text
language sql stable set search_path = '' as $$ select 'pong'::text $$;
grant execute on function public.ping() to anon, authenticated;
