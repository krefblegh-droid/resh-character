// Single-page front end. Routes (hash based):
//   #/characters              list of registered characters
//   #/char/2588               "Character U+2588" page
//   #/char/2588/add-form      upload a glyph image for a font (password)
//   #/edit                    editor: register a new character (password)
(() => {
  const app = document.getElementById('app');
  const TOKEN_KEY = 'glyph-token';
  let preferredFont = null; // font to preselect on the next character page

  // ---------- Utilities ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') setToken(null);
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
    return data;
  }

  function setTitle(title) { document.title = title; }
  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === name));
  }

  // ---------- Password modal ----------
  const modal = document.getElementById('pw-modal');
  const pwForm = document.getElementById('pw-form');
  const pwInput = document.getElementById('pw-input');
  const pwError = document.getElementById('pw-error');
  let modalResolve = null;

  function askPassword() {
    pwInput.value = '';
    pwError.textContent = '';
    modal.hidden = false;
    pwInput.focus();
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function closeModal(result) {
    modal.hidden = true;
    if (modalResolve) modalResolve(result);
    modalResolve = null;
  }
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwError.textContent = '';
    try {
      const { token } = await api('/login', { method: 'POST', body: JSON.stringify({ password: pwInput.value }) });
      setToken(token);
      closeModal(true);
    } catch (err) {
      pwError.textContent = err.message;
      pwInput.select();
    }
  });
  document.getElementById('pw-cancel').addEventListener('click', () => closeModal(false));
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(false); });

  // Resolves true if we hold a valid token, prompting for the password if needed.
  async function ensureAuth() {
    if (getToken()) {
      try { await api('/auth'); return true; } catch { /* token expired */ }
    }
    return askPassword();
  }

  // Protected navigation: ask for the password, then go.
  async function goProtected(hash) {
    if (await ensureAuth()) location.hash = hash;
  }
  document.getElementById('edit-btn').addEventListener('click', () => goProtected('#/edit'));

  // ---------- Views ----------
  async function viewCharacters() {
    setTitle('Characters');
    setActiveNav('characters');
    app.innerHTML = '<h1>Characters</h1><p class="muted">Loading…</p>';
    const list = await api('/characters');
    if (!list.length) {
      app.innerHTML = '<h1>Characters</h1><p class="muted">No characters registered yet. Use <b>Edit</b> to register one.</p>';
      return;
    }
    app.innerHTML = `<h1>Characters</h1>
      <ul class="char-list">
        ${list.map((c) => `
          <li><a href="#/char/${esc(c.code)}">
            <span class="code">U+${esc(c.code)}</span>
            <span class="name">${esc(c.name)}</span>
          </a></li>`).join('')}
      </ul>`;
  }

  async function viewCharacter(code) {
    setActiveNav(null);
    setTitle(`Character U+${code}`);
    app.innerHTML = `<p class="muted center">Loading…</p>`;
    let char, fonts;
    try {
      [char, fonts] = await Promise.all([api('/characters/' + code), api('/fonts')]);
    } catch (err) {
      app.innerHTML = `<h1>Character U+${esc(code)}</h1><p class="error">${esc(err.message)}</p><a class="back" href="#/characters">← Back to Characters</a>`;
      return;
    }
    const formsByFont = new Map(char.forms.map((f) => [f.font.toLowerCase(), f]));

    app.innerHTML = `
      <section class="char-page">
        <h1>Character U+${esc(char.code)}</h1>
        <p class="subtitle">${esc(char.name)}</p>
        <div class="glyph-box" id="glyph-box"><span class="placeholder">Select a font below</span></div>
        <select class="font-select" id="font-select" aria-label="Font">
          <option value="">— Select a font —</option>
          ${fonts.map((f) => `<option value="${esc(f)}">${esc(f)}${formsByFont.has(f.toLowerCase()) ? '' : ' (no image)'}</option>`).join('')}
        </select>
        <button class="btn" id="add-form-btn" type="button">Add form</button>
      </section>`;

    const box = document.getElementById('glyph-box');
    const select = document.getElementById('font-select');
    function show() {
      const font = select.value;
      if (!font) { box.innerHTML = '<span class="placeholder">Select a font below</span>'; return; }
      const form = formsByFont.get(font.toLowerCase());
      box.innerHTML = form
        ? `<img src="${esc(form.image)}" alt="U+${esc(char.code)} ${esc(char.name)} in ${esc(font)}">`
        : `<span class="placeholder">No image of this character in <b>${esc(font)}</b> yet.</span>`;
    }
    select.addEventListener('change', show);
    if (preferredFont && fonts.includes(preferredFont)) { select.value = preferredFont; show(); }
    preferredFont = null;

    document.getElementById('add-form-btn').addEventListener('click', () => goProtected(`#/char/${char.code}/add-form`));
  }

  async function viewAddForm(code) {
    setActiveNav(null);
    if (!(await ensureAuth())) { location.hash = `#/char/${code}`; return; }
    let char, fonts;
    try {
      [char, fonts] = await Promise.all([api('/characters/' + code), api('/fonts')]);
    } catch (err) {
      app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      return;
    }
    setTitle(`Add form · Character U+${char.code}`);
    app.innerHTML = `
      <a class="back" href="#/char/${esc(char.code)}">← Character U+${esc(char.code)}</a>
      <h1>Add form</h1>
      <p class="muted">U+${esc(char.code)} ${esc(char.name)}</p>
      <form class="card stack" id="add-form">
        <input type="text" id="font" placeholder="Font" list="font-list" required maxlength="100" autocomplete="off">
        <datalist id="font-list">${fonts.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>
        <input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" required>
        <img class="preview" id="preview" alt="Preview" hidden>
        <p class="error" id="form-error"></p>
        <div class="row"><button class="btn" type="submit" id="upload-btn">Upload</button></div>
      </form>`;

    const fileInput = document.getElementById('file');
    const preview = document.getElementById('preview');
    const errorEl = document.getElementById('form-error');
    let dataUrl = null;

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      dataUrl = null;
      preview.hidden = true;
      errorEl.textContent = '';
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { errorEl.textContent = 'Image must be 5 MB or smaller.'; fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => { dataUrl = reader.result; preview.src = dataUrl; preview.hidden = false; };
      reader.readAsDataURL(file);
    });

    document.getElementById('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      if (!dataUrl) { errorEl.textContent = 'Choose an image file.'; return; }
      const btn = document.getElementById('upload-btn');
      btn.disabled = true;
      const font = document.getElementById('font').value.trim();
      try {
        await api(`/characters/${char.code}/forms`, { method: 'POST', body: JSON.stringify({ font, image: dataUrl }) });
        preferredFont = font;
        location.hash = `#/char/${char.code}`;
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false;
        if (err.status === 401) goProtected(location.hash);
      }
    });
  }

  async function viewEditor() {
    setActiveNav('edit');
    if (!(await ensureAuth())) { location.hash = '#/characters'; return; }
    setTitle('Editor');
    app.innerHTML = `
      <h1>Editor</h1>
      <form class="card stack" id="register-form" autocomplete="off">
        <input type="text" id="code" placeholder="Code" inputmode="text" maxlength="6" required spellcheck="false">
        <input type="text" id="name" placeholder="Name" maxlength="200" required spellcheck="false" autocapitalize="characters">
        <p class="error" id="reg-error"></p>
        <div class="row"><button class="btn" type="submit">Register</button></div>
      </form>`;

    const codeEl = document.getElementById('code');
    const nameEl = document.getElementById('name');
    const errorEl = document.getElementById('reg-error');

    // Filter while typing, keeping the caret in place.
    function filterInput(el, transform) {
      el.addEventListener('input', () => {
        const before = el.value;
        const after = transform(before);
        if (after === before) return;
        const pos = el.selectionStart - (before.length - after.length);
        el.value = after;
        el.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
      });
    }
    // Code: hexadecimal digits only (a "U+" prefix is stripped).
    filterInput(codeEl, (v) => v.toUpperCase().replace(/^U\+/, '').replace(/[^0-9A-F]/g, ''));
    // Name: Basic Latin only, rendered in capitals.
    filterInput(nameEl, (v) => v.toUpperCase().replace(/[^\x20-\x7E]/g, ''));

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      try {
        const c = await api('/characters', { method: 'POST', body: JSON.stringify({ code: codeEl.value, name: nameEl.value }) });
        location.hash = `#/char/${c.code}`;
      } catch (err) {
        errorEl.textContent = err.message;
        if (err.status === 401) goProtected('#/edit');
      }
    });
    codeEl.focus();
  }

  // ---------- Router ----------
  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    try {
      if (parts[0] === 'char' && parts[1] && parts[2] === 'add-form') return await viewAddForm(parts[1].toUpperCase());
      if (parts[0] === 'char' && parts[1]) return await viewCharacter(parts[1].toUpperCase());
      if (parts[0] === 'edit') return await viewEditor();
      if (parts[0] !== 'characters') { location.replace('#/characters'); return; }
      await viewCharacters();
    } catch (err) {
      app.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
