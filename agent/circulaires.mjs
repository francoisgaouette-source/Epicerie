// Agent hebdomadaire : vérifie les circulaires et met à jour les prix dans Supabase.
// Lancé chaque jeudi par GitHub Actions (.github/workflows/circulaires.yml).
//
// Variables d'environnement (secrets GitHub) :
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Facultatives : MODEL (défaut claude-sonnet-5-5), MAX_PRODUITS (défaut 30, par foyer),
//   MAX_PRODUITS_SEMAINE (défaut 150, pour toute l'app), TAILLE_LOT (défaut 5)
//
// Lecture commune : les circulaires sont les mêmes pour tout le monde. L'agent rassemble les produits
// de tous les foyers, cherche chaque produit une seule fois par semaine (table veille_prix), puis
// applique les prix trouvés à chaque foyer, sans autre appel à l'IA. Le coût dépend du nombre de
// produits différents, pas du nombre de foyers.

import { createClient } from "@supabase/supabase-js";
import { appendFileSync } from "node:fs";

const env = (k, d) => process.env[k] || d;
const MODEL = env("MODEL", "claude-sonnet-5-5");
const MAX_PRODUITS = parseInt(env("MAX_PRODUITS", "30"), 10);
const TAILLE_LOT = parseInt(env("TAILLE_LOT", "5"), 10);
const MAX_PRODUITS_SEMAINE = parseInt(env("MAX_PRODUITS_SEMAINE", "150"), 10);
for (const k of ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Variable manquante : ${k}`); process.exit(1); }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const TODAY = ymd(new Date());
// Clé commune d'un produit entre foyers : nom, marque et format normalisés
const cleProduit = (p) => [p.nom, p.marque, p.format].map(norm).join("|");
// Semaine des circulaires au Québec : du jeudi au mercredi. On la repère par son jeudi.
const JEUDI = (() => { const d = new Date(TODAY + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 3) % 7)); return d.toISOString().slice(0, 10); })();
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(",", ".").replace(/[^\d.]/g, "")); return isFinite(n) && n > 0 ? n : null; };
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
  "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];

async function must(q, what) {
  const { data, error } = await q;
  if (error) throw new Error(`${what} : ${error.message}`);
  return data;
}

// ---------- Claude (API Messages + recherche web)
const usage = { input: 0, output: 0, searches: 0, cacheEcrit: 0, cacheLu: 0 };
async function claude(messages) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        messages,
        tools: [{
          type: "web_search_20250305", name: "web_search", max_uses: 12,
          user_location: { type: "approximate", city: "Montréal", region: "Québec", country: "CA", timezone: "America/Toronto" },
        }],
      }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))); continue; }
    const body = await res.json();
    if (!res.ok) throw new Error(`API Claude ${res.status} : ${JSON.stringify(body.error || body)}`);
    usage.input += body.usage?.input_tokens || 0;
    usage.output += body.usage?.output_tokens || 0;
    usage.searches += body.usage?.server_tool_use?.web_search_requests || 0;
    usage.cacheEcrit += body.usage?.cache_creation_input_tokens || 0;
    usage.cacheLu += body.usage?.cache_read_input_tokens || 0;
    return body;
  }
  throw new Error("API Claude indisponible après plusieurs essais.");
}

// ---------- Coût de la lecture commune (table couts_ia, lue par la console). $ US par million de jetons :
// entrée, sortie, écriture en cache, lecture en cache. Recherche web : 0,01 $ chacune.
const PRIX = {
  "claude-haiku-5-5": [0.10, 0.50, 0.125, 0.01],
  "claude-sonnet-5-5": [2, 10, 2.5, 0.10],
  "claude-opus-5-5": [4, 20, 5, 0.20],
};
async function noterCout(foyer_id, avant, fonction = "circulaires") {
  const d = (k) => usage[k] - avant[k];
  const p = PRIX[MODEL] || PRIX["claude-sonnet-5-5"];
  const ligne = { app: "commis", fonction, foyer_id, modele: MODEL,
    entree: d("input"), sortie: d("output"), cache_ecrit: d("cacheEcrit"), cache_lu: d("cacheLu"), recherches: d("searches") };
  ligne.cout_usd = (ligne.entree * p[0] + ligne.sortie * p[1] + ligne.cache_ecrit * p[2] + ligne.cache_lu * p[3]) / 1e6 + ligne.recherches * 0.01;
  if (!ligne.entree && !ligne.recherches) return;
  console.log(`Coût de la lecture : ${ligne.cout_usd.toFixed(3)} $ US (${ligne.recherches} recherches, ${ligne.entree} jetons en entrée).`);
  const { error } = await sb.from("couts_ia").insert(ligne);
  if (error) console.warn(`Coût non noté : ${error.message}`);
}

async function demander(prompt) {
  const messages = [{ role: "user", content: prompt }];
  let texte = "";
  for (let tour = 0; tour < 6; tour++) {
    const r = await claude(messages);
    texte = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (r.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: r.content }); // reprendre une recherche longue
  }
  return extraireJSON(texte);
}

function extraireJSON(texte) {
  const blocs = [...texte.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidats = blocs.length ? blocs.reverse() : [texte.slice(texte.indexOf("{"), texte.lastIndexOf("}") + 1)];
  for (const c of candidats) { try { return JSON.parse(c); } catch {} }
  console.warn("Réponse sans JSON lisible :\n" + texte.slice(0, 1500));
  return null;
}

function promptLot(lot, magasins) {
  return `Nous sommes le ${TODAY}. Tu aides des ménages du Québec à suivre les prix d'épicerie.

Épiceries à vérifier : ${magasins.join(", ")}.

Produits (id, nom, marque, format) :
${lot.map((p) => `- ${p.id} | ${p.nom}${p.marque ? ` | ${p.marque}` : ""}${p.format ? ` | ${p.format}` : ""}`).join("\n")}

Pour chaque produit et chaque épicerie, trouve avec la recherche web :
1. S'il est en SPÉCIAL dans la circulaire de la semaine en cours (au Québec, les circulaires vont du jeudi au mercredi). Sources utiles : flipp.com, les pages circulaire et promotions de iga.net, metro.ca, maxi.ca, superc.ca, provigo.ca.
2. Son PRIX RÉGULIER, à partir de l'épicerie en ligne ou de la circulaire (prix avant rabais).

Règles :
- N'inscris un prix que s'il est confirmé par une source de la semaine; sinon mets null. Ne devine jamais.
- Le produit doit correspondre (marque et format semblables si précisés). Si le format diffère, indique-le dans "detail".
- Un prix « 2 pour 7 $ » donne special = 3.50 avec l'explication dans "detail". Note les conditions (carte de membre, limite, achat minimum).
- "categorie" : la catégorie la plus juste parmi ${CATS.join(", ")}.
- Fais au plus une dizaine de recherches au total, en ciblant les circulaires.

Réponds uniquement avec un bloc \`\`\`json contenant :
{"semaine":"du 5 au 11 novembre","debut":"AAAA-MM-JJ","fin":"AAAA-MM-JJ",
 "resultats":[{"id":"<id>","categorie":"...","magasins":{"<Épicerie>":{"reg":4.99,"special":3.49,"debut":"AAAA-MM-JJ","fin":"AAAA-MM-JJ","detail":"...","source":"https://..."}}}]}
N'inclus une épicerie que si tu as trouvé au moins un prix pour elle.`;
}

// ---------- programme principal
// Chaque foyer actif dont l'agent des circulaires est activé (foyers.circulaires = true)
async function main() {
  const foyers = await must(sb.from("foyers").select("id, nom, essai_fin, paye_jusqua, circulaires").eq("circulaires", true), "foyers");
  const actifs = foyers.filter((f) => new Date(f.essai_fin) > new Date() || (f.paye_jusqua && new Date(f.paye_jusqua) > new Date()));
  console.log(`${actifs.length} foyer(s) à traiter, semaine du jeudi ${JEUDI}.`);

  // 1. Ce que chaque foyer veut faire vérifier
  const ctxs = [];
  for (const f of actifs) {
    try { ctxs.push({ f, ...(await preparerFoyer(f.id)) }); } catch (e) { console.error(`Foyer ${f.nom} : ${e.message}`); }
  }

  // 2. Lecture commune : chaque produit différent, une fois par semaine
  const avant = { ...usage };
  let veille = new Map();
  try { veille = await lectureCommune(ctxs); } catch (e) { console.error(`Lecture commune : ${e.message}`); }
  await noterCout(null, avant, "circulaires");

  // 3. Appliquer à chaque foyer, sans IA
  for (const c of ctxs) {
    console.log(`\n=== Foyer « ${c.f.nom} » ===`);
    try { await appliquerFoyer(c, veille); } catch (e) { console.error(`Foyer ${c.f.nom} : ${e.message}`); }
  }
  const total = (usage.input * (PRIX[MODEL] || PRIX["claude-sonnet-5-5"])[0] + usage.output * (PRIX[MODEL] || PRIX["claude-sonnet-5-5"])[1]) / 1e6 + usage.searches * 0.01;
  const bilan = `\nCoût total de la semaine : ${total.toFixed(2)} $ US pour ${ctxs.length} foyer(s) (${usage.searches} recherches web, ${MODEL}).`;
  console.log(bilan);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, bilan + "\n");
}

async function preparerFoyer(FOYER) {
  const config = (await must(sb.from("config").select("*").eq("foyer_id", FOYER).maybeSingle(), "config")) || {};
  // Chaque lieu a ses épiceries : on vérifie toutes celles des lieux du foyer
  const lieux = (await must(sb.from("lieux").select("magasins").eq("foyer_id", FOYER), "lieux")) || [];
  const desLieux = [...new Set(lieux.flatMap((l) => Array.isArray(l.magasins) ? l.magasins : []))];
  const magasins = desLieux.length ? desLieux : config.magasins?.length ? config.magasins : ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const produits = await must(sb.from("produits").select("*").eq("foyer_id", FOYER), "produits");
  const epicerie = await must(sb.from("epicerie").select("*").eq("foyer_id", FOYER).eq("fait", false), "epicerie");
  // Les produits surveillés sont ceux marqués ★ dans le catalogue.
  const surveiller = produits.filter((p) => p.surveiller).map((p) => ({ nom: p.nom, prix_cible: p.prix_cible }));

  // Priorité : surveillés, puis dans la liste, puis prix les plus anciens.
  const nomsSurv = new Set(surveiller.map((s) => norm(s.nom)));
  const nomsListe = new Set(epicerie.map((e) => norm(e.nom)));
  const majMin = (p) => Object.values(p.prix || {}).map((e) => e.maj || "").sort()[0] || "";
  const rang = (p) => (nomsSurv.has(norm(p.nom)) ? 0 : nomsListe.has(norm(p.nom)) ? 1 : 2);
  const choisis = [...produits]
    .sort((a, b) => rang(a) - rang(b) || majMin(a).localeCompare(majMin(b)))
    .filter((p, i) => rang(p) === 0 || i < MAX_PRODUITS);
  return { FOYER, magasins, epicerie, surveiller, choisis, rang };
}

async function lectureCommune(ctxs) {
  // Besoins de tous les foyers, regroupés par produit : quelles épiceries, priorité, combien de foyers
  const besoins = new Map();
  for (const c of ctxs) for (const p of c.choisis) {
    const k = cleProduit(p);
    const b = besoins.get(k) || { p, magasins: new Set(), rang: 9, foyers: 0 };
    c.magasins.forEach((m) => b.magasins.add(m));
    b.rang = Math.min(b.rang, c.rang(p)); b.foyers++;
    besoins.set(k, b);
  }
  // Ce qui a déjà été lu cette semaine (par un autre foyer ou une exécution précédente)
  const veille = new Map();
  const cles = [...besoins.keys()];
  for (let i = 0; i < cles.length; i += 200) {
    const rows = await must(sb.from("veille_prix").select("cle, resultat, magasins").eq("semaine", JEUDI).in("cle", cles.slice(i, i + 200)), "veille");
    rows.forEach((r) => veille.set(r.cle, r));
  }
  const aLire = [...besoins.entries()]
    .map(([k, b]) => ({ k, ...b, manque: [...b.magasins].filter((m) => !(veille.get(k)?.magasins || []).includes(m)) }))
    .filter((x) => x.manque.length)
    .sort((a, b) => a.rang - b.rang || b.foyers - a.foyers);
  const coupes = aLire.length - MAX_PRODUITS_SEMAINE;
  if (coupes > 0) console.log(`Limite de ${MAX_PRODUITS_SEMAINE} produits par semaine : ${coupes} produit(s) attendront.`);
  const lus = aLire.slice(0, MAX_PRODUITS_SEMAINE);
  console.log(`${besoins.size} produits différents pour ${ctxs.length} foyer(s); ${besoins.size - aLire.length} déjà lus cette semaine, ${lus.length} à lire.`);

  for (let i = 0; i < lus.length; i += TAILLE_LOT) {
    const lot = lus.slice(i, i + TAILLE_LOT);
    const magasins = [...new Set(lot.flatMap((x) => x.manque))];
    console.log(`Lot ${i / TAILLE_LOT + 1} : ${lot.map((x) => x.p.nom).join(", ")} (${magasins.join(", ")})`);
    let r;
    try { r = await demander(promptLot(lot.map((x) => x.p), magasins)); } catch (e) { console.error(`Lot ignoré : ${e.message}`); continue; }
    if (!r) continue;
    const lignes = lot.map((x) => {
      const ancien = veille.get(x.k) || { resultat: {}, magasins: [] };
      const trouve = (r.resultats || []).find((y) => y.id === x.p.id) || {};
      const resultat = {
        semaine: ancien.resultat.semaine || r.semaine || null,
        debut: ancien.resultat.debut || (isDate(r.debut) ? r.debut : null),
        fin: ancien.resultat.fin || (isDate(r.fin) ? r.fin : null),
        categorie: trouve.categorie || ancien.resultat.categorie || null,
        magasins: { ...(ancien.resultat.magasins || {}), ...Object.fromEntries(Object.entries(trouve.magasins || {}).filter(([m]) => magasins.includes(m))) },
      };
      const ligne = { cle: x.k, semaine: JEUDI, resultat, magasins: [...new Set([...ancien.magasins, ...x.manque])], maj: new Date().toISOString() };
      veille.set(x.k, ligne);
      return ligne;
    });
    await must(sb.from("veille_prix").upsert(lignes, { onConflict: "cle,semaine" }), "enregistrer la veille");
  }
  return veille;
}

async function appliquerFoyer({ FOYER, magasins, epicerie, surveiller, choisis }, veille) {
  let semaine = null, debutSem = null, finSem = null;
  const resultats = new Map();
  for (const p of choisis) {
    const v = veille.get(cleProduit(p));
    if (!v) continue;
    resultats.set(p.id, v.resultat);
    semaine ||= v.resultat.semaine; debutSem ||= v.resultat.debut; finSem ||= v.resultat.fin;
  }
  console.log(`${resultats.size} produits sur ${choisis.length} ont une lecture cette semaine.`);

  // ---------- mise à jour des prix
  const ilYa30j = ymd(new Date(Date.now() - 30 * 864e5));
  let nbMaj = 0;
  const trouves = []; // spéciaux confirmés {produit, magasin, ...}
  for (const p of choisis) {
    const r = resultats.get(p.id);
    const prix = structuredClone(p.prix || {});
    let change = false;
    // Retirer les spéciaux expirés
    for (const m of Object.keys(prix)) {
      if (prix[m].finSpecial && prix[m].finSpecial < TODAY) { delete prix[m].special; delete prix[m].finSpecial; change = true; }
    }
    if (r) {
      for (const [m, v] of Object.entries(r.magasins || {})) {
        if (!magasins.includes(m) || !v) continue;
        const ancien = prix[m] || {};
        const protege = ancien.par === "manuel" && (ancien.maj || "") >= ilYa30j;
        const reg = num(v.reg), special = num(v.special);
        const source = /^https?:\/\//.test(v.source || "") ? v.source : ancien.source;
        const entree = { ...ancien };
        if (reg != null && !protege) { entree.reg = reg; entree.maj = TODAY; entree.par = "agent"; entree.source = source; }
        if (special != null) {
          entree.special = special;
          entree.finSpecial = isDate(v.fin) ? v.fin : finSem;
          trouves.push({ p, magasin: m, prix: special, reg: reg ?? num(ancien.reg), debut: isDate(v.debut) ? v.debut : debutSem, fin: entree.finSpecial, detail: v.detail || "", lien: source || "" });
        }
        if (JSON.stringify(entree) !== JSON.stringify(ancien)) { prix[m] = entree; change = true; }
      }
    }
    const maj = {};
    if (change) maj.prix = prix;
    if (r && p.categorie === "Autre" && CATS.includes(r.categorie) && r.categorie !== "Autre") maj.categorie = r.categorie;
    if (Object.keys(maj).length) { await must(sb.from("produits").update(maj).eq("id", p.id), "maj produit"); if (maj.prix) nbMaj++; }
  }

  // ---------- spéciaux des articles surveillés
  await must(sb.from("speciaux").delete().eq("foyer_id", FOYER).or(`fin.lt.${TODAY},fin.is.null`), "nettoyage spéciaux");
  const existants = await must(sb.from("speciaux").select("item, magasin, fin").eq("foyer_id", FOYER), "spéciaux existants");
  const cle = (item, mag, fin) => `${norm(item)}|${norm(mag)}|${fin || ""}`;
  const deja = new Set(existants.map((s) => cle(s.item, s.magasin, s.fin)));
  const nouveaux = [];
  for (const s of surveiller) {
    const cible = s.prix_cible != null ? Number(s.prix_cible) : null;
    for (const t of trouves.filter((t) => norm(t.p.nom) === norm(s.nom))) {
      if (cible != null && t.prix > cible) continue;
      if (deja.has(cle(s.nom, t.magasin, t.fin))) continue;
      nouveaux.push({ foyer_id: FOYER, item: s.nom, magasin: t.magasin, prix: t.prix, prix_reg: t.reg, detail: t.detail, debut: t.debut, fin: t.fin, lien: t.lien, semaine: semaine || "" });
    }
  }
  if (nouveaux.length) await must(sb.from("speciaux").insert(nouveaux), "ajout spéciaux");

  // ---------- magasin le moins cher pour la liste en cours
  const prodFrais = await must(sb.from("produits").select("nom, prix").eq("foyer_id", FOYER), "relecture produits");
  const pm = new Map(prodFrais.map((p) => [norm(p.nom), p]));
  const prixA = (p, m) => { const e = p?.prix?.[m]; if (!e) return null; if (e.special != null && (!e.finSpecial || e.finSpecial >= TODAY)) return e.special; return e.reg ?? null; };
  const totaux = magasins.map((m) => {
    let t = 0, n = 0; epicerie.forEach((i) => { const v = prixA(pm.get(norm(i.nom)), m); if (v != null) { t += v * (num(i.qte) || 1); n++; } });
    return { m, t, n };
  }).filter((x) => x.n > 0);
  const nMax = Math.max(0, ...totaux.map((x) => x.n));
  const meilleur = totaux.filter((x) => x.n === nMax).sort((a, b) => a.t - b.t)[0];

  const nbSurvSpecial = new Set(nouveaux.map((n) => norm(n.item))).size;
  const resume = `${nbSurvSpecial} article${nbSurvSpecial > 1 ? "s" : ""} surveillé${nbSurvSpecial > 1 ? "s" : ""} en spécial; prix mis à jour pour ${nbMaj} produit${nbMaj > 1 ? "s" : ""}.` +
    (meilleur && epicerie.length ? ` Pour la liste en cours, ${meilleur.m} est le moins cher (${meilleur.t.toFixed(2).replace(".", ",")} $ pour ${meilleur.n} article${meilleur.n > 1 ? "s" : ""} avec prix).` : "");
  await must(sb.from("config").update({ derniere_verif: new Date().toISOString(), semaine: semaine || null, resume }).eq("foyer_id", FOYER), "état agent");

  const lignes = nouveaux.map((n) => `- ${n.item} : ${n.prix.toFixed(2)} $ chez ${n.magasin}${n.fin ? ` (jusqu'au ${n.fin})` : ""}`);
  const rapport = [`## Circulaires ${semaine || ""}`, resume, "", ...(lignes.length ? lignes : ["Aucun article surveillé n'est en spécial cette semaine."]), "",
    ].join("\n");
  console.log(rapport);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rapport + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
