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
  const state = { liste: [], surv: [], spec: [], prod: [], espaces: [], config: null, membres: [], email: null };
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

  // ---------- photos
  const urls = new Map(); // chemin -> URL signée
  let fetchingUrls = false;
  const photoOf = (item, pm) => item.photo || (pm && (pm.get(norm(item.nom)) || {}).photo) || null;
  async function ensureUrls(paths) {
    const need = [...new Set(paths.filter((p) => p && !urls.has(p)))];
    if (!need.length || fetchingUrls) return;
    fetchingUrls = true;
    try {
      const { data } = await sb.storage.from("photos").createSignedUrls(need, 60 * 60 * 24 * 7);
      (data || []).forEach((d) => { if (d.signedUrl) urls.set(d.path, d.signedUrl); });
      need.forEach((p) => { if (!urls.has(p)) urls.set(p, ""); });
    } catch (e) { console.error(e); }
    fetchingUrls = false;
    render();
  }
  const thumb = (path, alt) => path
    ? `<img class="thumb" src="${esc(urls.get(path) || "")}" alt="${esc(alt)}" data-zoom="${esc(path)}" loading="lazy">`
    : "";

  // Réduit la photo (max 1280 px, JPEG) avant l'envoi
  async function shrink(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) {
      src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, k = Math.min(1, 1280 / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    const b64 = c.toDataURL("image/jpeg", 0.82).split(",")[1];
    return { blob, b64 };
  }
  async function uploadPhoto(blob) {
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (error) throw error;
    return path;
  }

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
        const ph = photoOf(i, pm);
        return `<li class="${i.fait ? "done" : ""}">
          <input type="checkbox" class="check" id="chk-${i.id}" data-id="${i.id}" ${i.fait ? "checked" : ""} aria-label="Acheté : ${esc(i.nom)}">
          ${thumb(ph, i.nom)}
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
    renderMaison();
    ensureUrls([...state.liste.map((i) => photoOf(i, pm)), ...state.prod.map((p) => p.photo)]);
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
          ${thumb(p.photo, p.nom)}
          <div class="main"><div class="name">${esc(p.nom)}${b && b.special ? '<span class="sale">spécial</span>' : ""}</div>
          <div class="meta">${esc([p.marque, p.format].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="best-price">${b ? money(b.val) + `<small>${esc(b.store)}</small>` : "<small>aucun prix</small>"}</div>
          ${openProd === p.id ? productDetail(p, b) : ""}
        </li>`;
      }).join("")).join("")}</ul>`;
  }

  // ---------- maison : espaces et réserves
  const espacesTries = () => [...state.espaces].sort((a, b) => (a.ordre - b.ordre) || norm(a.nom).localeCompare(norm(b.nom)));
  const estBas = (p) => p.minimum != null && Number(p.stock || 0) <= Number(p.minimum);
  const fmtQ = (n) => { const v = Number(n || 0); return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(".", ","); };
  const espaceSelect = (p, id) => `<select id="${id}" aria-label="Espace" data-pfield="espace_id" data-id="${p.id}">
      <option value="">Sans espace</option>${espacesTries().map((e) => `<option value="${e.id}" ${e.id === p.espace_id ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select>`;
  function stockCtl(p) {
    return `<div class="stock${estBas(p) ? " low" : ""}">
      <button class="sbtn" type="button" data-stock="-1" data-id="${p.id}" aria-label="Retirer un ${esc(p.nom)}">−</button>
      <span class="sval" aria-label="En réserve">${fmtQ(p.stock)}</span>
      <button class="sbtn" type="button" data-stock="1" data-id="${p.id}" aria-label="Ajouter un ${esc(p.nom)}">+</button>
    </div>`;
  }
  function renderMaison() {
    const act = document.activeElement;
    if (act && act.closest && act.closest("#v-maison [data-keep]")) return;
    const esp = espacesTries();
    const bas = state.prod.filter(estBas);
    $("#c-maison").textContent = bas.length;
    $("#c-maison").classList.toggle("hot", bas.length > 0);
    const enListe = new Set(state.liste.filter((i) => !i.fait).map((i) => norm(i.nom)));
    const aAjouter = bas.filter((p) => !enListe.has(norm(p.nom)));
    $("#maison-alerte").innerHTML = bas.length
      ? `<div class="mix"><b>${bas.length} produit${bas.length > 1 ? "s" : ""} sous le minimum</b> : ${bas.map((p) => esc(p.nom)).join(", ")}.
          ${aAjouter.length ? `<br><button class="link" type="button" id="add-bas">Ajouter ${aAjouter.length > 1 ? "les " + aAjouter.length + " manquants" : "le manquant"} à la liste</button>` : " Déjà dans la liste."}</div>`
      : "";
    const q = norm($("#in-msearch").value);
    const match = (p) => !q || norm([p.nom, p.marque, p.format].join(" ")).includes(q);
    if (!esp.length) {
      $("#list-maison").innerHTML = emptyBox("Aucun espace", "Créez vos espaces (garde-manger, frigo, congélateur…) dans « Gérer les espaces » ci-dessous.");
    } else {
      $("#list-maison").innerHTML = esp.map((e) => {
        const items = state.prod.filter((p) => p.espace_id === e.id && match(p)).sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
        if (q && !items.length) return "";
        return `<div class="espace">
          <div class="espace-head"><h2>${esc(e.nom)}</h2><span class="hint">${items.length} produit${items.length > 1 ? "s" : ""}</span></div>
          ${items.length ? `<ul class="list">${items.map((p) => `<li>
            ${thumb(p.photo, p.nom)}
            <div class="main"><div class="name">${esc(p.nom)}${estBas(p) ? '<span class="sale low-tag">à racheter</span>' : ""}</div>
              <div class="meta">${esc([p.format, p.minimum != null ? "minimum " + fmtQ(p.minimum) : ""].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
            ${stockCtl(p)}</li>`).join("")}</ul>`
          : `<p class="hint espace-vide">Vide. Assignez des produits à cet espace dans l'onglet Produits ou dans « Produits sans espace » ci-dessous.</p>`}
        </div>`;
      }).join("") || emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc($("#in-msearch").value)} ».`);
    }
    const sans = state.prod.filter((p) => !p.espace_id && match(p)).sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
    $("#sans-espace-count").textContent = sans.length;
    $("#list-sans-espace").innerHTML = sans.length
      ? `<ul class="list" data-keep>${sans.map((p) => `<li>${thumb(p.photo, p.nom)}<div class="main"><div class="name">${esc(p.nom)}</div></div>${espaceSelect(p, "se-" + p.id)}</li>`).join("")}</ul>`
      : `<p class="hint">Tous les produits ont un espace.</p>`;
    $("#list-espaces").innerHTML = esp.map((e, i) => `<li>
        <input id="esp-${e.id}" value="${esc(e.nom)}" aria-label="Nom de l'espace" data-espnom="${e.id}">
        <button class="icon" type="button" data-espmove="-1" data-id="${e.id}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon" type="button" data-espmove="1" data-id="${e.id}" aria-label="Descendre" ${i === esp.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon" type="button" data-del="espaces" data-id="${e.id}" aria-label="Supprimer ${esc(e.nom)}">✕</button></li>`).join("");
  }
  async function ajusterStock(id, delta) {
    const p = state.prod.find((x) => x.id === id); if (!p) return;
    const avant = Number(p.stock || 0), apres = Math.max(0, avant + delta);
    if (apres === avant) return;
    p.stock = apres; render();
    await run(sb.from("produits").update({ stock: apres }).eq("id", id));
    if (delta < 0 && estBas(p) && !(avant <= Number(p.minimum))) {
      if (!state.liste.some((i) => !i.fait && norm(i.nom) === norm(p.nom))) {
        if (await run(sb.from("epicerie").insert({ nom: p.nom, ...(p.photo ? { photo: p.photo } : {}) }), `« ${p.nom} » est sous le minimum : ajouté à la liste.`)) scheduleReload("epicerie");
      }
    }
  }

  function productDetail(p, b) {
    const pid = p.id;
    return `<div class="prod-detail" data-stop>
      <div class="prod-photo">
        ${p.photo ? `<img src="${esc(urls.get(p.photo) || "")}" alt="${esc(p.nom)}" data-zoom="${esc(p.photo)}">` : ""}
        <button class="btn ghost" type="button" data-prodphoto="${pid}">${p.photo ? "Changer la photo" : "Ajouter une photo"}</button>
      </div>
      <div class="edit-fields">
        <input id="e-nom-${pid}" value="${esc(p.nom)}" aria-label="Nom" data-pfield="nom" data-id="${pid}">
        <input id="e-marque-${pid}" value="${esc(p.marque || "")}" placeholder="Marque" aria-label="Marque" data-pfield="marque" data-id="${pid}">
        <input id="e-format-${pid}" value="${esc(p.format || "")}" placeholder="Format" aria-label="Format" data-pfield="format" data-id="${pid}">
        <select id="e-cat-${pid}" aria-label="Catégorie" data-pfield="categorie" data-id="${pid}">${CATS.map((c) => `<option ${c === (p.categorie || "Autre") ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="edit-fields maison-fields">
        <label class="mf">Espace ${espaceSelect(p, "e-esp-" + pid)}</label>
        <label class="mf">En réserve ${stockCtl(p)}</label>
        <label class="mf">Minimum à garder <input id="e-min-${pid}" inputmode="decimal" placeholder="Aucun" value="${p.minimum != null ? esc(fmtQ(p.minimum)) : ""}" data-nfield="minimum" data-id="${pid}"></label>
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
  const TABLES = { epicerie: "liste", surveiller: "surv", speciaux: "spec", produits: "prod", espaces: "espaces" };
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
    await Promise.all(["epicerie", "surveiller", "produits", "espaces", "config"].map(load).concat(
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
    ["epicerie", "surveiller", "speciaux", "produits", "espaces", "config"].forEach((t) =>
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
  async function ensureProduct(nom, extra) {
    const ex = extra || {};
    const p = state.prod.find((x) => norm(x.nom) === norm(nom));
    if (p) {
      const maj = {};
      if (ex.photo && !p.photo) maj.photo = ex.photo;
      if (ex.marque && !p.marque) maj.marque = ex.marque;
      if (ex.format && !p.format) maj.format = ex.format;
      if (ex.categorie && ex.categorie !== "Autre" && (!p.categorie || p.categorie === "Autre")) maj.categorie = ex.categorie;
      if (Object.keys(maj).length) { await run(sb.from("produits").update(maj).eq("id", p.id)); scheduleReload("produits"); }
      return;
    }
    const row = { nom };
    ["marque", "format", "categorie", "photo"].forEach((k) => { if (ex[k]) row[k] = ex[k]; });
    await run(sb.from("produits").insert(row));
    scheduleReload("produits");
  }

  // ---------- aide
  function showHelp(open) {
    $("#help").hidden = !open;
    if (open) { $("#help").scrollIntoView({ block: "start", behavior: "smooth" }); }
    else { try { localStorage.setItem("aide-vue", "1"); } catch (e) {} }
  }
  $("#open-help").addEventListener("click", () => showHelp($("#help").hidden));
  $("#close-help").addEventListener("click", () => showHelp(false));
  $("#close-help-2").addEventListener("click", () => showHelp(false));
  function helpFirstTime() {
    let vue = false;
    try { vue = localStorage.getItem("aide-vue") === "1"; } catch (e) {}
    if (!vue) $("#help").hidden = false;
  }

  // ---------- suggestions (seulement pendant la saisie)
  const desktop = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  const focusIfDesktop = (el) => { if (desktop) el.focus(); };
  function setupSuggest(inputSel, boxSel) {
    const input = $(inputSel), box = $(boxSel);
    let shown = [], active = -1;
    const hide = () => { box.hidden = true; box.innerHTML = ""; shown = []; active = -1; };
    const pick = (p) => { input.value = p.nom; hide(); input.dispatchEvent(new Event("input")); hide(); };
    function update() {
      const q = norm(input.value);
      if (q.length < 2 || document.activeElement !== input) return hide();
      const words = q.split(" ");
      shown = state.prod
        .filter((p) => { const n = norm([p.nom, p.marque].join(" ")); return words.every((w) => n.includes(w)) && norm(p.nom) !== q; })
        .sort((a, b) => (norm(b.nom).startsWith(q) - norm(a.nom).startsWith(q)) || norm(a.nom).localeCompare(norm(b.nom)))
        .slice(0, 5);
      if (!shown.length) return hide();
      active = -1;
      box.innerHTML = shown.map((p, i) => `<li role="option" id="${boxSel.slice(1)}-${i}" data-i="${i}">${thumb(p.photo, "")}<span>${esc(p.nom)}${p.format ? ` <span class="meta">${esc(p.format)}</span>` : ""}</span></li>`).join("");
      box.hidden = false;
    }
    input.addEventListener("input", update);
    input.addEventListener("blur", () => setTimeout(hide, 150));
    input.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
        box.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(shown[active]); }
      else if (e.key === "Escape") hide();
    });
    box.addEventListener("pointerdown", (e) => {
      const li = e.target.closest("li[data-i]"); if (!li) return;
      e.preventDefault(); pick(shown[+li.dataset.i]);
    });
    input.form && input.form.addEventListener("submit", hide);
  }
  setupSuggest("#in-liste", "#sug-liste");
  setupSuggest("#in-surv", "#sug-surv");
  $("#in-msearch").addEventListener("input", renderMaison);
  $("#f-espace").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-espace").value.trim(); if (!nom) return;
    if (state.espaces.some((x) => norm(x.nom) === norm(nom))) { status(`L'espace « ${nom} » existe déjà.`); return; }
    $("#in-espace").value = "";
    const ordre = Math.max(0, ...state.espaces.map((x) => x.ordre || 0)) + 1;
    if (await run(sb.from("espaces").insert({ nom, ordre }), `Espace « ${nom} » créé.`)) scheduleReload("espaces");
  });

  // ---------- ajout par photo
  let photoPending = null; // {path, ident, busy}
  function showPending(p) {
    photoPending = p;
    $("#pending").hidden = !p;
    if (!p) return;
    $("#pending-img").src = p.preview || "";
    const id = p.ident;
    $("#pending-title").textContent = p.busy ? "Identification du produit…" : (id && id.nom) ? id.nom : "Produit non reconnu";
    $("#pending-meta").textContent = p.busy ? "La photo sera jointe à l'article."
      : p.erreur ? p.erreur
      : (id && id.nom) ? [id.marque, id.format, id.categorie].filter(Boolean).join(" · ") + (id.confiance === "basse" ? " · à vérifier" : "")
      : "Écrivez le nom de l'article; la photo y sera jointe.";
    updatePendingAdd();
  }
  function updatePendingAdd() {
    const btn = $("#pending-add");
    if (!photoPending) return;
    const nom = $("#in-liste").value.trim();
    btn.disabled = photoPending.busy || !nom;
    btn.textContent = photoPending.busy ? "Identification…" : nom ? `Ajouter « ${nom} »` : "Écrivez le nom ci-dessus";
  }
  $("#in-liste").addEventListener("input", updatePendingAdd);
  $("#pending-add").addEventListener("click", () => $("#f-liste").requestSubmit());
  $("#in-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    const preview = URL.createObjectURL(file);
    showPending({ preview, busy: true });
    const mine = photoPending;
    try {
      const { blob, b64 } = await shrink(file);
      const [path, ident] = await Promise.all([
        uploadPhoto(blob),
        sb.functions.invoke("identifier-produit", { body: { image: b64, media_type: "image/jpeg" } })
          .then(({ data, error }) => (error ? { erreur: true } : data)).catch(() => ({ erreur: true })),
      ]);
      if (photoPending !== mine) return; // annulé entre-temps
      const ok = ident && !ident.erreur && ident.nom;
      if (ok && !$("#in-liste").value.trim()) $("#in-liste").value = ident.nom;
      showPending({ preview, path, ident: ok ? ident : null, busy: false,
        erreur: ident && ident.erreur ? "L'identification n'a pas fonctionné. Écrivez le nom; la photo y sera jointe." : "" });
      if (ok) focusIfDesktop($("#pending-add")); else focusIfDesktop($("#in-liste"));
    } catch (err) {
      console.error(err);
      if (photoPending === mine) showPending(null);
      status("La photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.");
    }
  });
  $("#pending-cancel").addEventListener("click", () => {
    if (photoPending && photoPending.path) sb.storage.from("photos").remove([photoPending.path]);
    if (photoPending && photoPending.ident && $("#in-liste").value.trim() === photoPending.ident.nom) $("#in-liste").value = "";
    showPending(null);
  });

  // Photo d'un produit du catalogue
  let prodPhotoTarget = null;
  $("#in-prod-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file || !prodPhotoTarget) return;
    const id = prodPhotoTarget; prodPhotoTarget = null;
    status("Envoi de la photo…");
    try {
      const { blob } = await shrink(file);
      const path = await uploadPhoto(blob);
      if (await run(sb.from("produits").update({ photo: path }).eq("id", id), "Photo ajoutée.")) scheduleReload("produits");
    } catch (err) { console.error(err); status("La photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez."); }
  });

  // Agrandir une photo
  function zoom(path) {
    const u = urls.get(path); if (!u) return;
    $("#lightbox-img").src = u; $("#lightbox").hidden = false; $("#lightbox-close").focus();
  }
  $("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });
  // Optimistic local update, then sync
  function local(table, fn) { fn(); render(); }

  // ---------- events
  $("#f-liste").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-liste").value.trim(); if (!nom) return;
    if (photoPending && photoPending.busy) { status("Un instant, la photo est en cours d'envoi."); return; }
    const qte = $("#in-qte").value.trim();
    const ph = photoPending && photoPending.path ? photoPending.path : null;
    const id = (photoPending && photoPending.ident) || {};
    const sameAsIdent = id.nom && norm(id.nom) === norm(nom);
    $("#in-liste").value = ""; $("#in-qte").value = ""; focusIfDesktop($("#in-liste"));
    showPending(null);
    if (await run(sb.from("epicerie").insert(ph ? { nom, qte, photo: ph } : { nom, qte }))) {
      scheduleReload("epicerie");
      ensureProduct(nom, ph ? { photo: ph, ...(sameAsIdent ? { marque: id.marque, format: id.format, categorie: id.categorie } : {}) } : null);
    }
  });
  $("#f-surv").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-surv").value.trim(); if (!nom) return;
    const c = $("#in-cible").value.trim();
    if (c && num(c) == null) { status("Inscris le prix cible en chiffres, par exemple 9,99."); return; }
    $("#in-surv").value = ""; $("#in-cible").value = ""; focusIfDesktop($("#in-surv"));
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
    $("#in-pnom").value = ""; $("#in-pformat").value = ""; focusIfDesktop($("#in-pnom"));
    if (await run(sb.from("produits").insert({ nom, format, categorie }))) scheduleReload("produits");
  });
  $("#in-search").addEventListener("input", (e) => { search = e.target.value; renderProducts(); });

  document.addEventListener("change", async (e) => {
    const c = e.target.closest("#app .check");
    if (c) {
      const it = state.liste.find((i) => i.id === c.dataset.id);
      if (it) local("epicerie", () => (it.fait = c.checked));
      await run(sb.from("epicerie").update({ fait: c.checked }).eq("id", c.dataset.id));
      // Acheté : on range dans la réserve de la maison (si le produit a un espace)
      const p = it && state.prod.find((x) => norm(x.nom) === norm(it.nom));
      if (p && p.espace_id) { const q = num(it.qte); await ajusterStock(p.id, (c.checked ? 1 : -1) * (q && q > 0 ? q : 1)); }
      return;
    }
    const nf = e.target.closest("[data-nfield]");
    if (nf) {
      const raw = nf.value.trim(), v = num(raw);
      if (raw !== "" && v == null) { status("Inscris un nombre, par exemple 2."); return; }
      await run(sb.from("produits").update({ [nf.dataset.nfield]: raw === "" ? null : v }).eq("id", nf.dataset.id));
      scheduleReload("produits"); return;
    }
    const en = e.target.closest("[data-espnom]");
    if (en) {
      const v = en.value.trim(); if (!v) return;
      await run(sb.from("espaces").update({ nom: v }).eq("id", en.dataset.espnom));
      scheduleReload("espaces"); return;
    }
    const pf = e.target.closest("[data-pfield]");
    if (pf) {
      let v = pf.value.trim(); if (pf.dataset.pfield === "nom" && !v) return;
      if (pf.dataset.pfield === "espace_id") v = v || null;
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
    const z = e.target.closest("[data-zoom]");
    if (z) { e.preventDefault(); zoom(z.dataset.zoom); return; }
    const sbt = e.target.closest("[data-stock]");
    if (sbt) { await ajusterStock(sbt.dataset.id, Number(sbt.dataset.stock)); return; }
    const mv = e.target.closest("[data-espmove]");
    if (mv) {
      const esp = espacesTries(); const i = esp.findIndex((x) => x.id === mv.dataset.id); const j = i + Number(mv.dataset.espmove);
      if (i < 0 || j < 0 || j >= esp.length) return;
      [esp[i], esp[j]] = [esp[j], esp[i]];
      esp.forEach((x, k) => (x.ordre = k + 1)); render();
      for (const [k, x] of esp.entries()) await run(sb.from("espaces").update({ ordre: k + 1 }).eq("id", x.id));
      return;
    }
    if (e.target.closest("#add-bas")) {
      const enListe = new Set(state.liste.filter((i) => !i.fait).map((i) => norm(i.nom)));
      const rows = state.prod.filter((p) => estBas(p) && !enListe.has(norm(p.nom))).map((p) => ({ nom: p.nom, ...(p.photo ? { photo: p.photo } : {}) }));
      if (rows.length && await run(sb.from("epicerie").insert(rows), `${rows.length} article${rows.length > 1 ? "s" : ""} ajouté${rows.length > 1 ? "s" : ""} à la liste.`)) scheduleReload("epicerie");
      return;
    }
    const pp = e.target.closest("[data-prodphoto]");
    if (pp) { prodPhotoTarget = pp.dataset.prodphoto; $("#in-prod-photo").click(); return; }
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
    helpFirstTime();
    await loadAll();
    subscribe();
  }
  let current, started = false;
  sb.auth.onAuthStateChange((evt, session) => {
    const email = (session && session.user && session.user.email) || null;
    if (started && email === current && evt !== "SIGNED_OUT") return;
    started = true;
    current = email;
    setTimeout(() => onSession(session), 0);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
