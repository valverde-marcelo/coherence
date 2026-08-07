'use strict'

window.coherenceI18n = {
  dictionaries: {
    'pt-BR': {
      welcomeTitle: 'Bem-vindo ao Coherence',
      welcomeLead: 'Uma rede social distribuída, sob seu controle.',
      language: 'idioma',
      importIdentity: 'importar chaves',
      createAccount: 'criar nova conta',
      username: 'nome de usuário',
      confirm: 'confirmar',
      imported: 'Identidade importada. Iniciando seu espaço…',
      creating: 'Criando sua identidade…',
      invalidName: 'Use de 1 a 30 caracteres. @ e # não são permitidos.',
      importError: 'Não foi possível importar essa identidade.',
      createError: 'Não foi possível criar a identidade.'
    },
    'en-US': {
      welcomeTitle: 'Welcome to Coherence',
      welcomeLead: 'A distributed social network, under your control.',
      language: 'language',
      importIdentity: 'import keys',
      createAccount: 'create new account',
      username: 'username',
      confirm: 'confirm',
      imported: 'Identity imported. Starting your space…',
      creating: 'Creating your identity…',
      invalidName: 'Use 1 to 30 characters. @ and # are not allowed.',
      importError: 'Could not import that identity.',
      createError: 'Could not create the identity.'
    }
  },
  locale: 'pt-BR',
  text(key) {
    return this.dictionaries[this.locale][key] || key
  },
  apply(locale) {
    this.locale = locale === 'en-US' ? 'en-US' : 'pt-BR'
    document.documentElement.lang = this.locale
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = this.text(element.dataset.i18n)
    })
  }
}
