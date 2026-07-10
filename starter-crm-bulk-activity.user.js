// ==UserScript==
// @name         Starter CRM — массовое управление активностью точек
// @namespace    starter-crm-bulk-activity
// @version      2.2
// @description  Массовое управление точками в Starter CRM: активность (Включена / Временно закрыта / Отключена), СТОП Доставка и СТОП Приём заказов — с историей изменений и откатом. v2.2: исправлен переход из "Отключена" в "Включена"/"Временно закрыта" (status и isClosed — независимые поля), увеличена пауза между запросами
// @author       you
// @match        https://crm.starterapp.ru/*/admin/shops-management/shops*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
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

  // ID операций "СТОП Доставка" / "СТОП Приём заказов" в панели управления
  // загрузкой (/admin/shops-management/time-management?shop=ID). Проверено:
  // ID одинаковый для всех точек проекта (это конфигурация уровня проекта,
  // а не конкретной точки) — можно захардкодить один раз.
  const OPERATION_IDS = {
    stop_delivery: 'ea51ff13-6f35-4561-87e5-5e9301dda005',
    stop_orders: 'fb696d61-0a30-4ed6-87d2-fe00a0a95442',
  };

  // Пауза между запросами при массовом применении. Поднята с 250 до 600 мс:
  // при параллельной обработке сразу нескольких точек бэкенд периодически
  // отдавал 503 на PATCH .../closed и .../status при более короткой паузе.
  const REQUEST_DELAY_MS = 600;

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
      background: #fff; width: 780px; max-width: 94vw; max-height: 88vh;
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
      display: flex; align-items: center; gap: 8px; padding: 8px 20px;
      border-bottom: 1px solid #f2f2f2; cursor: pointer; flex-wrap: wrap;
    }
    .bulk-act-row:hover { background: #f7f9fe; }
    .bulk-act-row .name { flex: 1 1 160px; display: flex; align-items: center; gap: 8px; min-width: 160px; }
    .bulk-act-row .name .missing-label { color: #c0392b; font-style: italic; }
    .bulk-act-row .city { color: #888; font-size: 12px; width: 100px; flex-shrink: 0; }
    .bulk-act-fix-link {
      font-size: 11px; color: #1a73e8; text-decoration: none; white-space: nowrap;
      border: 1px solid #1a73e8; border-radius: 999px; padding: 2px 8px;
    }
    .bulk-act-fix-link:hover { background: #eaf1fd; }
    .bulk-act-hist-btn {
      border: none; background: none; cursor: pointer; font-size: 14px; padding: 2px 4px;
      border-radius: 4px; line-height: 1;
    }
    .bulk-act-hist-btn:hover { background: #e8eefc; }
    .bulk-act-row-history {
      display: none; font-size: 12px; color: #555; padding: 6px 20px 10px 46px; background: #fafbff;
      flex-basis: 100%;
    }
    .bulk-act-row-history.open { display: block; }
    .bulk-act-row-history div { padding: 2px 0; }
    .bulk-act-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; white-space: nowrap; }
    .bulk-badge-active { background: #e3f7e6; color: #1a8a3d; }
    .bulk-badge-temp   { background: #fdecd2; color: #b96a00; }
    .bulk-badge-off    { background: #eee; color: #777; }
    .bulk-badge-ok      { background: #e3f7e6; color: #1a8a3d; }
    .bulk-badge-stop    { background: #fdecea; color: #c0392b; }
    .bulk-badge-unknown { background: #f0f0f0; color: #999; }
    #bulk-act-footer {
      padding: 14px 20px; border-top: 1px solid #eee; display: flex;
      align-items: center; gap: 10px; flex-wrap: wrap;
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
    #bulk-act-tabs { display: flex; gap: 4px; padding: 10px 20px 0; border-bottom: 1px solid #eee; }
    .bulk-act-tab {
      padding: 8px 14px; border: none; background: none; cursor: pointer;
      font-weight: 600; color: #888; border-bottom: 2px solid transparent;
    }
    .bulk-act-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
    #bulk-act-tab-shops { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    #bulk-act-history { overflow-y: auto; flex: 1; padding: 8px 20px; }
    .bulk-hist-batch { border: 1px solid #eee; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .bulk-hist-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .bulk-hist-date { color: #888; font-size: 12px; }
    .bulk-hist-target { font-weight: 600; }
    .bulk-hist-count { color: #555; font-size: 12px; }
    .bulk-hist-rolledback { color: #888; font-size: 12px; font-style: italic; }
    .bulk-hist-toggle, .bulk-hist-rollback {
      margin-left: auto; padding: 5px 10px; border: 1px solid #ddd; border-radius: 6px;
      background: #f7f7f8; cursor: pointer; font-size: 12px;
    }
    .bulk-hist-rollback { border-color: #1a73e8; color: #1a73e8; background: #fff; }
    .bulk-hist-rollback:disabled { color: #aaa; border-color: #ddd; cursor: not-allowed; }
    .bulk-hist-items { margin-top: 8px; font-size: 12px; color: #555; display: none; }
    .bulk-hist-items div { padding: 2px 0; }
    #bulk-act-history-empty { padding: 30px; text-align: center; color: #888; }
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

  // Живой статус СТОП Доставка / СТОП Приём заказов для одной точки.
  // true = остановлено, false = работает, null = не удалось определить
  // (например, у точки нет такой группы операций).
  async function fetchShopOperations(id) {
    try {
      const res = await fetch(`${API_BASE}/operations/pad/${id}/operation_groups`, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const stopGroup = (data.groups || []).find(g => g.title === null);
      const ops = stopGroup ? stopGroup.operations : [];
      const isSelected = (opId) => {
        const op = ops.find(o => o.id === opId);
        return op ? !!op.isSelected : null;
      };
      return {
        stopDelivery: isSelected(OPERATION_IDS.stop_delivery),
        stopOrders: isSelected(OPERATION_IDS.stop_orders),
      };
    } catch (e) {
      return { stopDelivery: null, stopOrders: null };
    }
  }

  // Параллельно, но с ограничением одновременных запросов, чтобы не
  // заддосить бэкенд при большом числе точек.
  async function mapWithConcurrency(items, limit, fn) {
    let idx = 0;
    async function worker() {
      while (idx < items.length) {
        const cur = idx++;
        await fn(items[cur], cur);
      }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
  }

  function statusLabel(activeStatus) {
    if (activeStatus === 'active') return { text: 'Включена', cls: 'bulk-badge-active' };
    if (activeStatus === 'temporary_closed') return { text: 'Временно закрыта', cls: 'bulk-badge-temp' };
    if (activeStatus === 'not_active') return { text: 'Отключена', cls: 'bulk-badge-off' };
    return { text: activeStatus || '—', cls: 'bulk-badge-off' };
  }

  function stopBadgeHtml(label, state) {
    if (state === true) return `<span class="bulk-act-badge bulk-badge-stop" title="${label}: остановлено">${label}: СТОП</span>`;
    if (state === false) return `<span class="bulk-act-badge bulk-badge-ok" title="${label}: работает">${label}: ОК</span>`;
    return `<span class="bulk-act-badge bulk-badge-unknown" title="${label}: не удалось определить">${label}: —</span>`;
  }

  // city у точки приходит объектом { name, country }, а не строкой
  function cityName(shop) {
    return (shop.city && shop.city.name || '').trim();
  }

  // legalTitle бывает null у точек, где название ещё не заполнили.
  // Используется в сортировке и отображении — вынесено отдельно, чтобы
  // не потерять null-проверку где-нибудь ещё в будущем.
  function shopTitle(shop) {
    return shop.legalTitle || '';
  }

  function shopEditUrl(shop) {
    return `${location.origin}/${PROJECT}/admin/shops-management/shops/${shop.id}?tab=activity`;
  }

  // --- Типы массового действия ---
  // Три независимых действия: обычная активность точки (закрытие/открытие)
  // и два "стопа" из панели управления загрузкой. У каждого свой набор
  // целевых значений для выпадающего списка внизу модалки.
  const ACTIONS = {
    activity: {
      label: 'Активность точки',
      targets: [
        { value: 'active', label: 'Включена' },
        { value: 'temporary_closed', label: 'Временно закрыта' },
        { value: 'not_active', label: 'Отключена' },
      ],
    },
    stop_delivery: {
      label: 'СТОП Доставка',
      targets: [
        { value: 'select', label: 'Остановить' },
        { value: 'unselect', label: 'Возобновить' },
      ],
    },
    stop_orders: {
      label: 'СТОП Приём заказов',
      targets: [
        { value: 'select', label: 'Остановить' },
        { value: 'unselect', label: 'Возобновить' },
      ],
    },
  };

  const ACTIVITY_TARGET_LABELS = {
    active: 'Включена',
    temporary_closed: 'Временно закрыта',
    not_active: 'Отключена',
  };

  const STOP_TARGET_LABELS = {
    select: 'Остановлено',
    unselect: 'Работает',
  };

  function targetLabelFor(action, value) {
    if (action === 'activity') return ACTIVITY_TARGET_LABELS[value] || value;
    return STOP_TARGET_LABELS[value] || value;
  }

  // --- История изменений (для отката) ---
  // Храним последние HISTORY_LIMIT партий изменений через GM_setValue —
  // это переживает перезагрузку страницы и закрытие браузера (в отличие от
  // обычной переменной в памяти).
  const HISTORY_KEY = 'bulk-act-history';
  const HISTORY_LIMIT = 30;

  function loadHistory() {
    try {
      return JSON.parse(GM_getValue(HISTORY_KEY, '[]'));
    } catch (e) {
      return [];
    }
  }

  function saveHistory(batches) {
    GM_setValue(HISTORY_KEY, JSON.stringify(batches.slice(-HISTORY_LIMIT)));
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
        <div id="bulk-act-tabs">
          <button class="bulk-act-tab active" data-tab="shops">Точки</button>
          <button class="bulk-act-tab" data-tab="history">История / Откат</button>
        </div>
        <div id="bulk-act-tab-shops">
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
            <span>Действие:</span>
            <select id="bulk-act-action">
              <option value="activity">Активность точки</option>
              <option value="stop_delivery">СТОП Доставка</option>
              <option value="stop_orders">СТОП Приём заказов</option>
            </select>
            <select id="bulk-act-target"></select>
            <button id="bulk-act-apply" disabled>Применить</button>
          </div>
        </div>
        <div id="bulk-act-history" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.bulk-act-tab').forEach(tab => {
      tab.onclick = () => switchTab(tab.dataset.tab);
    });

    overlay.querySelector('#bulk-act-close').onclick = closeModal;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    overlay.querySelector('#bulk-act-city').addEventListener('change', renderList);
    overlay.querySelector('#bulk-act-select-all').onclick = () => toggleVisible(true);
    overlay.querySelector('#bulk-act-select-none').onclick = () => toggleVisible(false);
    overlay.querySelector('#bulk-act-refresh').onclick = loadShops;
    overlay.querySelector('#bulk-act-apply').onclick = applyBulk;
    overlay.querySelector('#bulk-act-action').addEventListener('change', renderTargetOptions);
    renderTargetOptions();

    await loadShops();
  }

  function renderTargetOptions() {
    const action = overlay.querySelector('#bulk-act-action').value;
    const targetSelect = overlay.querySelector('#bulk-act-target');
    targetSelect.innerHTML = ACTIONS[action].targets
      .map(t => `<option value="${t.value}">${t.label}</option>`)
      .join('');
  }

  function closeModal() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function switchTab(tab) {
    overlay.querySelectorAll('.bulk-act-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    overlay.querySelector('#bulk-act-tab-shops').style.display = tab === 'shops' ? '' : 'none';
    overlay.querySelector('#bulk-act-history').style.display = tab === 'history' ? '' : 'none';
    if (tab === 'history') renderHistory();
  }

  async function loadShops() {
    const list = overlay.querySelector('#bulk-act-list');
    list.textContent = 'Загрузка…';
    try {
      // Точки без названия (legalTitle === null) не должны ронять сортировку —
      // shopTitle() подставляет '' вместо null.
      shops = (await fetchShops()).sort((a, b) => shopTitle(a).localeCompare(shopTitle(b), 'ru'));
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

    // Живой статус СТОП по каждой точке — отдельные запросы, ограниченные
    // по параллельности, чтобы не заддосить бэкенд списком из полусотни точек.
    list.textContent = 'Загрузка статусов СТОП…';
    await mapWithConcurrency(shops, 6, async (s) => {
      const ops = await fetchShopOperations(s.id);
      s.stopDelivery = ops.stopDelivery;
      s.stopOrders = ops.stopOrders;
    });

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
      const nameHtml = s.legalTitle
        ? s.legalTitle
        : `<span class="missing-label">Без названия (#${s.id})</span>` +
          `<a class="bulk-act-fix-link" href="${shopEditUrl(s)}" target="_blank" rel="noopener" ` +
          `title="Открыть настройки этой точки, чтобы задать название">заполнить →</a>`;
      return `
        <div class="bulk-act-row-wrap" data-shop-id="${s.id}">
          <div class="bulk-act-row">
            <input type="checkbox" data-id="${s.id}" ${checked}>
            <span class="name">${nameHtml}</span>
            <span class="city">${cityName(s)}</span>
            <span class="bulk-act-badge ${st.cls}">${st.text}</span>
            ${stopBadgeHtml('Дост.', s.stopDelivery)}
            ${stopBadgeHtml('Приём', s.stopOrders)}
            <button type="button" class="bulk-act-hist-btn" title="История изменений этой точки (общая для всех, из CRM)">🕘</button>
          </div>
          <div class="bulk-act-row-history"></div>
        </div>
      `;
    }).join('') || '<div style="padding:20px;color:#888">Ничего не найдено</div>';

    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', updateCount);
    });
    list.querySelectorAll('.bulk-act-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.closest('.bulk-act-hist-btn') || e.target.closest('.bulk-act-fix-link')) return;
        const cb = row.querySelector('input[type=checkbox]');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });
    list.querySelectorAll('.bulk-act-hist-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wrap = btn.closest('.bulk-act-row-wrap');
        toggleShopHistory(Number(wrap.dataset.shopId), wrap.querySelector('.bulk-act-row-history'));
      });
    });
    updateCount();
  }

  // Настоящая, серверная история изменений точки (эндпоинт самой CRM) —
  // видна всем, у кого есть доступ к CRM, независимо от браузера.
  // Показывает изменения активности (закрыта/открыта); изменения СТОП
  // Доставка / Приём заказов через этот эндпоинт не приходят — это отдельная
  // лента событий на стороне CRM, которую скрипт не запрашивает.
  const shopHistoryCache = new Map();

  async function fetchShopHistory(id) {
    if (shopHistoryCache.has(id)) return shopHistoryCache.get(id);
    const res = await fetch(`${API_BASE}/shop/${id}/history?historyLimit=8&historyPage=1`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    shopHistoryCache.set(id, data.history || []);
    return data.history || [];
  }

  function describeHistoryEntry(entry) {
    if (entry.event === 'update_shop_status') {
      return ACTIVITY_TARGET_LABELS[entry.data.status] || entry.data.status;
    }
    if (entry.event === 'update_shop_closed') {
      return entry.data.isClosed ? 'Временно закрыта' : 'Включена';
    }
    return entry.event;
  }

  async function toggleShopHistory(id, container) {
    const showing = container.classList.contains('open');
    if (showing) {
      container.classList.remove('open');
      container.innerHTML = '';
      return;
    }
    container.classList.add('open');
    container.textContent = 'Загрузка истории…';
    try {
      const history = await fetchShopHistory(id);
      if (!history.length) {
        container.textContent = 'Изменений пока не было';
        return;
      }
      container.innerHTML = history.map(h => {
        const d = new Date(h.at);
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `<div>${dateStr} — <b>${h.username}</b> → «${describeHistoryEntry(h)}»</div>`;
      }).join('');
    } catch (e) {
      container.textContent = 'Не удалось загрузить историю: ' + e.message;
    }
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

  // Активность точки — тот же способ, которым сама CRM переключает статус.
  //
  // На бэкенде это ДВА независимых поля:
  //   status      — 'active' | 'not_active' (Отключена — это всегда status=not_active)
  //   isClosed    — true | false (работает только пока status='active'; определяет
  //                 Включена (false) / Временно закрыта (true))
  //
  // Раньше при target === 'active' скрипт дёргал только .../closed?isClosed=false.
  // Это верно, если точка была "Временно закрыта" (status уже 'active'), но если
  // точка была "Отключена" (status='not_active'), запрос ничего не менял в status —
  // PATCH отвечал 200/204 (выглядело как успех), а точка так и оставалась отключена.
  //
  // Фикс: для target 'active' и 'temporary_closed' сначала гарантированно переводим
  // status в 'active' (если точка уже активна — это просто лишний, но безвредный
  // запрос), и только потом переключаем isClosed.
  async function patchStatus(id, target) {
    if (target === 'not_active') {
      return fetch(`${API_BASE}/shop/${id}/status?shop_status=not_active`, { method: 'PATCH', credentials: 'include' });
    }

    // target === 'active' | 'temporary_closed' — сначала убеждаемся, что точка
    // не "Отключена" на уровне status, иначе следующий шаг ни на что не повлияет.
    const statusRes = await fetch(`${API_BASE}/shop/${id}/status?shop_status=active`, { method: 'PATCH', credentials: 'include' });
    if (!statusRes.ok) return statusRes;

    // Небольшая пауза между двумя последовательными запросами для одной точки,
    // чтобы не бить по бэкенду двумя PATCH почти одновременно.
    await new Promise(r => setTimeout(r, 150));

    if (target === 'temporary_closed') {
      return fetch(`${API_BASE}/shop/${id}/closed?isClosed=true`, { method: 'PATCH', credentials: 'include' });
    }
    // target === 'active'
    return fetch(`${API_BASE}/shop/${id}/closed?isClosed=false`, { method: 'PATCH', credentials: 'include' });
  }

  // СТОП Доставка / СТОП Приём заказов — тот же способ, которым панель
  // управления загрузкой (time-management) переключает эти кнопки.
  // target: 'select' (включить СТОП) | 'unselect' (снять СТОП)
  async function patchOperation(id, operationId, target) {
    return fetch(`${API_BASE}/operations/pad/${id}/${operationId}/${target}`, {
      method: 'POST',
      credentials: 'include',
    });
  }

  async function applyAction(action, id, target) {
    if (action === 'activity') return patchStatus(id, target);
    return patchOperation(id, OPERATION_IDS[action], target);
  }

  async function applyBulk() {
    const ids = getSelectedIds();
    const action = overlay.querySelector('#bulk-act-action').value;
    const target = overlay.querySelector('#bulk-act-target').value;
    const actionDef = ACTIONS[action];
    const targetLabel = actionDef.targets.find(t => t.value === target).label;

    if (!confirm(`${targetLabel} — «${actionDef.label}» для ${ids.length} точек(и)?`)) return;

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

    // Снимок состояния "до" — только для тех точек, где смена реально удалась
    // И где известно исходное состояние, чтобы потом можно было откатить
    // именно партию изменений. Для СТОП-действий "исходное состояние" — это
    // просто противоположное значение select/unselect.
    const changedItems = [];

    for (const id of ids) {
      const shop = shops.find(s => s.id === id);
      const name = shop ? (shop.legalTitle || `#${id} (без названия)`) : id;

      let prevValue = null;
      if (shop) {
        if (action === 'activity') {
          prevValue = shop.activeStatus;
        } else {
          const cur = action === 'stop_delivery' ? shop.stopDelivery : shop.stopOrders;
          prevValue = cur === true ? 'select' : cur === false ? 'unselect' : null;
        }
      }

      try {
        const res = await applyAction(action, id, target);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        addLine(`✓ ${name}`, 'bulk-log-ok');
        if (prevValue !== null && prevValue !== target) {
          changedItems.push({
            id,
            name,
            prevValue,
            prevLabel: targetLabelFor(action, prevValue),
          });
        }
      } catch (e) {
        addLine(`✗ ${name}: ${e.message}`, 'bulk-log-err');
      }
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS)); // пауза между точками
    }

    if (changedItems.length) {
      const history = loadHistory();
      history.push({
        ts: Date.now(),
        kind: action,
        actionLabel: actionDef.label,
        target,
        targetLabel,
        items: changedItems,
        rolledBack: false,
      });
      saveHistory(history);
    }

    const done = document.createElement('div');
    done.style.marginTop = '6px';
    done.style.fontWeight = '600';
    done.textContent = 'Готово. Обновляю список…';
    log.appendChild(done);

    await loadShops();
    overlay.querySelector('#bulk-act-apply').disabled = getSelectedIds().length === 0;
  }

  function renderHistory() {
    const box = overlay.querySelector('#bulk-act-history');
    const history = loadHistory();

    if (!history.length) {
      box.innerHTML = '<div id="bulk-act-history-empty">Пока нет ни одного массового изменения</div>';
      return;
    }

    box.innerHTML = [...history].reverse().map(batch => `
      <div class="bulk-hist-batch" data-ts="${batch.ts}">
        <div class="bulk-hist-head">
          <span class="bulk-hist-date">${formatDate(batch.ts)}</span>
          <span class="bulk-hist-target">${batch.actionLabel} → ${batch.targetLabel}</span>
          <span class="bulk-hist-count">${batch.items.length} точек(и)</span>
          ${batch.rolledBack ? '<span class="bulk-hist-rolledback">откачено</span>' : ''}
          <button class="bulk-hist-toggle" type="button">Показать точки</button>
          <button class="bulk-hist-rollback" type="button" ${batch.rolledBack ? 'disabled' : ''}>Откатить</button>
        </div>
        <div class="bulk-hist-items">
          ${batch.items.map(it => `<div>${it.name}: было «${it.prevLabel}» → стало «${batch.targetLabel}»</div>`).join('')}
        </div>
        <div class="bulk-hist-log" style="display:none"></div>
      </div>
    `).join('');

    box.querySelectorAll('.bulk-hist-toggle').forEach(btn => {
      btn.onclick = () => {
        const itemsEl = btn.closest('.bulk-hist-batch').querySelector('.bulk-hist-items');
        const showing = itemsEl.style.display === 'block';
        itemsEl.style.display = showing ? 'none' : 'block';
        btn.textContent = showing ? 'Показать точки' : 'Скрыть точки';
      };
    });
    box.querySelectorAll('.bulk-hist-rollback').forEach(btn => {
      btn.onclick = () => rollbackBatch(Number(btn.closest('.bulk-hist-batch').dataset.ts));
    });
  }

  async function rollbackBatch(ts) {
    const history = loadHistory();
    const batch = history.find(b => b.ts === ts);
    if (!batch || batch.rolledBack) return;

    if (!confirm(`Откатить ${batch.items.length} точек(и) к состоянию до изменения «${batch.actionLabel} → ${batch.targetLabel}» (${formatDate(batch.ts)})?`)) return;

    const batchEl = overlay.querySelector(`.bulk-hist-batch[data-ts="${ts}"]`);
    const logEl = batchEl.querySelector('.bulk-hist-log');
    logEl.style.display = 'block';
    logEl.innerHTML = '';
    batchEl.querySelector('.bulk-hist-rollback').disabled = true;

    for (const item of batch.items) {
      const line = document.createElement('div');
      try {
        const res = await applyAction(batch.kind, item.id, item.prevValue);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        line.className = 'bulk-log-ok';
        line.textContent = `✓ ${item.name} → «${item.prevLabel}»`;
      } catch (e) {
        line.className = 'bulk-log-err';
        line.textContent = `✗ ${item.name}: ${e.message}`;
      }
      logEl.appendChild(line);
      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    }

    batch.rolledBack = true;
    saveHistory(history);
    renderHistory();
    await loadShops();
  }
})();
