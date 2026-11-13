// Console HoldingAI : tout passe par la fonction serveur « console », qui vérifie que le compte y a droit.
(() => {
  const URL_SB = "https://gandliltstmtfsmsjaew.supabase.co";
  const CLE_SB = "sb_publishable_8b0VbS6YyEf5vrsn5u9m4Q_JJZ1vkmP"; // clé publique : l'accès est décidé par le serveur
  const sb = window.supabase.createClient(URL_SB, CLE_SB, { auth: { storageKey: "holdingai.console" } });
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const JOUR = 864e5;
  const etat = { vue: "traiter", d: null, courriel: "", frais: null };

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
  const nomApp = { commis: "Le Commis", fanion: "Fanion" };
  const puce = (app) => `<span class="app"><i class="pastille ${app}"></i>${nomApp[app]}</span>`;

  // ---------- serveur
  async function appel(corps) {
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
    return { avis, paiements, essais, demandes: d.fanion.demandes, n: avis.length + paiements.length + d.fanion.demandes.length };
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

  // ---------- vues
  function vueTraiter(d) {
    const a = aTraiter(d);
    const blocs = [];
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
  const MOTS = { "commis.avis": "Avis", "commis.foyer": "Foyer", "fanion.avis": "Avis", "fanion.groupe": "Groupe", "fanion.demande": "Demande de jeu" };
  const GESTES = { publie: "publié sur le site", attente: "remis en attente", ecarte: "écarté", essai: "essai prolongé", activer: "forfait activé pour 12 mois", retirer: "forfait retiré", traitee: "marquée comme traitée" };
  function vueJournal(d) {
    return section("Journal", "Chaque geste fait dans la console, du plus récent au plus ancien.",
      table([{ t: "Geste" }, { t: "App" }, { t: "Quand" }], d.commis.journal.map((j) => {
        const x = j.detail || {};
        return [`<span class="nom">${esc(MOTS[j.action] || j.action)} : ${esc(j.cible || "")}</span><small>${esc([GESTES[x.etat || x.geste] || "", x.raison || ""].filter(Boolean).join(", "))}</small>`, puce(j.app), esc(moment(j.cree))];
      }), "Aucun geste pour l'instant."));
  }

  const VUES = [["traiter", "À traiter"], ["commis", "Le Commis"], ["fanion", "Fanion"], ["journal", "Journal"]];
  function rendre() {
    const d = etat.d; if (!d) return;
    const n = aTraiter(d).n;
    $("#onglets").innerHTML = VUES.map(([k, mot]) => `<button class="onglet" data-vue="${k}" ${etat.vue === k ? 'aria-current="page"' : ""}>${k === "commis" || k === "fanion" ? `<i class="pastille ${k}"></i>` : ""}${mot}${k === "traiter" && n ? `<span class="compte">${n}</span>` : ""}</button>`).join("");
    $("#page").innerHTML = etat.vue === "commis" ? vueCommis(d) : etat.vue === "fanion" ? vueFanion(d) : etat.vue === "journal" ? vueJournal(d) : vueTraiter(d);
    $("#pied").textContent = `Connecté : ${etat.courriel}. Données lues à ${new Intl.DateTimeFormat("fr-CA", { hour: "numeric", minute: "2-digit" }).format(new Date())}.`;
    document.title = (n ? `(${n}) ` : "") + "Console HoldingAI";
    etat.frais = null;
  }
  async function charger(silence) {
    if (!silence && !etat.d) $("#page").innerHTML = `<p class="charge">Lecture des données…</p>`;
    try {
      const d = await appel({ action: "tout" });
      etat.d = d; etat.courriel = d.courriel || ""; rendre();
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

  // ---------- gestes
  $("#onglets").addEventListener("click", (e) => { const b = e.target.closest("[data-vue]"); if (!b) return; etat.vue = b.dataset.vue; rendre(); window.scrollTo({ top: 0 }); });
  $("#actualiser").addEventListener("click", async () => { await charger(true); toast("Données à jour."); });
  $("#sortir").addEventListener("click", async () => { await sb.auth.signOut(); etat.d = null; montrerPorte(""); });
  $("#page").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const d = etat.d;
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
    } else if (b.dataset.demande) {
      agir({ action: "fanion.demande", id: b.dataset.demande }, "Demande marquée comme traitée.");
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden && etat.d && !$("#dlg").open) charger(true); });
})();
