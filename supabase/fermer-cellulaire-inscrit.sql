-- Appliqué le 2026-11-13 : la nouvelle app n'utilise plus cette fonction.
revoke execute on function public.cellulaire_inscrit(text) from public, anon, authenticated;
