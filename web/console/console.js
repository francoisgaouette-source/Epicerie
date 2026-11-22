// Console HoldingAI : tout passe par la fonction serveur « console », qui vérifie que le compte y a droit.
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
  const nomApp = { commis: "Le Commis", fanion: "Fanion", plumeau: "Le Plumeau", holdingai: "HoldingAI", console: "Console" };
  const puce = (app) => `<span class="app"><i class="pastille ${esc(app)}"></i>${esc(nomApp[app] || app)}</span>`;

  // ---------- serveur
  // Idées, sondages et nouveautés : fonctions de la base, réservées aux comptes de la console
  const MSG_RPC = { acces_refuse: "Votre accès permet seulement de consulter.", titre_requis: "Donnez un titre à la nouveauté.", introuvable: "Idée introuvable." };
  async function rpc(nom, args) {
    const { data, error } = await sb.rpc(nom, args);
    if (error) throw Object.assign(new Error(MSG_RPC[error.message] || error.message), { code: 400 });
    return data;
  }
  async function appel(corps) {
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
    return { avis, paiements, essais, fils, idees, demandes: d.fanion.demandes, n: avis.length + paiements.length + d.fanion.demandes.length + fils.length + idees.length };
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
    const FILTRES = [["attente", `À traiter${nAttente ? ` (${nAttente})` : ""}`], ["tous", "Tous"], ["holdingai", "HoldingAI"], ["commis", "Le Commis"], ["fanion", "Fanion"], ["auto", "Automatiques"]];
    const k = etat.filtre;
    const vus = fils.filter((f) => (k === "attente" ? f.attente : k === "tous" ? true : k === "auto" ? f.auto : f.app === k && !f.auto));
    const vide = !fils.length ? "Aucun courriel reçu pour l'instant. Tout ce qui est écrit à une adresse @holdingai.app, @lecommis.ai ou @fanion.ai arrivera ici."
      : k === "attente" ? "Aucun courriel à traiter." : "Aucun courriel dans cette liste.";
    return section("Courriels", "Tout ce qui est écrit à une adresse @holdingai.app, @lecommis.ai ou @fanion.ai. Une copie arrive aussi dans votre boîte personnelle. Les réponses partent de l'adresse à laquelle la personne a écrit.",
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
  const SOURCES = { app: "", sondage: "réponse au sondage", rosalie: "proposée par Rosalie" };
  const ficheIdee = (i) => {
    const [ic, mot] = TYPES[i.type] || TYPES.autre;
    const tamp = i.statut === "recue" ? `<span class="tampon attente">À lire</span>` : `<span class="tampon${i.statut === "non" ? " neutre" : ""}">${esc(STATUTS[i.statut])}</span>`;
    const autres = Object.keys(STATUTS).filter((k) => k !== i.statut && k !== "recue");
    return `<article class="fiche">
      <div class="tete">${tamp}${puce(i.app || "commis")}<b>${ic} ${esc(mot)}</b><span>${esc(moment(i.cree))}</span>${i.prenom ? `<span>${esc(i.prenom)}</span>` : ""}${i.foyer ? `<span>${i.app === "fanion" ? "groupe" : "foyer"} ${esc(i.foyer)}</span>` : ""}${i.ecran ? `<span>écran ${esc(i.ecran)}</span>` : ""}${SOURCES[i.source] ? `<span>${esc(SOURCES[i.source])}</span>` : ""}</div>
      <blockquote>${esc(i.texte)}</blockquote>
      ${i.contact_ok && i.contact ? `<p class="note">Accepte d'être contacté·e : <b>${esc(String(i.contact).startsWith("+") ? tel(i.contact) : i.contact)}</b></p>` : ""}
      ${i.appareil ? `<p class="note">${esc(i.appareil)}</p>` : ""}
      ${i.reponse ? `<div class="message envoye"><p class="note"><b>Votre réponse</b>, ${esc(moment(i.repondu))} · la personne la voit dans l'app</p><p class="lettre">${esc(i.reponse)}</p></div>` : ""}
      <div class="gestes">
        <button class="btn" data-idee="${esc(i.id)}" data-g="repondre">${i.reponse ? "Modifier la réponse" : "Répondre"}</button>
        ${autres.map((k) => `<button class="btn pale" data-idee="${esc(i.id)}" data-g="statut" data-statut="${k}">${esc(STATUTS[k])}</button>`).join("")}
        ${i.statut !== "faite" ? `<button class="lien" data-idee="${esc(i.id)}" data-g="annoncer">C'est fait : l'annoncer à tous</button>` : ""}
      </div>
    </article>`;
  };
  function vueIdees(d) {
    const r = d.retour || { idees: [], sondages: [], nouveautes: [] };
    const APPS = [["tous", "Toutes les apps"], ["commis", "Le Commis"], ["fanion", "Fanion"], ["plumeau", "Le Plumeau"]];
    const appF = APPS.some(([k]) => k === etat.appIdee) ? etat.appIdee : "tous";
    const deLapp = (x) => appF === "tous" || (x.app || "commis") === appF;
    const ids = r.idees.filter(deLapp), so = r.sondages.filter(deLapp), nvs = r.nouveautes.filter(deLapp);
    const nomSond = appF === "fanion" ? "Fanion" : appF === "commis" ? "Le Commis" : appF === "plumeau" ? "Le Plumeau" : "l'app";
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
          <label>Dans quelle app<select id="in-nv-app"><option value="commis" ${appF === "fanion" || appF === "plumeau" ? "" : "selected"}>Le Commis</option><option value="fanion" ${appF === "fanion" ? "selected" : ""}>Fanion</option><option value="plumeau" ${appF === "plumeau" ? "selected" : ""}>Le Plumeau</option></select></label>
          <button class="btn" type="submit">Annoncer</button></form>` +
        table([{ t: "Nouveauté" }, { t: "Annoncée" }, { t: "Geste" }], nvs.map((n) => [`${puce(n.app || "commis")} <span class="nom">${esc(n.titre)}</span><small>${esc(n.texte || "")}${n.idee_id ? " · demandée par un membre" : ""}</small>`, esc(jour(n.cree)), `<div class="gestes"><button class="lien" data-nouveaute="${esc(n.id)}">Retirer</button></div>`]), "Aucune nouveauté annoncée pour l'instant.")) +
      section(`Sondage : recommanderiez-vous ${nomSond}?`, "Posé dans l'app après 10 jours d'usage, puis tous les 3 mois. 9-10 : promoteurs (l'app leur propose de la faire découvrir). 0-6 : détracteurs (l'app leur demande ce qui accroche).",
        table([{ t: "Note", n: 1 }, { t: "Pourquoi" }, { t: "Foyer ou groupe" }, { t: "Quand" }], so.slice(0, 100).map((x) => [`<b>${x.note}</b> ${puce(x.app || "commis")}`, esc(x.raison || ""), esc(x.foyer || ""), esc(moment(x.cree))]), "Aucune réponse au sondage pour l'instant."));
  }

  // ---------- vues
  function vueTraiter(d) {
    const a = aTraiter(d);
    const blocs = [];
    if (a.fils.length) blocs.push(section("Courriels à traiter", "Des personnes vous ont écrit. Répondez ici, ou marquez le courriel comme traité.", liste(a.fils.slice(0, 30).map(ficheCourriel), "")));
    if (a.idees.length) blocs.push(section("Idées et commentaires à lire", "Ce que les membres de vos apps vous ont envoyé. Répondez ou changez l'état : la personne le voit dans l'app.", liste(a.idees.slice(0, 20).map(ficheIdee), "")));
    blocs.push(section("Avis à approuver", "Un avis paraît sur le site seulement après votre approbation, et seulement si la personne a accepté l'affichage.",
      liste(a.avis.map((x) => ficheAvis(x, x.app)), "Aucun avis en attente. Les nouveaux avis du Commis et de Fanion arrivent ici.")));
    if (a.paiements.length) blocs.push(section("Paiements à relier", "Stripe a reçu ces paiements sans pouvoir activer un foyer. Activez le bon foyer dans l'onglet Le Commis.",
      table([{ t: "Client" }, { t: "Reçu" }, { t: "Montant", n: 1 }], a.paiements.map((p) => [`<span class="nom">${esc(p.nom || p.courriel || "Inconnu")}</span><small>${esc(p.courriel || "")}</small>`, esc(moment(p.cree)), esc(argent(p.montant, p.devise))]), "")));
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
      section("Comptes", "Le Plumeau est gratuit : pas de forfait à gérer. Un compte « ont importé et fait le ménage » a gardé 20 liens ou plus et a archivé un lien ou gardé une suggestion de Colette.",
        table([{ t: "Personne" }, { t: "Inscrite" }, { t: "Liens", n: 1 }, { t: "Archivés", n: 1 }, { t: "Collections", n: 1 }, { t: "Suggestions gardées", n: 1 }, { t: "Dernier lien" }],
          cp.map((c) => [`<span class="nom">${esc(c.prenom || "Sans prénom")}</span><small>${esc(c.courriel || "")}${c.bloque ? " · IA coupée" : ""}</small>`, esc(jour(c.cree)), c.liens, c.archives, c.collections, c.sugg_gardees, c.derniere ? esc(ilYA(c.derniere)) : "aucun"]),
          "Aucun compte pour l'instant. Les inscriptions sur leplumeau.ai s'afficheront ici.")) +
      section("Idées et commentaires", "Répondez dans l'onglet Idées (filtre Le Plumeau) : la personne voit votre réponse dans l'app, et Colette l'avertit.",
        liste(idees.filter((i) => i.statut === "recue").slice(0, 20).map(ficheIdee), idees.length ? "Tout est lu. Les idées traitées sont dans l'onglet Idées." : "Aucune idée reçue pour l'instant.")) +
      section("Questions posées à Colette", "Ce que les gens demandent à Colette dans l'app. Une question qui revient souvent montre un endroit où l'app accroche.",
        liste(q.map(ficheQuestion), "Aucune question notée pour l'instant. Elles s'inscrivent ici à mesure que les gens en posent."));
  }
  // ---------- coûts de l'API Claude : ce que coûte chaque fonction et chaque foyer
  const usd = (n) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "USD", minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);
  const NOMS_FONCTIONS = { rosalie: "Rosalie (questions)", "photo-produit": "Photo d'un produit", facture: "Lecture de facture", circulaires: "Circulaires (lecture commune)", colette: "Colette (questions)", ajouter: "Le Plumeau : lecture d'un lien", classer: "Le Plumeau : classement des liens", suggerer: "Le Plumeau : sites semblables" };
  function vueCouts(d) {
    const tous = d.couts || [], j30 = tous.filter((c) => Date.now() - t(c.cree) < 30 * JOUR);
    const somme = (l) => l.reduce((s, c) => s + Number(c.cout_usd || 0), 0);
    const grouper = (l, cle) => { const m = new Map(); for (const c of l) { const k = c[cle] || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return [...m.entries()]; };
    const foyers = new Map(((d.commis && d.commis.foyers) || []).map((f) => [f.id, f.nom]));
    const parFoyer = grouper(j30.filter((c) => c.foyer_id), "foyer_id").map(([id, l]) => ({ id, l, n: somme(l) })).sort((a, b) => b.n - a.n);
    // Les circulaires sont lues une fois pour toute l'app (foyer vide) : leur coût est réparti entre les foyers actifs
    const actifs = ((d.commis && d.commis.foyers) || []).filter((f) => ["essai", "paye"].includes(forfaitCommis(f).cle)).length || parFoyer.length || 1;
    const commun = somme(j30.filter((c) => !c.foyer_id && (c.app || "commis") === "commis"));
    const moyen = (somme(j30.filter((c) => c.foyer_id)) + commun) / actifs;
    const parApp = grouper(j30, "app").map(([a, l]) => ({ a: a || "commis", l, n: somme(l) })).sort((x, y) => y.n - x.n);
    return `<section class="section">${chiffres([[usd(somme(j30)), "dépensés en IA depuis 30 jours"], [j30.length, "appels depuis 30 jours"], [usd(moyen), "par foyer actif, en 30 jours"], [usd(moyen * 365 / 30), "par foyer, projeté sur un an"]])}</section>` +
      section("Par app, depuis 30 jours", "Le Plumeau est gratuit : son coût par compte se compare à zéro revenu. Les quotas quotidiens le gardent bas.",
        table([{ t: "App" }, { t: "Appels", n: 1 }, { t: "Coût 30 jours", n: 1 }, { t: "Projeté sur un an", n: 1 }],
          parApp.map(({ a, l, n }) => [puce(a), l.length, esc(usd(n)), esc(usd(n * 365 / 30))]), "Aucun appel noté pour l'instant.")) +
      section("Par fonction, depuis 30 jours", "Le prix est calculé avec les tarifs publiés d'Anthropic, en dollars américains. Une recherche web coûte 0,01 $.",
        table([{ t: "Fonction" }, { t: "Modèle" }, { t: "Appels", n: 1 }, { t: "Jetons entrée", n: 1 }, { t: "Jetons sortie", n: 1 }, { t: "Recherches", n: 1 }, { t: "Coût", n: 1 }, { t: "Par appel", n: 1 }],
          grouper(j30, "fonction").map(([f, l]) => ({ f, l, n: somme(l) })).sort((a, b) => b.n - a.n).map(({ f, l, n }) => [
            `<span class="nom">${esc(NOMS_FONCTIONS[f] || f)}</span>`, esc([...new Set(l.map((c) => c.modele.replace("claude-", "")))].join(", ")), l.length,
            l.reduce((s, c) => s + c.entree, 0).toLocaleString("fr-CA"), l.reduce((s, c) => s + c.sortie, 0).toLocaleString("fr-CA"), l.reduce((s, c) => s + c.recherches, 0), esc(usd(n)), esc(usd(n / l.length))]),
          "Aucun appel noté pour l'instant. Chaque appel à Claude s'inscrira ici.")) +
      section("Par foyer, depuis 30 jours", `Comparez la projection sur un an au prix de l'abonnement (19,99 $ CA, environ 19,11 $ après les frais Stripe). La lecture commune des circulaires (${usd(commun)}) est partagée entre les ${actifs} foyer${actifs > 1 ? "s" : ""} actif${actifs > 1 ? "s" : ""} : ${usd(commun / actifs)} chacun, ajouté ci-dessous.`,
        table([{ t: "Foyer" }, { t: "Appels", n: 1 }, { t: "Coût 30 jours", n: 1 }, { t: "Projeté sur un an", n: 1 }, { t: "Le plus coûteux" }],
          parFoyer.map(({ id, l, n }) => {
            const pire = grouper(l, "fonction").map(([f, x]) => [f, somme(x)]).sort((a, b) => b[1] - a[1])[0];
            const part = n + commun / actifs;
            return [`<span class="nom">${esc(foyers.get(id) || "Foyer retiré")}</span>`, l.length, esc(usd(part)), esc(usd(part * 365 / 30)), esc(pire ? `${NOMS_FONCTIONS[pire[0]] || pire[0]} (${usd(pire[1])})` : "")];
          }), "Aucun foyer n'a encore utilisé l'IA."));
  }
  const MOTS = { "commis.idee": "Idée", "commis.nouveaute": "Nouveauté", "fanion.idee": "Idée", "fanion.nouveaute": "Nouveauté", "plumeau.idee": "Idée", "plumeau.nouveaute": "Nouveauté", "commis.avis": "Avis", "commis.foyer": "Foyer", "fanion.avis": "Avis", "fanion.groupe": "Groupe", "fanion.demande": "Demande de jeu", "acces.inviter": "Accès", "acces.role": "Accès", "acces.retirer": "Accès", "courriel.etat": "Courriel", "courriel.repondre": "Courriel" };
  const GESTES = { publie: "publié sur le site", attente: "remis en attente", ecarte: "écarté", essai: "essai prolongé", activer: "forfait activé pour 12 mois", retirer: "forfait retiré", traitee: "marquée comme traitée", traite: "marqué comme traité", atraiter: "remis à traiter", repondu: "réponse envoyée", annoncer: "annoncée dans l'app", recue: "à lire", etudiee: "à l'étude", prevue: "prévue", faite: "faite", non: "non retenue" };
  const ROLES = { proprio: "Propriétaire", gestion: "Gestion", lecture: "Consultation" };
  const gesteJournal = (j) => { const x = j.detail || {};
    if (j.app === "console") return x.geste === "inviter" ? `accès donné (${ROLES[x.role] || ""})` : x.geste === "role" ? `rôle changé (${ROLES[x.role] || ""})` : "accès retiré";
    if (j.action === "commis.idee") return [GESTES[x.statut] || "", x.repondu ? "réponse envoyée" : ""].filter(Boolean).join(", ");
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

  const VUES = [["traiter", "À traiter"], ["courriels", "Courriels"], ["idees", "Idées"], ["commis", "Le Commis"], ["fanion", "Fanion"], ["plumeau", "Le Plumeau"], ["couts", "Coûts IA"], ["journal", "Journal"]];
  function rendre() {
    const d = etat.d; if (!d) return;
    const n = aTraiter(d).n;
    const vues = etat.role === "proprio" ? [...VUES, ["acces", "Accès"]] : VUES;
    if (!vues.some(([k]) => k === etat.vue)) etat.vue = "traiter";
    $("#onglets").innerHTML = vues.map(([k, mot]) => `<button class="onglet" data-vue="${k}" ${etat.vue === k ? 'aria-current="page"' : ""}>${k === "commis" || k === "fanion" || k === "plumeau" ? `<i class="pastille ${k}"></i>` : ""}${mot}${k === "traiter" && n ? `<span class="compte">${n}</span>` : ""}</button>`).join("");
    $("#page").innerHTML = etat.vue === "commis" ? vueCommis(d) : etat.vue === "fanion" ? vueFanion(d) : etat.vue === "plumeau" ? vuePlumeau(d) : etat.vue === "journal" ? vueJournal(d) : etat.vue === "couts" ? vueCouts(d) : etat.vue === "acces" ? vueAcces(d) : etat.vue === "courriels" ? vueCourriels(d) : etat.vue === "idees" ? vueIdees(d) : vueTraiter(d);
    // Consultation seulement : aucun bouton de geste (le serveur les refuserait de toute façon)
    if (etat.role === "lecture") $("#page").querySelectorAll("[data-avis],[data-foyer],[data-groupe],[data-demande],[data-courriel],[data-idee],[data-nouveaute],#f-nouveaute").forEach((b) => b.remove());
    $("#pied").textContent = `Connecté : ${etat.courriel}${etat.role === "lecture" ? " (consultation seulement)" : ""}. Données lues à ${new Intl.DateTimeFormat("fr-CA", { hour: "numeric", minute: "2-digit" }).format(new Date())}.`;
    document.title = (n ? `(${n}) ` : "") + "Console HoldingAI";
    etat.frais = null;
  }
  async function charger(silence) {
    if (!silence && !etat.d) $("#page").innerHTML = `<p class="charge">Lecture des données…</p>`;
    try {
      const d = await appel({ action: "tout" });
      try { d.retour = await rpc("console_retour"); } catch (e) { d.retour = { idees: [], sondages: [], nouveautes: [] }; }
      try { d.plumeau = await rpc("console_plumeau"); } catch (e) { d.plumeau = { comptes: [], erreur: e.message }; }
      etat.d = d; etat.courriel = d.courriel || ""; etat.role = d.role || "lecture"; rendre();
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
  $("#actualiser").addEventListener("click", async () => { await charger(true); toast("Données à jour."); });
  $("#sortir").addEventListener("click", async () => { await sb.auth.signOut(); etat.d = null; montrerPorte(""); });
  $("#page").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = etat.d;
    if (b.dataset.filtre) { etat.filtre = b.dataset.filtre; rendre(); return; }
    if (b.dataset.filtreidee) { etat.filtreIdee = b.dataset.filtreidee; rendre(); return; }
    if (b.dataset.appidee) { etat.appIdee = b.dataset.appidee; rendre(); return; }
    if (b.dataset.nouveaute) {
      const ok = await confirmer({ titre: "Retirer cette nouveauté ?", texte: "Les membres qui ne l'ont pas encore vue ne la verront pas.", bouton: "Retirer" });
      if (ok) agir({ action: "commis.nouveaute", geste: "retirer", id: b.dataset.nouveaute }, "Nouveauté retirée.");
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
