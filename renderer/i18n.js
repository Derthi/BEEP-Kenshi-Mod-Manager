// Simple i18n translation system
// Loads JSON locale files, provides t(key, params) function,
// and updateDOM() to refresh all [data-i18n] elements.

const SUPPORTED_LOCALES = {
  en: 'English',
  de: 'Deutsch',
  ja: '日本語',
  zh: '中文',
  fr: 'Français',
};

let currentLocale = 'en';
let strings = {};
let fallbackStrings = {};

async function loadLocale(locale) {
  try {
    const resp = await fetch(`locales/${locale}.json`);
    return await resp.json();
  } catch {
    console.warn(`Failed to load locale: ${locale}`);
    return {};
  }
}

async function initI18n(locale) {
  currentLocale = locale || 'en';
  fallbackStrings = await loadLocale('en');
  if (currentLocale !== 'en') {
    strings = await loadLocale(currentLocale);
  } else {
    strings = fallbackStrings;
  }
  updateDOM();
}

async function setLocale(locale) {
  currentLocale = locale;
  if (locale !== 'en') {
    strings = await loadLocale(locale);
  } else {
    strings = fallbackStrings;
  }
  updateDOM();
}

// Translate a key with optional interpolation: t('key', { count: 5 })
// Placeholders in strings use {name} syntax: "Found {count} mods"
function t(key, params) {
  let str = strings[key] || fallbackStrings[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return str;
}

// Update all DOM elements with data-i18n attribute
function updateDOM() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

function getCurrentLocale() {
  return currentLocale;
}
