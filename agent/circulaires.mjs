// Agent hebdomadaire : vérifie les circulaires et met à jour les prix dans Supabase.
// Lancé chaque jeudi par GitHub Actions (.github/workflows/circulaires.yml).
//
// Variables d'environnement (secrets GitHub) :
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Facultatives : MODEL (défaut claude-sonnet-5-5), MAX_PRODUITS (défaut 30), TAILLE_LOT (défaut 5)

import { createClient } from "@supabase/supabase-js";
import { appendFileSync } from "node:fs";

const env = (k, d) => process.env[k] || d;
const MODEL = env("MODEL", "claude-sonnet-5-5");
const MAX_PRODUITS = parseInt(env("MAX_PRODUITS", "30"), 10);
const TAILLE_LOT = parseInt(env("TAILLE_LOT", "5"), 10);
for (const k of ["ANTHROPIC_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`Variable manquante : ${k}`); process.exit(1); }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const TODAY = ymd(new Date());
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
const usage = { input: 0, output: 0, searches: 0 };
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
    return body;
  }
  throw new Error("API Claude indisponible après plusieurs essais.");
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

function promptLot(lot, magasins, region) {
  return `Nous sommes le ${TODAY}. Tu aides un ménage de ${region} à suivre les prix d'épicerie.

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
async function main() {
  const config = (await must(sb.from("config").select("*").eq("id", 1).maybeSingle(), "config")) || {};
  const magasins = config.magasins?.length ? config.magasins : ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const region = config.region || "Montréal, QC";
  const produits = await must(sb.from("produits").select("*"), "produits");
  const epicerie = await must(sb.from("epicerie").select("*").eq("fait", false), "epicerie");
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

  console.log(`${choisis.length} produits à vérifier (sur ${produits.length}) dans ${magasins.join(", ")}.`);
  let semaine = null, debutSem = null, finSem = null;
  const resultats = new Map();
  for (let i = 0; i < choisis.length; i += TAILLE_LOT) {
    const lot = choisis.slice(i, i + TAILLE_LOT);
    console.log(`Lot ${i / TAILLE_LOT + 1} : ${lot.map((p) => p.nom).join(", ")}`);
    try {
      const r = await demander(promptLot(lot, magasins, region));
      if (!r) continue;
      semaine ||= r.semaine; debutSem ||= isDate(r.debut) ? r.debut : null; finSem ||= isDate(r.fin) ? r.fin : null;
      for (const x of r.resultats || []) if (lot.some((p) => p.id === x.id)) resultats.set(x.id, x);
    } catch (e) { console.error(`Lot ignoré : ${e.message}`); }
  }

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
  await must(sb.from("speciaux").delete().or(`fin.lt.${TODAY},fin.is.null`), "nettoyage spéciaux");
  const existants = await must(sb.from("speciaux").select("item, magasin, fin"), "spéciaux existants");
  const cle = (item, mag, fin) => `${norm(item)}|${norm(mag)}|${fin || ""}`;
  const deja = new Set(existants.map((s) => cle(s.item, s.magasin, s.fin)));
  const nouveaux = [];
  for (const s of surveiller) {
    const cible = s.prix_cible != null ? Number(s.prix_cible) : null;
    for (const t of trouves.filter((t) => norm(t.p.nom) === norm(s.nom))) {
      if (cible != null && t.prix > cible) continue;
      if (deja.has(cle(s.nom, t.magasin, t.fin))) continue;
      nouveaux.push({ item: s.nom, magasin: t.magasin, prix: t.prix, prix_reg: t.reg, detail: t.detail, debut: t.debut, fin: t.fin, lien: t.lien, semaine: semaine || "" });
    }
  }
  if (nouveaux.length) await must(sb.from("speciaux").insert(nouveaux), "ajout spéciaux");

  // ---------- magasin le moins cher pour la liste en cours
  const prodFrais = await must(sb.from("produits").select("nom, prix"), "relecture produits");
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
  await must(sb.from("config").update({ derniere_verif: new Date().toISOString(), semaine: semaine || null, resume }).eq("id", 1), "état agent");

  const lignes = nouveaux.map((n) => `- ${n.item} : ${n.prix.toFixed(2)} $ chez ${n.magasin}${n.fin ? ` (jusqu'au ${n.fin})` : ""}`);
  const rapport = [`## Circulaires ${semaine || ""}`, resume, "", ...(lignes.length ? lignes : ["Aucun article surveillé n'est en spécial cette semaine."]), "",
    `Recherches web : ${usage.searches} · jetons : ${usage.input} entrée, ${usage.output} sortie (${MODEL}).`].join("\n");
  console.log(rapport);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, rapport + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
