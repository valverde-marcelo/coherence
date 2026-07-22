'use strict'

/**
 * Lightweight i18n translator module for Coherence
 * Supports dot-notation keys and pluralization for Portuguese (BR) and English
 */

class Translator {
  constructor (localesObj = {}, defaultLang = 'pt-BR') {
    this.locales = localesObj // { 'pt-BR': {...}, 'en': {...} }
    this.currentLang = defaultLang
    this.defaultLang = defaultLang
  }

  setCurrentLang (lang) {
    if (this.locales[lang]) {
      this.currentLang = lang
    } else {
      console.warn(`Language "${lang}" not available, keeping "${this.currentLang}"`)
    }
  }

  getCurrentLang () {
    return this.currentLang
  }

  /**
   * Get a translation value using dot-notation key
   * @param {string} key - e.g., 'identity.label', 'errors.publishError'
   * @param {string} lang - Language code (e.g., 'pt-BR', 'en'). Defaults to currentLang.
   * @param {*} defaultValue - Fallback value if key not found
   * @returns {*} Translated string or defaultValue
   */
  t (key, lang, defaultValue = '') {
    if (!lang) lang = this.currentLang
    const locale = this.locales[lang]
    if (!locale) return defaultValue

    const keys = key.split('.')
    let value = locale
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return defaultValue
      }
    }
    return value !== undefined ? value : defaultValue
  }

  /**
   * Get plural form of a translation key
   * Portuguese and English both use binary singular/plural:
   *   - singular (count === 1)
   *   - plural (count !== 1, including 0)
   *
   * @param {number} count - The count to determine plural form
   * @param {string} keyPrefix - Base key, e.g., 'follows.lastSeqMeta'
   *                             Will append '_one' or '_other'
   * @param {string} lang - Language code. Defaults to currentLang.
   * @returns {string} The plural form string
   */
  pluralize (count, keyPrefix, lang) {
    if (!lang) lang = this.currentLang
    const suffix = count === 1 ? '_one' : '_other'
    return this.t(keyPrefix + suffix, lang, '')
  }

  /**
   * Format a string with placeholders {key}
   * e.g., formatString('Seq {seq} · Hash {hash}', { seq: 5, hash: 'abc123' })
   * @param {string} template - String with {placeholder} markers
   * @param {object} values - Object with placeholder values
   * @returns {string} Formatted string
   */
  formatString (template, values = {}) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return key in values ? values[key] : match
    })
  }

  /**
   * Get the language label for display in UI (e.g., "Português (Brasil)", "English")
   * @param {string} lang - Language code
   * @returns {string} Human-readable language name
   */
  getLanguageLabel (lang) {
    return this.t('_meta.languageLabel', lang, lang)
  }

  /**
   * Get list of available languages
   * @returns {array} Array of language codes
   */
  getAvailableLanguages () {
    return Object.keys(this.locales)
  }
}

// Factory function for creating translator instances
function createTranslator (localesObj = {}, defaultLang = 'pt-BR') {
  return new Translator(localesObj, defaultLang)
}

// For Node.js (main process)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTranslator, Translator }
}

// For browser (renderer process), expose globally
if (typeof window !== 'undefined') {
  window.Translator = Translator
  window.createTranslator = createTranslator
}
