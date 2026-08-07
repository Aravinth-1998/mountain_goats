/**
 * Client i18n: JSON catalogs, DOM apply, locale persistence.
 * Extend SUPPORTED_LOCALES and add public/i18n/{code}.json for new languages.
 */
(function (root) {
  const STORAGE_KEY = 'mg_locale';
  const SUPPORTED_LOCALES = ['en', 'fr', 'de'];
  const LOCALE_LABELS = { en: 'English', fr: 'Francais', de: 'Deutsch' };

  /** @type {Record<string, object>} */
  const catalogs = {};
  let currentLocale = 'en';
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  /**
   * Resolve a dotted key in a nested catalog object.
   *
   * @param {object|null|undefined} catalog Locale catalog.
   * @param {string} key Dotted path.
   * @returns {string|undefined}
   */
  function lookup(catalog, key) {
    if (!catalog || !key) return undefined;
    const parts = key.split('.');
    let cur = catalog;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return typeof cur === 'string' ? cur : undefined;
  }

  /**
   * Replace {name} placeholders in a template.
   *
   * @param {string} template Message template.
   * @param {Record<string, string|number>|undefined} vars Values.
   * @returns {string}
   */
  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => (
      vars[name] != null ? String(vars[name]) : `{${name}}`
    ));
  }

  /**
   * Translate a catalog key.
   *
   * @param {string} key Dotted key.
   * @param {Record<string, string|number>} [vars] Interpolation values.
   * @returns {string}
   */
  function t(key, vars) {
    let raw = lookup(catalogs[currentLocale], key);
    if (raw == null && currentLocale !== 'en') {
      raw = lookup(catalogs.en, key);
    }
    if (raw == null) return key;
    return interpolate(raw, vars);
  }

  /**
   * Plural helper: uses key or key_plural based on count !== 1.
   *
   * @param {string} baseKey Catalog key for singular.
   * @param {number} count Quantity.
   * @param {Record<string, string|number>} [vars] Interpolation (count added).
   * @returns {string}
   */
  function tPlural(baseKey, count, vars) {
    const n = Number(count) || 0;
    const key = n === 1 ? baseKey : `${baseKey}_plural`;
    const merged = Object.assign({ count: n }, vars || {});
    const pluralHit = lookup(catalogs[currentLocale], key)
      || (currentLocale !== 'en' ? lookup(catalogs.en, key) : undefined);
    if (pluralHit != null) return interpolate(pluralHit, merged);
    return t(baseKey, merged);
  }

  /**
   * Apply data-i18n* attributes under a root.
   *
   * @param {ParentNode} [root] Root node (default document).
   */
  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
  }

  /**
   * @returns {string}
   */
  function getLocale() {
    return currentLocale;
  }

  /**
   * @returns {string[]}
   */
  function getSupportedLocales() {
    return SUPPORTED_LOCALES.slice();
  }

  /**
   * Display label for a locale code.
   *
   * @param {string} code Locale code.
   * @returns {string}
   */
  function getLocaleLabel(code) {
    return LOCALE_LABELS[code] || code;
  }

  /**
   * Persist locale, update DOM lang, re-apply static strings, notify listeners.
   *
   * @param {string} code Locale code.
   * @returns {Promise<void>}
   */
  async function setLocale(code) {
    const next = SUPPORTED_LOCALES.includes(code) ? code : 'en';
    if (!catalogs[next]) {
      await loadCatalog(next);
    }
    currentLocale = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) { /* ignore */ }
    document.documentElement.lang = next;
    applyDom();
    try {
      document.dispatchEvent(new CustomEvent('mg:localechange', { detail: { locale: next } }));
    } catch (e) { /* ignore */ }
  }

  /**
   * Map server error payload to a translated string.
   *
   * @param {{ errorKey?: string, error?: string }|null|undefined} res Server result.
   * @param {string} [fallbackKey] Catalog key if nothing matches.
   * @returns {string}
   */
  function formatServerError(res, fallbackKey) {
    if (res && res.errorKey) return t(res.errorKey);
    if (res && res.error) {
      const byMsg = catalogs.en && catalogs.en.errors && catalogs.en.errors.byMessage;
      if (byMsg && byMsg[res.error]) return t(byMsg[res.error]);
      return res.error;
    }
    return t(fallbackKey || 'errors.generic');
  }

  /**
   * Fetch and cache one locale catalog.
   *
   * @param {string} code Locale code.
   * @returns {Promise<object>}
   */
  async function loadCatalog(code) {
    if (catalogs[code]) return catalogs[code];
    const res = await fetch(`/i18n/${code}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`i18n catalog missing: ${code}`);
    const data = await res.json();
    catalogs[code] = data;
    return data;
  }

  /**
   * Detect initial locale from storage or navigator.
   *
   * @returns {string}
   */
  function detectLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
    } catch (e) { /* ignore */ }
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (SUPPORTED_LOCALES.includes(nav)) return nav;
    return 'en';
  }

  /**
   * Boot catalogs and apply DOM.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    await loadCatalog('en');
    const initial = detectLocale();
    if (initial !== 'en') {
      try {
        await loadCatalog(initial);
      } catch (e) {
        /* fall back to en */
      }
    }
    currentLocale = catalogs[initial] ? initial : 'en';
    document.documentElement.lang = currentLocale;
    applyDom();
    readyResolve();
  }

  const api = {
    SUPPORTED_LOCALES,
    ready,
    t,
    tPlural,
    applyDom,
    getLocale,
    setLocale,
    getSupportedLocales,
    getLocaleLabel,
    formatServerError,
    init,
  };

  root.MgI18n = api;
  root.t = t;
  root.tPlural = tPlural;

  init().catch((err) => {
    console.error('[i18n] init failed', err);
    readyResolve();
  });
})(window);
