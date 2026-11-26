-- CRM de la console HoldingAI (migration « crm », appliquée le 2026-11-25 dans le projet « Notre épicerie »).
-- Tables crm_contacts, crm_notes, crm_taches : lues et écrites seulement par la fonction console-crm (clé de service).
-- Fonction crm_donnees() : tout le CRM en un appel. Voir supabase/functions/console-crm pour les gestes.
-- Les personnes inscrites dans les apps (compte HoldingAI, Le Commis, Le Gousset, Le Tiroir) paraissent dans le CRM
-- sans fiche; la fiche est créée au premier geste (note, tâche, étape, modification).

-- 2026-11-26 : invitations à la bêta inscrites à la main (onglet CRM, « Invitations bêta »).
-- Les invitations faites avec « Inviter quelqu'un » dans les apps viennent de HoldingAI Compte (invitations_arrivees).
alter table public.crm_contacts
  add column if not exists invite_par uuid references public.crm_contacts(id) on delete set null,
  add column if not exists invite_app text,
  add column if not exists invite_le date;
alter table public.crm_contacts add constraint crm_contacts_invite_pas_soi check (invite_par is null or invite_par <> id);
create index if not exists crm_contacts_invite_par on public.crm_contacts(invite_par);
