-- Notre épicerie : connexion par cellulaire (comme Le 19e)
-- Membres reconnus par courriel OU par cellulaire.

-- 1. Membres : identifiant, cellulaire, courriel facultatif
alter table public.membres add column if not exists id uuid not null default gen_random_uuid();
alter table public.membres add column if not exists telephone text;
alter table public.membres drop constraint if exists membres_pkey;
alter table public.membres add primary key (id);
alter table public.membres alter column email drop not null;
create unique index if not exists membres_email_unique on public.membres (lower(email)) where email is not null;
create unique index if not exists membres_tel_unique on public.membres (telephone) where telephone is not null;
alter table public.membres drop constraint if exists membres_contact;
alter table public.membres add constraint membres_contact check (email is not null or telephone is not null);

-- Cellulaire au format international (+1XXXXXXXXXX)
create or replace function private.tel_e164(t text)
returns text language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when length(regexp_replace(t, '\D', '', 'g')) = 10 then '+1' || regexp_replace(t, '\D', '', 'g')
    when length(regexp_replace(t, '\D', '', 'g')) = 11 and left(regexp_replace(t, '\D', '', 'g'), 1) = '1' then '+' || regexp_replace(t, '\D', '', 'g')
    else 'invalide' end;
$$;

-- 2. Qui est membre : courriel OU cellulaire du compte connecté
create or replace function private.est_membre()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.membres m
    where (m.email is not null and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
       or (m.telephone is not null and coalesce(auth.jwt() ->> 'phone', '') <> ''
           and regexp_replace(m.telephone, '\D', '', 'g') = regexp_replace(auth.jwt() ->> 'phone', '\D', '', 'g'))
  );
$$;

-- 3. Vérifications à l'ajout ou à la modification d'un membre (maximum 4)
create or replace function private.verifier_membres()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
    new.nom := trim(coalesce(new.nom, ''));
    new.telephone := private.tel_e164(new.telephone);
    if new.telephone = 'invalide' then raise exception 'cellulaire_invalide' using errcode = 'P0001'; end if;
    if new.email is not null and new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'courriel_invalide' using errcode = 'P0001'; end if;
    if new.email is null and new.telephone is null then raise exception 'contact_requis' using errcode = 'P0001'; end if;
    if tg_op = 'INSERT' then
      if (select count(*) from public.membres) >= 4 then raise exception 'limite_membres' using errcode = 'P0001'; end if;
      if new.invite_par is null then new.invite_par := coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'phone'); end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if (select count(*) from public.membres) <= 1 then raise exception 'dernier_membre' using errcode = 'P0001'; end if;
    return old;
  end if;
  return new;
end $$;
revoke all on function private.verifier_membres() from public, anon, authenticated;
drop trigger if exists membres_verif_ins on public.membres;
create trigger membres_verif_ins before insert or update on public.membres for each row execute function private.verifier_membres();

-- 4. Avant d'envoyer un texto : ce cellulaire est-il inscrit ? (évite d'envoyer des codes à n'importe qui)
create or replace function public.cellulaire_inscrit(tel text)
returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.membres where telephone is not null and telephone = private.tel_e164(tel));
$$;
revoke all on function public.cellulaire_inscrit(text) from public;
grant execute on function public.cellulaire_inscrit(text) to anon, authenticated;
grant usage on schema private to anon;
grant execute on function private.tel_e164(text) to anon, authenticated;

-- 5. « Ajouté par » : courriel ou cellulaire
alter table public.epicerie alter column par set default coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'phone');

-- 6. Abonnements aux notifications : par compte plutôt que par courriel
alter table public.abonnements add column if not exists user_id uuid default auth.uid();
alter table public.abonnements alter column email drop not null;
alter table public.abonnements alter column email set default lower(auth.jwt() ->> 'email');
drop policy if exists abonnements_siens on public.abonnements;
create policy abonnements_siens on public.abonnements for all to authenticated
  using (private.est_membre() and user_id = auth.uid())
  with check (private.est_membre() and user_id = auth.uid());
