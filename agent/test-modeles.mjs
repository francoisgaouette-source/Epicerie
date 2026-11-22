// Test des modèles : compare Sonnet et Haiku (ou d'autres) sur de vraies données de Le Commis,
// pour décider si on peut passer à un modèle moins cher sans perdre en qualité.
// Lancé à la main par GitHub Actions (.github/workflows/test-modeles.yml). Ne modifie aucune donnée.
//
// 1. Factures : relit les dernières photos de factures enregistrées (stockage « photos », dossier factures/)
//    avec chaque modèle et compare les articles, les prix et le total.
// 2. Circulaires : vérifie le même lot de produits avec chaque modèle et compare les prix trouvés.
//
// Variables : ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Facultatives : MODELES (défaut « claude-sonnet-5-5,claude-haiku-5-5 », le premier sert de référence),
//   NB_FACTURES (défaut 5), NB_PRODUITS (défaut 5)

import { createClient } from "@supabase/supabase-js";
import { appendFileSync } from "node:fs";
import { usage, PRIX, demander, promptLot } from "./circulaires.mjs";

const MODELES = (process.env.MODELES || "claude-sonnet-5-5,claude-haiku-5-5").split(",").map((m) => m.trim()).filter(Boolean);
const NB_FACTURES = parseInt(process.env.NB_FACTURES || "5", 10);
const NB_PRODUITS = parseInt(process.env.NB_PRODUITS || "5", 10);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const $ = (n) => (n == null ? "—" : `${n.toFixed(2)} $`);
const out = [];
const ecrire = (l = "") => { out.push(l); console.log(l); };

function cout(modele, u) {
  const p = PRIX[modele] || PRIX["claude-sonnet-5-5"];
  return (u.input * p[0] + u.output * p[1] + u.cacheEcrit * p[2] + u.cacheLu * p[3]) / 1e6 + u.searches * 0.01;
}
async function mesurer(modele, fn) {
  const avant = { ...usage }, t0 = Date.now();
  let r = null, erreur = null;
  try { r = await fn(); } catch (e) { erreur = e.message; }
  const d = Object.fromEntries(Object.keys(usage).map((k) => [k, usage[k] - avant[k]]));
  return { r, erreur, cout: cout(modele, d), secondes: (Date.now() - t0) / 1000, recherches: d.searches };
}

// ---------- appel simple à l'API (factures : vision, sans recherche web)
async function appel(modele, content) {
  for (let essai = 0; essai < 4; essai++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modele, max_tokens: 8000, messages: [{ role: "user", content }] }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 15000 * (essai + 1))); continue; }
    const body = await res.json();
    if (!res.ok) throw new Error(`API ${res.status} : ${body?.error?.message || ""}`);
    usage.input += body.usage?.input_tokens || 0; usage.output += body.usage?.output_tokens || 0;
    const texte = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = texte.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
  throw new Error("API indisponible.");
}

// Même consigne que la fonction lire-facture (supabase/functions/lire-facture/index.ts), sans la liste des
// produits du ménage : on compare ici la lecture du reçu lui-même.
const promptFacture = () => `Ces photos montrent une facture (reçu de caisse) d'épicerie au Québec.
Lis chaque article acheté. Ignore les sous-totaux, taxes, consignes, sacs, rabais globaux et modes de paiement.
Si une ligne de rabais suit un article, déduis-la du prix de cet article.
Les abréviations de caisse doivent être traduites en nom clair (ex. « LAIT 2% NAT 2L » → « Lait 2 % Natrel », format « 2 L »).
Réponds uniquement avec un objet JSON :
{"magasin":"nom de l'épicerie","date":"AAAA-MM-JJ de l'achat ou null","total_imprime":0.00,
 "articles":[{"texte":"texte de la ligne tel qu'imprimé","nom":"nom clair en français","format":"","quantite":1,"prix_total":0.00}]}
total_imprime : le sous-total des articles avant taxes imprimé sur le reçu, ou null.
Pour un article vendu au poids, mets quantite = 1 et indique le poids dans format.`;

async function testFactures() {
  ecrire("## 1. Lecture de factures");
  const { data: objets, error } = await sb.storage.from("photos").list("factures", { limit: 100 });
  if (error) { ecrire(`Stockage illisible : ${error.message}`); return; }
  // Les photos sont rangées par mois : factures/AAAA-MM/xxx.jpg
  const fichiers = [];
  for (const dossier of (objets || []).filter((o) => !o.metadata)) {
    const { data } = await sb.storage.from("photos").list(`factures/${dossier.name}`, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    (data || []).filter((o) => /\.(jpe?g|png|webp)$/i.test(o.name)).forEach((o) => fichiers.push({ chemin: `factures/${dossier.name}/${o.name}`, cree: o.created_at }));
  }
  fichiers.sort((a, b) => String(b.cree).localeCompare(String(a.cree)));
  const choisis = fichiers.slice(0, NB_FACTURES);
  ecrire(`${fichiers.length} photo(s) de facture trouvée(s); ${choisis.length} testée(s).\n`);
  const sommes = Object.fromEntries(MODELES.map((m) => [m, { cout: 0, secondes: 0, accord: 0, articles: 0 }]));

  for (const f of choisis) {
    const { data: blob, error: e2 } = await sb.storage.from("photos").download(f.chemin);
    if (e2) { ecrire(`- ${f.chemin} : illisible (${e2.message})`); continue; }
    const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const media = /\.png$/i.test(f.chemin) ? "image/png" : /\.webp$/i.test(f.chemin) ? "image/webp" : "image/jpeg";
    const content = [{ type: "image", source: { type: "base64", media_type: media, data } }, { type: "text", text: promptFacture() }];
    const res = {};
    for (const m of MODELES) res[m] = await mesurer(m, () => appel(m, content));
    const ref = res[MODELES[0]].r || {};
    const refArt = (ref.articles || []).map((a) => ({ ...a, p: num(a.prix_total), n: norm(a.nom) }));
    ecrire(`### ${f.chemin.split("/").pop()} — ${ref.magasin || "?"} ${ref.date || ""}`);
    ecrire(`Total imprimé lu par ${MODELES[0]} : ${$(num(ref.total_imprime))}\n`);
    ecrire(`| Modèle | Articles | Somme des articles | Total imprimé lu | Articles identiques à la référence* | Coût | Secondes |`);
    ecrire(`|---|---|---|---|---|---|---|`);
    for (const m of MODELES) {
      const x = res[m];
      if (x.erreur) { ecrire(`| ${m} | erreur : ${x.erreur} | | | | ${$(x.cout)} | ${x.secondes.toFixed(0)} |`); continue; }
      const art = (x.r.articles || []).map((a) => ({ ...a, p: num(a.prix_total), n: norm(a.nom) }));
      const somme = art.reduce((s, a) => s + (a.p || 0), 0);
      // Un article concorde s'il a le même prix qu'un article de la référence (chaque article de référence sert une fois)
      const libres = [...refArt];
      let accord = 0;
      for (const a of art) { const i = libres.findIndex((r) => r.p != null && r.p === a.p); if (i >= 0) { accord++; libres.splice(i, 1); } }
      sommes[m].cout += x.cout; sommes[m].secondes += x.secondes; sommes[m].accord += accord; sommes[m].articles += refArt.length;
      ecrire(`| ${m} | ${art.length} | ${$(somme)} | ${$(num(x.r.total_imprime))} | ${m === MODELES[0] ? "référence" : `${accord} sur ${refArt.length}`} | ${x.cout.toFixed(4)} $ | ${x.secondes.toFixed(0)} |`);
    }
    // Détail ligne par ligne, pour juger à l'œil les noms traduits
    ecrire(`\n<details><summary>Articles lus par chaque modèle</summary>\n`);
    ecrire(`| ${MODELES.join(" | ")} |`); ecrire(`|${MODELES.map(() => "---").join("|")}|`);
    const listes = MODELES.map((m) => (res[m].r?.articles || []).map((a) => `${a.nom || a.texte} ${a.format || ""} — ${$(num(a.prix_total))}`));
    for (let i = 0; i < Math.max(...listes.map((l) => l.length)); i++) ecrire(`| ${listes.map((l) => l[i] || "").join(" | ")} |`);
    ecrire(`\n</details>\n`);
  }
  if (choisis.length) {
    ecrire(`**Bilan des factures** (*même prix qu'un article lu par ${MODELES[0]})\n`);
    for (const m of MODELES) {
      const s = sommes[m];
      ecrire(`- ${m} : ${(s.cout / choisis.length).toFixed(4)} $ par facture` + (m === MODELES[0] ? " (référence)" : `, ${s.articles ? Math.round((100 * s.accord) / s.articles) : 0} % des articles identiques`) + `, ${(s.secondes / choisis.length).toFixed(0)} s par facture.`);
    }
  }
  ecrire("");
}

async function testCirculaires() {
  ecrire("## 2. Circulaires");
  const { data: foyers } = await sb.from("foyers").select("id, nom").eq("circulaires", true).limit(1);
  if (!foyers?.length) { ecrire("Aucun foyer avec les circulaires activées."); return; }
  const FOYER = foyers[0].id;
  const { data: lieux } = await sb.from("lieux").select("magasins").eq("foyer_id", FOYER);
  const magasins = [...new Set((lieux || []).flatMap((l) => l.magasins || []))].slice(0, 5);
  const mags = magasins.length ? magasins : ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const { data: produits } = await sb.from("produits").select("id, nom, marque, format, surveiller").eq("foyer_id", FOYER);
  const lot = [...(produits || [])].sort((a, b) => Number(!!b.surveiller) - Number(!!a.surveiller)).slice(0, NB_PRODUITS);
  ecrire(`Lot de ${lot.length} produits (${lot.map((p) => p.nom).join(", ")}) dans ${mags.join(", ")}.\n`);

  const res = {};
  for (const m of MODELES) res[m] = await mesurer(m, () => demander(promptLot(lot, mags), m));
  ecrire(`| Modèle | Prix trouvés | Spéciaux trouvés | Identiques à la référence* | Recherches web | Coût | Secondes |`);
  ecrire(`|---|---|---|---|---|---|---|`);
  const prixDe = (r) => {
    const l = [];
    for (const x of r?.resultats || []) for (const [mag, v] of Object.entries(x.magasins || {})) {
      if (num(v?.reg) != null) l.push({ k: `${x.id}|${mag}|reg`, p: num(v.reg) });
      if (num(v?.special) != null) l.push({ k: `${x.id}|${mag}|special`, p: num(v.special) });
    }
    return l;
  };
  const ref = new Map(prixDe(res[MODELES[0]].r).map((x) => [x.k, x.p]));
  for (const m of MODELES) {
    const x = res[m];
    if (x.erreur) { ecrire(`| ${m} | erreur : ${x.erreur} | | | ${x.recherches} | ${x.cout.toFixed(3)} $ | ${x.secondes.toFixed(0)} |`); continue; }
    const l = prixDe(x.r);
    const accord = l.filter((y) => ref.get(y.k) === y.p).length;
    ecrire(`| ${m} | ${l.filter((y) => y.k.endsWith("reg")).length} | ${l.filter((y) => y.k.endsWith("special")).length} | ${m === MODELES[0] ? "référence" : `${accord} sur ${ref.size}`} | ${x.recherches} | ${x.cout.toFixed(3)} $ | ${x.secondes.toFixed(0)} |`);
  }
  ecrire(`\n<details><summary>Prix trouvés par chaque modèle</summary>\n`);
  ecrire(`| Produit | Épicerie | ${MODELES.join(" | ")} |`); ecrire(`|---|---|${MODELES.map(() => "---").join("|")}|`);
  for (const p of lot) for (const mag of mags) {
    const cell = (m) => { const v = (res[m].r?.resultats || []).find((x) => x.id === p.id)?.magasins?.[mag]; return v ? `rég. ${$(num(v.reg))}${num(v.special) != null ? `, spécial ${$(num(v.special))}` : ""}` : ""; };
    const cells = MODELES.map(cell);
    if (cells.some(Boolean)) ecrire(`| ${p.nom} | ${mag} | ${cells.join(" | ")} |`);
  }
  ecrire(`\n</details>\n\n*même produit, même épicerie, même prix que ${MODELES[0]}. Les écarts ne sont pas tous des erreurs : vérifiez quelques prix sur flipp.com.`);
}

ecrire(`# Test des modèles — ${new Date().toISOString().slice(0, 10)}\nRéférence : ${MODELES[0]}. Comparé : ${MODELES.slice(1).join(", ")}.\n`);
try { await testFactures(); } catch (e) { ecrire(`Test des factures interrompu : ${e.message}`); }
try { await testCirculaires(); } catch (e) { ecrire(`Test des circulaires interrompu : ${e.message}`); }
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
