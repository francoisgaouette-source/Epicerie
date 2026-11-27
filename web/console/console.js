// Console de L'Établi (anciennement HoldingAI) : tout passe par la fonction serveur « console », qui vérifie que le compte y a droit.
(() => {
  const URL_SB = "https://gandliltstmtfsmsjaew.supabase.co";
  const CLE_SB = "sb_publishable_8b0VbS6YyEf5vrsn5u9m4Q_JJZ1vkmP"; // clé publique : l'accès est décidé par le serveur
  const sb = window.supabase.createClient(URL_SB, CLE_SB, { auth: { storageKey: "holdingai.console" } });
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const JOUR = 864e5;
  const etat = { vue: "traiter", d: null, courriel: "", role: "lecture", frais: null, filtre: "attente" };

  // ---------- dates et mots
  const fDate = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", year: "numeric" });
  const fHeure = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const t = (v) => (v == null || v === "" ? 0 : typeof v === "number" ? v : new Date(v).getTime());
  const jour = (v) => (t(v) ? fDate.format(t(v)) : "");
  const moment = (v) => (t(v) ? fHeure.format(t(v)) : "");
  const ilYA = (v) => {
    if (!t(v)) return "jamais";
    const j = Math.floor((Date.now() - t(v)) / JOUR);
    return j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : j < 60 ? `il y a ${j} jours` : `il y a ${Math.round(j / 30)} mois`;
  };
  const pl = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
  const tel = (s) => { const d = String(s || "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : s || ""; };
  const argent = (c, devise) => (c == null ? "" : new Intl.NumberFormat("fr-CA", { style: "currency", currency: (devise || "cad").toUpperCase() }).format(c / 100));

  // ---------- états
  function forfaitCommis(f) {
    const now = Date.now(), paye = t(f.paye_jusqua), essai = t(f.essai_fin);
    if (paye > now) return new Date(paye).getFullYear() >= 2090 ? { cle: "paye", mot: "À vie", detail: "foyer fondateur" } : { cle: "paye", mot: "Payé", detail: `jusqu'au ${jour(paye)}` };
    if (essai > now) { const j = Math.ceil((essai - now) / JOUR); return { cle: "essai", mot: "Essai", detail: `encore ${pl(j, "jour", "jours")}`, jours: j }; }
    return { cle: "fini", mot: "Terminé", detail: paye ? `forfait fini le ${jour(paye)}` : `essai fini le ${jour(essai)}` };
  }
  function forfaitFanion(g) {
    if (g.plan === "groupe" && (!g.paye_jusqua || t(g.paye_jusqua) > Date.now())) return { cle: "paye", mot: "Groupe", detail: g.paye_jusqua ? `jusqu'au ${jour(g.paye_jusqua)}` : "sans date de fin", max: 16 };
    if (g.plan === "groupe") return { cle: "fini", mot: "Saison finie", detail: `le ${jour(g.paye_jusqua)}`, max: 4 };
    return { cle: "gratuit", mot: "Gratuit", detail: "", max: 4 };
  }
  const tamponForfait = (e) => `<span class="tampon ${e.cle === "paye" ? "" : e.cle === "fini" ? "refus" : e.cle === "essai" ? "attente" : "neutre"}">${esc(e.mot)}</span>`;
  const etatAvis = (a) => (a.publie ? "publie" : a.ecarte ? "ecarte" : "attente");
  const tamponAvis = (a, cle) => {
    const e = etatAvis(a), frais = etat.frais === cle ? " frais" : "";
    return e === "publie" ? `<span class="tampon${frais}">Publié</span>` : e === "ecarte" ? `<span class="tampon refus${frais}">Écarté</span>` : `<span class="tampon attente${frais}">En attente</span>`;
  };
  // Les apps de L'Établi, avec leur nom exact (clé courte = slug de HoldingAI Compte sans « le- », « la- » ou « l »)
  const nomApp = { echange: "L'Échange", gousset: "Le Gousset", pourquoi: "Le Pourquoi", commis: "Le Commis", fanion: "Le Fanion", seuil: "Le Seuil", plumeau: "Le Plumeau",
    vestibule: "Le Vestibule", tiroir: "Le Tiroir", voute: "La Voûte", donne: "La Donne", nostalgie: "La Nostalgie", escale: "L'Escale", debours: "Le Débours", holdingai: "L’Établi", console: "Console" };
  const puce = (app) => `<span class="app"><i class="pastille ${esc(app)}"></i>${esc(nomApp[app] || app)}</span>`;

  // ---------- serveur
  // Idées, sondages et nouveautés : fonctions de la base, réservées aux comptes de la console
  const MSG_RPC = { acces_refuse: "Votre accès permet seulement de consulter.", titre_requis: "Donnez un titre à la nouveauté.", introuvable: "Idée introuvable." };
  async function rpc(nom, args) {
    const { data, error } = await sb.rpc(nom, args);
    if (error) throw Object.assign(new Error(MSG_RPC[error.message] || error.message), { code: 400 });
    return data;
  }
  // Le Plumeau a son propre projet Supabase : la fonction « console-plumeau » fait le pont (comptes séparés du Commis)
  async function pont(corps) {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw Object.assign(new Error("Connexion requise."), { code: 401 });
    const r = await fetch(`${URL_SB}/functions/v1/console-plumeau`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CLE_SB, Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify(corps),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erreur || d.message || `Erreur ${r.status}`), { code: r.status === 401 || r.status === 403 ? 400 : r.status });
    return d;
  }
  // Le Tiroir et Le Gousset : une fonction « console-pont » dans chaque projet vérifie l'accès auprès du Commis
  // Frais variables lus dans les factures (Anthropic, Twilio, Stripe) : chargés seulement quand l'onglet Coûts s'ouvre
  async function factures(rafraichir) {
    if (etat.facturesEnCours) return;
    etat.facturesEnCours = true;
    try {
      const { data: s } = await sb.auth.getSession();
      const r = await fetch(`${URL_SB}/functions/v1/console-factures`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CLE_SB, Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify({ rafraichir: !!rafraichir }) });
      const d = await r.json().catch(() => ({}));
      etat.factures = r.ok ? d : { erreur: d.erreur || `Erreur ${r.status}` };
    } catch (e) { etat.factures = { erreur: e.message }; }
    etat.facturesEnCours = false;
    if (etat.vue === "couts") rendre();
  }
  const PROJETS = { commis: URL_SB, tiroir: "https://inhheqccvhwybmcdboip.supabase.co", gousset: "https://jdgflxesnaiumxodrkzd.supabase.co",
    seuil: "https://wuvpckyktoukttkbdzql.supabase.co", // Le Seuil et La Voûte (projet commun)
    compte: "https://wwakxuzuhmdmweluafiz.supabase.co" }; // HoldingAI Compte
  async function pontApp(app, corps) {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw Object.assign(new Error("Connexion requise."), { code: 401 });
    const r = await fetch(`${PROJETS[app]}/functions/v1/console-pont`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify(corps) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erreur || d.message || `Erreur ${r.status}`), { code: r.status === 401 || r.status === 403 ? 400 : r.status });
    return d;
  }
  const appDe = (liste, id) => ((((etat.d || {}).retour || {})[liste] || []).find((x) => x.id === id) || {}).app;
  async function appel(corps) {
    if (corps.action === "commis.idee" && appDe("idees", corps.id) === "plumeau") return pont({ action: "idee", id: corps.id, statut: corps.statut ?? null, reponse: corps.reponse ?? null });
    if (corps.action === "commis.nouveaute" && (corps.geste === "retirer" ? appDe("nouveautes", corps.id) === "plumeau" : corps.app === "plumeau"))
      return pont(corps.geste === "retirer" ? { action: "nouveaute", retirer: corps.id } : { action: "nouveaute", titre: corps.titre, texte: corps.texte || null, idee_id: corps.idee_id || null });
    if (corps.action === "tiroir.foyer") return pontApp("tiroir", { action: "foyer", id: corps.id, geste: corps.geste, paiement: corps.paiement || null });
    if (corps.action === "gousset.demande") return pontApp("gousset", { action: "demande", id: corps.id, statut: corps.statut });
    if (corps.action === "plumeau.bloquer") return pont({ action: "bloquer", user_id: corps.user_id, bloque: corps.bloque });
    if (corps.action === "commis.idee") return rpc("console_idee", { p_id: corps.id, p_statut: corps.statut ?? null, p_reponse: corps.reponse ?? null });
    if (corps.action === "commis.nouveaute") return rpc("console_nouveaute", corps.geste === "retirer" ? { p_retirer: corps.id } : { p_titre: corps.titre, p_texte: corps.texte || null, p_idee: corps.idee_id || null, p_app: corps.app || "commis" });
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw Object.assign(new Error("Connexion requise."), { code: 401 });
    const r = await fetch(`${URL_SB}/functions/v1/console`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CLE_SB, Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify(corps),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erreur || d.message || `Erreur ${r.status}`), { code: r.status });
    return d;
  }
  let toastT;
  function toast(msg, err) {
    const el = $("#toast"); el.textContent = msg; el.className = "toast" + (err ? " err" : ""); el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, err ? 6000 : 2600);
  }
  function confirmer({ titre, texte, bouton, raison }) {
    return new Promise((res) => {
      const dlg = $("#dlg");
      $("#dlg-titre").textContent = titre; $("#dlg-texte").textContent = texte; $("#dlg-ok").textContent = bouton;
      $("#dlg-raison-l").hidden = !raison; $("#dlg-raison").value = "";
      dlg.onclose = () => res(dlg.returnValue === "ok" ? { raison: $("#dlg-raison").value.trim() } : null);
      dlg.returnValue = ""; dlg.showModal();
    });
  }

  // ---------- éléments à traiter
  function aTraiter(d) {
    const avis = [
      ...d.commis.avis.filter((a) => etatAvis(a) === "attente").map((a) => ({ ...a, app: "commis" })),
      ...d.fanion.avis.filter((a) => etatAvis(a) === "attente").map((a) => ({ ...a, app: "fanion" })),
    ].sort((a, b) => t(b.cree) - t(a.cree));
    const paiements = d.commis.paiements.filter((p) => !p.active);
    const essais = d.commis.foyers.map((f) => ({ f, e: forfaitCommis(f) })).filter((x) => x.e.cle === "essai" && x.e.jours <= 7);
    const fils = filsCourriels(d).filter((f) => f.attente);
    const idees = ((d.retour || {}).idees || []).filter((i) => i.statut === "recue");
    const acces = ((d.gousset || {}).demandes || []).filter((x) => x.statut === "pending");
    const paiementsTiroir = (d.tiroir || {}).paiements || [];
    const crmDues = tachesDues();
    return { avis, paiements, essais, fils, idees, acces, paiementsTiroir, crm: crmDues, demandes: d.fanion.demandes, n: crmDues.length + avis.length + paiements.length + d.fanion.demandes.length + fils.length + idees.length + acces.length + paiementsTiroir.length };
  }

  // ---------- courriels : les messages d'un même échange forment un fil
  function filsCourriels(d) {
    const parFil = new Map();
    for (const c of d.courriels || []) { if (!parFil.has(c.fil)) parFil.set(c.fil, []); parFil.get(c.fil).push(c); }
    return [...parFil.values()].map((ms) => {
      ms.sort((a, b) => t(a.cree) - t(b.cree));
      const recus = ms.filter((m) => m.sens === "recu");
      const dernier = recus[recus.length - 1] || ms[ms.length - 1];
      return { fil: dernier.fil, app: dernier.app, ms, dernier, peutRepondre: !!recus.length, attente: recus.some((m) => !m.traite), repondu: ms.some((m) => m.sens === "envoye"), auto: recus.length > 0 && recus.every((m) => m.auto), date: t(ms[ms.length - 1].cree) };
    }).sort((a, b) => b.date - a.date);
  }
  const taille = (n) => (n == null ? "" : n < 1024 ? ` (${n} o)` : n < 1048576 ? ` (${Math.round(n / 1024)} Ko)` : ` (${(n / 1048576).toFixed(1).replace(".", ",")} Mo)`);
  const LONG = 700;
  function corpsCourriel(m) {
    const x = m.texte || "";
    if (!x) return `<p class="note">Ce message n'a pas de texte.</p>`;
    if (x.length <= LONG) return `<p class="lettre">${esc(x)}</p>`;
    return `<p class="lettre">${esc(x.slice(0, LONG).replace(/\s+\S*$/, ""))}…</p><details><summary>Lire le message au complet</summary><p class="lettre">${esc(x)}</p></details>`;
  }
  function messageCourriel(m) {
    const qui = m.sens === "envoye" ? `Réponse envoyée de ${esc(m.de)}` : `${esc(m.de_nom || m.de)}`;
    return `<div class="message${m.sens === "envoye" ? " envoye" : ""}">
      <p class="note"><b>${qui}</b>, ${esc(moment(m.cree))}</p>
      ${corpsCourriel(m)}
      ${(m.pieces || []).length ? `<p class="note">${pl(m.pieces.length, "pièce jointe", "pièces jointes")}${m.copie ? ", à ouvrir dans la copie reçue dans votre boîte" : ""} : ${m.pieces.map((p) => esc(p.nom) + taille(p.taille)).join(", ")}</p>` : ""}
      ${m.tronque ? `<p class="note alerte">Message très long : la fin se trouve dans la copie reçue dans votre boîte.</p>` : ""}
    </div>`;
  }
  function ficheCourriel(f) {
    const c = f.dernier, avant = f.ms.filter((m) => m !== c);
    const tampon = f.attente ? `<span class="tampon attente">À traiter</span>` : f.repondu ? `<span class="tampon">Répondu</span>` : f.auto ? `<span class="tampon neutre">Automatique</span>` : `<span class="tampon neutre">Traité</span>`;
    const gestes = [];
    if (f.peutRepondre && !f.auto) gestes.push(`<button class="btn" data-courriel="${esc(c.id)}" data-geste="repondre">Répondre</button>`);
    gestes.push(f.attente ? `<button class="btn pale" data-courriel="${esc(c.id)}" data-geste="traite">Marquer comme traité</button>` : `<button class="btn pale" data-courriel="${esc(c.id)}" data-geste="atraiter">Remettre à traiter</button>`);
    if (f.peutRepondre && f.auto) gestes.push(`<button class="lien" data-courriel="${esc(c.id)}" data-geste="repondre">Répondre quand même</button>`);
    return `<article class="fiche">
      ${tampon}
      <div class="tete">${puce(f.app)}<b>${esc(c.sens === "envoye" ? c.a : c.de_nom || c.de)}</b>${c.sens === "recu" && c.de_nom ? `<span>${esc(c.de)}</span>` : ""}<span>écrit à ${esc(c.sens === "envoye" ? c.de : c.a)}</span><span>${esc(moment(c.cree))}</span></div>
      <h3 class="objet">${esc(c.sujet || "(sans objet)")}</h3>
      ${avant.length ? `<details><summary>Voir le reste de l'échange (${pl(avant.length, "autre message", "autres messages")})</summary><div class="echange">${avant.map(messageCourriel).join("")}</div></details>` : ""}
      ${messageCourriel(c)}
      ${c.sens === "recu" && c.repondre_a ? `<p class="note">La réponse ira à ${esc(c.repondre_a)}, comme le demande ce message.</p>` : ""}
      <div class="gestes">${gestes.join("")}</div>
    </article>`;
  }
  function vueCourriels(d) {
    const fils = filsCourriels(d), nAttente = fils.filter((f) => f.attente).length;
    const FILTRES = [["attente", `À traiter${nAttente ? ` (${nAttente})` : ""}`], ["tous", "Tous"], ["holdingai", "L’Établi"], ["commis", "Le Commis"], ["fanion", "Le Fanion"], ["auto", "Automatiques"]];
    const k = etat.filtre;
    const vus = fils.filter((f) => (k === "attente" ? f.attente : k === "tous" ? true : k === "auto" ? f.auto : f.app === k && !f.auto));
    const vide = !fils.length ? "Aucun courriel reçu pour l'instant. Tout ce qui est écrit à une adresse @letabli.ai, @holdingai.app, @lecommis.ai ou @fanion.ai arrivera ici."
      : k === "attente" ? "Aucun courriel à traiter." : "Aucun courriel dans cette liste.";
    return section("Courriels", "Tout ce qui est écrit à une adresse @letabli.ai, @holdingai.app, @lecommis.ai ou @fanion.ai. Une copie arrive aussi dans votre boîte personnelle. Les réponses partent de l'adresse à laquelle la personne a écrit.",
      `<div class="filtres" role="group" aria-label="Filtrer les courriels">${FILTRES.map(([c, mot]) => `<button class="filtre" data-filtre="${c}" aria-pressed="${k === c}">${mot}</button>`).join("")}</div>` + liste(vus.slice(0, 100).map(ficheCourriel), vide));
  }

  // ---------- morceaux d'écran
  function ficheAvis(a, app) {
    const cle = `${app}:${a.id}`, e = etatAvis(a);
    const qui = app === "commis" ? [a.prenom, a.ville].filter(Boolean).join(", ") || "Sans nom" : [a.prenom, a.groupe].filter(Boolean).join(", ") || "Sans nom";
    const gestes = [];
    if (e !== "publie") gestes.push(`<button class="btn" data-avis="${esc(cle)}" data-etat="publie" ${a.accord ? "" : "disabled"}>Publier sur le site</button>`);
    if (e === "publie") gestes.push(`<button class="btn pale" data-avis="${esc(cle)}" data-etat="attente">Retirer du site</button>`);
    if (e === "attente") gestes.push(`<button class="btn pale" data-avis="${esc(cle)}" data-etat="ecarte">Écarter</button>`);
    if (e === "ecarte") gestes.push(`<button class="btn pale" data-avis="${esc(cle)}" data-etat="attente">Remettre en attente</button>`);
    return `<article class="fiche">
      ${tamponAvis(a, cle)}
      <div class="tete">${puce(app)}<b>${esc(qui)}</b><span>${esc(jour(a.cree))}</span>${a.etoiles ? `<span class="etoiles" aria-label="${a.etoiles} sur 5">${"★".repeat(a.etoiles)}${"☆".repeat(5 - a.etoiles)}</span>` : ""}${app === "commis" && a.foyer ? `<span>foyer ${esc(a.foyer)}</span>` : ""}</div>
      <blockquote>${esc(a.texte)}</blockquote>
      ${a.accord ? "" : `<p class="note alerte">La personne n'a pas accepté l'affichage sur le site. Cet avis reste privé.</p>`}
      <div class="gestes">${gestes.join("")}</div>
    </article>`;
  }
  const ficheDemande = (q) => `<article class="fiche">
      <div class="tete">${puce("fanion")}<b>${esc(q.nom)}</b><span>${esc(q.par)}${q.groupe ? `, ${esc(q.groupe)}` : ""}</span><span>${esc(jour(q.cree))}</span></div>
      ${q.lien ? `<p><a href="${esc(/^https?:\/\//i.test(q.lien) ? q.lien : "https://" + q.lien)}" target="_blank" rel="noopener noreferrer">${esc(q.lien)}</a></p>` : ""}
      ${q.texte ? `<blockquote>${esc(q.texte)}</blockquote>` : ""}
      <div class="gestes"><button class="btn pale" data-demande="${esc(q.id)}">Marquer comme traitée</button></div>
    </article>`;
  const ficheQuestion = (q) => `<article class="fiche">
      <div class="tete"><b>${esc(moment(q.cree))}</b>${q.foyer ? `<span>foyer ${esc(q.foyer)}</span>` : ""}${q.contexte ? `<span>écran ${esc(q.contexte)}</span>` : ""}</div>
      <blockquote>${esc(q.question)}</blockquote>
      ${q.reponse ? `<details><summary>Voir la réponse</summary><p class="reponse">${esc(q.reponse.replace(/\[\[ecran:[^\]]*\]\]/g, "").trim())}</p></details>` : ""}
    </article>`;
  const section = (titre, sous, corps) => `<section class="section"><h2>${titre}</h2>${sous ? `<p class="sous">${sous}</p>` : ""}${corps}</section>`;
  const liste = (items, vide) => (items.length ? `<div class="liste">${items.join("")}</div>` : `<p class="vide">${vide}</p>`);
  const chiffres = (paires) => `<div class="chiffres">${paires.map(([n, mot]) => `<div class="chiffre"><b>${n}</b><span>${mot}</span></div>`).join("")}</div>`;
  const table = (entetes, lignes, vide) => (lignes.length
    ? `<div class="table-boite"><table><thead><tr>${entetes.map((h) => `<th${h.n ? ' class="n"' : ""}>${h.t}</th>`).join("")}</tr></thead><tbody>${lignes.map((l) => `<tr>${l.map((c, i) => `<td data-t="${esc(entetes[i].t)}" class="${i === 0 ? "principal" : ""}${entetes[i].n ? " n" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<p class="vide">${vide}</p>`);

  // ---------- idées, sondages et nouveautés du Commis
  const TYPES = { idee: ["💡", "Idée"], probleme: ["🐞", "Problème"], aime: ["❤️", "J'aime"], autre: ["💬", "Commentaire"] };
  const STATUTS = { recue: "À lire", etudiee: "À l'étude", prevue: "Prévue", faite: "Faite", non: "Non retenue" };
  const SOURCES = { app: "", sondage: "réponse au sondage", rosalie: "proposée par Catherine" };
  // L'avis de Claude sur une idée (fonction console-idee-avis) : gardé par app + id
  const VERDICTS = { bonne: ["Bonne idée", ""], a_creuser: ["À creuser", " attente"], pas_maintenant: ["Pas maintenant", " neutre"], non: ["Pas pour nous", " refus"] };
  const EFFORTS = { petit: "petit effort", moyen: "effort moyen", gros: "gros effort" };
  const cleAvis = (i) => `${i.app || "commis"}|${i.id}`;
  async function appelAvis(corps) {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw new Error("Connexion requise.");
    const r = await fetch(`${URL_SB}/functions/v1/console-idee-avis`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CLE_SB, Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify(corps) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erreur || `Erreur ${r.status}`);
    return d;
  }
  async function chargerAvisIdees() {
    if (etat.avisIdees || etat.avisIdeesEnCours) return;
    etat.avisIdeesEnCours = true;
    try { const d = await appelAvis({ action: "tous" }); etat.avisIdees = Object.fromEntries((d.avis || []).map((a) => [`${a.app}|${a.idee_id}`, { ...a.avis, cree: a.cree }])); }
    catch { etat.avisIdees = {}; }
    etat.avisIdeesEnCours = false;
    if (etat.vue === "idees") rendre();
  }
  const blocAvis = (i) => {
    const k = cleAvis(i), a = (etat.avisIdees || {})[k];
    if ((etat.avisEnCours || {})[k]) return `<div class="avis-claude attend"><p class="note">Claude lit l'idée et la compare aux apps…</p></div>`;
    if (!a) return "";
    const [mot, cls] = VERDICTS[a.verdict] || VERDICTS.a_creuser;
    const appsA = (a.apps || []).map((x) => { const c = cleApp(x.app); return `<li>${x.app === "nouvelle" ? `<span class="app"><b>Une nouvelle app</b></span>` : puce(c)} ${esc(x.raison)}</li>`; }).join("");
    return `<div class="avis-claude">
      <div class="tete"><span class="tampon${cls}">${esc(mot)}</span><b>L'avis de Claude</b>${a.effort ? `<span>${esc(EFFORTS[a.effort])}</span>` : ""}${a.cree ? `<span>${esc(moment(a.cree))}</span>` : ""}</div>
      ${a.resume ? `<p class="resume">${esc(a.resume)}</p>` : ""}
      ${a.pourquoi ? `<p>${esc(a.pourquoi)}</p>` : ""}
      ${appsA ? `<p class="note"><b>Où elle a sa place</b></p><ul class="avis-apps">${appsA}</ul>` : ""}
      ${a.prochaine_etape ? `<p class="note"><b>Prochaine étape :</b> ${esc(a.prochaine_etape)}</p>` : ""}
    </div>`;
  };
  const ficheIdee = (i) => {
    const [ic, mot] = TYPES[i.type] || TYPES.autre;
    const tamp = i.statut === "recue" ? `<span class="tampon attente">À lire</span>` : `<span class="tampon${i.statut === "non" ? " neutre" : ""}">${esc(STATUTS[i.statut])}</span>`;
    const autres = Object.keys(STATUTS).filter((k) => k !== i.statut && k !== "recue");
    return `<article class="fiche">
      <div class="tete">${tamp}${puce(i.app || "commis")}<b>${ic} ${esc(mot)}</b><span>${esc(moment(i.cree))}</span>${i.prenom ? `<span>${esc(i.prenom)}</span>` : ""}${i.foyer ? `<span>${i.app === "fanion" ? "groupe" : "foyer"} ${esc(i.foyer)}</span>` : ""}${i.ecran ? `<span>écran ${esc(i.ecran)}</span>` : ""}${SOURCES[i.source] ? `<span>${esc(SOURCES[i.source])}</span>` : ""}</div>
      <blockquote>${esc(i.texte)}</blockquote>
      ${blocAvis(i)}
      ${i.contact_ok && i.contact ? `<p class="note">Accepte d'être contacté·e : <b>${esc(String(i.contact).startsWith("+") ? tel(i.contact) : i.contact)}</b></p>` : ""}
      ${i.appareil ? `<p class="note">${esc(i.appareil)}</p>` : ""}
      ${i.reponse ? `<div class="message envoye"><p class="note"><b>Votre réponse</b>, ${esc(moment(i.repondu))} · la personne la voit dans l'app</p><p class="lettre">${esc(i.reponse)}</p></div>` : ""}
      <div class="gestes">
        <button class="btn" data-idee="${esc(i.id)}" data-g="repondre">${i.reponse ? "Modifier la réponse" : "Répondre"}</button>
        ${autres.map((k) => `<button class="btn pale" data-idee="${esc(i.id)}" data-g="statut" data-statut="${k}">${esc(STATUTS[k])}</button>`).join("")}
        ${(etat.avisEnCours || {})[cleAvis(i)] ? "" : `<button class="btn pale claude" data-idee-avis="${esc(cleAvis(i))}">${(etat.avisIdees || {})[cleAvis(i)] ? "Redemander à Claude" : "Demander à Claude"}</button>`}
        ${i.statut !== "faite" ? `<button class="lien" data-idee="${esc(i.id)}" data-g="annoncer">C'est fait : l'annoncer à tous</button>` : ""}
      </div>
    </article>`;
  };
  function vueIdees(d) {
    const r = d.retour || { idees: [], sondages: [], nouveautes: [] };
    if (!etat.avisIdees) setTimeout(chargerAvisIdees, 0);
    const APPS = [["tous", "Toutes les apps"], ["commis", "Le Commis"], ["fanion", "Le Fanion"], ["plumeau", "Le Plumeau"]];
    const appF = APPS.some(([k]) => k === etat.appIdee) ? etat.appIdee : "tous";
    const deLapp = (x) => appF === "tous" || (x.app || "commis") === appF;
    const ids = r.idees.filter(deLapp), so = r.sondages.filter(deLapp), nvs = r.nouveautes.filter(deLapp);
    const nomSond = appF === "fanion" ? "Le Fanion" : appF === "commis" ? "Le Commis" : appF === "plumeau" ? "Le Plumeau" : "l'app";
    const recents = so.filter((x) => Date.now() - t(x.cree) < 90 * JOUR);
    const nps = recents.length ? Math.round(100 * (recents.filter((x) => x.note >= 9).length - recents.filter((x) => x.note <= 6).length) / recents.length) : null;
    const F = [["recue", "À lire"], ["etudiee", "À l'étude"], ["prevue", "Prévues"], ["faite", "Faites"], ["non", "Non retenues"], ["tous", "Toutes"]];
    const filtre = F.some(([k]) => k === etat.filtreIdee) ? etat.filtreIdee : "recue";
    const vis = ids.filter((i) => filtre === "tous" || i.statut === filtre);
    return `<section class="section"><div class="filtres">${APPS.map(([k, mot]) => `<button class="filtre" data-appidee="${k}" ${k === appF ? 'aria-pressed="true"' : ""}>${k === "tous" ? "" : `<i class="pastille ${k}"></i>`}${mot}</button>`).join("")}</div>${chiffres([
        [ids.filter((i) => i.statut === "recue").length, "à lire"], [ids.length, "idées et commentaires"],
        [ids.filter((i) => i.statut === "faite").length, "faites"], [nps == null ? "–" : (nps > 0 ? "+" : "") + nps, "recommandation (NPS, 90 jours)"],
        [recents.length, "réponses au sondage"]])}</section>` +
      section("Idées et commentaires", "Ce que les membres envoient avec « 💡 Une idée? » dans l'app, ou en répondant au sondage. Votre réponse et l'état (Prévue, Faite…) s'affichent pour la personne dans l'app : c'est ce qui ferme la boucle.",
        `<div class="filtres">${F.map(([k, mot]) => `<button class="filtre" data-filtreidee="${k}" ${k === filtre ? 'aria-pressed="true"' : ""}>${mot}${k !== "tous" ? ` (${ids.filter((i) => i.statut === k).length})` : ""}</button>`).join("")}</div>` +
        liste(vis.map(ficheIdee), filtre === "recue" ? "Rien de nouveau à lire." : "Aucune idée dans cette liste.")) +
      section("Annoncer une nouveauté", "Chaque membre la voit une fois, en haut de l'app, au prochain lancement. Annoncez les améliorations, surtout celles demandées par les membres.",
        `<form class="invite" id="f-nouveaute"><label>Titre<input id="in-nv-titre" required maxlength="120" placeholder="ex. Le bilan accepte maintenant les grammes"></label>
          <label>Détail (facultatif)<input id="in-nv-texte" maxlength="1000" placeholder="Une phrase sur ce qui change et où le trouver"></label>
          <label>Dans quelle app<select id="in-nv-app"><option value="commis" ${appF === "fanion" || appF === "plumeau" ? "" : "selected"}>Le Commis</option><option value="fanion" ${appF === "fanion" ? "selected" : ""}>Le Fanion</option><option value="plumeau" ${appF === "plumeau" ? "selected" : ""}>Le Plumeau</option></select></label>
          <button class="btn" type="submit">Annoncer</button></form>` +
        table([{ t: "Nouveauté" }, { t: "Annoncée" }, { t: "Geste" }], nvs.map((n) => [`${puce(n.app || "commis")} <span class="nom">${esc(n.titre)}</span><small>${esc(n.texte || "")}${n.idee_id ? " · demandée par un membre" : ""}</small>`, esc(jour(n.cree)), `<div class="gestes"><button class="lien" data-nouveaute="${esc(n.id)}">Retirer</button></div>`]), "Aucune nouveauté annoncée pour l'instant.")) +
      section(`Sondage : recommanderiez-vous ${nomSond}?`, "Posé dans l'app après 10 jours d'usage, puis tous les 3 mois. 9-10 : promoteurs (l'app leur propose de la faire découvrir). 0-6 : détracteurs (l'app leur demande ce qui accroche).",
        table([{ t: "Note", n: 1 }, { t: "Pourquoi" }, { t: "Foyer ou groupe" }, { t: "Quand" }], so.slice(0, 100).map((x) => [`<b>${x.note}</b> ${puce(x.app || "commis")}`, esc(x.raison || ""), esc(x.foyer || ""), esc(moment(x.cree))]), "Aucune réponse au sondage pour l'instant."));
  }

  // ---------- vues
  function vueTraiter(d) {
    const a = aTraiter(d);
    const blocs = [];
    if (a.crm.length) blocs.push(section("Tâches du CRM", "Les relances prévues pour aujourd'hui ou en retard.",
      `<div class="liste">${a.crm.map((k) => { const c = ((etat.crm || {}).contacts || []).find((x) => x.id === k.contact_id) || {};
        return `<div class="fiche tache"><label class="case"><input type="checkbox" data-crm-tache="${esc(k.id)}" data-crm-ecrit> ${esc(k.titre)}</label><small class="${k.echeance < aujourdHui() ? "retard" : ""}"><button class="lien" data-fiche="c:${esc(k.contact_id)}" data-vers-crm>${esc(c.nom || "Contact")}</button>, ${esc(echeanceTexte(k))}</small></div>`; }).join("")}</div>`));
    if (a.fils.length) blocs.push(section("Courriels à traiter", "Des personnes vous ont écrit. Répondez ici, ou marquez le courriel comme traité.", liste(a.fils.slice(0, 30).map(ficheCourriel), "")));
    if (a.idees.length) blocs.push(section("Idées et commentaires à lire", "Ce que les membres de vos apps vous ont envoyé. Répondez ou changez l'état : la personne le voit dans l'app.", liste(a.idees.slice(0, 20).map(ficheIdee), "")));
    blocs.push(section("Avis à approuver", "Un avis paraît sur le site seulement après votre approbation, et seulement si la personne a accepté l'affichage.",
      liste(a.avis.map((x) => ficheAvis(x, x.app)), "Aucun avis en attente. Les nouveaux avis du Commis et de Fanion arrivent ici.")));
    if (a.paiements.length) blocs.push(section("Paiements à relier", "Stripe a reçu ces paiements sans pouvoir activer un foyer. Activez le bon foyer dans l'onglet Le Commis.",
      table([{ t: "Client" }, { t: "Reçu" }, { t: "Montant", n: 1 }], a.paiements.map((p) => [`<span class="nom">${esc(p.nom || p.courriel || "Inconnu")}</span><small>${esc(p.courriel || "")}</small>`, esc(moment(p.cree)), esc(argent(p.montant, p.devise))]), "")));
    if (a.acces.length) blocs.push(section("Demandes d'accès au Gousset", "Le Gousset est en accès restreint : ces personnes attendent votre réponse.", ficheDemandesGousset(a.acces)));
    if (a.paiementsTiroir.length) blocs.push(section("Paiements du Tiroir à relier", "Stripe a reçu ces paiements sans pouvoir activer un foyer. Activez le bon foyer dans l'onglet Le Tiroir.",
      table([{ t: "Client" }, { t: "Reçu" }, { t: "Montant", n: 1 }], a.paiementsTiroir.map((p) => [`<span class="nom">${esc(p.nom || p.courriel || "Inconnu")}</span><small>${esc(p.courriel || "")}</small>`, esc(moment(p.cree)), esc(argent(p.montant, p.devise))]), "")));
    if (d.fanion.pret) blocs.push(section("Demandes de jeux", "Des groupes Fanion demandent l'ajout d'un jeu.", liste(a.demandes.map(ficheDemande), "Aucune demande de jeu en attente.")));
    if (a.essais.length) blocs.push(section("Essais qui se terminent cette semaine", "Rien à faire, sauf si vous voulez donner plus de temps à un foyer.",
      table([{ t: "Foyer" }, { t: "Essai" }, { t: "Geste" }], a.essais.map(({ f, e }) => [celluleFoyer(f), `${tamponForfait(e)}<small>${esc(e.detail)}</small>`, `<div class="gestes"><button class="lien" data-foyer="${esc(f.id)}" data-geste="essai">Prolonger l'essai de 30 jours</button></div>`]), "")));
    return blocs.join("");
  }
  const celluleFoyer = (f) => {
    const p = f.membres.find((m) => m.role === "proprio") || f.membres[0] || {};
    return `<span class="nom">${esc(f.nom)}</span><small>${esc([p.nom, tel(p.telephone), p.email].filter(Boolean).join(", "))}</small>`;
  };
  function vueCommis(d) {
    const c = d.commis, fo = c.foyers.map((f) => ({ f, e: forfaitCommis(f) }));
    const nb = (cle) => fo.filter((x) => x.e.cle === cle).length;
    const q = c.questions.filter((x) => x.app === "commis");
    return `<section class="section">${chiffres([[fo.length, fo.length > 1 ? "foyers inscrits" : "foyer inscrit"], [nb("essai"), "en essai"], [nb("paye"), "avec forfait"], [nb("fini"), "terminés"], [fo.filter((x) => Date.now() - t(x.f.cree) < 7 * JOUR).length, "nouveaux depuis 7 jours"]])}</section>` +
      section("Foyers et forfaits", "Chaque foyer a 30 jours d'essai, puis un forfait de 12 mois. Un paiement Stripe active le foyer tout seul ; les gestes ci-dessous servent aux exceptions.",
        table([{ t: "Foyer" }, { t: "Inscrit" }, { t: "Forfait" }, { t: "Membres", n: 1 }, { t: "Produits", n: 1 }, { t: "Dernière activité" }, { t: "Gestes" }],
          fo.map(({ f, e }) => [celluleFoyer(f), esc(jour(f.cree)), `${tamponForfait(e)}<small>${esc(e.detail)}</small>`, f.membres.length, f.produits, esc(ilYA(f.activite)),
            `<div class="gestes"><button class="lien" data-foyer="${esc(f.id)}" data-geste="essai">Prolonger l'essai de 30 jours</button><button class="lien" data-foyer="${esc(f.id)}" data-geste="activer">Activer 12 mois</button>${t(f.paye_jusqua) > Date.now() ? `<button class="lien" data-foyer="${esc(f.id)}" data-geste="retirer">Retirer le forfait</button>` : ""}</div>`]),
          "Aucun foyer inscrit pour l'instant.")) +
      section("Paiements reçus", "", table([{ t: "Client" }, { t: "Foyer" }, { t: "Reçu" }, { t: "Montant", n: 1 }, { t: "État" }],
        c.paiements.map((p) => [`<span class="nom">${esc(p.nom || p.courriel || "Inconnu")}</span><small>${esc(p.courriel || "")}</small>`, esc(p.foyer || "Non relié"), esc(moment(p.cree)), esc(argent(p.montant, p.devise)), p.active ? `<span class="tampon">Activé</span>` : `<span class="tampon attente">À relier</span>`]),
        "Aucun paiement pour l'instant. Les paiements Stripe du Commis s'inscriront ici dès l'ouverture des ventes.")) +
      section("Avis", "", liste(c.avis.map((a) => ficheAvis(a, "commis")), "Aucun avis reçu pour l'instant.")) +
      section("Questions posées au Commis", "Ce que les membres demandent à l'assistant dans l'app. Une question qui revient souvent montre un endroit où l'app accroche.",
        liste(q.map(ficheQuestion), "Aucune question notée pour l'instant. Elles s'inscrivent ici à mesure que les membres en posent."));
  }
  function vueFanion(d) {
    const f = d.fanion, gr = f.groupes.map((g) => ({ g, e: forfaitFanion(g) }));
    const q = d.commis.questions.filter((x) => x.app === "fanion");
    const relier = f.pret ? "" : `<section class="section"><div class="bandeau"><b>Fanion est en lecture seule.</b> Vous voyez les groupes et les avis déjà publiés. Pour voir les avis en attente, activer un forfait et lire les demandes de jeux, il reste à relier Firebase à la console :
      <ol><li>Dans la console Firebase, projet « pelland » : Paramètres du projet, Comptes de service, « Générer une nouvelle clé privée ».</li><li>Dans Supabase, projet du Commis : Edge Functions, Secrets, ajoutez <b>FIREBASE_SERVICE_ACCOUNT</b> et collez tout le contenu du fichier téléchargé.</li><li>Revenez ici et touchez Actualiser.</li></ol>${f.erreur ? `<p class="note">Détail : ${esc(f.erreur)}</p>` : ""}</div></section>`;
    return relier +
      `<section class="section">${chiffres([[gr.length, gr.length > 1 ? "groupes inscrits" : "groupe inscrit"], [gr.filter((x) => x.e.cle === "paye").length, "au forfait Groupe"], [gr.reduce((s, x) => s + (Number(x.g.joueurs) || 0), 0), "joueurs"], [gr.filter((x) => Date.now() - t(x.g.cree) < 7 * JOUR).length, "nouveaux depuis 7 jours"]])}</section>` +
      section("Groupes et forfaits", "Après un paiement Stripe, le courriel de Stripe donne le nom du groupe : activez-le ici pour lui ouvrir 16 joueurs pendant 12 mois.",
        table([{ t: "Groupe" }, { t: "Inscrit" }, { t: "Forfait" }, { t: "Joueurs", n: 1 }, { t: "Parties", n: 1 }, { t: "Dernière partie" }, { t: "Gestes" }],
          gr.map(({ g, e }) => [`<span class="nom">${esc(g.nom)}</span><small>${esc([g.proprio, g.ref ? `parrainé par ${g.ref}` : ""].filter(Boolean).join(", "))}</small>`, esc(jour(g.cree)) || "Avant les inscriptions",
            `${tamponForfait(e)}<small>${esc(e.detail)}</small>`, `${g.joueurs ?? "?"} / ${e.max}`, g.parties ?? (f.pret ? 0 : "?"), g.derniere_partie ? esc(ilYA(g.derniere_partie)) : f.pret ? "aucune" : "?",
            f.pret ? `<div class="gestes"><button class="lien" data-groupe="${esc(g.id)}" data-geste="activer">${e.cle === "paye" ? "Ajouter 12 mois" : "Activer le forfait Groupe"}</button>${g.plan === "groupe" ? `<button class="lien" data-groupe="${esc(g.id)}" data-geste="retirer">Retirer le forfait</button>` : ""}</div>` : ""]),
          "Aucun groupe inscrit pour l'instant.")) +
      section("Avis", "", liste(f.avis.map((a) => ficheAvis(a, "fanion")), "Aucun avis reçu pour l'instant.")) +
      (f.pret ? section("Demandes de jeux", "", liste(f.demandes.map(ficheDemande), "Aucune demande de jeu en attente.")) : "") +
      section("Questions posées au Caddie", "Ce que les joueurs demandent à l'assistant dans l'app.",
        liste(q.map(ficheQuestion), "Aucune question notée pour l'instant. Elles s'inscrivent ici à mesure que les joueurs en posent."));
  }
  function vuePlumeau(d) {
    const p = d.plumeau || { comptes: [] }, cp = p.comptes || [];
    const q = d.commis.questions.filter((x) => x.app === "plumeau");
    const r = d.retour || { idees: [] };
    const idees = r.idees.filter((i) => i.app === "plumeau");
    const somme = (k) => cp.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    const pilote = cp.filter((c) => Number(c.liens) + Number(c.archives) >= 20 && (Number(c.archives) > 0 || Number(c.sugg_gardees) > 0)).length;
    const j30 = (d.couts || []).filter((c) => c.app === "plumeau" && Date.now() - t(c.cree) < 30 * JOUR).reduce((s, c) => s + Number(c.cout_usd || 0), 0);
    const actifs = cp.filter((c) => c.derniere && Date.now() - t(c.derniere) < 30 * JOUR).length;
    return (p.erreur ? `<section class="section"><div class="bandeau">Les comptes du Plumeau n'ont pas pu être lus : ${esc(p.erreur)}</div></section>` : "") +
      `<section class="section">${chiffres([[cp.length, cp.length > 1 ? "comptes" : "compte"], [cp.filter((c) => Date.now() - t(c.cree) < 7 * JOUR).length, "nouveaux depuis 7 jours"], [somme("liens"), "liens gardés"], [somme("archives"), "liens archivés (ménage fait)"], [pilote, "ont importé et fait le ménage"], [usd(j30), "d'IA depuis 30 jours"], [actifs ? usd(j30 / actifs) : "–", "par compte actif, 30 jours"]])}</section>` +
      section("Comptes", "Le Plumeau est gratuit : pas de forfait à gérer. Un compte « ont importé et fait le ménage » a gardé 20 liens ou plus et a archivé un lien ou gardé une suggestion de Edda.",
        table([{ t: "Personne" }, { t: "Inscrite" }, { t: "Liens", n: 1 }, { t: "Archivés", n: 1 }, { t: "Collections", n: 1 }, { t: "Suggestions gardées", n: 1 }, { t: "Dernier lien" }, { t: "Geste" }],
          cp.map((c) => [`<span class="nom">${esc(c.prenom || "Sans prénom")}</span><small>${esc(c.courriel || "")}${c.bloque ? " · IA coupée" : ""}</small>`, esc(jour(c.cree)), c.liens, c.archives, c.collections, c.sugg_gardees, c.derniere ? esc(ilYA(c.derniere)) : "aucun",
            `<div class="gestes"><button class="lien" data-plumeau-compte="${esc(c.user_id)}" data-bloque="${c.bloque ? "0" : "1"}">${c.bloque ? "Rendre l'IA" : "Couper l'IA"}</button></div>`]),
          "Aucun compte pour l'instant. Les inscriptions sur leplumeau.ai s'afficheront ici.")) +
      section("Idées et commentaires", "Répondez dans l'onglet Idées (filtre Le Plumeau) : la personne voit votre réponse dans l'app, et Edda l'avertit.",
        liste(idees.filter((i) => i.statut === "recue").slice(0, 20).map(ficheIdee), idees.length ? "Tout est lu. Les idées traitées sont dans l'onglet Idées." : "Aucune idée reçue pour l'instant.")) +
      section("Questions posées à Edda", "Ce que les gens demandent à Edda dans l'app. Une question qui revient souvent montre un endroit où l'app accroche.",
        liste(q.map(ficheQuestion), "Aucune question notée pour l'instant. Elles s'inscrivent ici à mesure que les gens en posent."));
  }
  // ---------- Le Tiroir : foyers, fiches, rappels (5 fiches gratuites, puis 29 $ par année)
  function forfaitTiroir(f) {
    const paye = t(f.paye_jusqua);
    if (paye > Date.now()) return { cle: "paye", mot: "Payé", detail: `jusqu'au ${jour(paye)}` };
    if (paye) return { cle: "fini", mot: "Terminé", detail: `le ${jour(paye)}` };
    return { cle: "gratuit", mot: "Gratuit", detail: `${Math.min(f.fiches, 5)} / 5 fiches` };
  }
  const bandeauErreur = (x, nom) => (x && x.erreur ? `<section class="section"><div class="bandeau">Les données de ${nom} n'ont pas pu être lues : ${esc(x.erreur)}</div></section>` : "");
  function vueTiroir(d) {
    const x = d.tiroir || { foyers: [], paiements: [] }, fo = (x.foyers || []).map((f) => ({ f, e: forfaitTiroir(f) }));
    const somme = (k) => fo.reduce((s, { f }) => s + (Number(f[k]) || 0), 0);
    const j30 = (d.couts || []).filter((c) => c.app === "tiroir" && Date.now() - t(c.cree) < 30 * JOUR).reduce((s, c) => s + Number(c.cout_usd || 0), 0);
    const contact = (f) => [f.prenom, tel(f.telephone), f.courriel].filter(Boolean).join(", ");
    return bandeauErreur(x, "Le Tiroir") +
      `<section class="section">${chiffres([[fo.length, fo.length > 1 ? "foyers inscrits" : "foyer inscrit"], [fo.filter((y) => y.e.cle === "paye").length, "avec forfait"], [fo.filter((y) => y.e.cle === "gratuit" && y.f.fiches >= 5).length, "au plafond gratuit"], [somme("fiches"), "fiches"], [somme("documents"), "documents"], [somme("rappels"), "rappels à venir"], [fo.filter((y) => y.f.pilote).length, "foyers pilotes réussis"], [usd(j30), "d'IA depuis 30 jours"]])}</section>` +
      section("Foyers et forfaits", "5 fiches gratuites, puis 29 $ par année par foyer. Un foyer pilote réussi a créé des fiches et noté un entretien dans ses 30 premiers jours.",
        table([{ t: "Foyer" }, { t: "Inscrit" }, { t: "Forfait" }, { t: "Membres", n: 1 }, { t: "Fiches", n: 1 }, { t: "Documents", n: 1 }, { t: "Rappels", n: 1 }, { t: "Dernière activité" }, { t: "Gestes" }],
          fo.map(({ f, e }) => [`<span class="nom">${esc(f.nom || "Sans nom")}</span><small>${esc(contact(f))}</small>`, esc(jour(f.cree)), `${tamponForfait(e)}<small>${esc(e.detail)}</small>`, f.membres, f.fiches, f.documents,
            `${f.rappels}${f.rappels_retard ? `<small>${f.rappels_retard} en retard</small>` : ""}`, f.derniere ? esc(ilYA(f.derniere)) : "aucune",
            `<div class="gestes"><button class="lien" data-tiroir="${esc(f.id)}" data-geste="activer">${e.cle === "paye" ? "Ajouter 12 mois" : "Activer 12 mois"}</button>${e.cle === "paye" ? `<button class="lien" data-tiroir="${esc(f.id)}" data-geste="retirer">Retirer le forfait</button>` : ""}</div>`]),
          "Aucun foyer inscrit pour l'instant. Les inscriptions sur letiroir.ai s'afficheront ici.")) +
      ((x.paiements || []).length ? section("Paiements à relier", "Activez le foyer qui correspond au paiement : le paiement sera marqué comme relié.",
        table([{ t: "Client" }, { t: "Reçu" }, { t: "Montant", n: 1 }, { t: "Relier à" }], x.paiements.map((p) => [`<span class="nom">${esc(p.nom || p.courriel || "Inconnu")}</span><small>${esc(p.courriel || "")}</small>`, esc(moment(p.cree)), esc(argent(p.montant, p.devise)),
          `<div class="gestes">${fo.map(({ f }) => `<button class="lien" data-tiroir="${esc(f.id)}" data-geste="activer" data-paiement="${esc(p.id)}">${esc(f.nom || "Foyer")}</button>`).join("")}</div>`]), "")) : "");
  }
  // ---------- Le Gousset : comptes Gmail, offres, abonnements, demandes d'accès
  const ETATS_DEMANDE = { pending: ["En attente", "attente"], approved: ["Approuvée", ""], declined: ["Refusée", "refus"] };
  function ficheDemandesGousset(ds) {
    return table([{ t: "Personne" }, { t: "Demandé" }, { t: "État" }, { t: "Gestes" }], ds.map((a) => {
      const [mot, cl] = ETATS_DEMANDE[a.statut] || [a.statut, "neutre"];
      return [`<span class="nom">${esc(a.prenom || a.courriel)}</span><small>${esc([a.courriel, a.parrain ? `invitée par ${a.parrain}` : ""].filter(Boolean).join(", "))}</small>`, esc(jour(a.cree)), `<span class="tampon ${cl}">${esc(mot)}</span>`,
        `<div class="gestes">${a.statut !== "approved" ? `<button class="lien" data-gousset="${esc(a.id)}" data-statut="approved">Approuver</button>` : ""}${a.statut !== "declined" ? `<button class="lien" data-gousset="${esc(a.id)}" data-statut="declined">Refuser</button>` : ""}${a.statut !== "pending" ? `<button class="lien" data-gousset="${esc(a.id)}" data-statut="pending">Remettre en attente</button>` : ""}</div>`];
    }), "Aucune demande d'accès pour l'instant.");
  }
  function vueGousset(d) {
    const x = d.gousset || { comptes: [], demandes: [] }, cp = x.comptes || [];
    const somme = (k) => cp.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    const actifs = cp.filter((c) => c.sync && Date.now() - t(c.sync) < 7 * JOUR).length;
    return bandeauErreur(x, "Le Gousset") +
      `<section class="section">${chiffres([[cp.length, cp.length > 1 ? "comptes" : "compte"], [cp.filter((c) => c.gmail).length, "Gmail connecté"], [actifs, "synchronisés depuis 7 jours"], [somme("aubaines"), "offres en cours"], [somme("codes"), "codes promo"], [somme("abonnements"), "abonnements suivis"], [argent(Math.round(somme("economies") * 100), "cad"), "d'économies notées"], [(x.demandes || []).filter((a) => a.statut === "pending").length, "demandes d'accès en attente"]])}</section>` +
      section("Comptes", "Le Gousset lit l'onglet Promotions de Gmail. Une synchronisation récente montre que Raphaëlle travaille pour ce compte.",
        table([{ t: "Personne" }, { t: "Inscrite" }, { t: "Gmail" }, { t: "Dernière synchro" }, { t: "Offres", n: 1 }, { t: "Codes", n: 1 }, { t: "Abonnements", n: 1 }, { t: "Achats", n: 1 }, { t: "Économies", n: 1 }, { t: "Parrainages", n: 1 }],
          cp.map((c) => [`<span class="nom">${esc(c.prenom || "Sans prénom")}</span><small>${esc([c.courriel, c.ville].filter(Boolean).join(", "))}</small>`, esc(jour(c.cree)), c.gmail ? `<span class="tampon">Connecté</span>` : `<span class="tampon refus">Non</span>`,
            `${c.sync ? esc(ilYA(c.sync)) : "jamais"}${c.sync_etat ? `<small>${esc(c.sync_etat)}</small>` : ""}`, c.aubaines, c.codes, c.abonnements, c.achats, esc(argent(Math.round(Number(c.economies || 0) * 100), "cad")), c.parrainages]),
          "Aucun compte pour l'instant. Les inscriptions sur legousset.ai s'afficheront ici.")) +
      section("Demandes d'accès", "Les personnes qui demandent à essayer Le Gousset, souvent par le lien d'invitation d'un membre.", ficheDemandesGousset(x.demandes || []));
  }
  // ---------- comptes HoldingAI, Le Seuil et La Voûte
  // Une app dans HoldingAI Compte (« le-commis ») → son nom court dans la console (« commis »)
  const CLES_APPS = { lechange: "echange", lescale: "escale", "le-tapis": "donne" };
  const cleApp = (slug) => CLES_APPS[slug] || String(slug || "").replace(/^(le|la)-/, "");
  const personne = (d, uid) => ((d.compte || {}).comptes || []).find((c) => c.id === uid);
  const cellPersonne = (d, uid) => { const p = personne(d, uid);
    return p ? `<span class="nom">${esc(p.nom || "Sans nom")}</span><small>${esc(tel(p.cellulaire))}</small>` : `<span class="nom">Compte inconnu</span><small>${esc(String(uid).slice(0, 8))}</small>`; };
  const pucesApps = (apps) => apps.length ? `<span class="puces">${apps.map((a) => `<span class="puce-app" title="Dernière visite ${esc(ilYA(a.derniere))}"><i class="pastille ${esc(cleApp(a.app))}"></i>${esc(nomApp[cleApp(a.app)] || a.app)}</span>`).join("")}</span>` : "aucune";
  function vueComptes(d) {
    const c = d.compte || {}, cp = c.comptes || [];
    const visitesDe = (cle) => cp.filter((x) => (x.apps || []).some((a) => cleApp(a.app) === cle)).length;
    const parApp = (c.apps || []).filter((a) => a.slug !== "holdingai").map((a) => [visitesDe(cleApp(a.slug)), `sur ${a.nom}`]).filter(([n]) => n);
    return bandeauErreur(c, "Compte L’Établi") +
      `<section class="section">${chiffres([[cp.length, cp.length > 1 ? "comptes L’Établi" : "compte L’Établi"], [cp.filter((x) => Date.now() - t(x.cree) < 7 * JOUR).length, "nouveaux depuis 7 jours"], ((n) => [n, `${n > 1 ? "connectés" : "connecté"} depuis 7 jours`])(cp.filter((x) => x.vu && Date.now() - t(x.vu) < 7 * JOUR).length), ...parApp])}</section>` +
      section("Comptes", "Un seul compte par personne, pour toutes les apps branchées sur compte.letabli.ai. Les apps pas encore branchées gardent leurs propres comptes et n'apparaissent pas ici.",
        table([{ t: "Personne" }, { t: "Créé" }, { t: "Dernière connexion" }, { t: "Apps utilisées" }],
          cp.map((x) => [`<span class="nom">${esc(x.nom || "Sans nom")}</span><small>${esc(tel(x.cellulaire))}</small>`, esc(jour(x.cree)), esc(x.vu ? ilYA(x.vu) : "jamais"), pucesApps(x.apps || [])]),
          "Aucun compte L’Établi pour l'instant.")) +
      section("Statut des apps", "Une app en bêta affiche « Bêta » à côté d'Philou, dans son menu, à l'entrée et sur les invitations. Une app disponible n'affiche rien. Le changement paraît dans l'app au prochain chargement.",
        table([{ t: "App" }, { t: "Statut" }, { t: "" }],
          (c.apps || []).filter((a) => a.slug !== "holdingai" && a.active !== false).map((a) => [`${puce(cleApp(a.slug))}`,
            a.statut === "beta" ? `<span class="tampon attente">Bêta</span>` : `<span class="tampon">Disponible</span>`,
            `<button class="btn pale" data-statut-app="${esc(a.slug)}" data-statut="${a.statut === "beta" ? "" : "beta"}">${a.statut === "beta" ? "Marquer disponible" : "Mettre en bêta"}</button>`]),
          "La liste des apps n'a pas pu être lue."));
  }
  // Une app sans données propres dans la console : ses personnes (comptes HoldingAI qui l'ont ouverte) et son statut
  function vueAppCompte(d, app) {
    const c = d.compte || {}, fiche = (c.apps || []).find((a) => cleApp(a.slug) === app);
    const gens = (c.comptes || []).map((x) => ({ x, v: (x.apps || []).find((a) => cleApp(a.app) === app) })).filter((g) => g.v)
      .sort((a, b) => t(b.v.derniere) - t(a.v.derniere));
    return bandeauErreur(c, "Compte L’Établi") +
      `<section class="section app-entete"><h2>${esc(nomApp[app])}</h2>${fiche ? `<p class="sous">${fiche.adresse ? `<a href="${esc(fiche.adresse)}" target="_blank" rel="noopener">${esc(fiche.adresse.replace(/^https:\/\//, ""))}</a>` : ""}${fiche.personnage ? ` · avec ${esc(fiche.personnage)}` : ""} · ${fiche.statut === "beta" ? "en bêta" : "disponible"}</p>` : ""}
        ${chiffres([[gens.length, gens.length > 1 ? "personnes l'ont ouverte" : "personne l'a ouverte"], [gens.filter((g) => Date.now() - t(g.v.premiere) < 7 * JOUR).length, "nouvelles depuis 7 jours"],
          [gens.filter((g) => Date.now() - t(g.v.derniere) < 7 * JOUR).length, "actives depuis 7 jours"]])}
        ${fiche ? `<p data-statut-app-ligne><button class="btn pale" data-statut-app="${esc(fiche.slug)}" data-statut="${fiche.statut === "beta" ? "" : "beta"}">${fiche.statut === "beta" ? "Marquer disponible" : "Mettre en bêta"}</button></p>` : ""}</section>` +
      section("Personnes", "Les comptes L’Établi qui ont ouvert l'app. Ses données propres ne sont pas encore lues par la console.",
        table([{ t: "Personne" }, { t: "Première visite" }, { t: "Dernière visite" }, { t: "Autres apps" }],
          gens.map(({ x, v }) => [`<span class="nom">${esc(x.nom || "Sans nom")}</span><small>${esc(tel(x.cellulaire))}</small>`, esc(jour(v.premiere)), esc(ilYA(v.derniere)),
            pucesApps((x.apps || []).filter((a) => cleApp(a.app) !== app))]),
          "Personne n'a encore ouvert l'app."));
  }
  function vueSeuil(d) {
    const x = d.seuilvoute || {}, rs = x.seuil || [];
    return bandeauErreur(x, "Le Seuil") +
      `<section class="section">${chiffres([[rs.length, rs.length > 1 ? "personnes avec un compte" : "personne avec un compte"], ((n) => [n, `${n > 1 ? "actives" : "active"} depuis 7 jours`])(rs.filter((r) => Date.now() - t(r.maj) < 7 * JOUR).length), [rs.reduce((s, r) => s + (Number(r.reponses) || 0), 0), "réponses enregistrées"], [rs.reduce((s, r) => s + (Number(r.rappels) || 0), 0), "rappels prévus"]])}</section>` +
      section("Personnes", "Le Seuil est gratuit et le compte y est facultatif : on ne voit ici que les personnes qui gardent leurs réponses dans leur compte L’Établi. Le contenu des réponses n'est pas affiché.",
        table([{ t: "Personne" }, { t: "Réponses", n: 1 }, { t: "Rappels", n: 1 }, { t: "Dernière mise à jour" }],
          rs.map((r) => [cellPersonne(d, r.uid), r.reponses, r.rappels, esc(ilYA(r.maj))]),
          "Personne ne garde encore ses réponses dans un compte."));
  }
  function vueVoute(d) {
    const x = d.seuilvoute || {}, vs = x.voute || [];
    const ko = (n) => n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
    return bandeauErreur(x, "La Voûte") +
      `<section class="section">${chiffres([[vs.length, vs.length > 1 ? "voûtes gardées dans un compte" : "voûte gardée dans un compte"], ((n) => [n, `${n > 1 ? "mises" : "mise"} à jour depuis 30 jours`])(vs.filter((v) => Date.now() - t(v.maj) < 30 * JOUR).length), [ko(vs.reduce((s, v) => s + (Number(v.taille) || 0), 0)) || "0 Ko", "au total"]])}</section>` +
      section("Voûtes", "Chaque voûte est chiffrée sur l'appareil de la personne. La console voit seulement sa taille et sa date : ni L’Établi ni la console ne peuvent l'ouvrir.",
        table([{ t: "Personne" }, { t: "Taille", n: 1 }, { t: "Envoyée de" }, { t: "Dernière copie" }],
          vs.map((v) => [cellPersonne(d, v.uid), esc(ko(v.taille)), esc(v.appareil || ""), esc(ilYA(v.maj))]),
          "Aucune voûte gardée dans un compte pour l'instant."));
  }
  // ---------- coûts : frais fixes mensuels + coûts de l'API Claude, tout en dollars canadiens
  // Taux utilisé pour les services facturés en $ US : taux du marché (≈ 1,37) + ≈ 2,5 % de frais de la carte.
  const TAUX = 1.40;
  // Frais fixes en $ US par mois. À tenir à jour quand un forfait, un projet ou un domaine change.
  const FRAIS_FIXES = [
    { poste: "Supabase Pro", detail: "25 $ + 6 projets × 10 $ − 10 $ de crédit", usd: 75 },
    { poste: "Claude Pro", detail: "abonnement pour le développement", usd: 20 },
    { poste: "Domaines .ai (5)", detail: "lecommis, fanion, letiroir, leplumeau, legousset · 80 $ par an chacun", usd: 5 * 80 / 12 },
    { poste: "Domaine holdingai.app", detail: "≈ 15 $ par an", usd: 15 / 12 },
    { poste: "Cloudflare", detail: "forfait gratuit (5 $ si on active la réponse aux courriels)", usd: 0 },
    { poste: "GitHub", detail: "forfait gratuit, 2 000 minutes d'Actions par mois", usd: 0 },
  ];
  const PRIX_COMMIS_MOIS = 19.99 / 12, STRIPE_MOIS = (19.99 * 0.029 + 0.30) / 12; // en $ CA
  const cad = (n) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const cadUsd = (usd) => cad(usd * TAUX);
  const usd = cadUsd; // les autres onglets (Plumeau, Tiroir) affichent aussi en $ CA
  const MOIS = 365 / 12 / 30; // ramène 30 jours à un mois moyen
  const NOMS_FONCTIONS = { rosalie: "Catherine (questions)", "photo-produit": "Photo d'un produit", facture: "Lecture de facture", circulaires: "Circulaires (lecture commune)", colette: "Edda (questions)", ajouter: "Le Plumeau : lecture d'un lien", classer: "Le Plumeau : classement des liens", suggerer: "Le Plumeau : sites semblables" };
  const ORDRE_APPS = ["echange", "gousset", "pourquoi", "commis", "fanion", "seuil", "plumeau", "vestibule", "tiroir", "voute", "donne", "nostalgie", "escale", "holdingai"];
  const NOM_FRAIS = { holdingai: "Compte L’Établi", nostalgie: "La Nostalgie" };
  function sectionFrais() {
    const f = etat.factures;
    if (!f) { factures(); return section("Frais variables par app", "", `<p class="charge">Lecture des factures…</p>`); }
    if (f.erreur) return section("Frais variables par app", "", `<p class="vide">Les factures n'ont pas pu être lues (${esc(f.erreur)}). <button class="lien" data-factures>Réessayer</button></p>`);
    const a = f.anthropic || {}, tw = f.twilio || {}, st = f.stripe || {};
    const enCad = (montant, devise) => (String(devise || "cad").toLowerCase() === "usd" ? montant * TAUX : montant);
    const lignes = new Map([...ORDRE_APPS, "autre"].map((k) => [k, { claude: 0, textos: 0, stripe: 0, ventes: 0 }]));
    const ajouter = (app, cle, cadMontant) => { const l = lignes.get(app && lignes.has(app) ? app : "autre"); l[cle] += cadMontant; };
    if (a.pret) for (const c of a.cles || []) ajouter(c.app, "claude", c.usd * TAUX);
    if (tw.pret) {
      // Verify : partagé selon les tentatives de chaque service; textos directs : selon le nombre envoyé par chaque numéro
      let attribue = 0;
      for (const v of tw.verify || []) { ajouter(v.app, "textos", v.usd * TAUX); attribue += v.usd; }
      const smsUsd = (tw.categories || []).filter((c) => /^(sms|mms)/.test(c.cle)).reduce((s, c) => s + c.usd, 0);
      const nbTextos = (tw.textos || []).reduce((s, x) => s + x.nombre, 0);
      for (const x of tw.textos || []) { const part = nbTextos ? smsUsd * x.nombre / nbTextos : 0; ajouter(x.app, "textos", part * TAUX); attribue += part; }
      ajouter(null, "textos", Math.max(0, (tw.total_usd || 0) - attribue) * TAUX); // numéros loués, autres services
    }
    if (st.pret) for (const [app, x] of Object.entries(st.par_app || {})) { ajouter(app === "inconnue" ? null : app, "stripe", enCad(x.frais, st.devise)); ajouter(app === "inconnue" ? null : app, "ventes", enCad(x.ventes, st.devise)); }
    const somme = (k) => [...lignes.values()].reduce((s, l) => s + l[k], 0);
    etat.fraisVariables = { total: somme("claude") + somme("textos") + somme("stripe"), claude: a.pret ? somme("claude") : null }; // $ CA, pour les chiffres du haut
    const manque = [!a.pret && "Anthropic", !tw.pret && "Twilio", !st.pret && "Stripe"].filter(Boolean);
    const cellule = (pret, v) => (pret ? esc(cad(v)) : `<span class="gris">—</span>`);
    const rangs = [...lignes.entries()].filter(([k, l]) => ORDRE_APPS.includes(k) || l.claude + l.textos + l.stripe > 0.004)
      .map(([k, l]) => [k === "autre" ? `<span class="nom">Commun ou non attribué</span><small>numéros loués, clés sans nom d'app, paiements sans description</small>` : k === "holdingai" ? `<span class="nom">Compte L’Établi</span><small>textos de connexion</small>` : puce(k),
        cellule(a.pret, l.claude), cellule(tw.pret, l.textos), cellule(st.pret, l.stripe), `<b>${esc(cad(l.claude + l.textos + l.stripe))}</b>`, st.pret && l.ventes ? esc(cad(l.ventes)) : ""]);
    rangs.push([`<span class="nom">Total</span>`, cellule(a.pret, somme("claude")), cellule(tw.pret, somme("textos")), cellule(st.pret, somme("stripe")), `<b>${esc(cad(somme("claude") + somme("textos") + somme("stripe")))}</b>`, st.pret ? esc(cad(somme("ventes"))) : ""]);
    const aide = manque.length ? `<div class="bandeau"><b>À brancher : ${esc(manque.join(", "))}.</b> Chaque source se branche avec une clé de lecture, ajoutée dans Supabase, projet « Notre épicerie », Edge Functions, Secrets. La clé reste sur le serveur : la console ne reçoit que les montants.<ol>
      ${!a.pret ? `<li><b>Anthropic</b> : dans la console Anthropic, Settings, Admin keys, créez une clé d'administration. Secret <b>ANTHROPIC_ADMIN_KEY</b>. Le nom de chaque clé API doit contenir le nom de son app (ex. « Le Gousset ») pour que le coût soit classé.</li>` : ""}
      ${!tw.pret ? `<li><b>Twilio</b> : dans Twilio, Account, API keys &amp; tokens, créez une clé API (restreinte en lecture si offert). Secrets <b>TWILIO_ACCOUNT_SID</b>, <b>TWILIO_API_KEY</b> et <b>TWILIO_API_SECRET</b>. Les services Verify et les numéros doivent porter le nom de leur app.</li>` : ""}
      ${!st.pret ? `<li><b>Stripe</b> : dans Stripe, Développeurs, Clés API, créez une clé restreinte avec la lecture de « Balance » et de « Charges ». Secret <b>STRIPE_CLE_LECTURE</b>.</li>` : ""}
      </ol>Touchez ensuite « Relire les factures ».</div>` : "";
    const erreurs = [["Anthropic", a], ["Twilio", tw], ["Stripe", st]].filter(([, x]) => x.erreur).map(([n, x]) => `<p class="note alerte">${esc(n)} : ${esc(x.erreur)}</p>`).join("");
    const clesSansApp = (a.cles || []).filter((c) => !c.app && c.usd > 0.001);
    return section("Frais variables par app, 30 derniers jours", `Lus directement dans les factures d'Anthropic (Claude), de Twilio (textos) et de Stripe (frais de paiement), en dollars canadiens au taux de ${TAUX.toFixed(2).replace(".", ",")}. ${f.lu ? `Lu ${esc(moment(f.lu))}.` : ""} <button class="lien" data-factures="1">Relire les factures</button>`,
      aide + erreurs + table([{ t: "App" }, { t: "Claude", n: 1 }, { t: "Textos", n: 1 }, { t: "Frais Stripe", n: 1 }, { t: "Total", n: 1 }, { t: "Ventes", n: 1 }], rangs, "") +
      (clesSansApp.length ? `<p class="note">Clés Claude sans nom d'app : ${clesSansApp.map((c) => `${esc(c.nom)} (${esc(cad(c.usd * TAUX))})`).join(", ")}. Renommez-les dans la console Anthropic pour les classer.</p>` : ""));
  }
  function vueCouts(d) {
    const tous = d.couts || [], j30 = tous.filter((c) => Date.now() - t(c.cree) < 30 * JOUR);
    const somme = (l) => l.reduce((s, c) => s + Number(c.cout_usd || 0), 0) * MOIS; // $ US par mois
    const grouper = (l, cle) => { const m = new Map(); for (const c of l) { const k = c[cle] || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return [...m.entries()]; };
    const foyers = new Map(((d.commis && d.commis.foyers) || []).map((f) => [f.id, f.nom]));
    const parFoyer = grouper(j30.filter((c) => c.foyer_id), "foyer_id").map(([id, l]) => ({ id, l, n: somme(l) })).sort((a, b) => b.n - a.n);
    // Les circulaires sont lues une fois pour toute l'app (foyer vide) : leur coût est réparti entre les foyers actifs
    const actifs = ((d.commis && d.commis.foyers) || []).filter((f) => ["essai", "paye"].includes(forfaitCommis(f).cle)).length || parFoyer.length || 1;
    const commun = somme(j30.filter((c) => !c.foyer_id && (c.app || "commis") === "commis"));
    const parFoyerMoyen = parFoyer.length ? parFoyer.reduce((s, x) => s + x.n, 0) / parFoyer.length : 0; // $ US par mois, sans les circulaires
    const parApp = grouper(j30, "app").map(([a, l]) => ({ a: a || "commis", l, n: somme(l) })).sort((x, y) => y.n - x.n);
    const fixes = FRAIS_FIXES.reduce((s, f) => s + f.usd, 0), ia = somme(j30);

    // Seuil de rentabilité de Le Commis : ce que laisse un foyer chaque mois, après Stripe et son coût d'IA
    const laisse = PRIX_COMMIS_MOIS - STRIPE_MOIS - parFoyerMoyen * TAUX;
    const seuil = laisse > 0 ? Math.ceil(((fixes + commun) * TAUX) / laisse) : null;

    const haut = sectionFrais(), fv = etat.fraisVariables; // les factures, quand elles sont lues, remplacent la mesure faite dans les apps
    return `<section class="section">${chiffres([[fv ? cad(fixes * TAUX + fv.total) : cadUsd(fixes + ia), "par mois, tout compris"], [cadUsd(fixes), "frais fixes par mois"], [fv ? cad(fv.total) : cadUsd(ia), fv ? "frais variables, 30 derniers jours" : "Claude à l'utilisation, par mois"], [seuil ? `${seuil} foyers` : "—", "pour que Le Commis couvre tout"]])}</section>` + haut +
      section("Frais fixes mensuels", `Montants en dollars canadiens, au taux de ${TAUX.toFixed(2).replace(".", ",")} $ CA pour 1 $ US (frais de carte compris). Ils servent à toutes les apps.`,
        table([{ t: "Poste" }, { t: "Détail" }, { t: "Par mois", n: 1 }],
          [...FRAIS_FIXES.map((f) => [`<span class="nom">${esc(f.poste)}</span>`, esc(f.detail), esc(cadUsd(f.usd))]),
            [`<span class="nom">Total fixe</span>`, "", `<b>${esc(cadUsd(fixes))}</b>`]], "")) +
      section("Le Commis : ce que laisse un foyer chaque mois", "L'abonnement de 19,99 $ par an, ramené au mois, moins les frais Stripe et le coût d'IA moyen d'un foyer.",
        table([{ t: "" }, { t: "Par mois", n: 1 }],
          [["Abonnement (19,99 $ ÷ 12)", esc(cad(PRIX_COMMIS_MOIS))], ["Frais Stripe", esc("− " + cad(STRIPE_MOIS))],
            ["Claude, moyenne par foyer actif", esc("− " + cadUsd(parFoyerMoyen))], [`<span class="nom">Il reste</span>`, `<b>${esc(cad(laisse))}</b>`],
            ["Frais à couvrir (fixes + circulaires)", esc(cadUsd(fixes + commun))],
            [`<span class="nom">Foyers payants nécessaires</span>`, `<b>${seuil ?? "—"}</b>`]], "")) +
      section("Claude par app, par mois", "Calculé sur les 30 derniers jours. Le Plumeau est gratuit : son coût se compare à zéro revenu.",
        table([{ t: "App" }, { t: "Appels", n: 1 }, { t: "Par mois", n: 1 }],
          parApp.map(({ a, l, n }) => [puce(a), l.length, esc(cadUsd(n))]), "Aucun appel noté pour l'instant.")) +
      section("Claude par fonction, par mois", "Calculé sur les 30 derniers jours avec les tarifs publiés d'Anthropic. Une recherche web coûte 0,01 $ US (≈ 0,014 $ CA).",
        table([{ t: "Fonction" }, { t: "Modèle" }, { t: "Appels", n: 1 }, { t: "Jetons entrée", n: 1 }, { t: "Jetons sortie", n: 1 }, { t: "Recherches", n: 1 }, { t: "Par mois", n: 1 }, { t: "Par appel", n: 1 }],
          grouper(j30, "fonction").map(([f, l]) => ({ f, l, n: somme(l) })).sort((a, b) => b.n - a.n).map(({ f, l, n }) => [
            `<span class="nom">${esc(NOMS_FONCTIONS[f] || f)}</span>`, esc([...new Set(l.map((c) => c.modele.replace("claude-", "")))].join(", ")), l.length,
            l.reduce((s, c) => s + c.entree, 0).toLocaleString("fr-CA"), l.reduce((s, c) => s + c.sortie, 0).toLocaleString("fr-CA"), l.reduce((s, c) => s + c.recherches, 0), esc(cadUsd(n)),
            esc(new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format((n / MOIS / l.length) * TAUX))]),
          "Aucun appel noté pour l'instant. Chaque appel à Claude s'inscrira ici.")) +
      section("Le Commis : Claude par foyer, par mois", `Comparez au prix de l'abonnement : ${cad(PRIX_COMMIS_MOIS)} par mois. La lecture commune des circulaires (${cadUsd(commun)} par mois) est partagée entre les ${actifs} foyer${actifs > 1 ? "s" : ""} actif${actifs > 1 ? "s" : ""} : ${cadUsd(commun / actifs)} chacun, ajouté ci-dessous.`,
        table([{ t: "Foyer" }, { t: "Appels", n: 1 }, { t: "Par mois", n: 1 }, { t: "Le plus coûteux" }],
          parFoyer.map(({ id, l, n }) => {
            const pire = grouper(l, "fonction").map(([f, x]) => [f, somme(x)]).sort((a, b) => b[1] - a[1])[0];
            return [`<span class="nom">${esc(foyers.get(id) || "Foyer retiré")}</span>`, l.length, esc(cadUsd(n + commun / actifs)), esc(pire ? `${NOMS_FONCTIONS[pire[0]] || pire[0]} (${cadUsd(pire[1])})` : "")];
          }), "Aucun foyer n'a encore utilisé l'IA."));
  }
  // ---------- CRM : une fiche par personne (clients des apps et prospects), notes, tâches, courriels, import
  const TYPES_CRM = { client: "Client", prospect: "Prospect", partenaire: "Partenaire", testeur: "Testeur", media: "Média", autre: "Autre" };
  const ETAPES_CRM = [["a_contacter", "À contacter"], ["contacte", "Contacté"], ["interesse", "Intéressé"], ["converti", "Converti"], ["perdu", "Perdu"]];
  const NOM_ETAPE = Object.fromEntries(ETAPES_CRM);
  const APPS_CRM = ["echange", "gousset", "pourquoi", "commis", "fanion", "seuil", "plumeau", "vestibule", "tiroir", "voute", "donne", "nostalgie", "escale"];
  const EXPEDITEURS_CRM = ["bonjour@letabli.ai", "bonjour@holdingai.app", "bonjour@lecommis.ai", "bonjour@fanion.ai"];
  const cellCrm = (v) => { const b = String(v || "").trim(), x = b.replace(/\D/g, ""); if (!x) return null;
    return b.startsWith("+") && x.length >= 8 ? "+" + x : x.length === 10 ? "+1" + x : x.length === 11 && x[0] === "1" ? "+" + x : null; };
  const mailCrm = (v) => (String(v || "").trim().toLowerCase() || null);
  const aujourdHui = () => new Date().toLocaleDateString("en-CA"); // AAAA-MM-JJ, heure locale

  async function crm(corps) {
    const { data: s } = await sb.auth.getSession();
    if (!s.session) throw Object.assign(new Error("Connexion requise."), { code: 401 });
    const r = await fetch(`${URL_SB}/functions/v1/console-crm`, { method: "POST", headers: { "Content-Type": "application/json", apikey: CLE_SB, Authorization: `Bearer ${s.session.access_token}` }, body: JSON.stringify(corps) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.erreur || `Erreur ${r.status}`), { code: r.status });
    return d;
  }
  async function crmCharger() {
    try { etat.crm = await crm({ action: "tout" }); etat.crmErreur = null; }
    catch (e) { etat.crmErreur = e.message; etat.crm = etat.crm || { contacts: [], notes: [], taches: [] }; }
    if (etat.d) rendre();
  }

  // Réunit les fiches du CRM et les personnes inscrites dans les apps (même compte HoldingAI, même cellulaire ou même courriel)
  function personnesCrm(d) {
    const x = etat.crm || { contacts: [] };
    const gens = [], parUid = new Map(), parCell = new Map(), parMail = new Map();
    const indexer = (p) => { if (p.uid) parUid.set(p.uid, p); if (p.cellulaire) parCell.set(p.cellulaire, p); if (p.courriel) parMail.set(p.courriel, p); };
    for (const c of x.contacts || []) {
      const p = { cle: "c:" + c.id, contact: c, nom: c.nom, courriel: mailCrm(c.courriel), cellulaire: c.cellulaire, uid: c.holdingai_uid, organisation: c.organisation,
        type: c.type, etape: c.etape, etiquettes: c.etiquettes || [], apps: new Set(c.apps || []), utilise: new Map(), inscrit: null, vu: null, maj: c.maj, sources: [] };
      gens.push(p); indexer(p);
    }
    const ajouter = (src) => {
      const cell = cellCrm(src.cellulaire), mail = mailCrm(src.courriel);
      let p = (src.uid && parUid.get(src.uid)) || (cell && parCell.get(cell)) || (mail && parMail.get(mail));
      if (!p) {
        p = { cle: "v:" + (src.uid || cell || mail || src.nom), contact: null, nom: src.nom || mail || tel(cell) || "Sans nom", courriel: mail, cellulaire: cell, uid: src.uid || null,
          organisation: null, type: "client", etape: null, etiquettes: [], apps: new Set(), utilise: new Map(), inscrit: null, vu: null, maj: null, sources: [] };
        gens.push(p);
      }
      if (!p.courriel && mail) p.courriel = mail;
      if (!p.cellulaire && cell) p.cellulaire = cell;
      if (!p.uid && src.uid) p.uid = src.uid;
      if ((!p.nom || p.nom === "Sans nom") && src.nom) p.nom = src.nom;
      if (src.app) { p.apps.add(src.app); p.utilise.set(src.app, Math.max(p.utilise.get(src.app) || 0, t(src.derniere) || 0)); }
      if (src.cree && (!p.inscrit || t(src.cree) < t(p.inscrit))) p.inscrit = src.cree;
      if (src.vu && (!p.vu || t(src.vu) > t(p.vu))) p.vu = src.vu;
      p.sources.push(src.source);
      indexer(p);
    };
    for (const c of (d.compte || {}).comptes || []) {
      if (!(c.apps || []).length) ajouter({ uid: c.id, nom: c.nom, cellulaire: c.cellulaire, cree: c.cree, vu: c.vu, source: "Compte L’Établi" });
      for (const a of c.apps || []) ajouter({ uid: c.id, nom: c.nom, cellulaire: c.cellulaire, cree: a.premiere || c.cree, vu: c.vu, app: cleApp(a.app), derniere: a.derniere, source: "Compte L’Établi" });
    }
    for (const f of (d.commis || {}).foyers || []) for (const m of f.membres || []) ajouter({ nom: m.nom, courriel: m.email, cellulaire: m.telephone, cree: f.cree, app: "commis", derniere: f.activite, source: `Le Commis, foyer ${f.nom}` });
    for (const c of (d.gousset || {}).comptes || []) ajouter({ nom: c.prenom, courriel: c.courriel, cree: c.cree, app: "gousset", derniere: c.sync, source: "Le Gousset" });
    for (const f of (d.tiroir || {}).foyers || []) ajouter({ nom: f.prenom, courriel: f.courriel, cellulaire: f.telephone, cree: f.cree, app: "tiroir", derniere: f.derniere, source: `Le Tiroir, ${f.nom || "tiroir"}` });
    // Activité de chaque fiche : notes, tâches et courriels
    const notes = new Map(), taches = new Map();
    for (const n of x.notes || []) { if (!notes.has(n.contact_id)) notes.set(n.contact_id, []); notes.get(n.contact_id).push(n); }
    for (const k of x.taches || []) { if (!taches.has(k.contact_id)) taches.set(k.contact_id, []); taches.get(k.contact_id).push(k); }
    for (const p of gens) {
      const id = p.contact && p.contact.id;
      p.notes = (id && notes.get(id)) || []; p.taches = (id && taches.get(id)) || [];
      p.courriels = p.courriel ? (d.courriels || []).filter((c) => [c.de, c.a, c.repondre_a].map(mailCrm).includes(p.courriel)) : [];
      p.paiements = p.courriel ? ((d.commis || {}).paiements || []).filter((x2) => mailCrm(x2.courriel) === p.courriel) : [];
      p.prochaine = p.taches.filter((k) => !k.faite).sort((a, b) => String(a.echeance || "9999").localeCompare(String(b.echeance || "9999")))[0] || null;
      p.derniere = Math.max(t(p.maj), t(p.vu), ...p.notes.map((n) => t(n.cree)), ...p.courriels.map((c) => t(c.cree)), ...[...p.utilise.values()]);
    }
    return gens.sort((a, b) => b.derniere - a.derniere);
  }
  const tachesDues = () => ((etat.crm || {}).taches || []).filter((k) => !k.faite && k.echeance && k.echeance <= aujourdHui());

  function tamponCrm(p) {
    if (p.type === "prospect" && p.etape) return `<span class="tampon ${p.etape === "perdu" ? "refus" : p.etape === "converti" ? "" : "attente"}">${esc(NOM_ETAPE[p.etape])}</span>`;
    return `<span class="tampon ${p.type === "client" ? "" : "neutre"}">${esc(TYPES_CRM[p.type] || p.type)}</span>`;
  }
  const pucesCrm = (apps) => (apps.size || apps.length ? `<span class="puces">${[...apps].map((a) => `<span class="puce-app"><i class="pastille ${esc(a)}"></i>${esc(nomApp[a] || a)}</span>`).join("")}</span>` : "");
  const echeanceTexte = (k) => { if (!k.echeance) return "sans date"; const auj = aujourdHui();
    return k.echeance < auj ? `en retard, ${jour(k.echeance + "T12:00")}` : k.echeance === auj ? "aujourd'hui" : jour(k.echeance + "T12:00"); };

  // ---------- CRM : invitations à la bêta (qui a invité qui)
  const aApp = (n) => (/^Le /.test(n) ? "au " + n.slice(3) : /^Les /.test(n) ? "aux " + n.slice(4) : "à " + n);
  // Deux sources : le lien « Inviter quelqu'un » des apps (HoldingAI Compte, invitations_arrivees, automatique)
  // et l'invitation inscrite à la main dans une fiche (crm_contacts.invite_par, invite_app, invite_le).
  async function invitationsCharger() {
    try { etat.crmInv = await pontApp("compte", { action: "viralite" }); }
    catch (e) { etat.crmInv = { erreur: e.message, arrivees: [], profils: [] }; }
    if (etat.d) rendre();
  }
  function liensInvitation(gens) {
    const parUid = new Map(gens.filter((p) => p.uid).map((p) => [p.uid, p]));
    const parContact = new Map(gens.filter((p) => p.contact).map((p) => [p.contact.id, p]));
    const x = etat.crmInv || { arrivees: [], profils: [] };
    const profil = new Map((x.profils || []).map((p) => [p.id, p]));
    const personneUid = (uid) => parUid.get(uid) || { cle: "u:" + uid, nom: (profil.get(uid) || {}).nom || "Compte L’Établi", uid, apps: new Set(), fantome: true };
    const liens = [];
    for (const a of x.arrivees || []) liens.push({ de: personneUid(a.parrain), a: personneUid(a.filleul), app: cleApp(a.app), quand: a.cree, nouveau: a.nouveau, source: "lien" });
    for (const p of gens) {
      const c = p.contact; if (!c || !c.invite_par) continue;
      const de = parContact.get(c.invite_par); if (!de) continue;
      liens.push({ de, a: p, app: c.invite_app, quand: c.invite_le ? c.invite_le + "T12:00" : null, source: "main" });
    }
    // Pour chaque personne : l'invitation qui l'a amenée (la plus ancienne; celle inscrite à la main l'emporte)
    const parent = new Map();
    for (const l of liens) {
      const k = l.a.cle, avant = parent.get(k);
      if (!avant || (l.source === "main" && avant.source !== "main") || (l.source === avant.source && t(l.quand) < t(avant.quand))) parent.set(k, l);
    }
    const chaine = (p) => { const vus = new Set([p.cle]), ch = [p]; let l = parent.get(p.cle);
      while (l && !vus.has(l.de.cle)) { ch.unshift(l.de); vus.add(l.de.cle); l = parent.get(l.de.cle); } return ch; };
    const enfants = new Map();
    for (const l of liens) { if (!enfants.has(l.de.cle)) enfants.set(l.de.cle, []); if (!enfants.get(l.de.cle).some((m) => m.a.cle === l.a.cle)) enfants.get(l.de.cle).push(l); }
    return { liens, parent, chaine, enfants };
  }
  function arbreInvitations(inv) {
    const racines = [...new Map([...inv.liens].map((l) => [l.de.cle, l.de])).values()].filter((p) => !inv.parent.has(p.cle));
    const branche = (p, vus) => {
      const fils = (inv.enfants.get(p.cle) || []).filter((l) => !vus.has(l.a.cle)).sort((a, b) => t(a.quand) - t(b.quand));
      if (!fils.length) return "";
      return `<ul>${fils.map((l) => `<li><button class="nom-fiche" data-fiche="${esc(l.a.cle)}">${esc(l.a.nom)}</button>
        <small>${[l.app ? esc(nomApp[l.app] || l.app) : "", l.quand ? esc(jour(l.quand)) : "", l.source === "main" ? "inscrit à la main" : l.nouveau === false ? "avait déjà un compte" : ""].filter(Boolean).join(" · ")}</small>
        ${branche(l.a, new Set([...vus, l.a.cle]))}</li>`).join("")}</ul>`;
    };
    return racines.length ? `<div class="arbre">${racines.map((r) => `<div class="arbre-racine"><button class="nom-fiche" data-fiche="${esc(r.cle)}">${esc(r.nom)}</button>${branche(r, new Set([r.cle]))}</div>`).join("")}</div>` : "";
  }
  function vueCrmInvitations(d, gens) {
    if (!etat.crmInv) { invitationsCharger(); return `<p class="charge">Lecture des invitations…</p>`; }
    const inv = liensInvitation(gens);
    const invites = [...inv.parent.values()].sort((a, b) => t(b.quand) - t(a.quand));
    const inviteurs = new Set(inv.liens.map((l) => l.de.cle));
    const relais = invites.filter((l) => inviteurs.has(l.a.cle)).length;
    const profondeur = Math.max(0, ...invites.map((l) => inv.chaine(l.a).length - 1));
    const choix = (nom, aide) => `<select name="${nom}" required aria-label="${aide}"><option value="">${aide}</option>${gens.slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((p) => `<option value="${esc(p.cle)}">${esc(p.nom)}${p.courriel ? ` (${esc(p.courriel)})` : ""}</option>`).join("")}</select>`;
    return (etat.crmInv.erreur ? `<section class="section"><div class="bandeau">Les invitations faites dans les apps n'ont pas pu être lues : ${esc(etat.crmInv.erreur)}</div></section>` : "") +
      `<section class="section">${chiffres([[invites.length, invites.length > 1 ? "personnes invitées" : "personne invitée"], [inviteurs.size, inviteurs.size > 1 ? "personnes qui invitent" : "personne qui invite"],
        [relais, "invités qui ont invité à leur tour"], [profondeur, profondeur > 1 ? "générations dans la plus longue chaîne" : "génération dans la plus longue chaîne"]])}</section>` +
      section("Chaînes d'invitation", "Qui a invité qui, de génération en génération. Les invitations faites avec le bouton « Inviter quelqu'un » des apps s'ajoutent toutes seules; les autres s'inscrivent ci-dessous.",
        arbreInvitations(inv) || `<p class="vide">Personne n'a encore été invité.</p>`) +
      section("Toutes les invitations", "",
        table([{ t: "Personne invitée" }, { t: "Invitée par" }, { t: "Chaîne" }, { t: "App" }, { t: "Date" }, { t: "Comment" }, { t: "A invité", n: 1 }],
          invites.map((l) => [`<button class="nom-fiche" data-fiche="${esc(l.a.cle)}">${esc(l.a.nom)}</button>`, `<button class="nom-fiche" data-fiche="${esc(l.de.cle)}">${esc(l.de.nom)}</button>`,
            `<small class="chaine">${inv.chaine(l.a).map((p) => esc(p.nom)).join(" › ")}</small>`, l.app ? puce(l.app) : "", esc(l.quand ? jour(l.quand) : ""),
            esc(l.source === "main" ? "Inscrite à la main" : l.nouveau === false ? "Lien (avait déjà un compte)" : "Lien d'invitation"), (inv.enfants.get(l.a.cle) || []).length]),
          "Aucune invitation pour l'instant.")) +
      `<div data-crm-ecrit>` + section("Inscrire une invitation", "Pour une invitation faite hors des apps : un courriel, un appel, une rencontre. La personne invitée garde une seule « invitée par ».",
        `<form id="f-crm-invitation" class="crm-form">
          <label>Personne invitée${choix("invite", "Choisir la personne invitée")}</label>
          <label>Invitée par${choix("par", "Choisir qui l'a invitée")}</label>
          <label>App<select name="app"><option value="">Toutes ou aucune en particulier</option>${APPS_CRM.map((a) => `<option value="${a}">${esc(nomApp[a])}</option>`).join("")}</select></label>
          <label>Date<input name="le" type="date" value="${aujourdHui()}"></label>
          <div class="dlg-actions"><button class="btn" type="submit">Inscrire l'invitation</button></div>
        </form>`) + `</div>`;
  }
  // Dans la fiche : invitée par qui, et qui elle a invité
  function blocInvitationFiche(gens, p) {
    if (!etat.crmInv) { invitationsCharger(); return ""; }
    const inv = liensInvitation(gens), l = inv.parent.get(p.cle), fils = inv.enfants.get(p.cle) || [];
    const ch = inv.chaine(p);
    return section("Invitations bêta", "",
      `${l ? `<p>Invitée par <button class="nom-fiche" data-fiche="${esc(l.de.cle)}">${esc(l.de.nom)}</button>${l.app ? ` ${esc(aApp(nomApp[l.app] || l.app))}` : ""}${l.quand ? `, le ${esc(jour(l.quand))}` : ""}${l.source === "main" ? " (inscrit à la main)" : ""}.</p>` : `<p class="vide">Invitée par personne d'inscrit.</p>`}
      ${ch.length > 2 ? `<p class="note">Chaîne : ${ch.map((x) => esc(x.nom)).join(" › ")}</p>` : ""}
      ${fils.length ? `<p>A invité : ${fils.map((m) => `<button class="nom-fiche" data-fiche="${esc(m.a.cle)}">${esc(m.a.nom)}</button>`).join(", ")}.</p>` : ""}
      ${p.contact && p.contact.invite_par ? `<p data-crm-ecrit><button class="lien" data-crm="oublier-invitation">Retirer l'invitation inscrite à la main</button></p>` : ""}`);
  }

  function vueCrm(d) {
    if (!etat.crm) { crmCharger(); return `<p class="charge">Lecture du CRM…</p>`; }
    if (etat.crmImport) return vueCrmImport();
    if (etat.crmFiche === "nouveau") return `<p><button class="lien" data-crm="liste">Retour à la liste</button></p>` + section("Nouveau contact", "", formContact(null));
    const gens = personnesCrm(d);
    if (etat.crmFiche) { const p = gens.find((g) => g.cle === etat.crmFiche) || gens.find((g) => g.contact && "c:" + g.contact.id === etat.crmFiche); if (p) return vueCrmFiche(d, p); etat.crmFiche = null; }
    const f = etat.crmFiltre || "tous", q = (etat.crmRecherche || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const actifs = gens.filter((p) => p.type === "prospect" && ["a_contacter", "contacte", "interesse"].includes(p.etape));
    const FILTRES = [["tous", `Tous (${gens.length})`], ["client", `Clients (${gens.filter((p) => p.type === "client").length})`], ["prospect", `Prospects (${gens.filter((p) => p.type === "prospect").length})`],
      ["autres", `Partenaires, testeurs et médias (${gens.filter((p) => ["partenaire", "testeur", "media", "autre"].includes(p.type)).length})`], ["relancer", `À relancer (${gens.filter((p) => p.prochaine && p.prochaine.echeance && p.prochaine.echeance <= aujourdHui()).length})`],
      ["invitations", etat.crmInv ? `Invitations bêta (${liensInvitation(gens).parent.size})` : "Invitations bêta"]];
    const etiquettes = [...new Set(gens.flatMap((p) => p.etiquettes))].sort();
    const vus = gens.filter((p) => (f === "tous" || (f === "autres" ? ["partenaire", "testeur", "media", "autre"].includes(p.type) : f === "relancer" ? p.prochaine && p.prochaine.echeance && p.prochaine.echeance <= aujourdHui() : p.type === f))
      && (!etat.crmEtape || p.etape === etat.crmEtape) && (!etat.crmEtiquette || p.etiquettes.includes(etat.crmEtiquette))
      && (!q || [p.nom, p.courriel, p.cellulaire, p.organisation, ...p.etiquettes].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)));
    return (etat.crmErreur ? `<section class="section"><div class="bandeau">Le CRM n'a pas pu être lu : ${esc(etat.crmErreur)}</div></section>` : "") +
      `<section class="section">${chiffres([[gens.length, gens.length > 1 ? "personnes" : "personne"], [gens.filter((p) => p.type === "client").length, "clients"], [actifs.length, "prospects en cours"],
        [gens.filter((p) => p.etape === "converti").length, "prospects convertis"], [tachesDues().length, "tâches à faire aujourd'hui ou en retard"]])}</section>` +
      `<section class="section"><div class="crm-barre">
        <input id="crm-q" type="search" placeholder="Chercher un nom, un courriel, une étiquette" value="${esc(etat.crmRecherche || "")}" aria-label="Chercher dans le CRM">
        <div class="crm-boutons" data-crm-ecrit><button class="btn" data-crm="nouveau">Ajouter un contact</button><button class="btn pale" data-crm="importer">Importer une liste</button></div>
      </div>
      <div class="crm-filtres" role="group" aria-label="Filtrer">${FILTRES.map(([k, mot]) => `<button class="filtre" data-crm-filtre="${k}" ${f === k ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${esc(mot)}</button>`).join("")}
        <select id="crm-etape" aria-label="Étape"><option value="">Toutes les étapes</option>${ETAPES_CRM.map(([k, m]) => `<option value="${k}" ${etat.crmEtape === k ? "selected" : ""}>${m} (${gens.filter((p) => p.etape === k).length})</option>`).join("")}</select>
        ${etiquettes.length ? `<select id="crm-etiquette" aria-label="Étiquette"><option value="">Toutes les étiquettes</option>${etiquettes.map((e) => `<option ${etat.crmEtiquette === e ? "selected" : ""}>${esc(e)}</option>`).join("")}</select>` : ""}
      </div>` + (f === "invitations" ? `</section>` + vueCrmInvitations(d, gens) : 
      table([{ t: "Personne" }, { t: "Statut" }, { t: "Apps" }, { t: "Étiquettes" }, { t: "Prochaine tâche" }, { t: "Dernière activité" }],
        vus.slice(0, 500).map((p) => [`<button class="nom-fiche" data-fiche="${esc(p.cle)}">${esc(p.nom)}</button><small>${esc([p.organisation, p.courriel, tel(p.cellulaire)].filter(Boolean).join(", "))}</small>`,
          tamponCrm(p), pucesCrm(p.apps), esc(p.etiquettes.join(", ")),
          p.prochaine ? `${esc(p.prochaine.titre)}<small class="${p.prochaine.echeance && p.prochaine.echeance < aujourdHui() ? "retard" : ""}">${esc(echeanceTexte(p.prochaine))}</small>` : "",
          esc(p.derniere ? ilYA(p.derniere) : "")]),
        gens.length ? "Personne ne correspond à cette recherche." : "Le CRM est vide. Ajoutez un contact ou importez une liste; les personnes inscrites dans vos apps s'ajoutent toutes seules.") + `</section>`);
  }

  function formContact(c) {
    const v = (k) => esc((c && c[k]) || "");
    return `<form id="f-crm-contact" class="crm-form" data-id="${esc((c && c.id) || "")}">
      <label>Nom<input name="nom" required maxlength="120" value="${v("nom")}"></label>
      <label>Organisation<input name="organisation" maxlength="120" value="${v("organisation")}" placeholder="ex. Club de golf de Magog"></label>
      <label>Courriel<input name="courriel" type="email" maxlength="200" value="${v("courriel")}"></label>
      <label>Cellulaire<input name="cellulaire" inputmode="tel" maxlength="30" value="${esc(c && c.cellulaire ? tel(c.cellulaire) : "")}"></label>
      <label>Type<select name="type">${Object.entries(TYPES_CRM).map(([k, m]) => `<option value="${k}" ${(c ? c.type : "prospect") === k ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label>Étape (prospects)<select name="etape"><option value="">Aucune</option>${ETAPES_CRM.map(([k, m]) => `<option value="${k}" ${c && c.etape === k ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <label>Source<input name="source" maxlength="120" value="${v("source")}" placeholder="ex. salon, recommandation, site"></label>
      <label>Étiquettes<input name="etiquettes" value="${esc(((c && c.etiquettes) || []).join(", "))}" placeholder="séparées par des virgules"></label>
      <fieldset class="crm-apps"><legend>Apps qui l'intéressent</legend>${APPS_CRM.map((a) => `<label class="case"><input type="checkbox" name="apps" value="${a}" ${((c && c.apps) || []).includes(a) ? "checked" : ""}> ${esc(nomApp[a])}</label>`).join("")}</fieldset>
      <div class="dlg-actions"><button class="btn" type="submit">${c && c.id ? "Enregistrer" : "Ajouter le contact"}</button><button class="btn pale" type="button" data-crm="annuler">Annuler</button></div>
    </form>`;
  }

  function vueCrmFiche(d, p) {
    const retour = `<p><button class="lien" data-crm="liste">Retour à la liste</button></p>`;
    if (etat.crmEdition) return retour + section(p.contact ? `Modifier ${esc(p.nom)}` : "Nouveau contact", "", formContact(p.contact || { nom: p.nom, courriel: p.courriel, cellulaire: p.cellulaire, type: p.type, apps: [...p.apps] }));
    const ouvertes = p.taches.filter((k) => !k.faite), faites = p.taches.filter((k) => k.faite);
    const activite = [
      ...p.notes.map((n) => ({ t: t(n.cree), html: `<article class="fiche"><div class="tete"><b>Note</b><span>${esc(moment(n.cree))}</span>${n.auteur ? `<span>${esc(n.auteur)}</span>` : ""}<button class="lien" data-crm-note-suppr="${esc(n.id)}" data-crm-ecrit>Supprimer</button></div><p class="reponse">${esc(n.texte)}</p></article>` })),
      ...p.courriels.map((c) => ({ t: t(c.cree), html: `<article class="fiche"><div class="tete"><b>${c.sens === "envoye" ? "Courriel envoyé" : "Courriel reçu"}</b><span>${esc(moment(c.cree))}</span><span>${esc(c.sens === "envoye" ? `de ${c.de}` : `à ${c.a}`)}</span></div><p><b>${esc(c.sujet || "(sans objet)")}</b></p><details><summary>Lire</summary><p class="reponse">${esc(String(c.texte || "").slice(0, 4000))}</p></details></article>` })),
      ...p.paiements.map((x) => ({ t: t(x.cree), html: `<article class="fiche"><div class="tete"><b>Paiement</b><span>${esc(moment(x.cree))}</span><span>${esc(argent(x.montant, x.devise))}</span><span>${esc(x.foyer || "")}</span></div></article>` })),
      ...faites.map((k) => ({ t: t(k.faite_le), html: `<article class="fiche"><div class="tete"><b>Tâche faite</b><span>${esc(moment(k.faite_le))}</span></div><p>${esc(k.titre)}</p></article>` })),
    ].sort((a, b) => b.t - a.t);
    return retour +
      `<section class="section crm-entete"><div><h2>${esc(p.nom)}</h2><p class="sous">${esc([p.organisation, p.courriel, tel(p.cellulaire)].filter(Boolean).join(" · ") || "Aucune coordonnée")}</p></div>
        <div class="crm-statut">${tamponCrm(p)}${p.etiquettes.map((e) => `<span class="etiquette">${esc(e)}</span>`).join("")}</div></section>` +
      (p.type === "prospect" || p.etape ? `<section class="section" data-crm-ecrit><div class="crm-etapes" role="group" aria-label="Étape">${ETAPES_CRM.map(([k, m]) => `<button class="filtre" data-crm-etape-fiche="${k}" aria-pressed="${p.etape === k}">${m}</button>`).join("")}</div></section>` : "") +
      `<div class="crm-colonnes"><div>` +
      section("Tâches", "", (ouvertes.length ? `<div class="liste">${ouvertes.map((k) => `<div class="fiche tache"><label class="case"><input type="checkbox" data-crm-tache="${esc(k.id)}" data-crm-ecrit> ${esc(k.titre)}</label><small class="${k.echeance && k.echeance < aujourdHui() ? "retard" : ""}">${esc(echeanceTexte(k))}</small></div>`).join("")}</div>` : `<p class="vide">Aucune tâche ouverte.</p>`) +
        `<form id="f-crm-tache" class="crm-ligne" data-crm-ecrit><input name="titre" required maxlength="300" placeholder="ex. Relancer après la démo" aria-label="Nouvelle tâche"><input name="echeance" type="date" aria-label="Échéance" value=""><button class="btn" type="submit">Ajouter</button></form>`) +
      section("Note", "", `<form id="f-crm-note" class="crm-col" data-crm-ecrit><textarea name="texte" rows="3" maxlength="5000" required placeholder="Ce qui s'est dit, ce qu'il faut retenir" aria-label="Nouvelle note"></textarea><button class="btn" type="submit">Ajouter la note</button></form>`) +
      (p.courriel ? section("Écrire un courriel", `À ${esc(p.courriel)}. Le courriel est gardé dans cette fiche et dans l'onglet Courriels.`,
        `<form id="f-crm-courriel" class="crm-col" data-crm-ecrit><label>De<select name="de">${EXPEDITEURS_CRM.map((a) => `<option>${a}</option>`).join("")}</select></label>
          <label>Objet<input name="sujet" required maxlength="300"></label><label>Message<textarea name="texte" rows="7" required maxlength="20000"></textarea></label><button class="btn" type="submit">Envoyer</button></form>`) : "") +
      `</div><div>` +
      section("Apps", "", p.apps.size || p.uid ? `${p.utilise.size ? `<p class="crm-apps-ligne"><span>Utilise</span>${pucesCrm(new Set(p.utilise.keys()))}</p>` : ""}${p.contact && (p.contact.apps || []).length ? `<p class="crm-apps-ligne"><span>S'intéresse à</span>${pucesCrm(new Set(p.contact.apps))}</p>` : ""}<p class="note">${esc([p.uid ? "Compte L’Établi" : "", p.inscrit ? `inscrit le ${jour(p.inscrit)}` : "", p.vu ? `dernière connexion ${ilYA(p.vu)}` : ""].filter(Boolean).join(", "))}</p>${p.sources.length ? `<p class="note">${esc([...new Set(p.sources)].join(" · "))}</p>` : ""}` : `<p class="vide">N'utilise encore aucune app.</p>`) +
      blocInvitationFiche(personnesCrm(d), p) +
      section("Activité", "", activite.length ? `<div class="liste">${activite.map((a) => a.html).join("")}</div>` : `<p class="vide">Aucune activité pour l'instant.</p>`) +
      `<p class="crm-bas" data-crm-ecrit><button class="lien" data-crm="modifier">Modifier la fiche</button>${p.contact ? ` <button class="lien" data-crm="supprimer">Supprimer la fiche</button>` : ""}</p>` +
      `</div></div>`;
  }

  // Import : coller une liste (copiée d'une feuille) ou choisir un fichier CSV, voir l'aperçu, puis importer
  const COLONNES_CRM = [["nom", /^(nom|name|nom complet|full ?name|contact)$/], ["prenom", /^(pr[ée]nom|first ?name)$/], ["famille", /^(nom de famille|last ?name|surname)$/],
    ["courriel", /^(courriel|e-?mail|mail|adresse courriel)$/], ["cellulaire", /^(cellulaire|cell|t[ée]l[ée]phone|tel|phone|mobile|num[ée]ro)$/],
    ["organisation", /^(organisation|entreprise|compagnie|soci[ée]t[ée]|company|club|organization)$/], ["type", /^(type|cat[ée]gorie)$/], ["etape", /^([ée]tape|statut|stage|status)$/],
    ["etiquettes", /^([ée]tiquettes?|tags?|mots-?cl[ée]s)$/], ["source", /^(source|provenance)$/], ["apps", /^(apps?|application)$/], ["note", /^(notes?|commentaires?|remarques?)$/]];
  function lireCsv(texte) {
    const lignes = String(texte || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lignes.length) return { entetes: [], rangs: [] };
    const sep = ["\t", ";", ","].map((s) => [s, (lignes[0].match(new RegExp(s === "\t" ? "\\t" : s, "g")) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    const couper = (l) => { const out = []; let cur = "", q = false;
      for (let i = 0; i < l.length; i++) { const ch = l[i];
        if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === sep) { out.push(cur.trim()); cur = ""; } else cur += ch; }
      out.push(cur.trim()); return out; };
    const brut = lignes.map(couper);
    const norm = (h) => h.toLowerCase().replace(/[\s_]+/g, " ").trim();
    const reconnu = brut[0].map((h) => (COLONNES_CRM.find(([, re]) => re.test(norm(h))) || [null])[0]);
    const avecEntetes = reconnu.filter(Boolean).length >= 1;
    const cols = avecEntetes ? reconnu : brut[0].map((v) => (/@/.test(v) ? "courriel" : /^\+?[\d\s().-]{10,}$/.test(v) ? "cellulaire" : "nom"));
    const rangs = (avecEntetes ? brut.slice(1) : brut).map((r) => { const o = {}; cols.forEach((k, i) => { if (k && r[i]) o[k] = o[k] ? `${o[k]} ${r[i]}` : r[i]; });
      if (!o.nom && (o.prenom || o.famille)) o.nom = [o.prenom, o.famille].filter(Boolean).join(" "); delete o.prenom; delete o.famille; return o; }).filter((o) => o.nom || o.courriel || o.cellulaire);
    return { entetes: brut[0], cols, avecEntetes, rangs };
  }
  function vueCrmImport() {
    const x = etat.crmImport, a = x.apercu;
    return `<p><button class="lien" data-crm="liste">Retour à la liste</button></p>` +
      section("Importer une liste", "Collez des lignes copiées d'une feuille de calcul, ou choisissez un fichier CSV. La première ligne peut donner les colonnes : nom (ou prénom et nom de famille), courriel, cellulaire, organisation, type, étape, étiquettes, source, apps, note. Une personne déjà présente (même courriel ou même cellulaire) est complétée, jamais écrasée.",
        `<div class="crm-col"><textarea id="crm-import-texte" rows="8" placeholder="nom;courriel;cellulaire;organisation&#10;Julie Tremblay;julie@exemple.ca;514 555-0101;Club de golf Magog">${esc(x.texte || "")}</textarea>
          <label class="crm-fichier">Ou un fichier CSV<input id="crm-import-fichier" type="file" accept=".csv,.tsv,.txt,text/csv"></label>
          <div class="crm-ligne"><label>Type par défaut<select id="crm-import-type">${Object.entries(TYPES_CRM).map(([k, m]) => `<option value="${k}" ${(x.type || "prospect") === k ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label>Étiquette à ajouter à tous<input id="crm-import-etiquette" maxlength="40" value="${esc(x.etiquette || "")}" placeholder="ex. salon-golf-2026"></label></div>
          <div class="dlg-actions"><button class="btn pale" data-crm="apercu">Voir l'aperçu</button>${a && a.rangs.length ? `<button class="btn" data-crm="lancer-import">Importer ${a.rangs.length} contact${a.rangs.length > 1 ? "s" : ""}</button>` : ""}</div></div>`) +
      (a ? section("Aperçu", a.rangs.length ? `${a.rangs.length} ligne${a.rangs.length > 1 ? "s" : ""} reconnue${a.rangs.length > 1 ? "s" : ""}${a.avecEntetes ? "" : " (sans ligne de colonnes : nom, courriel et cellulaire devinés)"}. Les 10 premières :` : "Aucune ligne reconnue. Vérifiez que la liste a un nom, un courriel ou un cellulaire.",
        a.rangs.length ? table([{ t: "Nom" }, { t: "Courriel" }, { t: "Cellulaire" }, { t: "Organisation" }, { t: "Type" }, { t: "Étiquettes" }],
          a.rangs.slice(0, 10).map((r) => [esc(r.nom || ""), esc(r.courriel || ""), esc(r.cellulaire || ""), esc(r.organisation || ""), esc(r.type || x.type || "prospect"), esc(r.etiquettes || "")]), "") : "") : "") +
      (x.resultat ? section("Résultat", "", `<p>${x.resultat.ajoutes} ajouté${x.resultat.ajoutes > 1 ? "s" : ""}, ${x.resultat.completes} complété${x.resultat.completes > 1 ? "s" : ""}.</p>${(x.resultat.erreurs || []).length ? `<p class="note alerte">${x.resultat.erreurs.map(esc).join("<br>")}</p>` : ""}`) : "");
  }

  // Une personne vue dans une app mais sans fiche : la fiche est créée au premier geste (note, tâche, étiquette…)
  async function assurerFiche(p) {
    if (p.contact) return p.contact.id;
    const r = await crm({ action: "contact.enregistrer", contact: { nom: p.nom, courriel: p.courriel, cellulaire: p.cellulaire, type: "client", holdingai_uid: p.uid, apps: [...p.apps] } });
    etat.crmFiche = "c:" + r.contact.id;
    return r.contact.id;
  }
  async function gesteCrm(corps, fait) {
    try { await crm(corps); if (fait) toast(fait); await crmCharger(); return true; }
    catch (e) { toast(e.message, true); return false; }
  }
  function ficheCourante() { return etat.d && etat.crmFiche ? personnesCrm(etat.d).find((g) => g.cle === etat.crmFiche) : null; }

  async function clicCrm(b) {
    const g = b.dataset.crm;
    if (b.dataset.fiche) { etat.crmFiche = b.dataset.fiche; etat.crmEdition = false; rendre(); window.scrollTo({ top: 0 }); return true; }
    if (b.dataset.crmFiltre) { etat.crmFiltre = b.dataset.crmFiltre; rendre(); return true; }
    if (b.hasAttribute("data-crm-etape-fiche")) { const p = ficheCourante(); if (!p) return true;
      try { const id = await assurerFiche(p); await gesteCrm({ action: "contact.enregistrer", contact: { id, etape: b.dataset.crmEtapeFiche } }, `Étape : ${NOM_ETAPE[b.dataset.crmEtapeFiche]}.`); } catch (e) { toast(e.message, true); }
      return true; }
    if (b.dataset.crmNoteSuppr) { if (await confirmer({ titre: "Supprimer cette note ?", texte: "Elle sera effacée pour de bon.", bouton: "Supprimer la note" })) gesteCrm({ action: "note.supprimer", id: b.dataset.crmNoteSuppr }, "Note supprimée."); return true; }
    if (!g) return false;
    if (g === "liste") { etat.crmFiche = null; etat.crmEdition = false; etat.crmImport = null; rendre(); return true; }
    if (g === "nouveau") { etat.crmFiche = "nouveau"; etat.crmEdition = true; rendre(); return true; }
    if (g === "modifier") { etat.crmEdition = true; rendre(); return true; }
    if (g === "annuler") { etat.crmEdition = false; if (etat.crmFiche === "nouveau") etat.crmFiche = null; rendre(); return true; }
    if (g === "supprimer") { const p = ficheCourante(); if (!p || !p.contact) return true;
      if (await confirmer({ titre: `Supprimer la fiche de ${p.nom} ?`, texte: "Ses notes et ses tâches seront effacées pour de bon. Son compte dans les apps n'est pas touché.", bouton: "Supprimer la fiche" })) {
        if (await gesteCrm({ action: "contact.supprimer", id: p.contact.id }, "Fiche supprimée.")) { etat.crmFiche = null; rendre(); } }
      return true; }
    if (g === "oublier-invitation") { const p = ficheCourante(); if (!p || !p.contact) return true;
      await gesteCrm({ action: "contact.enregistrer", contact: { id: p.contact.id, invite_par: null, invite_app: null, invite_le: null } }, "Invitation retirée.");
      return true; }
    if (g === "importer") { etat.crmImport = { type: "prospect" }; rendre(); return true; }
    if (g === "apercu") { const x = etat.crmImport; x.texte = $("#crm-import-texte").value; x.type = $("#crm-import-type").value; x.etiquette = $("#crm-import-etiquette").value.trim(); x.apercu = lireCsv(x.texte); x.resultat = null; rendre(); return true; }
    if (g === "lancer-import") { const x = etat.crmImport, a = x.apercu; if (!a || !a.rangs.length) return true;
      if (a.rangs.length > 1000) { toast("Maximum de 1000 lignes à la fois.", true); return true; }
      const lignes = a.rangs.map((r) => ({ ...r, type: r.type || x.type, etiquettes: [r.etiquettes, x.etiquette].filter(Boolean).join(",") }));
      b.disabled = true;
      try { x.resultat = await crm({ action: "importer", lignes }); x.apercu = null; x.texte = ""; toast("Import terminé."); await crmCharger(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
      return true; }
    return false;
  }
  async function soumettreCrm(form) {
    const fd = new FormData(form), v = (k) => String(fd.get(k) || "").trim();
    if (form.id === "f-crm-contact") {
      const contact = { nom: v("nom"), organisation: v("organisation"), courriel: v("courriel"), cellulaire: v("cellulaire"), type: v("type"), etape: v("etape") || (v("type") === "prospect" && !form.dataset.id ? "a_contacter" : null), source: v("source"),
        etiquettes: v("etiquettes").split(",").map((x) => x.trim()).filter(Boolean), apps: fd.getAll("apps") };
      const p = ficheCourante();
      if (form.dataset.id) contact.id = form.dataset.id; else if (p && p.uid) contact.holdingai_uid = p.uid;
      try { const r = await crm({ action: "contact.enregistrer", contact }); toast(contact.id ? "Fiche enregistrée." : "Contact ajouté."); etat.crmFiche = "c:" + r.contact.id; etat.crmEdition = false; await crmCharger(); }
      catch (e) { toast(e.message, true); }
      return;
    }
    if (form.id === "f-crm-invitation") {
      const gens = personnesCrm(etat.d), invite = gens.find((g) => g.cle === v("invite")), par = gens.find((g) => g.cle === v("par"));
      if (!invite || !par) { toast("Choisissez les deux personnes.", true); return; }
      if (invite.cle === par.cle) { toast("Une personne ne peut pas s'inviter elle-même.", true); return; }
      try {
        const garder = etat.crmFiche;
        const idPar = await assurerFiche(par), idInvite = await assurerFiche(invite);
        etat.crmFiche = garder;
        await gesteCrm({ action: "contact.enregistrer", contact: { id: idInvite, invite_par: idPar, invite_app: v("app") || null, invite_le: v("le") || null } }, `Invitation inscrite : ${par.nom} › ${invite.nom}.`);
      } catch (e) { toast(e.message, true); }
      return;
    }
    const p = ficheCourante(); if (!p) return;
    try {
      const id = await assurerFiche(p);
      if (form.id === "f-crm-note") await gesteCrm({ action: "note.ajouter", contact_id: id, texte: v("texte") }, "Note ajoutée.");
      if (form.id === "f-crm-tache") await gesteCrm({ action: "tache.ajouter", contact_id: id, titre: v("titre"), echeance: v("echeance") || null }, "Tâche ajoutée.");
      if (form.id === "f-crm-courriel") {
        if (!(await confirmer({ titre: `Envoyer ce courriel à ${p.courriel} ?`, texte: `De ${v("de")}, objet « ${v("sujet")} ».`, bouton: "Envoyer" }))) return;
        await gesteCrm({ action: "courriel.envoyer", contact_id: id, de: v("de"), sujet: v("sujet"), texte: v("texte") }, "Courriel envoyé.");
        await charger(true); // le courriel envoyé paraît dans l'activité
      }
    } catch (e) { toast(e.message, true); }
  }
  const MOTS = { "crm.ajout": "CRM", "crm.suppression": "CRM", "crm.etape": "CRM", "crm.courriel": "CRM", "crm.import": "CRM", "commis.idee": "Idée", "commis.nouveaute": "Nouveauté", "fanion.idee": "Idée", "fanion.nouveaute": "Nouveauté", "plumeau.idee": "Idée", "plumeau.nouveaute": "Nouveauté", "plumeau.compte": "Compte", "tiroir.foyer": "Foyer", "gousset.demande": "Demande d'accès", "commis.avis": "Avis", "commis.foyer": "Foyer", "fanion.avis": "Avis", "fanion.groupe": "Groupe", "fanion.demande": "Demande de jeu", "acces.inviter": "Accès", "acces.role": "Accès", "acces.retirer": "Accès", "courriel.etat": "Courriel", "courriel.repondre": "Courriel" };
  const GESTES = { publie: "publié sur le site", attente: "remis en attente", ecarte: "écarté", essai: "essai prolongé", activer: "forfait activé pour 12 mois", retirer: "forfait retiré", traitee: "marquée comme traitée", traite: "marqué comme traité", atraiter: "remis à traiter", repondu: "réponse envoyée", annoncer: "annoncée dans l'app", recue: "à lire", etudiee: "à l'étude", prevue: "prévue", faite: "faite", non: "non retenue" };
  const ROLES = { proprio: "Propriétaire", gestion: "Gestion", lecture: "Consultation" };
  const gesteJournal = (j) => { const x = j.detail || {};
    if (/^crm\./.test(j.action)) return j.action === "crm.ajout" ? `contact ajouté (${TYPES_CRM[x.type] || ""})` : j.action === "crm.suppression" ? "fiche supprimée" : j.action === "crm.etape" ? `étape : ${NOM_ETAPE[x.etape] || x.etape}` : j.action === "crm.courriel" ? `courriel envoyé : ${x.sujet || ""}` : j.action === "crm.import" ? "import d'une liste" : "";
    if (j.app === "console") return x.geste === "inviter" ? `accès donné (${ROLES[x.role] || ""})` : x.geste === "role" ? `rôle changé (${ROLES[x.role] || ""})` : "accès retiré";
    if (j.action === "gousset.demande") return (ETATS_DEMANDE[x.statut] || [x.statut])[0].toLowerCase();
    if (j.action === "plumeau.compte") return x.geste === "bloquer" ? "IA coupée" : "IA rendue";
    if (j.action === "commis.idee" || j.action === "plumeau.idee") return [GESTES[x.statut] || "", x.repondu ? "réponse envoyée" : ""].filter(Boolean).join(", ");
    return GESTES[x.etat || x.geste] || ""; };
  function vueAcces(d) {
    const gens = d.acces || [];
    return section("Donner l'accès à quelqu'un", "La personne ouvre console.holdingai.app, entre son courriel et reçoit un code de connexion, comme vous. Aucun courriel d'invitation n'est envoyé : donnez-lui l'adresse vous-même.",
      `<form class="invite" id="f-invite"><label>Courriel<input id="in-invite" type="email" required maxlength="200" autocomplete="off" placeholder="prenom@exemple.com"></label>
        <label>Ce qu'elle peut faire<select id="in-role"><option value="lecture">Consulter seulement</option><option value="gestion">Consulter, publier les avis et gérer les forfaits</option></select></label>
        <button class="btn" type="submit">Donner l'accès</button></form>`) +
      section("Qui a accès", "Vous seul pouvez donner, changer ou retirer un accès.",
        table([{ t: "Personne" }, { t: "Rôle" }, { t: "Depuis" }, { t: "Dernière connexion" }, { t: "Gestes" }], gens.map((g) => [
          `<span class="nom">${esc(g.courriel)}</span>`, `<span class="tampon ${g.role === "lecture" ? "neutre" : ""}">${esc(ROLES[g.role] || g.role)}</span>`, esc(jour(g.ajoute)), esc(g.vu ? ilYA(g.vu) : "jamais"),
          g.role === "proprio" ? "" : `<div class="gestes"><button class="lien" data-acces="${esc(g.id)}" data-role="${g.role === "lecture" ? "gestion" : "lecture"}">${g.role === "lecture" ? "Permettre de publier et d'activer" : "Limiter à la consultation"}</button><button class="lien" data-acces="${esc(g.id)}" data-role="">Retirer l'accès</button></div>`]), ""));
  }
  function vueJournal(d) {
    return section("Journal", "Chaque geste fait dans la console, du plus récent au plus ancien.",
      table([{ t: "Geste" }, { t: "Par" }, { t: "App" }, { t: "Quand" }], d.commis.journal.map((j) => {
        const x = j.detail || {};
        return [`<span class="nom">${esc(MOTS[j.action] || j.action)} : ${esc(j.cible || "")}</span><small>${esc([gesteJournal(j), x.raison || ""].filter(Boolean).join(", "))}</small>`, esc(j.qui || ""), j.app === "console" ? "Console" : puce(j.app), esc(moment(j.cree))];
      }), "Aucun geste pour l'instant."));
  }

  // ---------- Viralité : combien de nouveaux chaque utilisateur amène, par app
  // Commis, Gousset, Tiroir : console_viralite() de chaque projet (parrainages, membres invités, partages propres à l'app).
  // HoldingAI Compte : console_viralite() des invitations communes à toutes les apps (bouton « Inviter quelqu'un »,
  //   lien compte.letabli.ai/i/CODE/app) : partages, ouvertures du lien, arrivées (nouveau compte ou première visite).
  // Fanion (groupes, parrain « ref ») et Plumeau : calculés avec les données déjà chargées.
  // Tout est lu seulement à l'ouverture de l'onglet.
  async function viralite() {
    if (etat.viraliteEnCours) return;
    etat.viraliteEnCours = true;
    const apps = ["commis", "gousset", "tiroir", "compte"];
    const res = await Promise.allSettled(apps.map((a) => pontApp(a, { action: "viralite" })));
    etat.viralite = Object.fromEntries(apps.map((a, i) => [a, res[i].status === "fulfilled" ? res[i].value : { unites: [], membres: [], partages: [], erreur: res[i].reason.message }]));
    etat.viraliteEnCours = false;
    if (etat.vue === "viralite") rendre();
  }
  const pct = (n, sur) => (sur ? `${Math.round((100 * n) / sur)} %` : "–");
  const facteur = (n) => (n == null ? "–" : n.toFixed(2).replace(".", ","));
  const mediane = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const duree = (ms) => (ms == null ? "–" : ms < 3600e3 ? "moins d'une heure" : ms < 2 * JOUR ? pl(Math.round(ms / 3600e3), "heure", "heures") : pl(Math.round(ms / JOUR), "jour", "jours"));
  // x = { unites:[{id,nom,cree,parrain}], membres:[{unite,cree,invite}], partages:[{unite,cree,canal}] } (données propres à l'app)
  // h = invitations HoldingAI de cette app : { partages, ouvertures, arrivees } (déjà filtrées sur l'app)
  function mesureVirale(x, h, depuis) {
    const dans = (c) => t(c) >= depuis;
    const us = x.unites || [], parId = new Map(us.map((u) => [u.id, u]));
    const nouveaux = us.filter((u) => dans(u.cree)), parraines = nouveaux.filter((u) => u.parrain);
    const invites = (x.membres || []).filter((m) => m.invite && dans(m.cree));
    const arrivees = h.arrivees.filter((a) => dans(a.cree));
    const ouvertures = h.ouvertures.filter((o) => dans(o.cree)).length;
    const partages = (x.partages || []).filter((p) => dans(p.cree)).length + h.partages.filter((p) => dans(p.cree)).length;
    const venus = parraines.length + arrivees.length;
    const cycles = [...parraines.map((u) => { const p = parId.get(u.parrain); return p ? t(u.cree) - t(p.cree) : null; }), ...arrivees.map((a) => a.delai)].filter((v) => v != null && v >= 0);
    return { total: us.length, nouveaux: nouveaux.length, venus, nouveauxComptes: arrivees.filter((a) => a.nouveau).length, invites: invites.length, partages, ouvertures,
      conversion: ouvertures ? arrivees.length / ouvertures : partages ? venus / partages : null, k: us.length ? (venus + invites.length) / us.length : null, cycle: mediane(cycles) };
  }
  function ambassadeurs(app, x, h, nomDe, depuis) {
    const us = x.unites || [], parId = new Map(us.map((u) => [u.id, u])), score = new Map();
    const plus = (cle, nom, champ) => { if (!cle) return; const s = score.get(cle) || { app, nom, venus: 0, invites: 0, partages: 0 }; s[champ]++; score.set(cle, s); };
    const nomU = (id) => (parId.get(id) || {}).nom || "Compte retiré";
    us.filter((u) => u.parrain && t(u.cree) >= depuis).forEach((u) => plus(app + u.parrain, nomU(u.parrain), "venus"));
    (x.membres || []).filter((m) => m.invite && t(m.cree) >= depuis).forEach((m) => plus(app + m.unite, nomU(m.unite), "invites"));
    (x.partages || []).filter((p) => t(p.cree) >= depuis).forEach((p) => plus(app + p.unite, nomU(p.unite), "partages"));
    h.arrivees.filter((a) => t(a.cree) >= depuis).forEach((a) => plus(app + "h" + a.parrain, nomDe(a.parrain), "venus"));
    h.partages.filter((p) => t(p.cree) >= depuis).forEach((p) => plus(app + "h" + p.profil, nomDe(p.profil), "partages"));
    return [...score.values()];
  }
  const APPS_VIRALES = [["commis", "foyers"], ["fanion", "groupes"], ["gousset", "comptes"], ["tiroir", "foyers"], ["plumeau", "comptes"], ["seuil", "comptes"], ["voute", "comptes"], ["pourquoi", "comptes"], ["nostalgie", "comptes"], ["echange", "comptes"], ["vestibule", "comptes"], ["donne", "comptes"], ["escale", "comptes"]];
  function vueViralite(d) {
    const per = etat.viralitePeriode || "30", depuis = per === "30" ? Date.now() - 30 * JOUR : 0;
    const v = etat.viralite;
    if (!v) { viralite(); }
    const hai = (v && v.compte) || { profils: [], partages: [], ouvertures: [], arrivees: [], acces: [] };
    const profil = new Map((hai.profils || []).map((p) => [p.id, p]));
    const nomDe = (id) => (profil.get(id) || {}).nom || "Sans prénom";
    const haiDe = (app) => ({
      partages: (hai.partages || []).filter((p) => cleApp(p.app) === app),
      ouvertures: (hai.ouvertures || []).filter((o) => cleApp(o.app) === app),
      arrivees: (hai.arrivees || []).filter((a) => cleApp(a.app) === app).map((a) => ({ ...a, delai: profil.get(a.parrain) ? t(a.cree) - t(profil.get(a.parrain).cree) : null })),
    });
    // Apps sans données propres : leurs comptes HoldingAI (première visite) et les arrivées
    const parCompte = (app) => ({ unites: (hai.acces || []).filter((x) => cleApp(x.app) === app).map((x) => ({ id: x.profil, nom: nomDe(x.profil), cree: x.premiere })), membres: [], partages: [] });
    const f = d.fanion || { groupes: [] }, gr = f.groupes || [];
    const parRef = (r) => gr.find((g) => g.id === r || g.nom === r || g.code === r);
    const propres = {
      commis: v && v.commis, gousset: v && v.gousset, tiroir: v && v.tiroir,
      fanion: { unites: gr.map((g) => ({ id: g.id, nom: g.nom, cree: g.cree, parrain: g.ref ? (parRef(g.ref) || {}).id || g.ref : null })), membres: [], partages: [] },
      plumeau: { unites: ((d.plumeau || {}).comptes || []).map((c) => ({ id: c.user_id, nom: c.prenom, cree: c.cree, parrain: null })), membres: [], partages: [] },
    };
    const joueursInvites = gr.reduce((s, g) => s + Math.max(0, (Number(g.joueurs) || 0) - 1), 0);
    const mesures = APPS_VIRALES.map(([app, unite]) => {
      const x = app in propres ? propres[app] : v ? parCompte(app) : null;
      return { app, unite, x, h: haiDe(app), m: x ? mesureVirale(x, haiDe(app), depuis) : null };
    });
    if (per === "tout") { const mf = mesures.find((l) => l.app === "fanion").m; mf.invites = joueursInvites; mf.k = mf.total ? (mf.venus + joueursInvites) / mf.total : null; }
    const ok = mesures.filter((l) => l.m);
    const somme = (k) => ok.reduce((s, l) => s + l.m[k], 0);
    const tot = { nouveaux: somme("nouveaux"), venus: somme("venus"), invites: somme("invites"), partages: somme("partages"), ouvertures: somme("ouvertures"), total: somme("total") };
    const kGlobal = tot.total ? (tot.venus + tot.invites) / tot.total : null;
    const erreurs = ["commis", "gousset", "tiroir", "compte"].filter((a) => v && v[a] && v[a].erreur).map((a) => `${a === "compte" ? "Invitations L’Établi" : nomApp[a]} : ${esc(v[a].erreur)}`);
    const choix = `<div class="filtres" role="group" aria-label="Période">${[["30", "30 derniers jours"], ["tout", "Depuis le début"]].map(([k, m]) => `<button class="filtre" data-viralite-periode="${k}" aria-pressed="${per === k}">${m}</button>`).join("")}</div>`;
    const amb = [...(v ? mesures.flatMap((l) => (l.x ? ambassadeurs(l.app, l.app in propres ? l.x : { unites: [], membres: [], partages: [] }, l.h, nomDe, depuis) : [])) : [])]
      .filter((a) => a.venus || a.invites || a.partages).sort((a, b) => b.venus + b.invites - (a.venus + a.invites) || b.partages - a.partages).slice(0, 15);
    const passages = (hai.arrivees || []).filter((a) => !a.nouveau && t(a.cree) >= depuis);
    const cp = (d.compte || {}).comptes || [];
    const multi = cp.filter((c) => (c.apps || []).filter((a) => cleApp(a.app) !== "holdingai").length >= 2);
    return `<section class="section"><h2>Viralité</h2><p class="sous">Combien de nouveaux chaque utilisateur amène. Au-dessus de 1, chaque utilisateur en amène plus d'un et l'app grandit seule ; sous 1, la croissance dépend de vos efforts.</p>${choix}
      ${v ? "" : `<p class="charge">Lecture des parrainages, des invitations et des partages…</p>`}
      ${erreurs.length ? `<div class="bandeau">Certaines données n'ont pas pu être lues. ${erreurs.join(" ; ")}</div>` : ""}
      ${chiffres([[tot.nouveaux, per === "30" ? "nouveaux depuis 30 jours" : "inscrits au total"], [pct(tot.venus, tot.nouveaux), "venus par une invitation"], [tot.invites, "invités dans un foyer ou un groupe"], [tot.partages, "partages de l'app"], [tot.ouvertures, "liens d'invitation ouverts"], [facteur(kGlobal), "facteur K, toutes apps"]])}</section>` +
      section("Par app", "Venus : parrainages propres à l'app et arrivées par le lien d'invitation L’Établi. Ouvertures : visites du lien d'invitation. Conversion : arrivées ÷ ouvertures (ou venus ÷ partages quand le lien n'est pas encore utilisé). Facteur K : (venus + invités) ÷ inscrits. Cycle viral : délai typique entre l'inscription de la personne qui invite et l'arrivée de celle qu'elle amène.",
        table([{ t: "App" }, { t: "Nouveaux", n: 1 }, { t: "Venus", n: 1 }, { t: "Invités", n: 1 }, { t: "Partages", n: 1 }, { t: "Ouvertures", n: 1 }, { t: "Conversion", n: 1 }, { t: "Facteur K", n: 1 }, { t: "Cycle viral" }],
          mesures.map(({ app, unite, m }) => m ? [`${puce(app)}<small>${esc(pl(m.total, unite.replace(/s$/, ""), unite))}</small>`, m.nouveaux, `${m.venus}<small>${pct(m.venus, m.nouveaux)}</small>`,
            app === "fanion" && per === "30" ? "<small>total seulement</small>" : ["commis", "tiroir", "fanion"].includes(app) ? m.invites : "<small>–</small>", m.partages, m.ouvertures,
            m.conversion == null ? "–" : `${Math.round(m.conversion * 100)} %`, `<b>${facteur(m.k)}</b>`, esc(duree(m.cycle))] : [puce(app), "…", "", "", "", "", "", "", ""]), "")) +
      section("Ambassadeurs", "Les personnes, foyers et groupes qui amènent le plus de monde. Un bon endroit pour dire merci, ou leur offrir un mois.",
        table([{ t: "Qui" }, { t: "App" }, { t: "Venus", n: 1 }, { t: "Invités", n: 1 }, { t: "Partages", n: 1 }],
          amb.map((a) => [`<span class="nom">${esc(a.nom)}</span>`, puce(a.app), a.venus, a.invites, a.app === "fanion" ? "–" : a.partages]),
          per === "30" ? "Personne n'a invité, parrainé ou partagé depuis 30 jours." : "Personne n'a encore invité, parrainé ou partagé.")) +
      section("D'une app à l'autre", "Les comptes L’Établi qui utilisent au moins deux apps, et ceux qui ont découvert une autre app grâce à une invitation.",
        `${chiffres([[multi.length, multi.length > 1 ? "personnes sur 2 apps ou plus" : "personne sur 2 apps ou plus"], [pct(multi.length, cp.length), "des comptes L’Établi"], [passages.length, passages.length > 1 ? "comptes venus d'une autre app par invitation" : "compte venu d'une autre app par invitation"]])}` +
        table([{ t: "Personne" }, { t: "Apps utilisées" }], multi.map((c) => [`<span class="nom">${esc(c.nom || "Sans nom")}</span>`, pucesApps(c.apps || [])]), "Aucune personne n'utilise encore deux apps.")) +
      section("Pas encore mesuré", "",
        `<ul class="note-liste"><li>Le Plumeau et Le Gousset n'ont pas encore le bouton « Inviter quelqu'un » : leur code n'est pas dans les dépôts connus. Le menu d'Philou l'offrira dès qu'ils chargeront porte.js.</li>
        <li>Le Fanion : les partages restent dans Firebase jusqu'à sa sortie ; seuls les groupes parrainés et les joueurs ajoutés sont comptés.</li>
        <li>Les liens de parrainage propres au Commis (?ref=) ne comptent pas leurs ouvertures ; ceux du bouton « Inviter quelqu'un » les comptent.</li></ul>`);
  }

  // Menu sur deux rangées : les fonctions en haut, les apps en dessous
  const FONCTIONS = [["traiter", "À traiter"], ["crm", "CRM"], ["comptes", "Comptes"], ["courriels", "Courriels"], ["idees", "Idées"], ["viralite", "Viralité"], ["couts", "Coûts"], ["journal", "Journal"]];
  const APPS = ["echange", "gousset", "pourquoi", "commis", "fanion", "seuil", "plumeau", "vestibule", "tiroir", "voute", "donne", "nostalgie", "escale"].map((k) => [k, nomApp[k]]);
  function rendre() {
    const d = etat.d; if (!d) return;
    const n = aTraiter(d).n;
    const fonctions = etat.role === "proprio" ? [...FONCTIONS, ["acces", "Accès"]] : FONCTIONS;
    if (![...fonctions, ...APPS].some(([k]) => k === etat.vue)) etat.vue = "traiter";
    const bouton = (cls) => ([k, mot]) => `<button class="${cls}" data-vue="${k}" ${etat.vue === k ? 'aria-current="page"' : ""}>${cls === "app" ? `<i class="pastille ${k}"></i>` : ""}${mot}${k === "traiter" && n ? `<span class="compte">${n}</span>` : ""}</button>`;
    $("#onglets").innerHTML = `<div class="rangee fonctions" role="group" aria-label="Fonctions">${fonctions.map(bouton("onglet")).join("")}</div>` +
      `<div class="rangee apps" role="group" aria-label="Apps">${APPS.map(bouton("app")).join("")}</div>`;
    $("#page").innerHTML = etat.vue === "commis" ? vueCommis(d) : etat.vue === "fanion" ? vueFanion(d) : etat.vue === "plumeau" ? vuePlumeau(d) : etat.vue === "tiroir" ? vueTiroir(d) : etat.vue === "gousset" ? vueGousset(d) : etat.vue === "seuil" ? vueSeuil(d) : etat.vue === "voute" ? vueVoute(d) : etat.vue === "comptes" ? vueComptes(d) : etat.vue === "crm" ? vueCrm(d) : etat.vue === "journal" ? vueJournal(d) : etat.vue === "viralite" ? vueViralite(d) : etat.vue === "couts" ? vueCouts(d) : etat.vue === "acces" ? vueAcces(d) : etat.vue === "courriels" ? vueCourriels(d) : etat.vue === "idees" ? vueIdees(d) : nomApp[etat.vue] ? vueAppCompte(d, etat.vue) : vueTraiter(d);
    // Consultation seulement : aucun bouton de geste (le serveur les refuserait de toute façon)
    if (etat.role === "lecture") $("#page").querySelectorAll("[data-avis],[data-foyer],[data-groupe],[data-demande],[data-courriel],[data-idee],[data-nouveaute],[data-plumeau-compte],[data-tiroir],[data-gousset],#f-nouveaute,[data-crm-ecrit],[data-statut-app]").forEach((b) => b.remove());
    $("#pied").textContent = `Connecté : ${etat.courriel}${etat.role === "lecture" ? " (consultation seulement)" : ""}. Données lues à ${new Intl.DateTimeFormat("fr-CA", { hour: "numeric", minute: "2-digit" }).format(new Date())}.`;
    document.title = (n ? `(${n}) ` : "") + "Console L'Établi";
    etat.frais = null;
  }
  async function charger(silence) {
    if (!silence && !etat.d) $("#page").innerHTML = `<p class="charge">Lecture des données…</p>`;
    try {
      const d = await appel({ action: "tout" });
      try { d.retour = await rpc("console_retour"); } catch (e) { d.retour = { idees: [], sondages: [], nouveautes: [] }; }
      // Le Plumeau (projet à part) : comptes, idées, nouveautés, questions à Edda et coûts, ajoutés aux listes communes
      try {
        const p = await pont({ action: "tout" });
        d.plumeau = { comptes: p.comptes || [] };
        d.retour.idees = [...d.retour.idees, ...(p.idees || [])].sort((a, b) => t(b.cree) - t(a.cree));
        d.retour.nouveautes = [...(d.retour.nouveautes || []), ...(p.nouveautes || [])].sort((a, b) => t(b.cree) - t(a.cree));
        d.commis.questions = [...(d.commis.questions || []), ...(p.questions || [])].sort((a, b) => t(b.cree) - t(a.cree));
        d.couts = [...(d.couts || []), ...(p.couts || [])];
      } catch (e) { d.plumeau = { comptes: [], erreur: e.message }; }
      // Le Tiroir et Le Gousset (projets à part), lus en parallèle
      const [ti, go, se, co] = await Promise.allSettled([pontApp("tiroir", { action: "tout" }), pontApp("gousset", { action: "tout" }), pontApp("seuil", { action: "tout" }), pontApp("compte", { action: "tout" })]);
      d.seuilvoute = se.status === "fulfilled" ? se.value : { seuil: [], voute: [], erreur: se.reason.message };
      d.compte = co.status === "fulfilled" ? co.value : { comptes: [], apps: [], erreur: co.reason.message };
      d.tiroir = ti.status === "fulfilled" ? ti.value : { foyers: [], paiements: [], erreur: ti.reason.message };
      d.gousset = go.status === "fulfilled" ? go.value : { comptes: [], demandes: [], erreur: go.reason.message };
      d.couts = [...(d.couts || []), ...((d.tiroir || {}).couts || [])];
      etat.d = d; etat.courriel = d.courriel || ""; etat.role = d.role || "lecture"; rendre();
      crmCharger(); // le CRM se lit à part, puis la page se met à jour
    } catch (e) {
      if (e.code === 401) { await sb.auth.signOut(); montrerPorte("Votre session est terminée. Reconnectez-vous."); }
      else if (e.code === 403) { await sb.auth.signOut(); montrerPorte("Ce compte n'a pas accès à la console.", true); }
      else if (etat.d) toast(e.message, true);
      else $("#page").innerHTML = `<p class="vide">Les données n'ont pas pu être lues (${esc(e.message)}). Touchez Actualiser pour réessayer.</p>`;
    }
  }
  async function agir(corps, fait, frais) {
    try { await appel(corps); etat.frais = frais || null; toast(fait); await charger(true); }
    catch (e) { toast(e.message, true); }
  }

  // Petite fenêtre de saisie (réponse à une idée, nouveauté)
  function saisir({ titre, info, texte, bouton, champTitre, statut, statutActuel }) {
    return new Promise((res) => {
      const dlg = $("#dlg-saisie");
      $("#sa-titre").textContent = titre; $("#sa-info").textContent = info || "";
      $("#sa-l-titre").hidden = !champTitre; $("#sa-champ-titre").value = ""; $("#sa-champ-titre").required = !!champTitre;
      $("#sa-texte").value = texte || ""; $("#sa-ok").textContent = bouton;
      $("#sa-l-statut").hidden = !statut;
      if (statut) $("#sa-statut").value = statutActuel === "recue" ? "etudiee" : statutActuel;
      $("#sa-form").onsubmit = (e) => { e.preventDefault(); dlg.close(); res({ titre: $("#sa-champ-titre").value.trim(), texte: $("#sa-texte").value.trim(), statut: statut ? $("#sa-statut").value : undefined }); };
      $("#sa-annuler").onclick = () => { dlg.close(); res(null); };
      dlg.showModal(); setTimeout(() => (champTitre ? $("#sa-champ-titre") : $("#sa-texte")).focus(), 30);
    });
  }
  $("#page").addEventListener("submit", (e) => {
    if (e.target.id !== "f-nouveaute") return;
    e.preventDefault();
    agir({ action: "commis.nouveaute", titre: $("#in-nv-titre").value, texte: $("#in-nv-texte").value, app: $("#in-nv-app").value }, `Nouveauté annoncée dans ${nomApp[$("#in-nv-app").value] || "l'app"}.`);
  });

  // ---------- gestes
  $("#onglets").addEventListener("click", (e) => { const b = e.target.closest("[data-vue]"); if (!b) return; etat.vue = b.dataset.vue; rendre(); window.scrollTo({ top: 0 }); });
  $("#actualiser").addEventListener("click", async () => { etat.viralite = null; etat.crmInv = null; await charger(true); toast("Données à jour."); });
  $("#sortir").addEventListener("click", async () => { await sb.auth.signOut(); etat.d = null; montrerPorte(""); });
  $("#page").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.hasAttribute("data-factures")) { etat.factures = null; rendre(); factures(true); return; }
    if (b.hasAttribute("data-vers-crm")) { etat.vue = "crm"; }
    if (await clicCrm(b)) return;
    const d = etat.d;
    if (b.dataset.viralitePeriode) { etat.viralitePeriode = b.dataset.viralitePeriode; rendre(); return; }
    if (b.dataset.filtre) { etat.filtre = b.dataset.filtre; rendre(); return; }
    if (b.dataset.filtreidee) { etat.filtreIdee = b.dataset.filtreidee; rendre(); return; }
    if (b.dataset.appidee) { etat.appIdee = b.dataset.appidee; rendre(); return; }
    if (b.dataset.nouveaute) {
      const ok = await confirmer({ titre: "Retirer cette nouveauté ?", texte: "Les membres qui ne l'ont pas encore vue ne la verront pas.", bouton: "Retirer" });
      if (ok) agir({ action: "commis.nouveaute", geste: "retirer", id: b.dataset.nouveaute }, "Nouveauté retirée.");
      return;
    }
    if (b.dataset.statutApp) {
      const app = ((d.compte || {}).apps || []).find((a) => a.slug === b.dataset.statutApp); if (!app) return;
      b.disabled = true;
      try {
        await pontApp("compte", { action: "statut_app", slug: app.slug, statut: b.dataset.statut || null });
        app.statut = b.dataset.statut || null; rendre();
        toast(app.statut === "beta" ? `${app.nom} est maintenant en bêta.` : `${app.nom} est maintenant disponible : « Bêta » n'est plus affiché.`);
      } catch (err) { b.disabled = false; toast(err.message, true); }
      return;
    }
    if (b.dataset.tiroir) {
      const f = ((d.tiroir || {}).foyers || []).find((x) => x.id === b.dataset.tiroir); if (!f) return;
      if (b.dataset.geste === "retirer" && !confirm(`Retirer le forfait du foyer « ${f.nom} »? Il retombe à 5 fiches.`)) return;
      return agir({ action: "tiroir.foyer", id: f.id, geste: b.dataset.geste, paiement: b.dataset.paiement || null }, b.dataset.geste === "activer" ? `Forfait de 12 mois activé pour « ${f.nom} ».` : "Forfait retiré.");
    }
    if (b.dataset.gousset) {
      const mots = { approved: "Demande approuvée.", declined: "Demande refusée.", pending: "Demande remise en attente." };
      return agir({ action: "gousset.demande", id: b.dataset.gousset, statut: b.dataset.statut }, mots[b.dataset.statut]);
    }
    if (b.dataset.plumeauCompte) {
      const bloque = b.dataset.bloque === "1";
      if (bloque && !confirm("Couper l'IA de ce compte? Edda ne lira plus ses liens et ne répondra plus à ses questions.")) return;
      return agir({ action: "plumeau.bloquer", user_id: b.dataset.plumeauCompte, bloque }, bloque ? "IA coupée pour ce compte." : "IA rendue à ce compte.");
    }
    if (b.dataset.ideeAvis) {
      const k = b.dataset.ideeAvis, i = ((d.retour || {}).idees || []).find((x) => cleAvis(x) === k); if (!i) return;
      const encore = !!(etat.avisIdees || {})[k];
      etat.avisEnCours = { ...(etat.avisEnCours || {}), [k]: true }; rendre();
      try {
        const r = await appelAvis({ action: "avis", rafraichir: encore, idee: { id: i.id, app: i.app || "commis", type: i.type, texte: i.texte, ecran: i.ecran || null } });
        etat.avisIdees = { ...(etat.avisIdees || {}), [k]: { ...r.avis, cree: r.cree } };
      } catch (err) { toast(err.message, true); }
      delete etat.avisEnCours[k]; rendre();
      return;
    }
    if (b.dataset.idee) {
      const i = ((d.retour || {}).idees || []).find((x) => x.id === b.dataset.idee); if (!i) return;
      const g = b.dataset.g;
      if (g === "statut") return agir({ action: "commis.idee", id: i.id, statut: b.dataset.statut }, `Idée marquée « ${STATUTS[b.dataset.statut]} ».`);
      if (g === "repondre") {
        const r = await saisir({ titre: "Répondre dans l'app", info: `« ${i.texte.slice(0, 200)} »`, texte: i.reponse || `Merci ${i.prenom || ""}! `.replace(" !", "!"), bouton: "Envoyer la réponse", statut: true, statutActuel: i.statut });
        if (r) agir({ action: "commis.idee", id: i.id, reponse: r.texte, statut: r.statut }, "Réponse envoyée : la personne la verra dans l'app.");
        return;
      }
      if (g === "annoncer") {
        const r = await saisir({ titre: "Annoncer cette amélioration à tous", info: `Demandée : « ${i.texte.slice(0, 200)} »`, champTitre: true, texte: "", bouton: "Annoncer" });
        if (r) agir({ action: "commis.nouveaute", titre: r.titre, texte: r.texte, idee_id: i.id, app: i.app || "commis" }, "Nouveauté annoncée. L'idée est marquée comme faite.");
        return;
      }
    }
    if (b.dataset.courriel) {
      const c = (d.courriels || []).find((x) => x.id === b.dataset.courriel), g = b.dataset.geste; if (!c) return;
      if (g === "repondre") return repondre(c);
      return agir({ action: "courriel.etat", id: c.id, traite: g === "traite" }, g === "traite" ? "Courriel marqué comme traité." : "Courriel remis à traiter.");
    }
    if (b.dataset.avis) {
      const [app, id] = b.dataset.avis.split(":"), cible = b.dataset.etat;
      const site = app === "commis" ? "lecommis.ai" : "fanion.ai";
      const a = (app === "commis" ? d.commis.avis : d.fanion.avis).find((x) => String(x.id) === id); if (!a) return;
      const ok = await confirmer(cible === "publie" ? { titre: "Publier cet avis ?", texte: `Il paraîtra sur ${site}, signé ${a.prenom || "sans nom"}. La mise à jour du site peut prendre une dizaine de minutes.`, bouton: "Publier sur le site" }
        : cible === "ecarte" ? { titre: "Écarter cet avis ?", texte: "Il ne paraîtra pas sur le site et quittera la liste à traiter. Vous pourrez le remettre en attente.", bouton: "Écarter" }
        : etatAvis(a) === "publie" ? { titre: "Retirer cet avis du site ?", texte: `Il ne paraîtra plus sur ${site} et reviendra dans la liste à traiter.`, bouton: "Retirer du site" }
        : { titre: "Remettre cet avis en attente ?", texte: "Il reviendra dans la liste à traiter.", bouton: "Remettre en attente" });
      if (ok) agir({ action: `${app}.avis`, id, etat: cible }, cible === "publie" ? "Avis publié." : cible === "ecarte" ? "Avis écarté." : "Avis remis en attente.", b.dataset.avis);
    } else if (b.dataset.foyer) {
      const f = d.commis.foyers.find((x) => x.id === b.dataset.foyer), g = b.dataset.geste; if (!f) return;
      const ok = await confirmer(g === "essai" ? { titre: `Prolonger l'essai de « ${f.nom} » ?`, texte: "Le foyer garde l'app complète 30 jours de plus, sans payer.", bouton: "Prolonger l'essai de 30 jours" }
        : g === "activer" ? { titre: `Activer « ${f.nom} » pour 12 mois ?`, texte: "À utiliser pour un paiement reçu hors Stripe ou un accès offert. Les 12 mois s'ajoutent à la fin de l'essai ou du forfait en cours.", bouton: "Activer 12 mois", raison: true }
        : { titre: `Retirer le forfait de « ${f.nom} » ?`, texte: "Le foyer retombe sur son essai : s'il est terminé, les membres ne pourront plus modifier leurs listes.", bouton: "Retirer le forfait" });
      if (ok) agir({ action: "commis.foyer", id: f.id, geste: g, jours: 30, raison: ok.raison }, g === "essai" ? "Essai prolongé." : g === "activer" ? "Forfait activé pour 12 mois." : "Forfait retiré.");
    } else if (b.dataset.groupe) {
      const gr = d.fanion.groupes.find((x) => x.id === b.dataset.groupe), g = b.dataset.geste; if (!gr) return;
      const ok = await confirmer(g === "activer" ? { titre: `Activer le forfait Groupe de « ${gr.nom} » ?`, texte: "Le groupe pourra inscrire jusqu'à 16 joueurs pendant 12 mois. Si un forfait est déjà en cours, les 12 mois s'y ajoutent.", bouton: "Activer le forfait Groupe", raison: true }
        : { titre: `Retirer le forfait de « ${gr.nom} » ?`, texte: "Le groupe revient au forfait Gratuit, limité à 4 joueurs.", bouton: "Retirer le forfait" });
      if (ok) agir({ action: "fanion.groupe", id: gr.id, geste: g, raison: ok.raison }, g === "activer" ? "Forfait Groupe activé." : "Forfait retiré.");
    } else if (b.dataset.acces) {
      const g = (d.acces || []).find((x) => x.id === b.dataset.acces), r = b.dataset.role; if (!g) return;
      const ok = await confirmer(!r ? { titre: `Retirer l'accès de ${g.courriel} ?`, texte: "Cette personne ne pourra plus ouvrir la console, dès maintenant.", bouton: "Retirer l'accès" }
        : r === "gestion" ? { titre: `Donner plus de pouvoirs à ${g.courriel} ?`, texte: "Cette personne pourra publier ou écarter des avis, prolonger des essais et activer ou retirer des forfaits.", bouton: "Permettre de publier et d'activer" }
        : { titre: `Limiter ${g.courriel} à la consultation ?`, texte: "Cette personne verra tout, mais ne pourra plus rien publier ni activer.", bouton: "Limiter à la consultation" });
      if (ok) agir(r ? { action: "acces.role", id: g.id, role: r } : { action: "acces.retirer", id: g.id }, r ? "Rôle changé." : "Accès retiré.");
    } else if (b.dataset.demande) {
      agir({ action: "fanion.demande", id: b.dataset.demande }, "Demande marquée comme traitée.");
    }
  });

  // ---------- réponse à un courriel
  let reponseA = null;
  function repondre(c) {
    // Le brouillon est gardé si on referme et rouvre la réponse au même courriel
    if (!reponseA || reponseA.id !== c.id) $("#rep-texte").value = "";
    reponseA = c;
    $("#rep-titre").textContent = `Répondre à ${c.de_nom || c.de}`;
    $("#rep-info").textContent = `De ${c.a} (${nomApp[c.app]}), à ${c.repondre_a || c.de}. Objet : ${/^\s*re\s*:/i.test(c.sujet) ? c.sujet : "Re: " + (c.sujet || "")}. Son message sera cité sous votre réponse.`;
    $("#rep-msg").textContent = ""; $("#rep-ok").disabled = false;
    $("#dlg-rep").showModal(); $("#rep-texte").focus();
  }
  $("#rep-annuler").addEventListener("click", () => $("#dlg-rep").close());
  $("#rep-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texte = $("#rep-texte").value.trim(); if (!texte || !reponseA) return;
    $("#rep-ok").disabled = true; $("#rep-msg").className = "msg"; $("#rep-msg").textContent = "Envoi…";
    try {
      const r = await appel({ action: "courriel.repondre", id: reponseA.id, texte });
      $("#dlg-rep").close(); $("#rep-texte").value = ""; reponseA = null;
      toast(r.note === false ? "Réponse envoyée, mais elle n'a pas pu être notée dans la console." : "Réponse envoyée.", r.note === false);
      await charger(true);
    } catch (err) {
      // La réponse reste à l'écran : rien n'est perdu si l'envoi échoue
      $("#rep-msg").className = "msg err"; $("#rep-msg").textContent = `${err.message} Votre réponse n'est pas partie.`; $("#rep-ok").disabled = false;
    }
  });

  $("#page").addEventListener("submit", async (e) => {
    if (e.target.id !== "f-invite") return;
    e.preventDefault();
    const courriel = $("#in-invite").value.trim().toLowerCase(), role = $("#in-role").value;
    const ok = await confirmer({ titre: `Donner l'accès à ${courriel} ?`, texte: role === "gestion" ? "Cette personne verra tous les foyers, groupes, avis et questions, et pourra publier des avis et gérer les forfaits." : "Cette personne verra tous les foyers, groupes, avis et questions, y compris les coordonnées des clients, sans pouvoir rien modifier.", bouton: "Donner l'accès" });
    if (ok) agir({ action: "acces.inviter", courriel, role }, "Accès donné.");
  });

  $("#page").addEventListener("submit", (e) => { if (!/^f-crm-/.test(e.target.id)) return; e.preventDefault(); soumettreCrm(e.target); });
  $("#page").addEventListener("input", (e) => {
    if (e.target.id !== "crm-q") return;
    const pos = e.target.selectionStart; etat.crmRecherche = e.target.value; rendre();
    const q = $("#crm-q"); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });
  $("#page").addEventListener("change", async (e) => {
    const el = e.target;
    if (el.id === "crm-etape") { etat.crmEtape = el.value || null; rendre(); }
    if (el.id === "crm-etiquette") { etat.crmEtiquette = el.value || null; rendre(); }
    if (el.dataset && el.dataset.crmTache) { el.disabled = true; await gesteCrm({ action: "tache.faite", id: el.dataset.crmTache, faite: el.checked }, el.checked ? "Tâche faite." : null); }
    if (el.id === "crm-import-fichier" && el.files && el.files[0]) {
      if (el.files[0].size > 2e6) { toast("Fichier trop gros (2 Mo au maximum).", true); return; }
      $("#crm-import-texte").value = await el.files[0].text();
    }
  });

  // ---------- connexion par code reçu par courriel
  let courriel = "";
  const msg = (m, err) => { const el = $("#porte-msg"); el.textContent = m || ""; el.className = "msg" + (err ? " err" : ""); };
  function montrerPorte(m, err) {
    $("#console").hidden = true; $("#porte").hidden = false; $("#f-code").hidden = true; $("#f-courriel").hidden = false; msg(m, err);
  }
  $("#f-courriel").addEventListener("submit", async (e) => {
    e.preventDefault();
    courriel = $("#in-courriel").value.trim().toLowerCase();
    const b = e.target.querySelector("button"); b.disabled = true; msg("Envoi du code…");
    const { error } = await sb.auth.signInWithOtp({ email: courriel, options: { shouldCreateUser: false } });
    b.disabled = false;
    // Même message que le courriel existe ou non : la page ne dit pas qui a un compte
    if (error && /rate|seconds|trop/i.test(error.message)) return msg("Un code vient d'être envoyé. Attendez une minute avant d'en demander un autre.", true);
    $("#f-courriel").hidden = true; $("#f-code").hidden = false; $("#in-code").value = ""; $("#in-code").focus();
    msg(`Si ${courriel} a accès à la console, un code vient d'y être envoyé.`);
  });
  $("#f-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button"); b.disabled = true; msg("Vérification…");
    const { error } = await sb.auth.verifyOtp({ email: courriel, token: $("#in-code").value.trim(), type: "email" });
    b.disabled = false;
    if (error) return msg("Ce code n'est pas bon ou il est expiré. Vérifiez le dernier courriel reçu.", true);
    ouvrir();
  });
  $("#autre-courriel").addEventListener("click", () => montrerPorte(""));
  function ouvrir() { $("#porte").hidden = true; $("#console").hidden = false; msg(""); charger(); }

  sb.auth.getSession().then(({ data }) => (data.session ? ouvrir() : montrerPorte("")));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && etat.d && !$("#dlg").open && !$("#dlg-rep").open) charger(true); });
})();
