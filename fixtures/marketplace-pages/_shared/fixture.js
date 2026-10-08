/* Shared helpers for marketplace fixture pages. These pages test the app's flow logic and helpers, NOT real-site accuracy. */
window.__filled = window.__filled || {};

window.Fixture = {
  params: new URLSearchParams(location.search),
  /** Redirect to the login page unless the fake login flag is set (simulates a logged-out browser). */
  requireLogin(loginPath) {
    if (localStorage.getItem('cl-login') !== '1') location.replace(loginPath);
  },
  /** Hide controls listed in ?missing=a,b (matched against data-fixture-id) to simulate a changed website. */
  applyMissing() {
    const missing = (this.params.get('missing') || '').split(',').filter(Boolean);
    missing.forEach((id) => document.querySelectorAll('[data-fixture-id="' + id + '"]').forEach((el) => el.remove()));
  },
  record(key, value) { window.__filled[key] = value; },
  saveFilled() { localStorage.setItem('cl-filled', JSON.stringify(window.__filled)); },
  /** Simple dropdown: clicking `trigger` shows `list`; clicking an option (li) records its text and closes. */
  dropdown(trigger, list, key) {
    trigger.addEventListener('click', () => { list.hidden = false; });
    list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      Fixture.record(key, li.textContent.trim()); trigger.dataset.value = li.textContent.trim(); list.hidden = true;
    }));
  },
  /** Multi-level menu: `tree` is nested objects; arrays/null terminate. Records the chosen path under `key`. */
  menu(trigger, menuEl, tree, key) {
    let picked = [];
    function show(items, level) {
      menuEl.hidden = false; menuEl.innerHTML = '';
      items.forEach((name) => {
        const li = document.createElement('li'); li.setAttribute('role', 'menuitem'); li.textContent = name;
        li.addEventListener('click', () => { picked[level] = name; picked.length = level + 1; advance(); });
        menuEl.appendChild(li);
      });
    }
    function nodeAt() { let n = tree; for (const p of picked) { if (n === null || n === undefined) return null; n = Array.isArray(n) ? null : n[p]; } return n; }
    function advance() {
      const n = nodeAt();
      if (n === null || n === undefined) { Fixture.record(key, picked.join(' > ')); menuEl.hidden = true; return; }
      show(Array.isArray(n) ? n : Object.keys(n), picked.length);
    }
    trigger.addEventListener('click', () => { picked = []; show(Object.keys(tree), 0); });
  },
  /** Typeahead: show matching suggestions under `input`; clicking one records it. */
  typeahead(input, listEl, options, key) {
    input.addEventListener('input', () => {
      listEl.innerHTML = '';
      const q = input.value.toLowerCase();
      Fixture.record(key + 'Typed', input.value);
      if (!q) return;
      options.filter((o) => o.toLowerCase().includes(q)).forEach((o) => {
        const li = document.createElement('li'); li.textContent = o;
        li.addEventListener('click', () => { input.value = o; Fixture.record(key, o); listEl.innerHTML = ''; });
        listEl.appendChild(li);
      });
    });
  },
  /** File input that "uploads" after a short delay and renders preview <img>s inside [data-testid=Photo-n]. */
  uploads(input, container, key, wrapperClass) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      Fixture.record(key, files.map((f) => f.name));
      files.forEach((f, i) => setTimeout(() => {
        const d = document.createElement('div'); d.dataset.testid = 'Photo-' + i; if (wrapperClass) d.className = wrapperClass;
        const img = document.createElement('img'); img.width = 40; img.height = 40; img.alt = 'photo ' + (i + 1);
        img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; d.appendChild(img); container.appendChild(d);
      }, 120 * (i + 1)));
    });
  },
  /** Radio buttons (role=radio) inside a group: records the clicked text. */
  radios(group, key) {
    group.querySelectorAll('[role=radio]').forEach((b) => b.addEventListener('click', () => {
      group.querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true'); Fixture.record(key, b.textContent.trim());
    }));
  },
};
