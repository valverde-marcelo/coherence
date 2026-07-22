#!/usr/bin/env node
'use strict'

/**
 * Validation script for locale files
 * Checks that all locale files have consistent keys
 */

const fs = require('fs')
const path = require('path')

const localesDir = path.join(__dirname, '..', 'locales')

// Get all locale files
const localeFiles = fs.readdirSync(localesDir)
  .filter(f => f.endsWith('.json') && f !== 'template.json')

if (localeFiles.length === 0) {
  console.error('No locale files found in locales/')
  process.exit(1)
}

const locales = {}
for (const file of localeFiles) {
  const lang = file.replace('.json', '')
  const filePath = path.join(localesDir, file)
  try {
    locales[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error(`Error parsing ${file}:`, err.message)
    process.exit(1)
  }
}

console.log(`Validating ${localeFiles.length} locale file(s): ${localeFiles.join(', ')}`)

// Helper to get all keys (recursively, flattened)
function getKeys (obj, prefix = '') {
  const keys = new Set()
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue // Skip metadata
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null) {
      for (const subkey of getKeys(v, fullKey)) {
        keys.add(subkey)
      }
    } else {
      keys.add(fullKey)
    }
  }
  return keys
}

// Check that all locales have the same keys
const refLang = localeFiles[0].replace('.json', '')
const refKeys = getKeys(locales[refLang])
const allLangs = localeFiles.map(f => f.replace('.json', ''))

let hasErrors = false

for (const lang of allLangs) {
  const keys = getKeys(locales[lang])
  const missing = new Set([...refKeys].filter(k => !keys.has(k)))
  const extra = new Set([...keys].filter(k => !refKeys.has(k)))

  if (missing.size > 0) {
    console.error(`❌ ${lang}: Missing keys (${missing.size}):`)
    for (const k of Array.from(missing).sort()) {
      console.error(`   - ${k}`)
    }
    hasErrors = true
  }

  if (extra.size > 0) {
    console.error(`❌ ${lang}: Extra keys (${extra.size}):`)
    for (const k of Array.from(extra).sort()) {
      console.error(`   - ${k}`)
    }
    hasErrors = true
  }

  if (missing.size === 0 && extra.size === 0) {
    console.log(`✓ ${lang}: All keys match`)
  }
}

if (hasErrors) {
  console.error('\n❌ Validation failed')
  process.exit(1)
} else {
  console.log('\n✅ All locale files are valid and consistent')
  process.exit(0)
}
