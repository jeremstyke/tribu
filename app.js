(() => {
  "use strict";

  const sb = window.supabase.createClient(window.TRIBU_CONFIG.supabaseUrl, window.TRIBU_CONFIG.supabaseKey);
  const $app = document.getElementById("app");

  const COLORS = ["#E4572E", "#F2A541", "#3FA34D", "#2E86AB", "#8E4585", "#E86A92", "#6C757D", "#17BEBB"];
  const EMOJIS = ["🙂", "😎", "🦁", "🐻", "🦊", "🐼", "🐣", "🌟", "⚽", "🎨", "🚀", "🦄"];
  const TYPES = {
    rdv:    { label: "Rendez-vous", ico: "📅" },
    tache:  { label: "Tâche",       ico: "✅" },
    sante:  { label: "Santé",       ico: "💊" },
    note:   { label: "Note",        ico: "📝" },
    taille: { label: "Taille",      ico: "📏" }
  };
  const SHOP_CATS = ["Fruits & légumes", "Frais", "Épicerie", "Bébé", "Hygiène", "Maison", "Autre"];

  const state = {
    session: null, household: null, me: null, members: [], memberships: [], passkeys: [],
    children: [], items: [], shopping: [], photos: [], logs: [], activities: [],
    filter: "all", channel: null, photoUrls: {}
  };

  // ---------- Utils ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (msg) => {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  };
  const childById = (id) => state.children.find((c) => c.id === id);
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const dayKey = (d) => startOfDay(d).toISOString();
  const fmtTime = (d) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (d) => {
    const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
    if (diff === 0) return "Aujourd'hui";
    if (diff === 1) return "Demain";
    if (diff === -1) return "Hier";
    const s = new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const age = (birth) => {
    if (!birth) return "";
    const b = new Date(birth), n = new Date();
    let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
    if (n.getDate() < b.getDate()) months--;
    if (months < 0) return "";
    if (months < 24) return months + " mois";
    return Math.floor(months / 12) + " ans";
  };
  const toLocalInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const errMsg = (e) => {
    const m = (e && e.message) || "";
    if (/Invalid login credentials/i.test(m)) return "Email ou mot de passe incorrect.";
    if (/Email not confirmed/i.test(m)) return "Confirme ton email avec le lien reçu, puis connecte-toi.";
    if (/already registered/i.test(m)) return "Un compte existe déjà avec cet email. Connecte-toi.";
    if (/Password should be/i.test(m)) return "Le mot de passe doit faire au moins 6 caractères.";
    if (/quota photos/i.test(m)) return "L'album de ta tribu est plein (100 photos). Supprime des photos pour en ajouter.";
    if (/code invalide/i.test(m)) return "Ce code ne correspond à aucune tribu. Vérifie-le.";
    return m || "Une erreur est survenue. Réessaie.";
  };

  // ---------- Invitation ----------
  const INVITE_KEY = "tribu_invite", HID_KEY = "tribu_hid";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} }
  };
  // Le code du lien est gardé de côté : il survit à la création de compte et à la confirmation d'email.
  (() => {
    const c = new URLSearchParams(location.search).get("code");
    if (c) { ls.set(INVITE_KEY, c.trim().toUpperCase().slice(0, 6)); history.replaceState(null, "", location.pathname + location.hash); }
  })();
  const pendingInvite = () => ls.get(INVITE_KEY);
  async function invitePreview(code) {
    const { data } = await sb.rpc("invite_preview", { p_code: code });
    return (data && data[0]) || null;
  }

  // ---------- Sheet (modal) ----------
  function openSheet(html, onMount) {
    closeSheet();
    const bd = document.createElement("div");
    bd.className = "sheet-backdrop";
    bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    bd.addEventListener("click", (e) => { if (e.target === bd) closeSheet(); });
    document.body.appendChild(bd);
    document.addEventListener("keydown", escClose);
    onMount && onMount(bd.querySelector(".sheet"));
    const f = bd.querySelector("input, select, textarea");
    if (f && window.matchMedia("(min-width: 700px)").matches) f.focus();
  }
  function escClose(e) { if (e.key === "Escape") closeSheet(); }
  function closeSheet() {
    document.querySelectorAll(".sheet-backdrop").forEach((n) => n.remove());
    document.removeEventListener("keydown", escClose);
  }

  // ---------- Data ----------
  async function loadHousehold() {
    const uid = state.session.user.id;
    const { data: mem } = await sb.from("members").select("household_id, display_name, role, households(name)").eq("user_id", uid).order("created_at");
    state.memberships = mem || [];
    loadPasskeys().then(() => { if (state.household && route()[0] === "reglages") render(); });
    if (!mem || !mem.length) { state.household = null; return; }
    state.me = mem.find((m) => m.household_id === ls.get(HID_KEY)) || mem[0];
    const hid = state.me.household_id;
    const [h, m] = await Promise.all([
      sb.from("households").select("*").eq("id", hid).single(),
      sb.from("members").select("user_id, display_name, role").eq("household_id", hid)
    ]);
    state.household = h.data;
    state.members = m.data || [];
    await loadAll();
    subscribe();
  }

  async function loadAll() {
    const hid = state.household.id;
    const since = new Date(Date.now() - 4 * 86400000).toISOString();
    const [c, i, s, ph, lg, ac] = await Promise.all([
      sb.from("children").select("*").eq("household_id", hid).order("created_at"),
      sb.from("items").select("*").eq("household_id", hid).order("due_at", { ascending: true, nullsFirst: false }),
      sb.from("shopping_items").select("*").eq("household_id", hid).order("created_at"),
      sb.from("photos").select("*").eq("household_id", hid).order("taken_on", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("logs").select("*").eq("household_id", hid).gte("at", since).order("at", { ascending: false }).limit(1000),
      sb.from("activities").select("*").eq("household_id", hid).order("start_time")
    ]);
    state.children = c.data || [];
    state.items = i.data || [];
    state.shopping = s.data || [];
    state.photos = ph.data || [];
    state.logs = lg.data || [];
    state.activities = ac.data || [];
    await loadPhotoUrls();
  }

  async function loadPhotoUrls() {
    const missing = [...state.children.map((c) => c.photo_path), ...state.photos.map((p) => p.path)].filter((p) => p && !state.photoUrls[p]);
    if (!missing.length) return;
    const { data } = await sb.storage.from("child-photos").createSignedUrls(missing, 60 * 60 * 24);
    (data || []).forEach((d) => { if (d.signedUrl) state.photoUrls[d.path] = d.signedUrl; });
  }
  const avatar = (c) => c.photo_path && state.photoUrls[c.photo_path]
    ? `<img src="${esc(state.photoUrls[c.photo_path])}" alt="">`
    : esc(c.emoji);

  // Redimensionne la photo côté téléphone avant envoi (600 px, JPEG) : rapide et léger.
  async function resizePhoto(file, max = 600) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * r), h = Math.round(bmp.height * r);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    return await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
  }

  function subscribe() {
    if (state.channel) sb.removeChannel(state.channel);
    const hid = state.household.id;
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { await loadAll(); render(); }, 250); };
    state.channel = sb.channel("tribu-" + hid);
    ["children", "items", "shopping_items", "photos", "logs", "activities"].forEach((table) => {
      state.channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${hid}` }, refresh);
    });
    state.channel.subscribe();
  }

  // ---------- Render router ----------
  function route() { return (location.hash || "#/accueil").slice(2).split("/"); }

  function render() {
    if (!state.session) return renderAuth();
    if (!state.household) return renderOnboarding();
    const [page, id] = route();
    let body = "";
    if (page === "enfants") body = viewChildren();
    else if (page === "enfant") body = viewChild(id);
    else if (page === "courses") body = viewShopping();
    else if (page === "reglages") body = viewSettings();
    else body = viewHome();
    const active = page === "enfant" ? "enfants" : (["enfants", "courses", "reglages"].includes(page) ? page : "accueil");
    const showFab = active === "accueil" || page === "enfant";
    $app.innerHTML = `
      <main class="wrap">${body}</main>
      ${showFab ? `<button class="fab" id="fab" aria-label="Ajouter un élément">+</button>` : ""}
      <nav class="nav" aria-label="Navigation"><ul>
        ${navLink("accueil", "🏠", "Accueil", active)}
        ${navLink("enfants", "👧", "Enfants", active)}
        ${navLink("courses", "🛒", "Courses", active)}
        ${navLink("reglages", "⚙️", "Tribu", active)}
      </ul></nav>`;
    bindCommon();
  }
  const navLink = (key, ico, label, active) =>
    `<li><a href="#/${key}" ${active === key ? 'aria-current="page"' : ""}><span class="ico" aria-hidden="true">${ico}</span>${label}</a></li>`;

  // ---------- Auth (Face ID / empreinte, ou mot de passe) ----------
  const PK = window.SimpleWebAuthnBrowser;
  const pkSupported = () => !!(window.PublicKeyCredential && PK && PK.browserSupportsWebAuthn());
  const bioLabel = () => { const e = detectEnv(); return e.ios ? "Face ID" : e.android ? "l'empreinte" : "une clé d'accès"; };
  const deviceName = () => { const e = detectEnv(); return e.ios ? "iPhone / iPad" : e.android ? "Android" : "Ordinateur"; };

  async function pkCall(body) {
    const { data, error } = await sb.functions.invoke("passkey", { body: { ...body, device: deviceName() } });
    if (error) {
      let j = {};
      try { j = await error.context.json(); } catch (_) {}
      throw new Error(j.error || "server");
    }
    return data;
  }
  async function finishLogin(token_hash) {
    let r = await sb.auth.verifyOtp({ token_hash, type: "magiclink" });
    if (r.error) r = await sb.auth.verifyOtp({ token_hash, type: "email" });
    if (r.error) throw r.error;
  }
  async function passkeyLogin() {
    const o = await pkCall({ action: "login-options" });
    const response = await PK.startAuthentication({ optionsJSON: o.options });
    const r = await pkCall({ action: "login-verify", challengeId: o.challengeId, response });
    await finishLogin(r.token_hash);
  }
  async function passkeySignup(email) {
    const o = await pkCall({ action: "register-options", email });
    const response = await PK.startRegistration({ optionsJSON: o.options });
    const r = await pkCall({ action: "register-verify", challengeId: o.challengeId, response });
    await finishLogin(r.token_hash);
  }
  async function passkeyAdd() {
    const o = await pkCall({ action: "register-options", mode: "add" });
    const response = await PK.startRegistration({ optionsJSON: o.options });
    await pkCall({ action: "register-verify", challengeId: o.challengeId, response });
    await loadPasskeys();
  }
  async function loadPasskeys() {
    const { data } = await sb.from("passkey_credentials").select("id, device, created_at, last_used_at").order("created_at");
    state.passkeys = data || [];
  }
  function pkError(e) {
    const n = (e && (e.name || "")) + " " + ((e && e.message) || "");
    if (/NotAllowedError|AbortError|cancel/i.test(n)) return "Opération annulée. Réessaie quand tu veux.";
    if (/InvalidStateError|excluded|previously registered/i.test(n)) return "Cet appareil est déjà enregistré pour ce compte.";
    if (/exists/.test(n)) return "Un compte existe déjà avec cet email. Connecte-toi avec " + bioLabel() + " ou ton mot de passe.";
    if (/unknown_passkey/.test(n)) return "Cette clé n'est plus reconnue. Connecte-toi avec ton mot de passe, puis réactive " + bioLabel() + " dans l'onglet Tribu.";
    if (/expired/.test(n)) return "Le délai a expiré. Réessaie.";
    if (/invalid_email/.test(n)) return "Cette adresse email n'est pas valide.";
    if (/weak_password/.test(n)) return "Le mot de passe doit faire au moins 6 caractères.";
    if (/NotSupportedError|SecurityError/i.test(n)) return "Ce navigateur ne permet pas " + bioLabel() + ". Ouvre Tribu dans Safari ou Chrome, ou utilise un mot de passe.";
    return errMsg(e);
  }

  function renderAuth(mode) {
    const invite = pendingInvite();
    const pk = pkSupported();
    mode = mode || (invite ? "signup" : "home");
    if (!pk && mode === "home") mode = "login-pwd";
    if (!pk && mode === "signup") mode = "signup-pwd";
    const bio = bioLabel();

    let card = "";
    if (mode === "home") card = `
      <div class="card">
        <button class="btn block" id="pk-login">Se connecter avec ${bio}</button>
        <button class="btn ghost block" style="margin-top:10px" id="go-signup">Créer un compte</button>
        <button class="link small" id="go-pwd">Se connecter avec un mot de passe</button>
        <div id="err" class="error" hidden></div>
      </div>`;
    if (mode === "signup") card = `
      <form class="card" id="f-signup" novalidate>
        <h3>Créer un compte</h3>
        <p class="muted small" style="margin:4px 0 0">Pas de mot de passe à retenir : tu te connecteras avec ${bio}.</p>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required>
        <div id="err" class="error" hidden></div>
        <button class="btn block" style="margin-top:18px" type="submit">Créer mon compte avec ${bio}</button>
        <button class="link small" type="button" id="go-signup-pwd">Créer un compte avec un mot de passe</button>
        <button class="link small" type="button" id="go-home">J'ai déjà un compte</button>
      </form>`;
    if (mode === "signup-pwd" || mode === "login-pwd") {
      const isLogin = mode === "login-pwd";
      card = `
      <form class="card" id="f-pwd" novalidate>
        <h3>${isLogin ? "Se connecter" : "Créer un compte"}</h3>
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="${isLogin ? "username" : "email"}" required>
        <label for="pwd">Mot de passe</label>
        <input id="pwd" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" minlength="6" required>
        <div id="err" class="error" hidden></div>
        <button class="btn block" style="margin-top:18px" type="submit">${isLogin ? "Se connecter" : "Créer mon compte"}</button>
        ${isLogin ? `<button class="link small" type="button" id="forgot">Mot de passe oublié</button>` : ""}
        <button class="link small" type="button" id="${isLogin ? "go-signup" : "go-home"}">${isLogin ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}</button>
        ${pk ? `<button class="link small" type="button" id="go-home2">Utiliser ${bio}</button>` : ""}
      </form>`;
    }

    $app.innerHTML = `
      <div class="hero">
        <div class="dots" aria-hidden="true">${COLORS.slice(0, 5).map((c) => `<i style="--c:${c}"></i>`).join("")}</div>
        <h1>Tribu</h1>
        <p class="lead">Les enfants, les rendez-vous et les courses de toute la famille, au même endroit et à jour pour chaque parent.</p>
        <div id="invite-banner"></div>
        ${card}
        ${!isStandalone() ? `<button class="link" type="button" data-install-help style="margin-top:14px">📲 Comment installer Tribu sur mon téléphone</button>` : ""}
      </div>`;

    const err = document.getElementById("err");
    const showErr = (m) => { err.hidden = false; err.textContent = m; };
    const go = (id, m) => { const b = document.getElementById(id); if (b) b.onclick = () => renderAuth(m); };
    go("go-signup", "signup"); go("go-pwd", "login-pwd"); go("go-signup-pwd", "signup-pwd"); go("go-home", pk ? "home" : "login-pwd"); go("go-home2", "home");
    $app.querySelectorAll("[data-install-help]").forEach((b) => b.onclick = installSheet);
    if (invite) invitePreview(invite).then((pv) => {
      const b = document.getElementById("invite-banner"); if (!b || !pv) return;
      b.innerHTML = `<div class="invite-banner"><strong>${esc(pv.inviter || "Un parent")} t'invite à rejoindre ${esc(pv.household_name)}</strong><br>Crée ton compte (ou connecte-toi) pour retrouver les enfants, les rendez-vous et les courses de la famille.</div>`;
    });

    const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = label; };

    const pkl = document.getElementById("pk-login");
    if (pkl) pkl.onclick = async () => {
      err.hidden = true; busy(pkl, true);
      try { await passkeyLogin(); } catch (e) { showErr(pkError(e)); } finally { busy(pkl, false); }
    };

    const fs = document.getElementById("f-signup");
    if (fs) fs.onsubmit = async (e) => {
      e.preventDefault(); err.hidden = true;
      const email = document.getElementById("email").value.trim();
      if (!email) return showErr("Saisis ton email.");
      const btn = fs.querySelector("button[type=submit]"); busy(btn, true);
      try { await passkeySignup(email); } catch (ex) { showErr(pkError(ex)); } finally { busy(btn, false); }
    };

    const fp = document.getElementById("f-pwd");
    if (fp) {
      const isLogin = mode === "login-pwd";
      const forgot = document.getElementById("forgot");
      if (forgot) forgot.onclick = async () => {
        const email = document.getElementById("email").value.trim();
        if (!email) return showErr("Saisis ton email puis appuie à nouveau sur Mot de passe oublié.");
        await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        toast("Si un compte existe, un email a été envoyé");
      };
      fp.onsubmit = async (e) => {
        e.preventDefault(); err.hidden = true;
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("pwd").value;
        const btn = fp.querySelector("button[type=submit]"); busy(btn, true);
        try {
          if (!isLogin) await pkCall({ action: "signup-password", email, password });
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } catch (ex) { showErr(isLogin ? errMsg(ex) : pkError(ex)); }
        finally { busy(btn, false); }
      };
    }
  }

  // ---------- Onboarding ----------
  function renderOnboarding(mode = "create") {
    const create = mode === "create";
    $app.innerHTML = `
      <div class="hero">
        <h1>${create ? "Ta tribu" : "Rejoindre"}</h1>
        <p class="lead">${create ? "Crée l'espace de ta famille, puis invite l'autre parent avec un code." : "Saisis le code reçu pour rejoindre la tribu de ta famille."}</p>
        <form class="card" id="onb">
          <label for="dn">Ton prénom</label>
          <input id="dn" required maxlength="40" autocomplete="given-name" placeholder="Ex : Camille">
          ${create
            ? `<label for="hn">Nom de la tribu</label><input id="hn" required maxlength="60" placeholder="Ex : Famille Martin">`
            : `<label for="code">Code d'invitation</label><input id="code" required maxlength="6" style="text-transform:uppercase;letter-spacing:.15em;font-weight:700" placeholder="ABC123">`}
          <div id="err" class="error" hidden></div>
          <button class="btn block" style="margin-top:18px" type="submit">${create ? "Créer la tribu" : "Rejoindre la tribu"}</button>
          <button class="link" type="button" id="switch">${create ? "J'ai un code d'invitation" : "Créer une nouvelle tribu"}</button>
          <button class="link small muted" type="button" id="logout">Se déconnecter</button>
        </form>
      </div>`;
    document.getElementById("switch").onclick = () => renderOnboarding(create ? "join" : "create");
    document.getElementById("logout").onclick = () => sb.auth.signOut();
    document.getElementById("onb").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("err"); err.hidden = true;
      const dn = document.getElementById("dn").value.trim();
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const rpc = create
          ? sb.rpc("create_household", { p_name: document.getElementById("hn").value.trim(), p_display_name: dn })
          : sb.rpc("join_household", { p_code: document.getElementById("code").value.trim(), p_display_name: dn });
        const { data: newHid, error } = await rpc;
        if (error) throw error;
        ls.set(HID_KEY, newHid);
        history.replaceState(null, "", location.pathname + "#/accueil");
        await loadHousehold();
        render();
        toast(create ? "Tribu créée" : "Bienvenue dans la tribu");
      } catch (ex) { err.hidden = false; err.textContent = errMsg(ex); }
      finally { btn.disabled = false; }
    };
  }

  function renderJoinInvite(code, pv) {
    const already = !!state.household;
    $app.innerHTML = `
      <div class="hero">
        <div class="dots" aria-hidden="true">${COLORS.slice(0, 5).map((c) => `<i style="--c:${c}"></i>`).join("")}</div>
        <h1>${esc(pv.household_name)}</h1>
        <p class="lead">${esc(pv.inviter || "Un parent")} t'invite à partager l'organisation de la famille : enfants, rendez-vous, album et courses, synchronisés entre vous en temps réel.</p>
        <form class="card" id="ji">
          <label for="ji-dn">Ton prénom</label>
          <input id="ji-dn" required maxlength="40" autocomplete="given-name" value="${esc(state.me ? state.me.display_name : "")}" placeholder="Ex : Camille">
          ${already ? `<p class="muted small">Tu passeras sur cette tribu. ${esc(state.household.name)} reste accessible depuis l'onglet Tribu.</p>` : ""}
          <div id="err" class="error" hidden></div>
          <button class="btn block" style="margin-top:18px" type="submit">Rejoindre ${esc(pv.household_name)}</button>
          <button class="link" type="button" id="ji-no">Non merci</button>
        </form>
      </div>`;
    document.getElementById("ji-no").onclick = () => { ls.set(INVITE_KEY, null); render(); };
    document.getElementById("ji").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("err"); err.hidden = true;
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      const { data: hid, error } = await sb.rpc("join_household", { p_code: code, p_display_name: document.getElementById("ji-dn").value.trim() });
      if (error) { btn.disabled = false; err.hidden = false; err.textContent = errMsg(error); return; }
      ls.set(INVITE_KEY, null); ls.set(HID_KEY, hid);
      history.replaceState(null, "", location.pathname + "#/accueil");
      await loadHousehold(); render();
      toast("Bienvenue dans " + pv.household_name);
      if (!isStandalone()) setTimeout(installSheet, 900);
    };
  }

  async function afterLogin() {
    await loadHousehold();
    const code = pendingInvite();
    if (code) {
      const pv = await invitePreview(code);
      if (!pv) { ls.set(INVITE_KEY, null); toast("Ce lien d'invitation n'est plus valide."); }
      else if (state.household && state.household.invite_code === code) ls.set(INVITE_KEY, null);
      else return renderJoinInvite(code, pv);
    }
    render();
  }

  // ---------- Views ----------
  function chipsHtml(withAdd = true) {
    const all = `<button class="chip" data-filter="all" aria-pressed="${state.filter === "all"}"><div class="bubble" style="--c:var(--line)">👪</div><span>Tous</span></button>`;
    const kids = state.children.map((c) =>
      `<button class="chip" data-filter="${c.id}" aria-pressed="${state.filter === c.id}"><div class="bubble" style="--c:${esc(c.color)}">${avatar(c)}</div><span>${esc(c.first_name)}</span></button>`).join("");
    const add = withAdd ? `<button class="chip add" id="add-child"><div class="bubble">+</div><span>Enfant</span></button>` : "";
    return `<div class="chips" role="group" aria-label="Filtrer par enfant">${all}${kids}${add}</div>`;
  }

  function itemHtml(it, showDate = false) {
    const child = childById(it.child_id);
    const color = child ? child.color : "var(--ink-soft)";
    const t = TYPES[it.type];
    const who = child ? child.first_name : "Toute la famille";
    const time = it.due_at ? (showDate ? new Date(it.due_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " " : "") + fmtTime(it.due_at) : "";
    const checkable = it.type === "tache" || it.type === "rdv";
    return `
      <div class="item ${it.done ? "done" : ""}" style="--c:${esc(color)}">
        <div class="tab"></div>
        <div class="body" data-edit="${it.id}" role="button" tabindex="0">
          <div class="line1">${time ? `<span class="time">${esc(time)}</span>` : ""}<span class="title">${t.ico} ${esc(it.title)}</span></div>
          <div class="meta">${esc(who)} · ${t.label}${it.details ? " · " + esc(it.details.slice(0, 60)) : ""}</div>
        </div>
        ${checkable ? `<button class="check" data-toggle="${it.id}" aria-label="${it.done ? "Marquer comme non fait" : "Marquer comme fait"}"><i>${it.done ? "✓" : ""}</i></button>` : ""}
      </div>`;
  }

  function viewHome() {
    const now = new Date();
    const today = startOfDay(now);
    const horizon = new Date(today.getTime() + 14 * 86400000);
    const f = (it) => state.filter === "all" || it.child_id === state.filter;
    const items = state.items.filter(f);

    const overdue = items.filter((it) => it.type === "tache" && !it.done && it.due_at && new Date(it.due_at) < today);
    const upcoming = items.filter((it) => it.due_at && new Date(it.due_at) >= today && new Date(it.due_at) < horizon && it.type !== "taille");
    const todo = items.filter((it) => it.type === "tache" && !it.done && !it.due_at);

    const groups = {};
    upcoming.forEach((it) => { (groups[dayKey(it.due_at)] ||= []).push(it); });
    state.activities.filter((a) => state.filter === "all" || a.child_id === state.filter).forEach((a) => {
      occurrences(a, today, new Date(horizon.getTime() - 1)).forEach((o) => { (groups[dayKey(o.start)] ||= []).push({ occ: o, sortAt: o.start }); });
    });
    Object.values(groups).forEach((l) => l.sort((x, y) => new Date(x.sortAt || x.due_at) - new Date(y.sortAt || y.due_at)));
    const keys = Object.keys(groups).sort();
    if (!keys.includes(today.toISOString())) keys.unshift(today.toISOString());

    const shopLeft = state.shopping.filter((s) => !s.checked).length;
    const dateStr = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

    let html = `
      <header class="top"><div><h1>${esc(state.household.name)}</h1><div class="date">${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}</div></div></header>
      ${chipsHtml()}
      ${!isStandalone() && !ls.get("tribu_install_hidden") ? `<div class="install-banner">
        <span class="ib-ico" aria-hidden="true">📲</span>
        <div class="ib-text"><strong>Installe Tribu</strong><br><span class="small">Elle s'ouvrira comme une vraie app depuis ton écran d'accueil.</span></div>
        <button class="btn" data-install-help>Voir comment</button>
        <button class="ib-close" id="install-dismiss" aria-label="Masquer">×</button>
      </div>` : ""}
      ${(isStandalone() || ls.get("tribu_install_hidden")) && pkSupported() && !state.passkeys.length && !ls.get("tribu_pk_hidden") ? `<div class="install-banner">
        <span class="ib-ico" aria-hidden="true">🔐</span>
        <div class="ib-text"><strong>Connexion avec ${bioLabel()}</strong><br><span class="small">Plus besoin de mot de passe sur ce téléphone.</span></div>
        <button class="btn" id="pk-add">Activer</button>
        <button class="ib-close" id="pk-dismiss" aria-label="Masquer">×</button>
      </div>` : ""}`;

    state.children.filter((c) => (state.filter === "all" || state.filter === c.id) && ["bebe", "petit"].includes(ageBand(c))).forEach((c) => {
      html += `<section class="baby-card" style="--c:${esc(c.color)}">
        <div class="bc-head"><div class="bubble" aria-hidden="true">${avatar(c)}</div><a href="#/enfant/${c.id}" class="bc-name">${esc(c.first_name)}</a><button class="btn" data-log-pick="${c.id}">+ Noter</button></div>
        ${statsHtml(babyStats(c)) || `<p class="muted small" style="margin:8px 0 0">Note biberons, couches et dodos d'un geste avec + Noter.</p>`}
      </section>`;
    });

    if (!state.children.length) {
      html += `<div class="empty"><strong>Ajoute ton premier enfant</strong><br>Chaque enfant a sa couleur : ses rendez-vous, tâches et infos santé apparaîtront ici.<br><button class="btn" id="add-child-empty">Ajouter un enfant</button></div>`;
    }

    if (overdue.length) html += `<section class="day"><div class="day-title" style="color:var(--danger)">En retard</div>${overdue.map((i) => itemHtml(i, true)).join("")}</section>`;

    keys.forEach((k) => {
      const list = groups[k] || [];
      const isToday = k === today.toISOString();
      html += `<section class="day"><div class="day-title ${isToday ? "today" : ""}">${fmtDay(k)}</div>
        ${list.length ? list.map((i) => i.occ ? occHtml(i.occ) : itemHtml(i)).join("") : `<p class="muted small">Rien de prévu. Appuie sur + pour ajouter un rendez-vous ou une tâche.</p>`}</section>`;
    });

    if (todo.length) html += `<section class="day"><div class="day-title">À faire, sans date</div>${todo.map((i) => itemHtml(i)).join("")}</section>`;

    html += `<section class="day"><a href="#/courses" class="item" style="--c:var(--accent);text-decoration:none;color:inherit"><div class="tab"></div><div class="body"><div class="title">🛒 Courses</div><div class="meta">${shopLeft ? shopLeft + " article" + (shopLeft > 1 ? "s" : "") + " à acheter" : "La liste est vide"}</div></div></a></section>`;
    return html;
  }

  function viewChildren() {
    let html = `<header class="top"><h1>Enfants</h1></header>`;
    if (!state.children.length) {
      return html + `<div class="empty"><strong>Aucun enfant pour l'instant</strong><br>Ajoute chaque enfant pour suivre ses rendez-vous, sa santé et ses tailles.<br><button class="btn" id="add-child-empty">Ajouter un enfant</button></div>`;
    }
    html += state.children.map((c) => {
      const n = state.items.filter((i) => i.child_id === c.id && i.due_at && new Date(i.due_at) >= startOfDay(new Date()) && !i.done).length;
      return `<a href="#/enfant/${c.id}" class="item" style="--c:${esc(c.color)};text-decoration:none;color:inherit">
        <div class="tab"></div>
        <div class="body" style="display:flex;align-items:center;gap:14px">
          <div class="bubble" style="width:48px;height:48px;border-radius:50%;background:${esc(c.color)};display:grid;place-items:center;font-size:1.5rem;flex:0 0 auto;overflow:hidden">${avatar(c)}</div>
          <div><div class="title">${esc(c.first_name)}</div><div class="meta">${[age(c.birth_date), n ? n + " à venir" : ""].filter(Boolean).join(" · ") || "Aucun élément à venir"}</div></div>
        </div></a>`;
    }).join("");
    html += `<button class="btn ghost block" style="margin-top:14px" id="add-child-empty">Ajouter un enfant</button>`;
    return html;
  }

  function viewChild(id) {
    const c = childById(id);
    if (!c) { location.hash = "#/enfants"; return ""; }
    const items = state.items.filter((i) => i.child_id === id);
    let html = `
      <button class="back" onclick="history.length > 1 ? history.back() : (location.hash='#/enfants')">‹ Enfants</button>
      <div class="child-head"><div class="bubble" style="--c:${esc(c.color)}">${avatar(c)}</div>
        <div><h1>${esc(c.first_name)}</h1><div class="muted">${BAND_LABEL[ageBand(c)]} · ${age(c.birth_date) || "nouveau-né"}</div></div></div>
      <div class="row" style="margin-top:8px"><button class="btn ghost" id="edit-child" data-id="${c.id}">Modifier</button><button class="btn" id="add-for-child" data-id="${c.id}">Ajouter</button></div>
      <button class="btn ghost block" style="margin-top:10px" data-cal="${c.id}">📆 Synchroniser avec mon calendrier</button>`;
    const band = ageBand(c);
    if (band === "bebe" || band === "petit") {
      html += `<h2>Noter</h2>${quickGrid(c)}${statsHtml(babyStats(c))}<h2>Journal</h2>${journalHtml(c)}`;
    } else {
      html += `<h2>Santé rapide</h2>${quickGrid(c)}${statsHtml(babyStats(c))}${childLogs(c.id).length ? `<h2>Journal</h2>${journalHtml(c)}` : ""}`;
    }
    const acts = state.activities.filter((a) => a.child_id === id);
    html += `<h2>🎯 Activités</h2>
      ${acts.map((a) => `<div class="item" style="--c:${esc(c.color)}"><div class="tab"></div><div class="body" data-act="${a.id}" role="button" tabindex="0">
        <div class="line1"><span class="title">${esc(a.emoji)} ${esc(a.name)}</span></div>
        <div class="meta">${esc(actSchedule(a))}${a.location ? " · " + esc(a.location) : ""}${a.end_date ? " · jusqu'au " + parseYmd(a.end_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</div></div></div>`).join("")}
      <button class="btn ghost block" data-act-add="${c.id}">Ajouter une activité</button>`;
    const album = state.photos.filter((p) => p.child_id === id);
    html += `<h2>📸 Album</h2>
      <div class="album">
        <button class="album-add" data-album-add="${c.id}" aria-label="Ajouter une photo à l'album"><span>+</span>Photo</button>
        ${album.map((p) => `<button class="album-cell" data-photo="${p.id}" aria-label="Voir la photo du ${new Date(p.taken_on).toLocaleDateString("fr-FR")}">
          ${state.photoUrls[p.path] ? `<img src="${esc(state.photoUrls[p.path])}" alt="" loading="lazy">` : ""}
          ${p.note ? `<span class="album-note">${esc(p.note)}</span>` : ""}</button>`).join("")}
      </div>
      ${album.length ? "" : `<p class="muted small">Ajoute des photos avec une petite note pour garder ses souvenirs : premiers pas, anniversaires, sorties...</p>`}`;
    Object.entries(TYPES).forEach(([type, t]) => {
      let list = items.filter((i) => i.type === type);
      if (type === "rdv" || type === "tache") list = list.sort((a, b) => (a.done - b.done) || ((a.due_at || "9") > (b.due_at || "9") ? 1 : -1));
      html += `<h2>${t.ico} ${t.label}${type === "taille" ? "s" : type === "note" ? "s" : ""}</h2>`;
      html += list.length ? list.map((i) => itemHtml(i, true)).join("") : `<p class="muted small">Rien pour l'instant.</p>`;
    });
    return html;
  }

  function viewShopping() {
    let html = `<header class="top"><h1>Courses</h1></header>
      <form class="add-bar" id="shop-add">
        <input id="shop-name" placeholder="Ajouter un article" maxlength="100" aria-label="Article" autocomplete="off">
        <select id="shop-cat" aria-label="Rayon">${SHOP_CATS.map((c) => `<option>${c}</option>`).join("")}</select>
        <button class="btn" type="submit" aria-label="Ajouter">+</button>
      </form>`;
    if (!state.shopping.length) return html + `<div class="empty"><strong>La liste est vide</strong><br>Ajoute un article : il apparaît aussitôt chez chaque membre de la tribu.</div>`;
    const left = state.shopping.filter((s) => !s.checked);
    const done = state.shopping.filter((s) => s.checked);
    SHOP_CATS.forEach((cat) => {
      const list = left.filter((s) => s.category === cat);
      if (list.length) html += `<h2>${cat}</h2>${list.map(shopHtml).join("")}`;
    });
    if (done.length) {
      html += `<h2 class="muted">Dans le panier</h2>${done.map(shopHtml).join("")}
        <button class="btn ghost block" style="margin-top:12px" id="shop-clear">Vider le panier (${done.length})</button>`;
    }
    return html;
  }
  const shopHtml = (s) => `<div class="shop ${s.checked ? "done" : ""}">
      <button class="check" data-shop="${s.id}" aria-label="${s.checked ? "Remettre dans la liste" : "Mettre dans le panier"}"><i>${s.checked ? "✓" : ""}</i></button>
      <span class="name">${esc(s.name)}</span>
      <button class="del" data-shop-del="${s.id}" aria-label="Supprimer ${esc(s.name)}">×</button></div>`;

  function viewSettings() {
    const link = location.origin + location.pathname + "?code=" + state.household.invite_code;
    return `<header class="top"><h1>Tribu</h1></header>
      <div class="card">
        <h3>Inviter l'autre parent</h3>
        <p class="muted small">Envoie-lui ce lien : il crée son compte et rejoint directement ${esc(state.household.name)}. Vous verrez tous les deux les mêmes enfants, rendez-vous, photos et courses, en temps réel.</p>
        <button class="btn block" id="share" data-link="${esc(link)}">Envoyer le lien d'invitation</button>
        <p class="muted small" style="margin:14px 0 0">Ou donne-lui ce code, à saisir dans l'app :</p>
        <div class="code">${esc(state.household.invite_code)}</div>
      </div>
      <h2>Calendrier</h2>
      <div class="card">
        <p class="muted small" style="margin-top:0">Abonne ton calendrier à toute la tribu : les rendez-vous et éléments datés de tous les enfants s'y affichent et se mettent à jour tout seuls. Chaque enfant a aussi son propre calendrier depuis sa fiche.</p>
        <button class="btn block" data-cal="all">📆 Synchroniser toute la famille</button>
        ${state.me && state.me.role === "owner" ? `<button class="link small" id="cal-reset">Désactiver les anciens liens et en créer de nouveaux</button>` : ""}
      </div>
      <h2>Membres</h2>
      <div class="card">${state.members.map((m) => `<div class="member"><span>${esc(m.display_name)}${m.user_id === state.session.user.id ? " (toi)" : ""}</span><span class="muted small">${m.role === "owner" ? "Créateur" : "Parent"}</span></div>`).join("")}</div>
      ${!isStandalone() ? `<h2>Application</h2><div class="card"><p class="muted small" style="margin-top:0">Installe Tribu sur ton écran d'accueil : elle s'ouvre comme une vraie application, en plein écran, sans passer par le navigateur.</p><button class="btn block" data-install-help>📲 Installer Tribu sur mon téléphone</button></div>` : ""}
      ${state.memberships.length > 1 ? `<h2>Mes tribus</h2><div class="card">${state.memberships.map((m) => `<div class="member"><span>${esc(m.households ? m.households.name : "Tribu")}</span>${m.household_id === state.household.id ? `<span class="muted small">Actuelle</span>` : `<button class="link small" style="padding:0" data-switch="${m.household_id}">Ouvrir</button>`}</div>`).join("")}</div>` : ""}
      ${pkSupported() ? `<h2>Connexion avec ${bioLabel()}</h2>
      <div class="card">
        ${state.passkeys.length ? state.passkeys.map((k) => `<div class="member"><span>🔐 ${esc(k.device || "Appareil")}<br><span class="muted small">Ajoutée le ${new Date(k.created_at).toLocaleDateString("fr-FR")}${k.last_used_at ? ", utilisée " + ago(k.last_used_at) : ""}</span></span><button class="link small" style="padding:0" data-pk-del="${esc(k.id)}">Retirer</button></div>`).join("")
          : `<p class="muted small" style="margin-top:0">Connecte-toi d'un regard ou d'un doigt, sans mot de passe à retenir.</p>`}
        <button class="btn ${state.passkeys.length ? "ghost " : ""}block" style="margin-top:10px" id="pk-add">${state.passkeys.length ? "Ajouter cet appareil" : "Activer " + bioLabel()}</button>
      </div>` : ""}
      <h2>Compte</h2>
      <p class="muted small">${esc(state.session.user.email)}</p>
      <button class="btn ghost block" id="change-pwd">Changer mon mot de passe</button>
      <button class="btn ghost block" style="margin-top:10px" id="logout">Se déconnecter</button>
      <button class="btn danger block" style="margin-top:10px" id="leave">Quitter la tribu</button>`;
  }

  // ---------- Calendrier ----------
  function calSheet(childId) {
    const child = childId !== "all" ? childById(childId) : null;
    const https = `${window.TRIBU_CONFIG.supabaseUrl}/functions/v1/calendar?token=${state.household.calendar_token}${child ? "&child=" + child.id : ""}`;
    const webcal = https.replace(/^https:/, "webcal:");
    const google = "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(webcal);
    openSheet(`
      <h2 style="margin-top:0">Calendrier ${child ? "de " + esc(child.first_name) : "de la famille"}</h2>
      <p class="muted">Les rendez-vous, tâches, soins et notes datés ${child ? "de " + esc(child.first_name) : "de toute la tribu"} apparaîtront dans ton calendrier, avec un rappel 1 h avant chaque rendez-vous.</p>
      <a class="btn block" href="${esc(webcal)}">Ajouter au calendrier de l'iPhone</a>
      <a class="btn block" style="margin-top:10px" href="${esc(google)}" target="_blank" rel="noopener">Ajouter à Google Agenda (Android)</a>
      <button class="btn ghost block" style="margin-top:10px" id="cal-copy">Copier le lien</button>
      <p class="muted small" style="margin-top:14px">Les mises à jour arrivent automatiquement : en moins d'une heure sur iPhone, parfois quelques heures sur Google Agenda. Ce lien est personnel à ta tribu, ne le publie pas.</p>`, (el) => {
      el.querySelector("#cal-copy").onclick = async () => { await navigator.clipboard.writeText(https); toast("Lien copié"); };
    });
  }

  // ---------- Installation ----------
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function detectEnv() {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /android/i.test(ua);
    // Navigateurs intégrés (WhatsApp, Telegram, Messenger, Instagram...) : installation impossible
    const inApp = /FBAN|FBAV|Instagram|Line\/|Telegram|WhatsApp|Snapchat|; wv\)/i.test(ua) || (ios && !/Safari\//.test(ua));
    const iosOther = ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const samsung = /SamsungBrowser/i.test(ua);
    return { ios, android, inApp, iosOther, samsung };
  }
  const SHARE_ICON = `<svg class="ico-inline" viewBox="0 0 24 24" aria-label="icône Partager"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const steps = (list) => `<ol class="steps">${list.map((x) => `<li><span>${x}</span></li>`).join("")}</ol>`;

  function installSheet() {
    const env = detectEnv();
    let body = "";
    if (env.inApp) {
      body = `<p>Tu as ouvert Tribu depuis une autre application (WhatsApp, Telegram, Messenger...). Elle ne permet pas d'installer Tribu.</p>
        ${steps([
          `Appuie sur le menu de cette page (<strong>⋯</strong> ou <strong>⋮</strong>, souvent en haut à droite).`,
          `Choisis <strong>Ouvrir dans ${env.ios ? "Safari" : "Chrome"}</strong> (ou "Ouvrir dans le navigateur").`,
          `Appuie à nouveau sur "Installer Tribu" et suis les étapes.`
        ])}
        <button class="btn ghost block" id="copy-url">Copier l'adresse de Tribu</button>
        <p class="muted small">Tu peux aussi la coller dans ${env.ios ? "Safari" : "Chrome"}.</p>`;
    } else if (env.ios) {
      body = `${env.iosOther ? `<p class="muted small">Le plus simple est d'utiliser <strong>Safari</strong>. Dans ce navigateur, l'option se trouve aussi dans le bouton Partager.</p>` : ""}
        ${steps([
          `Appuie sur le bouton <strong>Partager</strong> ${SHARE_ICON} ${env.iosOther ? "dans la barre d'adresse" : "en bas de l'écran (ou en haut sur iPad)"}.`,
          `Fais défiler et appuie sur <strong>Sur l'écran d'accueil</strong>.`,
          `Appuie sur <strong>Ajouter</strong> en haut à droite.`,
          `Ouvre Tribu depuis la nouvelle icône sur ton écran d'accueil.`
        ])}
        <p class="muted small">Dans l'app installée, connecte-toi une fois avec ton email : ta tribu et toutes ses données seront là.</p>`;
    } else if (env.android) {
      body = `${state.installPrompt ? `<button class="btn block" id="install-now">Installer maintenant</button><p class="muted small" style="text-align:center">ou manuellement :</p>` : ""}
        ${steps(env.samsung ? [
          `Appuie sur le menu <strong>≡</strong> en bas à droite.`,
          `Choisis <strong>Ajouter la page à</strong>, puis <strong>Écran d'accueil</strong>.`,
          `Ouvre Tribu depuis la nouvelle icône.`
        ] : [
          `Appuie sur le menu <strong>⋮</strong> en haut à droite de Chrome.`,
          `Choisis <strong>Installer l'application</strong> (ou <strong>Ajouter à l'écran d'accueil</strong>).`,
          `Confirme avec <strong>Installer</strong>, puis ouvre Tribu depuis la nouvelle icône.`
        ])}`;
    } else {
      body = `${state.installPrompt ? `<button class="btn block" id="install-now">Installer maintenant</button>` : ""}
        <p>Sur ordinateur, avec Chrome ou Edge : clique sur l'icône d'installation à droite de la barre d'adresse, puis sur <strong>Installer</strong>.</p>
        <p class="muted small">Sur ton téléphone, ouvre ${esc(location.origin + location.pathname)} et appuie sur "Installer Tribu".</p>`;
    }
    openSheet(`<h2 style="margin-top:0">Installer Tribu</h2>${body}
      <button class="btn ghost block" style="margin-top:14px" id="install-close">J'ai compris</button>`, (el) => {
      el.querySelector("#install-close").onclick = closeSheet;
      const now = el.querySelector("#install-now");
      if (now) now.onclick = async () => { state.installPrompt.prompt(); await state.installPrompt.userChoice.catch(() => {}); state.installPrompt = null; closeSheet(); render(); };
      const cp = el.querySelector("#copy-url");
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname); toast("Adresse copiée"); } catch (_) { toast(location.origin + location.pathname); } };
    });
  }

  // ---------- Journal (suivi selon l'âge) ----------
  const ageMonths = (birth) => {
    const b = new Date(birth), n = new Date();
    let m = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
    if (n.getDate() < b.getDate()) m--;
    return Math.max(0, m);
  };
  const BAND_LABEL = { bebe: "Bébé", petit: "Tout-petit", enfant: "Enfant", ado: "Ado" };
  const ageBand = (c) => { const m = ageMonths(c.birth_date); return m < 12 ? "bebe" : m < 36 ? "petit" : m < 144 ? "enfant" : "ado"; };
  const ALL = ["bebe", "petit", "enfant", "ado"];
  const KINDS = {
    biberon:     { label: "Biberon",     ico: "🍼", bands: ["bebe", "petit"] },
    tetee:       { label: "Tétée",       ico: "🤱", bands: ["bebe", "petit"], maxMonths: 24 },
    repas:       { label: "Repas",       ico: "🥣", bands: ["bebe", "petit"], minMonths: 4 },
    couche:      { label: "Couche",      ico: "🧷", bands: ["bebe", "petit"] },
    pot:         { label: "Pot",         ico: "🚽", bands: ["petit"], minMonths: 18 },
    dodo:        { label: "Dodo",        ico: "😴", bands: ["bebe", "petit"] },
    reveil:      { label: "Réveil",      ico: "🌞", bands: ["bebe", "petit"] },
    medicament:  { label: "Médicament",  ico: "💊", bands: ALL },
    temperature: { label: "Température", ico: "🌡️", bands: ALL },
    bain:        { label: "Bain",        ico: "🛁", bands: ["bebe", "petit"] }
  };
  const kindsFor = (c) => {
    const band = ageBand(c), m = ageMonths(c.birth_date);
    return Object.entries(KINDS).filter(([, k]) => k.bands.includes(band) && (!k.minMonths || m >= k.minMonths) && (!k.maxMonths || m < k.maxMonths)).map(([key]) => key);
  };
  const childLogs = (id) => state.logs.filter((l) => l.child_id === id);
  const ago = (at) => {
    const min = Math.round((Date.now() - new Date(at)) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    if (min < 24 * 60) { const h = Math.floor(min / 60), r = min % 60; return `il y a ${h} h${r ? " " + String(r).padStart(2, "0") : ""}`; }
    return fmtDay(at).toLowerCase() + " à " + fmtTime(at);
  };
  const COUCHE = { pipi: "pipi", caca: "caca", both: "pipi + caca" };
  function logLabel(l) {
    const d = l.data || {};
    switch (l.kind) {
      case "biberon": return `Biberon${d.ml ? " " + d.ml + " ml" : ""}`;
      case "tetee": return `Tétée${d.side ? " " + d.side : ""}${d.min ? ", " + d.min + " min" : ""}`;
      case "repas": return `Repas${d.what ? " : " + d.what : ""}${d.qty ? " (" + d.qty + ")" : ""}`;
      case "couche": return `Couche ${COUCHE[d.type] || ""}`;
      case "pot": return `Pot : ${COUCHE[d.type] || ""}`;
      case "medicament": return `${d.name || "Médicament"}${d.dose ? " " + d.dose : ""}`;
      case "temperature": return `${String(d.t || "").replace(".", ",")} °C`;
      default: return KINDS[l.kind].label;
    }
  }

  function babyStats(c) {
    const logs = childLogs(c.id);
    const today = startOfDay(new Date());
    const tl = logs.filter((l) => new Date(l.at) >= today);
    const kinds = kindsFor(c);
    const tiles = [];
    if (kinds.includes("biberon")) {
      const b = tl.filter((l) => l.kind === "biberon");
      const last = logs.find((l) => l.kind === "biberon");
      const ml = b.reduce((a, l) => a + (Number(l.data.ml) || 0), 0);
      tiles.push(["🍼", last ? ago(last.at) : "Aucun", `${b.length} biberon${b.length > 1 ? "s" : ""}${ml ? ", " + ml + " ml" : ""} aujourd'hui`]);
    }
    if (kinds.includes("tetee")) {
      const t = tl.filter((l) => l.kind === "tetee"); const last = logs.find((l) => l.kind === "tetee");
      if (t.length || last) tiles.push(["🤱", last ? ago(last.at) : "Aucune", `${t.length} tétée${t.length > 1 ? "s" : ""} aujourd'hui${last && last.data.side ? ", dernière " + last.data.side : ""}`]);
    }
    if (kinds.includes("couche")) {
      const cc = tl.filter((l) => l.kind === "couche");
      const pipi = cc.filter((l) => l.data.type !== "caca").length, caca = cc.filter((l) => l.data.type !== "pipi").length;
      const last = logs.find((l) => l.kind === "couche");
      tiles.push(["🧷", last ? ago(last.at) : "Aucune", `${cc.length} couche${cc.length > 1 ? "s" : ""} aujourd'hui (${pipi} pipi, ${caca} caca)`]);
    }
    const sleep = logs.find((l) => l.kind === "dodo" || l.kind === "reveil");
    if (kinds.includes("dodo") && sleep) {
      const min = Math.round((Date.now() - new Date(sleep.at)) / 60000);
      const dur = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
      tiles.push([sleep.kind === "dodo" ? "😴" : "🌞", sleep.kind === "dodo" ? "Dort" : "Éveillé(e)", `depuis ${dur}`]);
    }
    const med = logs.find((l) => l.kind === "medicament" && Date.now() - new Date(l.at) < 86400000);
    if (med) tiles.push(["💊", ago(med.at), logLabel(med)]);
    const temp = logs.find((l) => l.kind === "temperature" && Date.now() - new Date(l.at) < 86400000);
    if (temp) tiles.push(["🌡️", logLabel(temp), ago(temp.at), Number(temp.data.t) >= 38]);
    return tiles;
  }
  const statsHtml = (tiles) => tiles.length ? `<div class="stats">${tiles.map(([i, a, b, warn]) =>
    `<div class="stat ${warn ? "warn" : ""}"><span class="s-ico" aria-hidden="true">${i}</span><div><strong>${esc(a)}</strong><div class="small muted">${esc(b)}</div></div></div>`).join("")}</div>` : "";
  const quickGrid = (c) => `<div class="quick">${kindsFor(c).map((k) =>
    `<button class="q-btn" data-log="${k}" data-child="${c.id}"><span aria-hidden="true">${KINDS[k].ico}</span>${KINDS[k].label}</button>`).join("")}</div>`;

  function journalHtml(c, limitDays = 2) {
    const from = startOfDay(new Date(Date.now() - (limitDays - 1) * 86400000));
    const logs = childLogs(c.id).filter((l) => new Date(l.at) >= from);
    if (!logs.length) return `<p class="muted small">Rien de noté pour l'instant. Appuie sur un bouton ci-dessus : l'heure actuelle est remplie automatiquement.</p>`;
    const groups = {};
    logs.forEach((l) => { (groups[dayKey(l.at)] ||= []).push(l); });
    return Object.keys(groups).sort().reverse().map((k) => `<div class="j-day">${fmtDay(k)}</div>${groups[k].map((l) =>
      `<button class="j-row" data-log-edit="${l.id}"><span class="j-time">${fmtTime(l.at)}</span><span aria-hidden="true">${KINDS[l.kind].ico}</span><span class="j-text">${esc(logLabel(l))}${l.note ? `<span class="muted"> · ${esc(l.note)}</span>` : ""}</span></button>`).join("")}`).join("");
  }

  function logPicker(c) {
    openSheet(`<h2 style="margin-top:0">${esc(c.first_name)} : noter</h2>${quickGrid(c)}
      <button class="btn ghost block" style="margin-top:14px" id="lp-item">📅 Rendez-vous, tâche ou note</button>
      <button class="btn ghost block" style="margin-top:10px" id="lp-act">🎯 Activité régulière</button>`, (el) => {
      el.querySelector("#lp-act").onclick = () => activityForm(c.id);
      el.querySelectorAll("[data-log]").forEach((b) => b.onclick = () => logForm(c, b.dataset.log));
      el.querySelector("#lp-item").onclick = () => itemForm(null, { child_id: c.id });
    });
  }

  function logForm(c, kind, existing) {
    const d = existing ? existing.data || {} : {};
    const k = KINDS[kind];
    const meds = [...new Set(state.logs.filter((l) => l.child_id === c.id && l.kind === "medicament" && l.data.name).map((l) => l.data.name))];
    const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, lab]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === val}">${lab}</button>`).join("")}</div>`;
    let fields = "";
    if (kind === "biberon") fields = `<label>Quantité (ml)</label>${seg("mlc", [30, 60, 90, 120, 150, 180, 210, 240].map((n) => [String(n), n]), String(d.ml || ""))}
      <input id="lf-ml" type="number" inputmode="numeric" min="0" max="500" value="${esc(d.ml || "")}" placeholder="Autre quantité" style="margin-top:8px">`;
    if (kind === "tetee") fields = `<label>Côté</label>${seg("side", [["gauche", "Gauche"], ["droite", "Droite"], ["des deux côtés", "Les deux"]], d.side || "")}
      <label for="lf-min">Durée (min)</label><input id="lf-min" type="number" inputmode="numeric" min="0" max="120" value="${esc(d.min || "")}">`;
    if (kind === "repas") fields = `<label for="lf-what">Au menu</label><input id="lf-what" maxlength="100" value="${esc(d.what || "")}" placeholder="Ex : purée de carottes">
      <label>Quantité</label>${seg("qty", [["tout mangé", "Tout mangé"], ["la moitié", "La moitié"], ["un peu", "Un peu"]], d.qty || "")}`;
    if (kind === "couche" || kind === "pot") fields = `<label>${kind === "pot" ? "Résultat" : "Contenu"}</label>
      <div class="big-choice">${[["pipi", "💧 Pipi"], ["caca", "💩 Caca"], ["both", "💧💩 Les deux"]].map(([v, lab]) => `<button type="button" data-type="${v}" aria-pressed="${d.type === v}">${lab}</button>`).join("")}</div>`;
    if (kind === "medicament") fields = `<label for="lf-name">Médicament</label><input id="lf-name" list="lf-meds" maxlength="80" required value="${esc(d.name || "")}" placeholder="Ex : Doliprane">
      <datalist id="lf-meds">${meds.map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
      <label for="lf-dose">Dose donnée</label><input id="lf-dose" maxlength="60" value="${esc(d.dose || "")}" placeholder="Ex : 1 dose-poids, 2,5 ml">`;
    if (kind === "temperature") fields = `<label for="lf-t">Température (°C)</label><input id="lf-t" type="number" inputmode="decimal" step="0.1" min="34" max="43" required value="${esc(d.t || "")}" placeholder="37,5">
      <p class="error small" id="lf-fever" hidden>Avant 3 mois, une fièvre à 38 °C ou plus impose d'appeler rapidement le médecin, ou le 15 en cas de doute.</p>`;
    openSheet(`
      <h2 style="margin-top:0">${k.ico} ${k.label} · ${esc(c.first_name)}</h2>
      <form id="lf">
        ${fields}
        <label for="lf-at">Heure</label>
        <input id="lf-at" type="datetime-local" required value="${toLocalInput(existing ? existing.at : new Date().toISOString())}">
        <label for="lf-note">Note (facultatif)</label>
        <input id="lf-note" maxlength="500" value="${esc(existing ? existing.note || "" : "")}" placeholder="${kind === "dodo" ? "Ex : dans son lit, s'est endormi seul" : "Ex : a régurgité un peu"}">
        <div class="actions">
          ${existing ? `<button type="button" class="btn danger" id="lf-del">Supprimer</button>` : `<button type="button" class="btn ghost" id="lf-cancel">Annuler</button>`}
          <button class="btn" type="submit">Enregistrer</button>
        </div>
      </form>`, (el) => {
      const vals = { side: d.side || "", qty: d.qty || "", type: d.type || "" };
      el.querySelectorAll("[data-seg]").forEach((w) => w.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        w.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        if (w.dataset.seg === "mlc") el.querySelector("#lf-ml").value = b.dataset.v; else vals[w.dataset.seg] = b.dataset.v;
      }));
      const form = el.querySelector("#lf");
      el.querySelectorAll("[data-type]").forEach((b) => b.onclick = () => {
        vals.type = b.dataset.type;
        el.querySelectorAll("[data-type]").forEach((x) => x.setAttribute("aria-pressed", x === b));
        if (!existing) form.requestSubmit();
      });
      const t = el.querySelector("#lf-t");
      if (t) t.oninput = () => { el.querySelector("#lf-fever").hidden = !(ageMonths(c.birth_date) < 3 && Number(t.value) >= 38); };
      const cancel = el.querySelector("#lf-cancel"); if (cancel) cancel.onclick = closeSheet;
      const del = el.querySelector("#lf-del");
      if (del) del.onclick = async () => { await sb.from("logs").delete().eq("id", existing.id); closeSheet(); await loadAll(); render(); toast("Supprimé"); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        const v = (id) => { const n = el.querySelector(id); return n ? n.value.trim() : ""; };
        if (kind === "biberon" && v("#lf-ml")) data.ml = Number(v("#lf-ml"));
        if (kind === "tetee") { if (vals.side) data.side = vals.side; if (v("#lf-min")) data.min = Number(v("#lf-min")); }
        if (kind === "repas") { if (v("#lf-what")) data.what = v("#lf-what"); if (vals.qty) data.qty = vals.qty; }
        if (kind === "couche" || kind === "pot") { if (!vals.type) return toast("Choisis pipi, caca ou les deux"); data.type = vals.type; }
        if (kind === "medicament") { if (!v("#lf-name")) return; data.name = v("#lf-name"); if (v("#lf-dose")) data.dose = v("#lf-dose"); }
        if (kind === "temperature") { if (!v("#lf-t")) return; data.t = Number(v("#lf-t").replace(",", ".")); }
        const row = { kind, data, at: new Date(v("#lf-at")).toISOString(), note: v("#lf-note") || null };
        const { error } = existing
          ? await sb.from("logs").update(row).eq("id", existing.id)
          : await sb.from("logs").insert({ ...row, household_id: state.household.id, child_id: c.id, created_by: state.session.user.id });
        if (error) return toast(errMsg(error));
        closeSheet(); await loadAll(); render(); toast(`${k.label} noté${["couche", "tetee", "temperature"].includes(kind) ? "e" : ""}`);
      };
    });
  }

  // ---------- Activités extrascolaires (récurrentes) ----------
  const DAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const DAY_LETTER = ["L", "M", "M", "J", "V", "S", "D"];
  const ACT_EMOJIS = ["⚽", "🏊", "🎵", "🎹", "🎸", "🎨", "🥋", "🤸", "💃", "🎾", "🏀", "🏉", "🐴", "🎭", "📚", "🧩", "🚴", "⛸️", "🏓", "🎯"];
  const isoDow = (d) => ((d.getDay() + 6) % 7) + 1;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseYmd = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };
  const mondayOf = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - (isoDow(x) - 1)); return x; };
  const hm = (t) => (t || "").slice(0, 5);
  const atTime = (dateStr, t) => { const d = parseYmd(dateStr); const [h, m] = t.split(":").map(Number); d.setHours(h, m, 0, 0); return d; };
  const schoolYearEnd = () => { const n = new Date(); const y = n.getMonth() >= 6 ? n.getFullYear() + 1 : n.getFullYear(); return `${y}-07-04`; };
  const memberName = (uid) => { const m = state.members.find((x) => x.user_id === uid); return m ? m.display_name : ""; };

  function occurrences(a, from, to) {
    const out = [];
    const start = parseYmd(a.start_date);
    const end = a.end_date ? parseYmd(a.end_date) : null;
    const anchor = mondayOf(start);
    const d = startOfDay(from > start ? from : start);
    const skips = new Set(a.skip_dates || []);
    while (d <= to && (!end || d <= end)) {
      const weeks = Math.round((mondayOf(d) - anchor) / (7 * 86400000));
      if (a.weekdays.includes(isoDow(d)) && weeks % (a.interval_weeks || 1) === 0) {
        const ds = ymd(d);
        out.push({ act: a, date: ds, start: atTime(ds, a.start_time), skipped: skips.has(ds) });
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  const actSchedule = (a) => {
    const days = [...a.weekdays].sort().map((n) => DAY_SHORT[n - 1]).join(", ");
    return `${days} · ${hm(a.start_time)}${a.end_time ? "-" + hm(a.end_time) : ""}${a.interval_weeks > 1 ? ` · toutes les ${a.interval_weeks} semaines` : ""}`;
  };
  function occHtml(o) {
    const a = o.act, child = childById(a.child_id);
    const who = [a.drop_by ? "Dépose : " + memberName(a.drop_by) : "", a.pick_by ? "Récupère : " + memberName(a.pick_by) : ""].filter(Boolean).join(" · ");
    return `<div class="item ${o.skipped ? "done" : ""}" style="--c:${esc(child ? child.color : "var(--ink-soft)")}">
      <div class="tab"></div>
      <div class="body" data-occ="${a.id}|${o.date}" role="button" tabindex="0">
        <div class="line1"><span class="time">${hm(a.start_time)}${a.end_time ? "-" + hm(a.end_time) : ""}</span><span class="title">${esc(a.emoji)} ${esc(a.name)}${o.skipped ? " (annulé)" : ""}</span></div>
        <div class="meta">${esc(child ? child.first_name : "")}${a.location ? " · " + esc(a.location) : ""}${who ? " · " + esc(who) : ""}</div>
      </div></div>`;
  }

  function occSheet(a, date) {
    const child = childById(a.child_id);
    const skipped = (a.skip_dates || []).includes(date);
    const tel = a.contact && /[0-9]{6,}/.test(a.contact.replace(/[\s.]/g, "")) ? a.contact.replace(/[^\d+]/g, "") : null;
    openSheet(`
      <h2 style="margin-top:0">${esc(a.emoji)} ${esc(a.name)}</h2>
      <p class="muted" style="margin-top:4px">${esc(child ? child.first_name : "")} · ${fmtDay(parseYmd(date))}, ${hm(a.start_time)}${a.end_time ? "-" + hm(a.end_time) : ""}</p>
      ${a.location ? `<p>📍 ${esc(a.location)}</p>` : ""}
      ${a.drop_by || a.pick_by ? `<p>🚗 ${[a.drop_by ? "Dépose : " + esc(memberName(a.drop_by)) : "", a.pick_by ? "Récupère : " + esc(memberName(a.pick_by)) : ""].filter(Boolean).join("<br>")}</p>` : ""}
      ${a.contact ? `<p>☎️ ${tel ? `<a href="tel:${esc(tel)}">${esc(a.contact)}</a>` : esc(a.contact)}</p>` : ""}
      ${a.notes ? `<p class="muted">${esc(a.notes)}</p>` : ""}
      <div class="actions">
        <button class="btn ghost" id="occ-skip">${skipped ? "Rétablir cette séance" : "Annuler cette séance"}</button>
        <button class="btn" id="occ-edit">Modifier l'activité</button>
      </div>`, (el) => {
      el.querySelector("#occ-edit").onclick = () => activityForm(a.child_id, a);
      el.querySelector("#occ-skip").onclick = async () => {
        const set = new Set(a.skip_dates || []);
        skipped ? set.delete(date) : set.add(date);
        const { error } = await sb.from("activities").update({ skip_dates: [...set].sort() }).eq("id", a.id);
        if (error) return toast(errMsg(error));
        closeSheet(); await loadAll(); render(); toast(skipped ? "Séance rétablie" : "Séance annulée");
      };
    });
  }

  function activityForm(childId, a) {
    const child = childById(childId);
    const v = a || { name: "", emoji: "⚽", weekdays: [], start_time: "", end_time: "", start_date: ymd(new Date()), end_date: schoolYearEnd(), interval_weeks: 1, location: "", contact: "", notes: "", drop_by: null, pick_by: null, skip_dates: [] };
    let emoji = v.emoji, days = new Set(v.weekdays), interval = v.interval_weeks || 1;
    const memberOpts = (sel) => `<option value="">Pas défini</option>${state.members.map((m) => `<option value="${m.user_id}" ${m.user_id === sel ? "selected" : ""}>${esc(m.display_name)}</option>`).join("")}`;
    const futureSkips = (v.skip_dates || []).filter((d) => d >= ymd(new Date()));
    openSheet(`
      <h2 style="margin-top:0">${a ? "Modifier l'activité" : "Nouvelle activité"} · ${esc(child.first_name)}</h2>
      <form id="af">
        <label for="af-name">Activité</label>
        <input id="af-name" required maxlength="80" value="${esc(v.name)}" placeholder="Ex : Foot, Piano, Natation">
        <div class="seg emoji-seg" id="af-emoji" style="margin-top:8px">${ACT_EMOJIS.map((x) => `<button type="button" data-v="${x}" aria-pressed="${x === emoji}">${x}</button>`).join("")}</div>
        <label>Jours</label>
        <div class="days" id="af-days">${DAY_LETTER.map((l, i) => `<button type="button" data-v="${i + 1}" aria-pressed="${days.has(i + 1)}" aria-label="${DAY_SHORT[i]}">${l}</button>`).join("")}</div>
        <div class="row">
          <div><label for="af-start">Début</label><input id="af-start" type="time" required value="${hm(v.start_time)}"></div>
          <div><label for="af-end">Fin</label><input id="af-end" type="time" required value="${hm(v.end_time)}"></div>
        </div>
        <label>Ça se répète</label>
        <div class="seg" id="af-int">${[[1, "Chaque semaine"], [2, "Toutes les 2 semaines"]].map(([n, l]) => `<button type="button" data-v="${n}" aria-pressed="${n === interval}">${l}</button>`).join("")}</div>
        <div class="row">
          <div><label for="af-from">Du</label><input id="af-from" type="date" required value="${esc(v.start_date)}"></div>
          <div><label for="af-to">Au</label><input id="af-to" type="date" value="${esc(v.end_date || "")}"></div>
        </div>
        <p class="muted small" style="margin:6px 0 0">Par défaut jusqu'à la fin de l'année scolaire. Laisse "Au" vide si ça ne s'arrête pas.</p>
        <label for="af-loc">Lieu</label>
        <input id="af-loc" maxlength="150" value="${esc(v.location || "")}" placeholder="Ex : Gymnase Jean Moulin">
        <div class="row">
          <div><label for="af-drop">Qui dépose</label><select id="af-drop">${memberOpts(v.drop_by)}</select></div>
          <div><label for="af-pick">Qui récupère</label><select id="af-pick">${memberOpts(v.pick_by)}</select></div>
        </div>
        <label for="af-contact">Contact</label>
        <input id="af-contact" maxlength="150" value="${esc(v.contact || "")}" placeholder="Ex : Coach Karim 06 12 34 56 78">
        <label for="af-notes">Notes</label>
        <textarea id="af-notes" maxlength="1000" placeholder="Ex : prendre le sac de sport et la gourde">${esc(v.notes || "")}</textarea>
        ${futureSkips.length ? `<label>Séances annulées</label><div class="seg">${futureSkips.map((d) => `<button type="button" data-unskip="${d}">${parseYmd(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} ×</button>`).join("")}</div>` : ""}
        <div id="af-err" class="error" hidden></div>
        <div class="actions">
          ${a ? `<button type="button" class="btn danger" id="af-del">Supprimer</button>` : `<button type="button" class="btn ghost" id="af-cancel">Annuler</button>`}
          <button class="btn" type="submit">${a ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>`, (el) => {
      let skips = new Set(v.skip_dates || []);
      el.querySelector("#af-emoji").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return; emoji = b.dataset.v;
        el.querySelectorAll("#af-emoji button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      });
      el.querySelector("#af-days").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return; const n = Number(b.dataset.v);
        days.has(n) ? days.delete(n) : days.add(n); b.setAttribute("aria-pressed", days.has(n));
      });
      el.querySelector("#af-int").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return; interval = Number(b.dataset.v);
        el.querySelectorAll("#af-int button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      });
      el.querySelectorAll("[data-unskip]").forEach((b) => b.onclick = () => { skips.delete(b.dataset.unskip); b.remove(); });
      const cancel = el.querySelector("#af-cancel"); if (cancel) cancel.onclick = closeSheet;
      const del = el.querySelector("#af-del");
      if (del) del.onclick = async () => {
        if (!confirm(`Supprimer l'activité ${a.name} et toutes ses séances ?`)) return;
        await sb.from("activities").delete().eq("id", a.id);
        closeSheet(); await loadAll(); render(); toast("Activité supprimée");
      };
      el.querySelector("#af").onsubmit = async (e) => {
        e.preventDefault();
        const err = el.querySelector("#af-err"); err.hidden = true;
        const fail = (m) => { err.hidden = false; err.textContent = m; };
        const val = (id) => el.querySelector(id).value.trim();
        if (!val("#af-name")) return fail("Indique le nom de l'activité.");
        if (!days.size) return fail("Choisis au moins un jour.");
        if (!val("#af-start") || !val("#af-end")) return fail("Indique l'heure de début et de fin.");
        if (val("#af-end") <= val("#af-start")) return fail("L'heure de fin doit être après l'heure de début.");
        if (val("#af-to") && val("#af-to") < val("#af-from")) return fail("La date de fin doit être après la date de début.");
        const row = {
          name: val("#af-name"), emoji, weekdays: [...days].sort(), start_time: val("#af-start"), end_time: val("#af-end"),
          interval_weeks: interval, start_date: val("#af-from"), end_date: val("#af-to") || null,
          location: val("#af-loc") || null, contact: val("#af-contact") || null, notes: val("#af-notes") || null,
          drop_by: val("#af-drop") || null, pick_by: val("#af-pick") || null, skip_dates: [...skips].sort()
        };
        const { error } = a
          ? await sb.from("activities").update(row).eq("id", a.id)
          : await sb.from("activities").insert({ ...row, household_id: state.household.id, child_id: child.id });
        if (error) return fail(errMsg(error));
        closeSheet(); await loadAll(); render(); toast(a ? "Activité modifiée" : "Activité ajoutée");
      };
    });
  }

  // ---------- Album ----------
  function photoForm(childId, photo) {
    const child = childById(childId || photo.child_id);
    const today = new Date().toISOString().slice(0, 10);
    if (!photo) return photoMultiForm(child, today);
    openSheet(`
      <h2 style="margin-top:0">Photo de ${esc(child.first_name)}</h2>
      <form id="pf">
        <div class="pf-preview">${state.photoUrls[photo.path] ? `<img src="${esc(state.photoUrls[photo.path])}" alt="">` : ""}</div>
        <label for="pf-note">Note</label>
        <textarea id="pf-note" maxlength="1000" placeholder="Ex : Ses premiers pas dans le salon !">${esc(photo.note || "")}</textarea>
        <label for="pf-date">Date</label>
        <input id="pf-date" type="date" max="${today}" value="${photo.taken_on}">
        <div class="actions">
          <button type="button" class="btn danger" id="pf-del">Supprimer</button>
          <button class="btn" type="submit">Enregistrer</button>
        </div>
      </form>`, (el) => {
      el.querySelector("#pf-del").onclick = async () => {
        if (!confirm("Supprimer cette photo de l'album ?")) return;
        await sb.from("photos").delete().eq("id", photo.id);
        await sb.storage.from("child-photos").remove([photo.path]);
        closeSheet(); await loadAll(); render(); toast("Photo supprimée");
      };
      el.querySelector("#pf").onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.from("photos").update({ note: el.querySelector("#pf-note").value.trim() || null, taken_on: el.querySelector("#pf-date").value || today }).eq("id", photo.id);
        if (error) return toast(errMsg(error));
        closeSheet(); await loadAll(); render(); toast("Modifications enregistrées");
      };
    });
  }

  // Ajout d'une ou plusieurs photos d'un coup, avec une note par photo (facultative)
  function photoMultiForm(child, today) {
    const MAX = 20;
    let picks = []; // { blob, url, date, note }
    openSheet(`
      <h2 style="margin-top:0">Album de ${esc(child.first_name)}</h2>
      <form id="pm">
        <label for="pm-file" class="pf-pick pf-preview" id="pm-pick"><span>📷</span>Choisir une ou plusieurs photos</label>
        <input id="pm-file" type="file" accept="image/*" multiple hidden>
        <div id="pm-list"></div>
        <div id="pm-common" hidden>
          <label for="pm-note-all">Note pour toutes les photos (facultatif)</label>
          <input id="pm-note-all" maxlength="1000" placeholder="Ex : Vacances à la mer">
        </div>
        <p class="muted small" id="pm-status"></p>
        <div class="actions">
          <button type="button" class="btn ghost" id="pm-cancel">Annuler</button>
          <button class="btn" type="submit" id="pm-submit" disabled>Ajouter à l'album</button>
        </div>
      </form>`, (el) => {
      const list = el.querySelector("#pm-list"), submit = el.querySelector("#pm-submit"), status = el.querySelector("#pm-status");
      const draw = () => {
        list.innerHTML = picks.map((p, i) => `
          <div class="pm-row">
            <img src="${p.url}" alt="">
            <div class="pm-fields">
              <input data-note="${i}" maxlength="1000" value="${esc(p.note)}" placeholder="Note (facultatif)">
              <input data-date="${i}" type="date" max="${today}" value="${p.date}">
            </div>
            <button type="button" class="del" data-rm="${i}" aria-label="Retirer cette photo">×</button>
          </div>`).join("");
        el.querySelector("#pm-common").hidden = picks.length < 2;
        el.querySelector("#pm-pick").innerHTML = picks.length ? `<span>➕</span>Ajouter d'autres photos` : `<span>📷</span>Choisir une ou plusieurs photos`;
        el.querySelector("#pm-pick").classList.toggle("compact", picks.length > 0);
        submit.disabled = !picks.length;
        submit.textContent = picks.length > 1 ? `Ajouter les ${picks.length} photos` : "Ajouter à l'album";
        list.querySelectorAll("[data-note]").forEach((n) => n.oninput = () => { picks[n.dataset.note].note = n.value; });
        list.querySelectorAll("[data-date]").forEach((n) => n.onchange = () => { picks[n.dataset.date].date = n.value || today; });
        list.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { URL.revokeObjectURL(picks[b.dataset.rm].url); picks.splice(Number(b.dataset.rm), 1); draw(); });
      };
      el.querySelector("#pm-file").onchange = async (e) => {
        const files = [...e.target.files].slice(0, MAX - picks.length);
        if (e.target.files.length > files.length) toast(`${MAX} photos maximum par envoi`);
        status.textContent = "Préparation des photos...";
        for (const f of files) {
          try {
            const blob = await resizePhoto(f, 1600);
            let date = today;
            if (f.lastModified) { const d = new Date(f.lastModified).toISOString().slice(0, 10); if (d <= today) date = d; }
            picks.push({ blob, url: URL.createObjectURL(blob), date, note: "" });
          } catch (_) { toast(`${f.name} n'a pas pu être lue`); }
        }
        status.textContent = ""; e.target.value = ""; draw();
      };
      el.querySelector("#pm-cancel").onclick = () => { picks.forEach((p) => URL.revokeObjectURL(p.url)); closeSheet(); };
      el.querySelector("#pm").onsubmit = async (e) => {
        e.preventDefault();
        if (!picks.length) return;
        const common = el.querySelector("#pm-note-all").value.trim();
        submit.disabled = true;
        let ok = 0, failMsg = "";
        for (let i = 0; i < picks.length; i++) {
          status.textContent = `Envoi ${i + 1} sur ${picks.length}...`;
          const p = picks[i];
          const path = `${state.household.id}/${child.id}/album/${Date.now()}-${i}.jpg`;
          const up = await sb.storage.from("child-photos").upload(path, p.blob, { contentType: "image/jpeg" });
          if (up.error) { failMsg = "Une photo n'a pas pu être envoyée."; continue; }
          const { error } = await sb.from("photos").insert({ household_id: state.household.id, child_id: child.id, path, note: p.note.trim() || common || null, taken_on: p.date, created_by: state.session.user.id });
          if (error) { await sb.storage.from("child-photos").remove([path]); failMsg = errMsg(error); if (/quota/i.test(error.message)) break; continue; }
          ok++;
        }
        picks.forEach((p) => URL.revokeObjectURL(p.url));
        closeSheet(); await loadAll(); render();
        toast(failMsg ? `${ok} photo${ok > 1 ? "s" : ""} ajoutée${ok > 1 ? "s" : ""}. ${failMsg}` : `${ok} photo${ok > 1 ? "s" : ""} ajoutée${ok > 1 ? "s" : ""} à l'album`);
      };
    });
  }

  // ---------- Forms ----------
  function childForm(child) {
    const c = child || { first_name: "", birth_date: "", color: COLORS[state.children.length % COLORS.length], emoji: EMOJIS[state.children.length % EMOJIS.length] };
    let color = c.color, emoji = c.emoji;
    openSheet(`
      <h2 style="margin-top:0">${child ? "Modifier " + esc(child.first_name) : "Ajouter un enfant"}</h2>
      <form id="cf">
        <label for="cf-name">Prénom</label>
        <input id="cf-name" required maxlength="40" value="${esc(c.first_name)}">
        <label>Photo</label>
        <div style="display:flex;align-items:center;gap:14px">
          <div id="cf-preview" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:${esc(c.color)};display:grid;place-items:center;font-size:2rem;flex:0 0 auto">${child ? avatar(child) : esc(c.emoji)}</div>
          <div style="display:flex;flex-direction:column;align-items:flex-start">
            <label class="btn ghost" style="margin:0;font-size:.95rem" for="cf-file">${child && child.photo_path ? "Changer la photo" : "Choisir une photo"}</label>
            <input id="cf-file" type="file" accept="image/*" hidden>
            <button type="button" class="link small" id="cf-rmphoto" ${child && child.photo_path ? "" : "hidden"}>Retirer la photo</button>
          </div>
        </div>
        <label for="cf-birth">Date de naissance</label>
        <input id="cf-birth" type="date" required max="${new Date().toISOString().slice(0, 10)}" value="${esc(c.birth_date || "")}">
        <p class="muted small" style="margin:6px 0 0">Les options s'adaptent à son âge : biberons, couches et dodos pour un bébé, rendez-vous et activités ensuite.</p>
        <label>Couleur</label>
        <div class="swatches" id="cf-colors">${COLORS.map((x) => `<button type="button" style="--c:${x}" data-v="${x}" aria-label="Couleur ${x}" aria-pressed="${x === color}"></button>`).join("")}</div>
        <label>Avatar</label>
        <div class="seg" id="cf-emojis">${EMOJIS.map((x) => `<button type="button" data-v="${x}" aria-pressed="${x === emoji}">${x}</button>`).join("")}</div>
        <div class="actions">
          ${child ? `<button type="button" class="btn danger" id="cf-del">Supprimer</button>` : `<button type="button" class="btn ghost" id="cf-cancel">Annuler</button>`}
          <button class="btn" type="submit">${child ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>`, (el) => {
      const pick = (wrap, cb) => wrap.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        cb(b.dataset.v);
      });
      let photoBlob = null, removePhoto = false;
      const preview = el.querySelector("#cf-preview");
      el.querySelector("#cf-file").onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          photoBlob = await resizePhoto(f); removePhoto = false;
          preview.innerHTML = `<img src="${URL.createObjectURL(photoBlob)}" alt="">`;
          el.querySelector("#cf-rmphoto").hidden = false;
        } catch (_) { toast("Format de photo non pris en charge. Essaie une autre image."); }
      };
      el.querySelector("#cf-rmphoto").onclick = () => {
        photoBlob = null; removePhoto = true; preview.textContent = emoji;
        el.querySelector("#cf-rmphoto").hidden = true;
      };
      pick(el.querySelector("#cf-colors"), (v) => { color = v; preview.style.background = v; });
      pick(el.querySelector("#cf-emojis"), (v) => { emoji = v; if (!preview.querySelector("img")) preview.textContent = v; });
      const cancel = el.querySelector("#cf-cancel"); if (cancel) cancel.onclick = closeSheet;
      const del = el.querySelector("#cf-del");
      if (del) del.onclick = async () => {
        if (!confirm(`Supprimer ${child.first_name}, tous ses éléments et son album ?`)) return;
        const files = [child.photo_path, ...state.photos.filter((p) => p.child_id === child.id).map((p) => p.path)].filter(Boolean);
        if (files.length) await sb.storage.from("child-photos").remove(files);
        await sb.from("children").delete().eq("id", child.id);
        closeSheet(); await loadAll(); location.hash = "#/enfants"; render(); toast("Enfant supprimé");
      };
      el.querySelector("#cf").onsubmit = async (e) => {
        e.preventDefault();
        const row = { first_name: el.querySelector("#cf-name").value.trim(), birth_date: el.querySelector("#cf-birth").value, color, emoji };
        if (!row.birth_date) return toast("Indique sa date de naissance");
        if (!row.first_name) return;
        const btn = el.querySelector("#cf button[type=submit]"); btn.disabled = true;
        const q = child
          ? sb.from("children").update(row).eq("id", child.id).select().single()
          : sb.from("children").insert({ ...row, household_id: state.household.id }).select().single();
        const { data: saved, error } = await q;
        if (error) { btn.disabled = false; return toast(errMsg(error)); }
        const oldPath = child && child.photo_path;
        if (photoBlob) {
          const path = `${state.household.id}/${saved.id}/${Date.now()}.jpg`;
          const up = await sb.storage.from("child-photos").upload(path, photoBlob, { contentType: "image/jpeg" });
          if (up.error) toast("La photo n'a pas pu être envoyée. Réessaie.");
          else {
            await sb.from("children").update({ photo_path: path }).eq("id", saved.id);
            if (oldPath) await sb.storage.from("child-photos").remove([oldPath]);
          }
        } else if (removePhoto && oldPath) {
          await sb.from("children").update({ photo_path: null }).eq("id", saved.id);
          await sb.storage.from("child-photos").remove([oldPath]);
        }
        closeSheet(); await loadAll(); render(); toast(child ? "Modifications enregistrées" : row.first_name + " ajouté(e)");
      };
    });
  }

  function itemForm(item, preset = {}) {
    const it = item || { type: preset.type || "rdv", title: "", details: "", child_id: preset.child_id ?? (state.filter !== "all" ? state.filter : null), due_at: null };
    let type = it.type;
    const placeholders = { rdv: "Ex : Pédiatre", tache: "Ex : Signer le carnet", sante: "Ex : Vaccin ROR, 2e dose", note: "Ex : Allergique aux kiwis", taille: "Ex : Chaussures 28" };
    openSheet(`
      <h2 style="margin-top:0">${item ? "Modifier" : "Ajouter"}</h2>
      <form id="itf">
        <div class="seg" id="itf-type" role="group" aria-label="Type">${Object.entries(TYPES).map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${k === type}">${t.ico} ${t.label}</button>`).join("")}</div>
        <label for="itf-title">Intitulé</label>
        <input id="itf-title" required maxlength="200" value="${esc(it.title)}" placeholder="${placeholders[type]}">
        <label for="itf-child">Pour qui</label>
        <select id="itf-child"><option value="">Toute la famille</option>${state.children.map((c) => `<option value="${c.id}" ${c.id === it.child_id ? "selected" : ""}>${esc(c.emoji)} ${esc(c.first_name)}</option>`).join("")}</select>
        <div id="itf-date-wrap">
          <label for="itf-date">Date et heure <span class="muted" id="itf-opt">(facultatif)</span></label>
          <input id="itf-date" type="datetime-local" value="${toLocalInput(it.due_at)}">
        </div>
        <label for="itf-details">Détails</label>
        <textarea id="itf-details" maxlength="2000" placeholder="Adresse, documents à apporter, posologie...">${esc(it.details || "")}</textarea>
        <div class="actions">
          ${item ? `<button type="button" class="btn danger" id="itf-del">Supprimer</button>` : `<button type="button" class="btn ghost" id="itf-cancel">Annuler</button>`}
          <button class="btn" type="submit">${item ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>`, (el) => {
      const dateWrap = el.querySelector("#itf-date-wrap");
      const sync = () => {
        el.querySelector("#itf-title").placeholder = placeholders[type];
        dateWrap.hidden = type === "taille";
        el.querySelector("#itf-opt").textContent = type === "rdv" ? "" : "(facultatif)";
        el.querySelector("#itf-date").required = type === "rdv";
      };
      sync();
      el.querySelector("#itf-type").addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        type = b.dataset.v;
        el.querySelectorAll("#itf-type button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        sync();
      });
      const cancel = el.querySelector("#itf-cancel"); if (cancel) cancel.onclick = closeSheet;
      const del = el.querySelector("#itf-del");
      if (del) del.onclick = async () => {
        await sb.from("items").delete().eq("id", item.id);
        closeSheet(); await loadAll(); render(); toast("Élément supprimé");
      };
      el.querySelector("#itf").onsubmit = async (e) => {
        e.preventDefault();
        const dv = el.querySelector("#itf-date").value;
        const row = {
          type,
          title: el.querySelector("#itf-title").value.trim(),
          child_id: el.querySelector("#itf-child").value || null,
          details: el.querySelector("#itf-details").value.trim() || null,
          due_at: (type === "taille" || !dv) ? null : new Date(dv).toISOString()
        };
        if (!row.title) return;
        const q = item
          ? sb.from("items").update(row).eq("id", item.id)
          : sb.from("items").insert({ ...row, household_id: state.household.id, created_by: state.session.user.id });
        const { error } = await q;
        if (error) return toast(errMsg(error));
        closeSheet(); await loadAll(); render(); toast(item ? "Modifications enregistrées" : TYPES[type].label + " ajouté(e)");
      };
    });
  }

  // ---------- Events ----------
  function bindCommon() {
    $app.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { state.filter = b.dataset.filter; render(); });
    ["add-child", "add-child-empty"].forEach((id) => { const b = document.getElementById(id); if (b) b.onclick = () => childForm(); });
    const fab = document.getElementById("fab");
    if (fab) fab.onclick = () => {
      const [page, id] = route();
      if (!state.children.length && page !== "enfant") { toast("Ajoute d'abord un enfant, ou choisis Toute la famille"); }
      const ch = page === "enfant" ? childById(id) : null;
      if (ch && ["bebe", "petit"].includes(ageBand(ch))) return logPicker(ch);
      itemForm(null, page === "enfant" ? { child_id: id } : {});
    };
    $app.querySelectorAll("[data-log]").forEach((b) => b.onclick = () => logForm(childById(b.dataset.child), b.dataset.log));
    $app.querySelectorAll("[data-log-pick]").forEach((b) => b.onclick = () => logPicker(childById(b.dataset.logPick)));
    $app.querySelectorAll("[data-log-edit]").forEach((b) => b.onclick = () => {
      const l = state.logs.find((x) => x.id === b.dataset.logEdit);
      logForm(childById(l.child_id), l.kind, l);
    });
    $app.querySelectorAll("[data-edit]").forEach((n) => {
      const open = () => itemForm(state.items.find((i) => i.id === n.dataset.edit));
      n.onclick = open;
      n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    });
    $app.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async () => {
      const it = state.items.find((i) => i.id === b.dataset.toggle);
      it.done = !it.done; render();
      await sb.from("items").update({ done: it.done }).eq("id", it.id);
    });
    const ec = document.getElementById("edit-child"); if (ec) ec.onclick = () => childForm(childById(ec.dataset.id));
    $app.querySelectorAll("[data-act-add]").forEach((b) => b.onclick = () => activityForm(b.dataset.actAdd));
    $app.querySelectorAll("[data-act]").forEach((b) => {
      const open = () => { const a = state.activities.find((x) => x.id === b.dataset.act); activityForm(a.child_id, a); };
      b.onclick = open; b.onkeydown = (e) => { if (e.key === "Enter") open(); };
    });
    $app.querySelectorAll("[data-occ]").forEach((b) => {
      const open = () => { const [aid, date] = b.dataset.occ.split("|"); occSheet(state.activities.find((x) => x.id === aid), date); };
      b.onclick = open; b.onkeydown = (e) => { if (e.key === "Enter") open(); };
    });
    $app.querySelectorAll("[data-album-add]").forEach((b) => b.onclick = () => photoForm(b.dataset.albumAdd));
    $app.querySelectorAll("[data-photo]").forEach((b) => b.onclick = () => photoForm(null, state.photos.find((p) => p.id === b.dataset.photo)));
    $app.querySelectorAll("[data-cal]").forEach((b) => b.onclick = () => calSheet(b.dataset.cal));
    const cr = document.getElementById("cal-reset");
    if (cr) cr.onclick = async () => {
      if (!confirm("Les calendriers déjà abonnés ne se mettront plus à jour. Chaque membre devra s'abonner à nouveau. Continuer ?")) return;
      const { data, error } = await sb.from("households").update({ calendar_token: crypto.randomUUID() }).eq("id", state.household.id).select().single();
      if (error) return toast(errMsg(error));
      state.household = data; render(); toast("Nouveaux liens créés");
    };
    const afc = document.getElementById("add-for-child"); if (afc) afc.onclick = () => itemForm(null, { child_id: afc.dataset.id });

    // Shopping
    const sa = document.getElementById("shop-add");
    if (sa) sa.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("shop-name").value.trim();
      if (!name) return;
      const category = document.getElementById("shop-cat").value;
      document.getElementById("shop-name").value = "";
      const { error } = await sb.from("shopping_items").insert({ household_id: state.household.id, name, category });
      if (error) return toast(errMsg(error));
      await loadAll(); render();
      const inp = document.getElementById("shop-name"); if (inp) { inp.focus(); document.getElementById("shop-cat").value = category; }
    };
    $app.querySelectorAll("[data-shop]").forEach((b) => b.onclick = async () => {
      const s = state.shopping.find((x) => x.id === b.dataset.shop);
      s.checked = !s.checked; render();
      await sb.from("shopping_items").update({ checked: s.checked }).eq("id", s.id);
    });
    $app.querySelectorAll("[data-shop-del]").forEach((b) => b.onclick = async () => {
      state.shopping = state.shopping.filter((x) => x.id !== b.dataset.shopDel); render();
      await sb.from("shopping_items").delete().eq("id", b.dataset.shopDel);
    });
    const sc = document.getElementById("shop-clear");
    if (sc) sc.onclick = async () => {
      const ids = state.shopping.filter((s) => s.checked).map((s) => s.id);
      state.shopping = state.shopping.filter((s) => !s.checked); render();
      await sb.from("shopping_items").delete().in("id", ids);
      toast("Panier vidé");
    };

    // Settings
    const share = document.getElementById("share");
    if (share) share.onclick = async () => {
      const text = `Rejoins ${state.household.name} sur Tribu pour qu'on organise la famille ensemble (enfants, rendez-vous, courses) :`;
      if (navigator.share) { try { await navigator.share({ title: "Rejoins notre tribu", text, url: share.dataset.link }); } catch (_) {} }
      else { await navigator.clipboard.writeText(text + " " + share.dataset.link); toast("Lien d'invitation copié"); }
    };
    const inst = document.getElementById("install");
    if (inst) inst.onclick = async () => { state.installPrompt.prompt(); state.installPrompt = null; render(); };
    $app.querySelectorAll("[data-install-help]").forEach((b) => b.onclick = installSheet);
    const pkd = document.getElementById("pk-dismiss");
    if (pkd) pkd.onclick = () => { ls.set("tribu_pk_hidden", "1"); render(); };
    const ib = document.getElementById("install-dismiss");
    if (ib) ib.onclick = () => { ls.set("tribu_install_hidden", "1"); render(); };
    const pka = document.getElementById("pk-add");
    if (pka) pka.onclick = async () => {
      pka.disabled = true;
      try { await passkeyAdd(); render(); toast(bioLabel().replace(/^l'/, "L'").replace(/^une/, "Une") + " activé" + (bioLabel() === "Face ID" ? "" : "e")); }
      catch (e) { toast(pkError(e)); pka.disabled = false; }
    };
    $app.querySelectorAll("[data-pk-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("Retirer cet appareil ? Tu ne pourras plus t'y connecter sans mot de passe.")) return;
      await sb.from("passkey_credentials").delete().eq("id", b.dataset.pkDel);
      await loadPasskeys(); render(); toast("Appareil retiré");
    });
    const cpw = document.getElementById("change-pwd");
    if (cpw) cpw.onclick = () => openSheet(`
      <h2 style="margin-top:0">Nouveau mot de passe</h2>
      <form id="pw">
        <input type="email" autocomplete="username" value="${esc(state.session.user.email)}" hidden>
        <label for="pw1">Nouveau mot de passe</label>
        <input id="pw1" type="password" autocomplete="new-password" minlength="6" required>
        <label for="pw2">Confirme-le</label>
        <input id="pw2" type="password" autocomplete="new-password" minlength="6" required>
        <div id="pw-err" class="error" hidden></div>
        <div class="actions"><button type="button" class="btn ghost" id="pw-cancel">Annuler</button><button class="btn" type="submit">Enregistrer</button></div>
      </form>`, (el) => {
      el.querySelector("#pw-cancel").onclick = closeSheet;
      el.querySelector("#pw").onsubmit = async (e) => {
        e.preventDefault();
        const a = el.querySelector("#pw1").value, b = el.querySelector("#pw2").value, err = el.querySelector("#pw-err");
        if (a !== b) { err.hidden = false; err.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
        const { error } = await sb.auth.updateUser({ password: a });
        if (error) { err.hidden = false; err.textContent = errMsg(error); return; }
        closeSheet(); toast("Mot de passe modifié");
      };
    });
    const lo = document.getElementById("logout"); if (lo) lo.onclick = () => sb.auth.signOut();
    $app.querySelectorAll("[data-switch]").forEach((b) => b.onclick = async () => {
      ls.set(HID_KEY, b.dataset.switch); state.filter = "all";
      await loadHousehold(); location.hash = "#/accueil"; render(); toast("Tribu " + state.household.name);
    });
    const lv = document.getElementById("leave");
    if (lv) lv.onclick = async () => {
      if (!confirm("Quitter cette tribu ? Tu n'auras plus accès à ses données.")) return;
      await sb.from("members").delete().eq("household_id", state.household.id).eq("user_id", state.session.user.id);
      if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
      ls.set(HID_KEY, null); state.filter = "all";
      await loadHousehold(); location.hash = "#/accueil"; render();
    };
  }

  // ---------- Boot ----------
  window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo(0, 0); });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installPrompt = e; });
  window.addEventListener("appinstalled", () => { state.installPrompt = null; closeSheet(); toast("Tribu est installée"); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  let booted = false;
  sb.auth.onAuthStateChange(async (event, session) => {
    const prev = state.session && state.session.user.id;
    state.session = session;
    if (event === "PASSWORD_RECOVERY") {
      const pwd = prompt("Choisis un nouveau mot de passe (6 caractères minimum)");
      if (pwd) { const { error } = await sb.auth.updateUser({ password: pwd }); toast(error ? errMsg(error) : "Mot de passe modifié"); }
    }
    if (!session) {
      if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
      Object.assign(state, { household: null, children: [], items: [], shopping: [], photos: [], logs: [], activities: [], members: [], memberships: [], passkeys: [], photoUrls: {} });
      return render();
    }
    if (!booted || prev !== session.user.id) {
      booted = true;
      $app.innerHTML = `<div class="hero"><p class="muted">Chargement de ta tribu...</p></div>`;
      setTimeout(afterLogin, 0);
    }
  });
})();
