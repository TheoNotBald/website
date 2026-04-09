create extension if not exists pgcrypto;

create table if not exists public.applications (
  id bigint generated always as identity primary key,
  discord_id text not null,
  ign text not null,
  preferred_side text not null,
  status text not null default 'pending' check (status in ('pending', 'under_review', 'accepted', 'denied', 'archived')),
  answers jsonb not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_applications_discord_id on public.applications(discord_id);
create index if not exists idx_applications_status on public.applications(status);
create index if not exists idx_applications_created_at on public.applications(created_at);

create table if not exists public.manager_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('accepted', 'denied', 'deleted')),
  application_id bigint not null references public.applications(id) on delete cascade,
  minecraft_username text,
  actor_discord_id text,
  actor_name text,
  actor_alias text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_manager_logs_created_at on public.manager_logs(created_at desc);
create index if not exists idx_manager_logs_application_id on public.manager_logs(application_id);
