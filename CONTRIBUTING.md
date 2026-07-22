# Contributing to Coherence

Thank you for your interest in contributing to Coherence. This project is open source under the Apache License 2.0, and contributions are welcome from developers who want to improve the app or build compatible clients.

## How to contribute

1. Open an issue first to discuss substantial changes.
2. Use clear, focused pull requests.
3. Include tests or reproduction steps for bug fixes.
4. Preserve the Apache 2.0 license and attribution notices in any modified source files.

## Issue types

- Bug report: unexpected behavior, crashes, or broken features.
- Feature request: protocol improvements, new UI workflows, or interoperability enhancements.
- Documentation: clarifications, README updates, or examples.

## Development workflow

- Fork the repository.
- Create a branch with a short descriptive name.
- Make incremental changes.
- Open a pull request describing what changed and why.

## Contributing translations

Coherence supports multiple languages! Community translations are welcome.

### How to contribute a translation

1. **Choose a language** not yet supported (or improve an existing one).
2. **Copy an existing locale file** as template:
   - Base template: `locales/pt-BR.json` (Portuguese) or `locales/en.json` (English)
3. **Create your locale file**: `locales/[language-code].json`
   - Use standard language codes (e.g., `es` for Spanish, `fr` for French, `de` for German, `zh-CN` for Simplified Chinese)
4. **Translate all keys** while preserving the JSON structure:
   ```json
   {
     "_meta": {
       "language": "es",
       "languageLabel": "Español",
       "contributors": ["your-github-username"]
     },
     "common": {
       "copy": "Copiar",
       ...
     },
     ...
   }
   ```

### Translation guidelines

- **Do not translate technical terms** (keys like `seq`, `DHT`, `WebTorrent`, etc.)
- **Preserve placeholders** like `{seq}`, `{hash}`, `{user}` in format strings (e.g., `"seq {seq} · hash {hash}…"`)
- **Maintain plural forms** where needed:
  - Singular form key: `lastSeqMeta_one`
  - Plural form key: `lastSeqMeta_other`
  - Example: `"último post: seq"` (both singular and plural in Portuguese/English use same text, but structure allows for languages with more complex rules)
- **Keep formatting and emojis** intact (e.g., `"↓"`, `"📎"`)
- **String length**: keep translations reasonably close to English length to avoid UI layout issues

### Validation before submitting PR

Run the validation script to ensure your locale file is complete:

```bash
npm run validate-locales
```

This checks that your new locale file has all required keys matching other locale files.

### Example contribution steps

```bash
# 1. Fork and clone the repo
git clone https://github.com/YOUR-USERNAME/coherence.git
cd coherence

# 2. Create a branch
git checkout -b add-spanish-translation

# 3. Copy and translate
cp locales/pt-BR.json locales/es.json
# Edit locales/es.json with your translations

# 4. Validate
npm run validate-locales

# 5. Commit and push
git add locales/es.json
git commit -m "Add Spanish translation"
git push origin add-spanish-translation

# 6. Open a pull request on GitHub
```

### Adding yourself as a contributor

In the locale file metadata, include your GitHub username in the `contributors` array:

```json
{
  "_meta": {
    "language": "es",
    "languageLabel": "Español",
    "contributors": ["your-github-username", "other-contributor"]
  },
  ...
}
```

## Attribution and licensing

By contributing to this project, you agree that your contributions will be licensed under Apache License 2.0. Keep attributions intact and do not remove the original copyright and license headers.
