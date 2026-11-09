-- Notre épicerie : plusieurs listes configurables
create table if not exists public.listes (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null,
  ordre int  not null default 0,
  cree  timestamptz not null default now()
);
insert into public.listes (nom, ordre) select 'Épicerie', 1 where not exists (select 1 from public.listes);

alter table public.epicerie add column if not exists liste_id uuid references public.listes(id) on delete cascade;
update public.epicerie set liste_id = (select id from public.listes order by ordre, cree limit 1) where liste_id is null;
alter table public.produits add column if not exists liste_id uuid references public.listes(id) on delete set null;

alter table public.listes enable row level security;
drop policy if exists membres_tout on public.listes;
create policy membres_tout on public.listes for all to authenticated
  using (private.est_membre()) with check (private.est_membre());
do $$ begin
  alter publication supabase_realtime add table public.listes;
exception when duplicate_object then null; end $$;
