// ==UserScript==
// @name         Starter CRM — массовое управление активностью точек
// @namespace    starter-crm-bulk-activity
// @version      1.7
// @description  Позволяет одним действием переключить статус активности (Включена / Временно закрыта / Отключена) сразу для нескольких точек продаж в Starter CRM
// @author       you
// @match        https://crm.starterapp.ru/*/admin/shops-management/shops*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/Gnomophile/CRM-mass-editing/main/starter-crm-bulk-activity.user.js
// @downloadURL  https://raw.githubusercontent.com/Gnomophile/CRM-mass-editing/main/starter-crm-bulk-activity.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Определяем "слаг" проекта из адреса, например sushistore ---
  // URL вида: https://crm.starterapp.ru/<project>/admin/shops-management/shops
  const pathParts = location.pathname.split('/').filter(Boolean);
  const PROJECT = pathParts[0];
  const API_BASE = `${location.origin}/${PROJECT}/api/v1/frontend`;

  if (!PROJECT) return;

  // --- Стили ---
  const style = document.createElement('style');
  style.textContent = `
    #bulk-act-fab {
      background: #1a73e8; color: #fff; border: none; border-radius: 8px;
      padding: 10px 16px; font: 600 14px/1.2 -apple-system, Segoe UI, Roboto, sans-serif;
      cursor: pointer; white-space: nowrap;
    }
    #bulk-act-fab:hover { background: #1558b0; }
    #bulk-act-fab-wrap {
      position: absolute; right: 0; top: 50%; transform: translateY(-50%);
      display: flex; justify-content: flex-end; align-items: center;
      width: max-content; z-index: 5;
    }
    #bulk-act-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 99999;
      display: flex; align-items: center; justify-content: center;
    }
    #bulk-act-modal {
      background: #fff; width: 720px; max-width: 92vw; max-height: 86vh;
      border-radius: 10px; display: flex; flex-direction: column;
      font: 14px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; overflow: hidden;
    }
    #bulk-act-modal header {
      padding: 16px 20px; border-bottom: 1px solid #eee; display: flex;
      align-items: center; justify-content: space-between;
    }
    #bulk-act-modal header h2 { font-size: 16px; margin: 0; }
    #bulk-act-modal header button { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
    #bulk-act-toolbar { padding: 12px 20px; display: flex; gap: 10px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
    #bulk-act-toolbar input[type=text] { flex: 1; padding: 7px 10px; border: 1px solid #ddd; border-radius: 6px; min-width: 160px; }
    #bulk-act-toolbar select { padding: 7px 10px; border: 1px solid #ddd; border-radius: 6px; }
    #bulk-act-toolbar button { padding: 7px 12px; border: 1px solid #ddd; border-radius: 6px; background: #f7f7f8; cursor: pointer; }
    #bulk-act-list { overflow-y: auto; flex: 1; padding: 4px 0; }
    .bulk-act-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 20px;
      border-bottom: 1px solid #f2f2f2; cursor: pointer;
    }
    .bulk-act-row:hover { background: #f7f9fe; }
    .bulk-act-row .name { flex: 1; }
    .bulk-act-row .city { color: #888; font-size: 12px; width: 110px; }
    .bulk-act-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
    .bulk-badge-active { background: #e3f7e6; color: #1a8a3d; }
    .bulk-badge-temp   { background: #fdecd2; color: #b96a00; }
    .bulk-badge-off    { background: #eee; color: #777; }
    #bulk-act-footer {
      padding: 14px 20px; border-top: 1px solid #eee; display: flex;
      align-items: center; gap: 12px; flex-wrap: wrap;
    }
    #bulk-act-footer select { padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; }
    #bulk-act-apply {
      background: #1a73e8; color: #fff; border: none; border-radius: 6px;
      padding: 9px 16px; cursor: pointer; font-weight: 600;
    }
    #bulk-act-apply:disabled { background: #bbb; cursor: not-allowed; }
    #bulk-act-count { color: #555; }
    #bulk-act-log {
      max-height: 140px; overflow-y: auto; padding: 8px 20px; font-size: 12px;
      border-top: 1px solid #eee; display: none; background: #fafafa;
    }
    .bulk-log-ok  { color: #1a8a3d; }
    .bulk-log-err { color: #c0392b; }
  `;
  document.head.appendChild(style);

  // --- Кнопка запуска: вставляем справа от заголовка "Точки продаж" ---
  let shops = [];
  let overlay = null;

  // Показываем кнопку только на странице СПИСКА точек, а не на карточке
  // конкретной точки (там тот же CSS-селектор заголовка, но путь длиннее:
  // /{project}/admin/shops-management/shops/{id})
  function isListPage() {
    const parts = location.pathname.split('/').filter(Boolean);
    return (
      parts.length === 4 &&
      parts[1] === 'admin' &&
      parts[2] === 'shops-management' &&
      parts[3] === 'shops'
    );
  }

  function removeButton() {
    const wrap = document.getElementById('bulk-act-fab-wrap');
    if (wrap) wrap.remove();
    if (overlay) closeModal();
  }

  function mountButton() {
    if (!isListPage()) { removeButton(); return; }
    if (document.getElementById('bulk-act-fab')) return; // уже вставлена

    const titleEl = document.querySelector('h2.page-title.nested-page-title .nested-page-title-text');
    if (!titleEl) return;

    // h2 -> col (title, растянута на всю ширину строки flex: 1 0 0%) -> row (nested-header-row)
    const row = titleEl.closest('h2').parentElement.parentElement;
    if (!row || !row.classList.contains('nested-header-row')) return;

    // Заголовочная колонка растягивается на всю строку и не сжимается (flex-shrink: 0),
    // поэтому обычный flex-сосед уезжает на новую строку. Ставим кнопку абсолютным
    // позиционированием поверх строки — так она всегда остаётся на одной линии с заголовком.
    if (getComputedStyle(row).position === 'static') {
      row.style.position = 'relative';
    }

    const wrap = document.createElement('div');
    wrap.id = 'bulk-act-fab-wrap';
    const fab = document.createElement('button');
    fab.id = 'bulk-act-fab';
    fab.type = 'button';
    fab.textContent = '⚡ Массовая активность';
    fab.addEventListener('click', openModal);
    wrap.appendChild(fab);
    row.appendChild(wrap);
  }

  // Страница — SPA (Vue), маршрут меняется без перезагрузки документа.
  // Перехватывать history.pushState/replaceState рискованно — это может
  // конфликтовать с внутренней навигацией Vue Router и подвешивать страницу,
  // поэтому просто следим за DOM (при смене маршрута Vue активно
  // перерисовывает разметку, и это гарантированно вызывает мутации).
  const headerObserver = new MutationObserver(mountButton);
  headerObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', mountButton);

  mountButton();

  async function fetchShops() {
    const res = await fetch(`${API_BASE}/shops?offset=0&limit=1000`, { credentials: 'include' });
    if (!res.ok) throw new Error('Не удалось получить список точек: ' + res.status);
    return res.json();
  }

  function statusLabel(activeStatus) {
    if (activeStatus === 'active') return { text: 'Включена', cls: 'bulk-badge-active' };
    if (activeStatus === 'temporary_closed') return { text: 'Временно закрыта', cls: 'bulk-badge-temp' };
    if (activeStatus === 'not_active') return { text: 'Отключена', cls: 'bulk-badge-off' };
    return { text: activeStatus || '—', cls: 'bulk-badge-off' };
  }

  // city у точки приходит объектом { name, country }, а не строкой
  function cityName(shop) {
    return (shop.city && shop.city.name || '').trim();
  }

  async function openModal() {
    overlay = document.createElement('div');
    overlay.id = 'bulk-act-overlay';
    overlay.innerHTML = `
      <div id="bulk-act-modal">
        <header>
          <h2>Массовое управление активностью — ${PROJECT}</h2>
          <button id="bulk-act-close">✕</button>
        </header>
        <div id="bulk-act-toolbar">
          <select id="bulk-act-city"><option value="">Все города</option></select>
          <span style="flex:1"></span>
          <button id="bulk-act-select-all">Выбрать все видимые</button>
          <button id="bulk-act-select-none">Снять выбор</button>
          <button id="bulk-act-refresh">↻ Обновить</button>
        </div>
        <div id="bulk-act-list">Загрузка…</div>
        <div id="bulk-act-log"></div>
        <div id="bulk-act-footer">
          <span id="bulk-act-count">Выбрано: 0</span>
          <span style="flex:1"></span>
          <span>Новый статус:</span>
          <select id="bulk-act-target">
            <option value="active">Включена</option>
            <option value="temporary_closed">Временно закрыта</option>
            <option value="not_active">Отключена</option>
          </select>
          <button id="bulk-act-apply" disabled>Применить</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#bulk-act-close').onclick = closeModal;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#bulk-act-city').addEventListener('change', renderList);
    overlay.querySelector('#bulk-act-select-all').onclick = () => toggleVisible(true);
    overlay.querySelector('#bulk-act-select-none').onclick = () => toggleVisible(false);
    overlay.querySelector('#bulk-act-refresh').onclick = loadShops;
    overlay.querySelector('#bulk-act-apply').onclick = applyBulk;

    await loadShops();
  }

  function closeModal() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  async function loadShops() {
    const list = overlay.querySelector('#bulk-act-list');
    list.textContent = 'Загрузка…';
    try {
      shops = (await fetchShops()).sort((a, b) => a.legalTitle.localeCompare(b.legalTitle, 'ru'));
    } catch (e) {
      list.textContent = 'Ошибка загрузки: ' + e.message;
      return;
    }
    const citySelect = overlay.querySelector('#bulk-act-city');
    const cityMap = new Map(); // cityId -> name
    shops.forEach(s => {
      const name = cityName(s);
      if (s.cityId != null && name) cityMap.set(s.cityId, name);
    });
    const cities = [...cityMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
    const prevValue = citySelect.value;
    citySelect.innerHTML = '<option value="">Все города</option>' +
      cities.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    if ([...citySelect.options].some(o => o.value === prevValue)) citySelect.value = prevValue;
    renderList();
  }

  function renderList() {
    const list = overlay.querySelector('#bulk-act-list');
    const cityFilter = overlay.querySelector('#bulk-act-city').value; // строка с cityId либо ''

    const selectedIds = new Set(getSelectedIds());

    const filtered = shops.filter(s => {
      if (cityFilter && String(s.cityId) !== cityFilter) return false;
      return true;
    });

    list.innerHTML = filtered.map(s => {
      const st = statusLabel(s.activeStatus);
      const checked = selectedIds.has(s.id) ? 'checked' : '';
      return `
        <label class="bulk-act-row">
          <input type="checkbox" data-id="${s.id}" ${checked}>
          <span class="name">${s.legalTitle}</span>
          <span class="city">${cityName(s)}</span>
          <span class="bulk-act-badge ${st.cls}">${st.text}</span>
        </label>
      `;
    }).join('') || '<div style="padding:20px;color:#888">Ничего не найдено</div>';

    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', updateCount);
    });
    updateCount();
  }

  function getSelectedIds() {
    if (!overlay) return [];
    return [...overlay.querySelectorAll('#bulk-act-list input[type=checkbox]:checked')]
      .map(cb => Number(cb.dataset.id));
  }

  function toggleVisible(state) {
    overlay.querySelectorAll('#bulk-act-list input[type=checkbox]').forEach(cb => { cb.checked = state; });
    updateCount();
  }

  function updateCount() {
    const n = getSelectedIds().length;
    overlay.querySelector('#bulk-act-count').textContent = `Выбрано: ${n}`;
    overlay.querySelector('#bulk-act-apply').disabled = n === 0;
  }

  const TARGET_LABELS = {
    active: 'Включена',
    temporary_closed: 'Временно закрыта',
    not_active: 'Отключена',
  };

  // Тот же способ, которым сама CRM переключает статус активности точки —
  // трёх разных состояний (Включена / Временно закрыта / Отключена)
  // на бэкенде отвечают два разных эндпоинта.
  async function patchStatus(id, target) {
    if (target === 'temporary_closed') {
      return fetch(`${API_BASE}/shop/${id}/closed?isClosed=true`, { method: 'PATCH', credentials: 'include' });
    }
    if (target === 'active') {
      return fetch(`${API_BASE}/shop/${id}/closed?isClosed=false`, { method: 'PATCH', credentials: 'include' });
    }
    // not_active
    return fetch(`${API_BASE}/shop/${id}/status?shop_status=not_active`, { method: 'PATCH', credentials: 'include' });
  }

  async function applyBulk() {
    const ids = getSelectedIds();
    const target = overlay.querySelector('#bulk-act-target').value;
    const targetLabel = TARGET_LABELS[target] || target;

    if (!confirm(`Переключить ${ids.length} точек(и) в статус «${targetLabel}»?`)) return;

    const log = overlay.querySelector('#bulk-act-log');
    log.style.display = 'block';
    log.innerHTML = '';
    overlay.querySelector('#bulk-act-apply').disabled = true;

    const addLine = (text, cls) => {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    };

    for (const id of ids) {
      const shop = shops.find(s => s.id === id);
      const name = shop ? shop.legalTitle : id;
      try {
        const res = await patchStatus(id, target);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        addLine(`✓ ${name}`, 'bulk-log-ok');
      } catch (e) {
        addLine(`✗ ${name}: ${e.message}`, 'bulk-log-err');
      }
      await new Promise(r => setTimeout(r, 250)); // небольшая пауза между запросами
    }

    const done = document.createElement('div');
    done.style.marginTop = '6px';
    done.style.fontWeight = '600';
    done.textContent = 'Готово. Обновляю список…';
    log.appendChild(done);

    await loadShops();
    overlay.querySelector('#bulk-act-apply').disabled = getSelectedIds().length === 0;
  }
})();