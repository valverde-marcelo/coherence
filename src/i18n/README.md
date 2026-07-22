# Internationalization (i18n) System

Coherence uses a lightweight, JSON-based internationalization system to support multiple languages.

## Overview

The i18n system consists of:

- **Locale files** (`locales/[lang].json`) — JSON dictionaries with translated strings
- **Translator module** (`src/i18n/translator.js`) — Core i18n logic (lookup, pluralization, formatting)
- **IPC bridge** (`electron/preload.js`) — Exposes translator API to the renderer process
- **UI integration** (`renderer/app.js`) — Uses `window.api.i18n.t()` to fetch strings dynamically
- **Validation script** (`scripts/validate-locales.js`) — Ensures all locales have identical key structures

## Supported Languages

Currently supported languages:
- **pt-BR** — Portuguese (Brazil) *(default)*
- **en** — English

To add a new language, see [Contributing translations](../CONTRIBUTING.md#contributing-translations).

## File Structure

```
coherence/
├── locales/
│   ├── pt-BR.json          # Portuguese (Brazil) translations
│   ├── en.json             # English translations
│   └── [other-lang].json   # (Future) Other language translations
├── src/
│   └── i18n/
│       └── translator.js   # Core i18n module
├── electron/
│   ├── main.js             # Loads locales, manages i18n state
│   └── preload.js          # Exposes window.api.i18n
├── renderer/
│   └── app.js              # Uses window.api.i18n.t() for translations
└── scripts/
    └── validate-locales.js # Validates locale consistency
```

## Locale File Format

Each locale file follows this structure:

```json
{
  "_meta": {
    "language": "pt-BR",
    "languageLabel": "Português (Brasil)",
    "contributors": ["initial", "your-username"]
  },
  "namespace1": {
    "key1": "translated string",
    "key2": "another string",
    "nested": {
      "key3": "nested translation"
    }
  },
  "namespace2": {
    ...
  }
}
```

### Key naming conventions

- **Namespaces**: Group related strings (e.g., `identity`, `feed`, `errors`, `nav`, `common`)
- **Dot notation**: Access nested keys as `namespace.key` or `namespace.nested.key`
- **Plurals**: Use `_one` and `_other` suffixes:
  - `follows.lastSeqMeta_one` — singular form
  - `follows.lastSeqMeta_other` — plural form (includes 0)

### Example locale structure

```json
{
  "_meta": {
    "language": "pt-BR",
    "languageLabel": "Português (Brasil)",
    "contributors": ["initial"]
  },
  "common": {
    "copy": "Copiar",
    "copied": "Copiado!",
    "loading": "carregando…"
  },
  "identity": {
    "label": "sua identidade (chave pública)",
    "displayNamePlaceholder": "seu nome de exibição (opcional)"
  },
  "feed": {
    "emptyWithoutFollows": "Nenhum post ainda...",
    "youLabel": "Você",
    "postFooterFmt": "seq {seq} · hash {hash}…"
  }
}
```

## Using the i18n system

### In the renderer process (UI)

#### 1. Static text with `data-i18n` attribute

For HTML elements with static text, use `data-i18n` attributes. The renderer automatically applies translations on init:

```html
<button data-i18n="common.copy">Copiar</button>
<label data-i18n="identity.label">sua identidade</label>
```

#### 2. Placeholder attributes with `data-i18n-placeholder`

For input placeholder text:

```html
<input data-i18n-placeholder="identity.displayNamePlaceholder" placeholder="seu nome de exibição" />
```

#### 3. Dynamic text in JavaScript

Use `window.api.i18n.t()` inside async functions:

```javascript
async function showError() {
  const errMsg = await window.api.i18n.t('errors.publishError', 'Erro ao publicar:')
  alert(errMsg + ' ' + error.message)
}
```

#### 4. String formatting with placeholders

Use locale keys with format patterns:

```javascript
const footerFmt = await window.api.i18n.t('feed.postFooterFmt', 'seq {seq} · hash {hash}…')
const footer = footerFmt
  .replace('{seq}', post.seq)
  .replace('{hash}', post.hash.slice(0, 12))
```

Or use `window.api.i18n.formatString()`:

```javascript
const footer = await window.api.i18n.formatString('feed.postFooterFmt', {
  seq: post.seq,
  hash: post.hash.slice(0, 12)
})
```

#### 5. Plural forms

Use `window.api.i18n.pluralize()`:

```javascript
const metaText = await window.api.i18n.pluralize(count, 'follows.lastSeqMeta')
// Returns 'último post: seq' (same for both singular/plural in Portuguese)
```

### In the main process

The main process loads all locale files at startup and uses the `Translator` class directly:

```javascript
const { createTranslator } = require('../src/i18n/translator')

// Already done in electron/main.js:
const translator = createTranslator(localesData, 'pt-BR')

// Use directly:
const translated = translator.t('common.copy', 'pt-BR', 'Copy')
const current = translator.getCurrentLang() // 'pt-BR'
translator.setCurrentLang('en')
```

## Translator API

### Methods

- **`t(key, lang, defaultValue)`** — Get a translated string
  - `key` (string): dot-notation key, e.g., `'common.copy'`
  - `lang` (string, optional): language code; defaults to current language
  - `defaultValue` (string, optional): fallback if key not found
  - Returns: translated string or defaultValue

- **`setCurrentLang(lang)`** — Set active language
- **`getCurrentLang()`** — Get active language code
- **`getAvailableLanguages()`** — Get array of all available language codes
- **`pluralize(count, keyPrefix, lang)`** — Get plural form
  - Appends `_one` or `_other` to keyPrefix based on count === 1
- **`formatString(template, values)`** — Replace `{placeholder}` with values
- **`getLanguageLabel(lang)`** — Get human-readable language name (e.g., "Português (Brasil)")

## Adding a new translation key

1. **Add to all locale files**:
   ```json
   {
     "myNamespace": {
       "myKey": "Translated string"
     }
   }
   ```

2. **Run validation**:
   ```bash
   npm run validate-locales
   ```

3. **Use in code**:
   ```javascript
   const text = await window.api.i18n.t('myNamespace.myKey')
   ```

## Changing the default language

The default language is currently **Portuguese (Brazil)** (`pt-BR`). To change:

1. Edit `electron/main.js`:
   ```javascript
   const translator = createTranslator(localesData, 'en') // Changed from 'pt-BR'
   ```

2. Update HTML `lang` attribute in `renderer/index.html`:
   ```html
   <html lang="en">
   ```

3. Update default locale string in `app.js` fallbacks

## Language persistence

The user's language preference is stored in the app's internal store (`settings.language`). This persists across sessions and is restored on startup via `socialApp.store.get('settings.language')` in `electron/main.js`.

## Validation

Run the validation script to ensure all locale files are consistent:

```bash
npm run validate-locales
```

This checks that:
- All locale files have identical top-level keys
- No keys are missing in any language
- No extra/unexpected keys exist

## Future enhancements

- **Crowdin/Weblate integration**: Allow community translators via a web platform
- **Translation memory**: Cache frequently translated strings
- **Date/time localization**: Full locale-aware date/time formatting beyond current `toLocaleString()`
- **RTL language support**: Add `dir="rtl"` to HTML for Arabic, Hebrew, etc.
- **More complex pluralization rules**: Support languages with >2 plural forms (Polish, Russian, etc.) via CLDR plural rules
- **Translation statistics**: Track completion % per language in CI

