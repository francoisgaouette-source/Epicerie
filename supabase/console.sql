-- Console HoldingAI (console.holdingai.app) : voir les migrations « console_holdingai » et « console_questions_commis »
-- appliquées dans Supabase. Tables : console_admins (qui a accès), console_questions (questions posées aux assistants),
-- console_paiements (paiements Stripe), console_journal (gestes faits dans la console).
-- Fonctions : console_donnees() (lecture, clé de service), temoignages_publies() (avis publiés, pour lecommis.ai).
-- Donner l'accès à une autre personne : insert into public.console_admins (user_id) select id from auth.users where email = '...';

-- À appliquer si ce n'est pas déjà fait : l'app note les questions posées au Commis
alter table public.console_questions alter column qui set default (auth.uid())::text;
alter table public.console_questions alter column foyer_id set default private.mon_foyer();
grant insert (app, question, reponse, contexte) on public.console_questions to authenticated;
drop policy if exists console_questions_ajout on public.console_questions;
create policy console_questions_ajout on public.console_questions for insert to authenticated
  with check (app = 'commis' and qui = (select auth.uid())::text and foyer_id is not null and foyer_id = private.mon_foyer());
