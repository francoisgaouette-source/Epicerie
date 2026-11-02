(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const cfg = window.EPICERIE_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const DEFAULT_STORES = ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
    "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];
  const state = { liste: [], surv: [], spec: [], prod: [], config: null, membres: [], email: null };
  let openProd = null, search = "", channel = null;

  // ---------- utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const num = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const money = (n) => (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") + " $" : "";
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const status = (m) => { $("#status").textContent = m || ""; };
  const stores = () => (state.config && Array.isArray(state.config.magasins) && state.config.magasins.length) ? state.config.magasins : DEFAULT_STORES;
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso);
    return isNaN(d) ? esc(iso) : d.toLocaleDateString("fr-CA", { day: "numeric", month: "long" });
  }
  const emptyBox = (t, x) => `<div class="empty"><strong>${t}</strong>${x}</div>`;
  const nameOf = (email) => {
    if (!email) return "";
    if (state.email && email.toLowerCase() === state.email.toLowerCase()) return "toi";
    const m = state.membres.find((x) => x.email.toLowerCase() === email.toLowerCase());
    return (m && m.nom) || "";
  };

  // ---------- prices
  function priceAt(p, store) {
    const e = p && p.prix && p.prix[store]; if (!e) return null;
    const sp = num(e.special), reg = num(e.reg);
    if (sp != null && (!e.finSpecial || e.finSpecial >= today())) return { val: sp, special: true, reg, fin: e.finSpecial };
    if (reg != null) return { val: reg, special: false, reg };
    return null;
  }
  function bestOf(p) {
    let best = null;
    for (const s of stores()) { const pr = priceAt(p, s); if (pr && (!best || pr.val < best.val)) best = { ...pr, store: s }; }
    return best;
  }
  const prodMap = () => { const m = new Map(); state.prod.forEach((p) => m.set(norm(p.nom), p)); return m; };

  // ---------- tabs
  let view = "liste";
  try { const v = localStorage.getItem("vue"); if (v && document.getElementById("v-" + v)) view = v; } catch (e) {}
  function showView(v) {
    view = v;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === v)));
    document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
    try { localStorage.setItem("vue", v); } catch (e) {}
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  showView(view);
  $("#in-pcat").innerHTML = CATS.map((c) => `<option>${c}</option>`).join("");
  $("#in-pcat").value = "Autre";

  // ---------- render
  function render() {
    const pm = prodMap();
    $("#dl-produits").innerHTML = [...state.prod].sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)))
      .map((p) => `<option value="${esc(p.nom)}">${esc([p.format, p.categorie].filter(Boolean).join(" · "))}</option>`).join("");

    // LISTE
    const liste = [...state.liste].sort((a, b) => (a.fait - b.fait) || (a.cree < b.cree ? -1 : 1));
    const restants = liste.filter((i) => !i.fait);
    $("#c-liste").textContent = restants.length;
    if (!liste.length) {
      $("#list-liste").innerHTML = emptyBox("La liste est vide", "Ajoute un article ci-dessus. L'autre personne le verra aussitôt.");
      $("#liste-actions").hidden = true;
    } else {
      const saleNames = new Set(state.spec.filter((s) => !s.ignore).map((s) => norm(s.item)));
      $("#list-liste").innerHTML = `<ul class="list">${liste.map((i) => {
        const by = nameOf(i.par); const p = pm.get(norm(i.nom)); const b = p && bestOf(p);
        const onSale = saleNames.has(norm(i.nom)) || (b && b.special);
        return `<li class="${i.fait ? "done" : ""}">
          <input type="checkbox" class="check" id="chk-${i.id}" data-id="${i.id}" ${i.fait ? "checked" : ""} aria-label="Acheté : ${esc(i.nom)}">
          <div class="main"><div class="name">${esc(i.nom)}${i.qte ? ` <span class="meta">× ${esc(i.qte)}</span>` : ""}${onSale ? '<span class="sale">en spécial</span>' : ""}</div>
          <div class="meta">${b ? `Meilleur prix : <span class="mono">${money(b.val)}</span> chez ${esc(b.store)}` : ""}${b && by ? " · " : ""}${by ? `ajouté par ${esc(by)}` : ""}</div></div>
          <button class="icon" data-del="epicerie" data-id="${i.id}" aria-label="Supprimer ${esc(i.nom)}">✕</button></li>`;
      }).join("")}</ul>`;
      const faits = liste.length - restants.length;
      $("#liste-actions").hidden = faits === 0;
      $("#liste-hint").textContent = faits ? `${faits} article${faits > 1 ? "s" : ""} coché${faits > 1 ? "s" : ""}` : "";
    }
    renderCompare(restants, pm);

    // SURVEILLER
    const surv = [...state.surv].sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
    $("#c-surveiller").textContent = surv.length;
    $("#list-surv").innerHTML = surv.length ? `<ul class="list">${surv.map((i) => {
      const hits = state.spec.some((s) => !s.ignore && norm(s.item) === norm(i.nom));
      const by = nameOf(i.par);
      return `<li><div class="main"><div class="name">${esc(i.nom)}${hits ? '<span class="sale">en spécial</span>' : ""}</div>
        <div class="meta">${i.prix_cible != null ? `Prix cible : ${money(Number(i.prix_cible))}` : "Tout rabais"}${by ? ` · ajouté par ${esc(by)}` : ""}</div></div>
        <button class="icon" data-del="surveiller" data-id="${i.id}" aria-label="Ne plus surveiller ${esc(i.nom)}">✕</button></li>`;
    }).join("")}</ul>`
      : emptyBox("Rien à surveiller pour l'instant", "Ajoute les articles qu'on achète seulement en rabais : café, papier de toilette, viande à congeler…");
    $("#stores").innerHTML = stores().map((m, ix) => `<span class="chip">${esc(m)}<button type="button" data-store="${ix}" aria-label="Retirer ${esc(m)}">✕</button></span>`).join("");

    // SPÉCIAUX
    const spec = state.spec.filter((s) => !s.ignore)
      .sort((a, b) => norm(a.item).localeCompare(norm(b.item)) || (num(a.prix) || 0) - (num(b.prix) || 0));
    $("#c-speciaux").textContent = spec.length;
    $("#c-speciaux").classList.toggle("hot", spec.length > 0);
    const c = state.config;
    $("#agent-info").innerHTML = c && c.derniere_verif
      ? `Dernière vérification : <b>${fmtDate(c.derniere_verif)}</b>${c.semaine ? ` · circulaires ${esc(c.semaine)}` : ""}${c.resume ? `<br>${esc(c.resume)}` : ""}`
      : `L'agent vérifie les circulaires <b>chaque jeudi matin</b>. Les spéciaux qui correspondent à votre liste « À surveiller » apparaîtront ici.`;
    $("#list-spec").innerHTML = spec.length ? `<div class="deals">${spec.map((s) => {
      const inList = state.liste.some((i) => !i.fait && norm(i.nom) === norm(s.item));
      const pr = num(s.prix), rg = num(s.prix_reg);
      return `<div class="deal">
        <div><div class="store">${esc(s.magasin)}${s.fin ? ` · jusqu'au ${fmtDate(s.fin)}` : ""}</div><div class="name">${esc(s.item)}</div></div>
        <div><div class="price">${pr != null ? money(pr) : ""}</div>${rg != null ? `<div class="reg">${money(rg)}</div>` : ""}</div>
        ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ""}
        <div class="deal-actions">
          ${inList ? '<span class="meta">Déjà dans la liste</span>' : `<button class="link" data-addfrom="${s.id}" type="button">Ajouter à la liste</button>`}
          <button class="link muted" data-ignore="${s.id}" type="button">Masquer</button>
          ${/^https?:\/\//.test(s.lien || "") ? `<a href="${esc(s.lien)}" target="_blank" rel="noopener">Voir la circulaire</a>` : ""}
        </div></div>`;
    }).join("")}</div>`
      : emptyBox("Aucun spécial trouvé pour l'instant", state.surv.length ? "Rien de votre liste n'est en rabais dans les circulaires vérifiées." : "Ajoutez d'abord des articles dans « À surveiller ».");

    renderProducts();
  }

  function renderCompare(restants, pm) {
    const box = $("#compare");
    if (!restants.length) { box.innerHTML = ""; return; }
    const qty = (i) => { const q = num(i.qte); return q && q > 0 ? q : 1; };
    const rows = stores().map((s) => {
      let total = 0, miss = 0;
      restants.forEach((i) => { const p = pm.get(norm(i.nom)); const pr = p && priceAt(p, s); if (pr) total += pr.val * qty(i); else miss++; });
      return { s, total, miss, found: restants.length - miss };
    });
    const priced = rows.filter((r) => r.found > 0);
    if (!priced.length) {
      box.innerHTML = `<div class="compare"><h2>Où acheter cette semaine</h2><p class="hint">Aucun prix connu pour les articles de la liste. L'agent ajoute les prix chaque jeudi; vous pouvez aussi les inscrire dans l'onglet Produits.</p></div>`;
      return;
    }
    const maxFound = Math.max(...priced.map((r) => r.found));
    const bestTotal = Math.min(...priced.filter((r) => r.found === maxFound).map((r) => r.total));
    const maxTotal = Math.max(...priced.map((r) => r.total)) || 1;
    let mix = 0, mixMiss = 0; const perStore = {};
    restants.forEach((i) => { const p = pm.get(norm(i.nom)); const b = p && bestOf(p); if (b) { mix += b.val * qty(i); perStore[b.store] = (perStore[b.store] || 0) + 1; } else mixMiss++; });
    const sorted = [...rows].sort((a, b) => (b.found - a.found) || (a.total - b.total));
    box.innerHTML = `<div class="compare">
      <div class="compare-head"><h2>Où acheter cette semaine</h2><span class="hint">${restants.length} article${restants.length > 1 ? "s" : ""} à acheter</span></div>
      <div class="bars">${sorted.map((r) => {
        const isBest = r.found === maxFound && r.total === bestTotal;
        return `<div class="bar${isBest ? " best" : ""}"><span class="store-name">${esc(r.s)}</span>
          <span class="track"><span class="fill" style="display:block;width:${r.found ? Math.max(4, Math.round(r.total / maxTotal * 100)) : 0}%"></span></span>
          <span class="amt">${r.found ? money(r.total) : "—"}${r.miss ? `<br><span class="miss">${r.miss} sans prix</span>` : ""}</span></div>`;
      }).join("")}</div>
      ${Object.keys(perStore).length > 1 ? `<div class="mix">En achetant chaque article là où il est le moins cher : <b class="mono">${money(mix)}</b> (${Object.entries(perStore).map(([s, n]) => `${n} chez ${esc(s)}`).join(", ")})${mixMiss ? `, ${mixMiss} sans prix` : ""}.</div>` : ""}
      <p class="hint">Totaux estimés avec les prix connus (spécial en cours, sinon prix régulier) et la quantité inscrite.</p>
    </div>`;
  }

  function renderProducts() {
    $("#c-produits").textContent = state.prod.length;
    const q = norm(search);
    const list = state.prod.filter((p) => !q || norm([p.nom, p.marque, p.format, p.categorie].join(" ")).includes(q));
    if (!state.prod.length) { $("#list-prod").innerHTML = emptyBox("Le catalogue est vide", "Ajoutez vos produits habituels ci-dessus, ou ajoutez simplement des articles à la liste : ils s'inscriront ici."); return; }
    if (!list.length) { $("#list-prod").innerHTML = emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc(search)} ».`); return; }
    // Don't rebuild while someone types in a product's fields.
    const act = document.activeElement;
    if (act && act.closest && act.closest("#list-prod [data-stop]")) return;
    const groups = {};
    list.forEach((p) => { const c = p.categorie || "Autre"; (groups[c] = groups[c] || []).push(p); });
    const order = [...CATS, ...Object.keys(groups).filter((c) => !CATS.includes(c))];
    $("#list-prod").innerHTML = `<ul class="list">${order.filter((c) => groups[c]).map((c) =>
      `<li class="cat-head" style="display:block">${esc(c)}</li>` +
      groups[c].sort((a, b) => norm(a.nom).localeCompare(norm(b.nom))).map((p) => {
        const b = bestOf(p);
        return `<li class="prod-row" data-prod="${p.id}">
          <div class="main"><div class="name">${esc(p.nom)}${b && b.special ? '<span class="sale">spécial</span>' : ""}</div>
          <div class="meta">${esc([p.marque, p.format].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="best-price">${b ? money(b.val) + `<small>${esc(b.store)}</small>` : "<small>aucun prix</small>"}</div>
          ${openProd === p.id ? productDetail(p, b) : ""}
        </li>`;
      }).join("")).join("")}</ul>`;
  }

  function productDetail(p, b) {
    const pid = p.id;
    return `<div class="prod-detail" data-stop>
      <div class="edit-fields">
        <input id="e-nom-${pid}" value="${esc(p.nom)}" aria-label="Nom" data-pfield="nom" data-id="${pid}">
        <input id="e-marque-${pid}" value="${esc(p.marque || "")}" placeholder="Marque" aria-label="Marque" data-pfield="marque" data-id="${pid}">
        <input id="e-format-${pid}" value="${esc(p.format || "")}" placeholder="Format" aria-label="Format" data-pfield="format" data-id="${pid}">
        <select id="e-cat-${pid}" aria-label="Catégorie" data-pfield="categorie" data-id="${pid}">${CATS.map((c) => `<option ${c === (p.categorie || "Autre") ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="price-grid">${stores().map((s, ix) => {
        const e = (p.prix && p.prix[s]) || {}; const pr = priceAt(p, s);
        return `<div class="pcell${b && b.store === s ? " best" : ""}"><label for="pr-${pid}-${ix}">${esc(s)}</label>
          <input id="pr-${pid}-${ix}" inputmode="decimal" placeholder="Prix régulier" value="${e.reg != null ? esc(String(e.reg)) : ""}" data-price="${esc(s)}" data-id="${pid}">
          ${pr && pr.special ? `<span class="sp">Spécial ${money(pr.val)}${pr.fin ? ` · ${fmtDate(pr.fin)}` : ""}</span>` : ""}
          ${e.maj ? `<span class="when">maj ${fmtDate(e.maj)}${e.par === "agent" ? " · agent" : ""}</span>` : ""}
        </div>`;
      }).join("")}</div>
      <div class="row-actions">
        <button class="link" type="button" data-tolist="${pid}">Ajouter à la liste</button>
        <button class="link" type="button" data-towatch="${pid}">Surveiller les spéciaux</button>
        <button class="link muted" type="button" data-del="produits" data-id="${pid}">Supprimer du catalogue</button>
      </div>
    </div>`;
  }

  // ---------- data
  const TABLES = { epicerie: "liste", surveiller: "surv", speciaux: "spec", produits: "prod" };
  async function load(table) {
    if (table === "config") {
      const { data } = await sb.from("config").select("*").eq("id", 1).maybeSingle();
      state.config = data; return;
    }
    const { data, error } = await sb.from(table).select("*").order("cree", { ascending: true, nullsFirst: true }).limit(2000);
    if (error && table === "speciaux") { const r = await sb.from(table).select("*").limit(2000); state[TABLES[table]] = r.data || []; return; }
    if (!error) state[TABLES[table]] = data || [];
  }
  async function loadAll() {
    await Promise.all(["epicerie", "surveiller", "produits", "config"].map(load).concat(
      sb.from("speciaux").select("*").limit(2000).then(({ data }) => { state.spec = data || []; })));
    render();
  }
  const pending = {};
  function scheduleReload(table) {
    clearTimeout(pending[table]);
    pending[table] = setTimeout(async () => {
      if (table === "speciaux") { const { data } = await sb.from("speciaux").select("*").limit(2000); state.spec = data || []; }
      else await load(table);
      render();
    }, 250);
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("epicerie-live");
    ["epicerie", "surveiller", "speciaux", "produits", "config"].forEach((t) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => scheduleReload(t)));
    channel.subscribe();
  }

  async function run(promise, okMsg) {
    const { error } = await promise;
    if (error) {
      if (error.code === "23505") return true; // already exists
      status("La modification n'a pas été enregistrée. Vérifiez votre connexion et réessayez.");
      console.error(error);
      return false;
    }
    status(okMsg || "");
    return true;
  }
  async function ensureProduct(nom) {
    if (state.prod.some((p) => norm(p.nom) === norm(nom))) return;
    await run(sb.from("produits").insert({ nom }));
    scheduleReload("produits");
  }
  // Optimistic local update, then sync
  function local(table, fn) { fn(); render(); }

  // ---------- events
  $("#f-liste").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-liste").value.trim(); if (!nom) return;
    const qte = $("#in-qte").value.trim();
    $("#in-liste").value = ""; $("#in-qte").value = ""; $("#in-liste").focus();
    if (await run(sb.from("epicerie").insert({ nom, qte }))) { scheduleReload("epicerie"); ensureProduct(nom); }
  });
  $("#f-surv").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-surv").value.trim(); if (!nom) return;
    const c = $("#in-cible").value.trim();
    if (c && num(c) == null) { status("Inscris le prix cible en chiffres, par exemple 9,99."); return; }
    $("#in-surv").value = ""; $("#in-cible").value = ""; $("#in-surv").focus();
    if (await run(sb.from("surveiller").insert({ nom, prix_cible: num(c) }))) { scheduleReload("surveiller"); ensureProduct(nom); }
  });
  $("#f-store").addEventListener("submit", async (e) => {
    e.preventDefault(); const m = $("#in-store").value.trim(); if (!m) return;
    const cur = stores(); $("#in-store").value = "";
    if (cur.some((x) => norm(x) === norm(m))) return;
    if (await run(sb.from("config").update({ magasins: [...cur, m] }).eq("id", 1))) scheduleReload("config");
  });
  $("#f-prod").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-pnom").value.trim(); if (!nom) return;
    if (state.prod.some((p) => norm(p.nom) === norm(nom))) { status(`« ${nom} » est déjà dans le catalogue.`); return; }
    const format = $("#in-pformat").value.trim(), categorie = $("#in-pcat").value;
    $("#in-pnom").value = ""; $("#in-pformat").value = ""; $("#in-pnom").focus();
    if (await run(sb.from("produits").insert({ nom, format, categorie }))) scheduleReload("produits");
  });
  $("#in-search").addEventListener("input", (e) => { search = e.target.value; renderProducts(); });

  document.addEventListener("change", async (e) => {
    const c = e.target.closest("#app .check");
    if (c) {
      const it = state.liste.find((i) => i.id === c.dataset.id);
      if (it) local("epicerie", () => (it.fait = c.checked));
      await run(sb.from("epicerie").update({ fait: c.checked }).eq("id", c.dataset.id));
      return;
    }
    const pf = e.target.closest("[data-pfield]");
    if (pf) {
      const v = pf.value.trim(); if (pf.dataset.pfield === "nom" && !v) return;
      await run(sb.from("produits").update({ [pf.dataset.pfield]: v }).eq("id", pf.dataset.id));
      scheduleReload("produits"); return;
    }
    const pi = e.target.closest("[data-price]");
    if (pi) {
      const v = num(pi.value);
      if (pi.value.trim() !== "" && v == null) { status("Inscris un prix en chiffres, par exemple 4,99."); return; }
      await run(sb.rpc("maj_prix", { p_id: pi.dataset.id, p_magasin: pi.dataset.price, p_entree: { reg: v, maj: today(), par: "manuel" } }));
      scheduleReload("produits");
    }
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#app")) return;
    if (e.target.closest("[data-stop] input, [data-stop] select")) return;
    const d = e.target.closest("[data-del]");
    if (d) {
      const t = d.dataset.del, key = TABLES[t];
      local(t, () => (state[key] = state[key].filter((x) => x.id !== d.dataset.id)));
      if (t === "produits") openProd = null;
      await run(sb.from(t).delete().eq("id", d.dataset.id)); return;
    }
    const st = e.target.closest("[data-store]");
    if (st) {
      const cur = [...stores()]; cur.splice(+st.dataset.store, 1);
      if (await run(sb.from("config").update({ magasins: cur }).eq("id", 1))) scheduleReload("config"); return;
    }
    const a = e.target.closest("[data-addfrom]");
    if (a) { const s = state.spec.find((x) => x.id === a.dataset.addfrom); if (s && await run(sb.from("epicerie").insert({ nom: s.item }))) scheduleReload("epicerie"); return; }
    const ig = e.target.closest("[data-ignore]");
    if (ig) { local("speciaux", () => (state.spec = state.spec.filter((x) => x.id !== ig.dataset.ignore))); await run(sb.from("speciaux").update({ ignore: true }).eq("id", ig.dataset.ignore)); return; }
    const tl = e.target.closest("[data-tolist]");
    if (tl) {
      const p = state.prod.find((x) => x.id === tl.dataset.tolist); if (!p) return;
      if (state.liste.some((i) => !i.fait && norm(i.nom) === norm(p.nom))) { status(`« ${p.nom} » est déjà dans la liste.`); return; }
      if (await run(sb.from("epicerie").insert({ nom: p.nom }), `« ${p.nom} » ajouté à la liste.`)) scheduleReload("epicerie"); return;
    }
    const tw = e.target.closest("[data-towatch]");
    if (tw) {
      const p = state.prod.find((x) => x.id === tw.dataset.towatch); if (!p) return;
      if (state.surv.some((i) => norm(i.nom) === norm(p.nom))) { status(`« ${p.nom} » est déjà surveillé.`); return; }
      if (await run(sb.from("surveiller").insert({ nom: p.nom }), `« ${p.nom} » est maintenant surveillé.`)) scheduleReload("surveiller"); return;
    }
    if (e.target.closest("[data-stop]")) return;
    const row = e.target.closest("[data-prod]");
    if (row) { openProd = openProd === row.dataset.prod ? null : row.dataset.prod; renderProducts(); }
  });
  $("#clear-done").addEventListener("click", async () => {
    const ids = state.liste.filter((i) => i.fait).map((i) => i.id);
    if (!ids.length) return;
    local("epicerie", () => (state.liste = state.liste.filter((i) => !i.fait)));
    await run(sb.from("epicerie").delete().in("id", ids));
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.email) loadAll(); });

  // ---------- auth
  let pendingEmail = "";
  const loginStatus = (m) => { $("#login-status").textContent = m || ""; };
  $("#f-email").addEventListener("submit", async (e) => {
    e.preventDefault();
    pendingEmail = $("#in-email").value.trim().toLowerCase(); if (!pendingEmail) return;
    loginStatus("Envoi du code…");
    const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true } });
    if (error) { loginStatus("Le code n'a pas pu être envoyé. Attendez une minute et réessayez."); console.error(error); return; }
    loginStatus("");
    $("#code-hint").textContent = `Entrez le code envoyé à ${pendingEmail}.`;
    $("#f-email").hidden = true; $("#f-code").hidden = false; $("#in-code").focus();
  });
  $("#f-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#in-code").value.replace(/\s/g, "");
    loginStatus("Vérification…");
    const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    if (error) { loginStatus("Ce code ne fonctionne pas ou a expiré. Vérifiez-le ou demandez-en un nouveau."); return; }
    loginStatus("");
  });
  $("#back-email").addEventListener("click", () => { $("#f-code").hidden = true; $("#f-email").hidden = false; $("#in-code").value = ""; loginStatus(""); });
  $("#logout").addEventListener("click", () => sb.auth.signOut());

  async function onSession(session) {
    if (!session) {
      state.email = null;
      if (channel) { sb.removeChannel(channel); channel = null; }
      $("#app").hidden = true; $("#login").hidden = false;
      $("#f-code").hidden = true; $("#f-email").hidden = false;
      return;
    }
    state.email = session.user.email;
    const { data: membres } = await sb.from("membres").select("email, nom");
    if (!membres || !membres.length) {
      $("#login").hidden = false; $("#app").hidden = true;
      loginStatus(`L'adresse ${state.email} n'a pas accès à cette liste. Demandez à l'ajouter dans la table « membres ».`);
      await sb.auth.signOut({ scope: "local" });
      return;
    }
    state.membres = membres;
    const me = membres.find((m) => m.email.toLowerCase() === state.email.toLowerCase());
    $("#who").textContent = (me && me.nom) || state.email;
    $("#login").hidden = true; $("#app").hidden = false;
    await loadAll();
    subscribe();
  }
  let current = null;
  sb.auth.onAuthStateChange((evt, session) => {
    const email = session && session.user && session.user.email;
    if (email === current && evt !== "SIGNED_OUT") return;
    current = email || null;
    setTimeout(() => onSession(session), 0);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
