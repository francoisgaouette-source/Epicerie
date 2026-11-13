-- Notre épicerie : plusieurs lieux (Maison, Chalet…), chacun avec ses espaces et ses réserves
create table if not exists public.lieux (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null,
  ordre int  not null default 0,
  cree  timestamptz not null default now()
);
insert into public.lieux (nom, ordre) select 'Maison', 1 where not exists (select 1 from public.lieux);

alter table public.espaces add column if not exists lieu_id uuid references public.lieux(id) on delete cascade;
update public.espaces set lieu_id = (select id from public.lieux order by ordre, cree limit 1) where lieu_id is null;

create table if not exists public.inventaire (
  id         uuid primary key default gen_random_uuid(),
  produit_id uuid not null references public.produits(id) on delete cascade,
  lieu_id    uuid not null references public.lieux(id) on delete cascade,
  espace_id  uuid references public.espaces(id) on delete set null,
  stock      numeric not null default 0,
  minimum    numeric,
  peremption date,
  maj        timestamptz not null default now(),
  unique (produit_id, lieu_id)
);
create index if not exists inventaire_lieu_idx on public.inventaire(lieu_id);

-- Reprendre les réserves actuelles dans le premier lieu
insert into public.inventaire (produit_id, lieu_id, espace_id, stock, minimum, peremption)
select p.id, (select id from public.lieux order by ordre, cree limit 1), p.espace_id, coalesce(p.stock, 0), p.minimum, p.peremption
from public.produits p
where (coalesce(p.stock, 0) > 0 or p.espace_id is not null or p.minimum is not null or p.peremption is not null)
on conflict (produit_id, lieu_id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['lieux','inventaire'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists membres_tout on public.%I', t);
    execute format('create policy membres_tout on public.%I for all to authenticated using (private.est_membre()) with check (private.est_membre())', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
