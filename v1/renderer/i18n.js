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
      searchingSeeders: 'Buscando seeders na rede para recuperar seus dados…',
      seederFound: 'Seeder encontrado! Baixando seus dados…',
      recoveryPeers: 'peers na rede: {n}',
      seederIncomplete: 'O seeder encontrado está incompleto: ele não tem todas as partes dos seus dados e não consegue enviar o que falta. A busca continua — se um seeder completo aparecer, a recuperação prossegue. Caso contrário, você pode esperar, cancelar e fechar, ou começar do zero.',
      recoveryProgress: 'Recebidos {have} de {length} blocos.',
      recoveryPeersInfo: '{peers} seeders conectados, {complete} completos.',
      recoveryPeersBreakdown: '{complete} completo(s), {partial} parcial(is), {empty} sem dados.',
      startingFromZero: 'Criando um novo espaço para esta identidade…',
      startFromZero: 'começar do zero',
      cancelAndClose: 'cancelar e fechar',
      closing: 'Fechando…',
      creating: 'Criando sua identidade…',
      invalidName: 'Use de 1 a 30 caracteres. @ e # não são permitidos.',
      importError: 'Não foi possível importar essa identidade.',
      createError: 'Não foi possível criar a identidade.',
      settings: 'configurações', close: 'fechar', about: 'sobre', faq: 'FAQ',
      settingsLanguage: 'idioma', exportIdentity: 'exportar identidade', resetApp: 'resetar aplicação',
      exportingIdentity: 'Exportando identidade…', exportSuccess: 'Identidade exportada com sucesso.', exportCanceled: 'Exportação cancelada.', exportError: 'Não foi possível exportar a identidade.',
      resetConfirmTitle: 'Resetar aplicação?', resetConfirmMessage: 'Tem certeza que deseja resetar? Isso excluirá permanentemente sua identidade, perfil, posts e configurações. Esta ação não pode ser desfeita.',
      cancel: 'cancelar', confirmReset: 'confirmar reset', resetting: 'Resetando aplicação…', resetError: 'Não foi possível resetar a aplicação.',
      aboutProject: 'projeto', aboutDescription: 'Rede social descentralizada baseada em Hypercore.', aboutVersion: 'versão', aboutGithub: 'repositório no GitHub', aboutStackTitle: 'tecnologia', donationCaption: 'Contribua com o desenvolvimento', donatePaypal: 'doar via PayPal', donateBmc: 'doar via Buy Me a Coffee', checkForUpdates: 'verificar atualizações', checkingForUpdates: 'Verificando atualizações…', updateAvailable: 'Nova versão {version} disponível!', updateDownload: 'baixar', updateUpToDate: 'Você está na versão mais recente ({version}).', updateCheckError: 'Não foi possível verificar atualizações agora.',

      // Main app UI
      back: '← voltar', searchUsersTitle: 'pesquisar usuários',
      searchPlaceholder: 'buscar por nome ou chave…', search: 'pesquisar',
      composerPlaceholder: 'transmitir algo para a rede…', addImage: '+ imagem', publish: 'publicar',
      feedEmpty: 'nenhuma transmissão ainda. publique a primeira, ou siga alguém.',
      following: 'seguindo', followers: 'seguidores',
      followPlaceholder: 'colar chave pública (hex)', follow: 'seguir',
      avatarTitle: 'Clique para alterar avatar', copyKeyTitle: 'Clique para copiar para área de trabalho',
      copied: 'copiado!', connecting: 'conectando…',
      name: 'nome', bio: 'bio', linksMax: 'links (máximo 3)',
      addLink: '+ adicionar link', save: 'salvar',
      copyKey: 'Copiar chave', unfollow: 'Deixar de seguir',
      noName: 'sem nome', noPeersConnected: 'nenhum peer conectado ainda',
      peersConnected: '{n} peers conectados', peerConnected: '1 peer conectado',
      syncing: 'sincronizando…', you: 'você', loading: 'carregando…',
      userDefault: 'Usuário', copyFullKey: 'Clique para copiar chave completa',
      posts: 'postagens', noUsersHere: 'nenhum usuário aqui ainda',
      viewProfile: 'ver perfil', followingDone: '✓ seguindo',
      noFollowersYet: 'nenhum seguidor ainda',
      composerErrorEmpty: 'escreva algo ou anexe uma imagem antes de publicar.',
      searching: 'buscando…', noResults: 'Nenhum resultado encontrado', searchError: 'erro na busca',
      followingRelation: 'seguindo/seguidor', viaNetwork: 'via rede', viaUser: 'via {name}',
      suggestedUsersTitle: 'usuários sugeridos', suggested: 'sugerido',
      addLinkTitle: 'adicionar link', title: 'título', linkTitlePlaceholder: 'ex: Meu Site',
      url: 'URL', urlPlaceholder: 'https://exemplo.com', add: 'adicionar',
      fillTitleUrl: 'Preencha título e URL', maxLinksReached: 'Máximo de 3 links atingido', link: 'Link',
      faqItems: [
        ['O que é o Coherence?', 'É uma rede social descentralizada onde cada usuário é dono dos seus dados, armazenados localmente e replicados entre pares.'],
        ['Como meus dados são protegidos?', 'Todos os dados são assinados com sua chave privada. Ninguém pode alterar seus posts ou perfil sem ter sua chave.'],
        ['O que acontece se eu perder minhas chaves?', 'Suas chaves são a única forma de acessar sua conta. Faça backup do identity.json, que também guarda o endereço do seu Hypercore.'],
        ['Como funciona a rede P2P?', 'O aplicativo usa Hypercore e Hyperswarm para replicar dados entre usuários sem servidores centrais.'],
        ['Posso recuperar minha conta em outro dispositivo?', 'Sim. Importe apenas o identity.json. Um seeder precisa estar online para recuperar perfil, posts e seguidores; sem seeder, você pode continuar aguardando, cancelar e fechar, ou começar do zero.'],
        ['O que é o Hypercore?', 'É um banco de dados imutável, assinado e distribuído, que garante integridade e ordem dos dados.'],
        ['Como faço para seguir alguém?', 'Você precisa da chave pública da pessoa. Cole-a no campo Seguir e aguarde a conexão P2P.'],
        ['Meus posts são públicos?', 'Sim, qualquer pessoa com sua chave pública pode acessar seu perfil e posts quando houver peers semeando seus dados.'],
        ['O aplicativo é gratuito?', 'Sim, é open-source e gratuito. Contribuições são bem-vindas via doação.'],
        ['Como posso contribuir com o projeto?', 'Contribua com código via GitHub, reporte problemas ou faça doações.']
      ].map(([question, answer]) => ({ question, answer }))
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
      searchingSeeders: 'Looking for seeders on the network to recover your data…',
      seederFound: 'Seeder found! Downloading your data…',
      recoveryPeers: 'peers on the network: {n}',
      seederIncomplete: 'The seeder found is incomplete: it does not have all parts of your data and cannot send what is missing. The search continues — if a complete seeder appears, recovery proceeds. Otherwise, you can wait, cancel and close, or start from zero.',
      recoveryProgress: 'Received {have} of {length} blocks.',
      recoveryPeersInfo: '{peers} seeders connected, {complete} complete.',
      recoveryPeersBreakdown: '{complete} complete, {partial} partial, {empty} with no data.',
      startingFromZero: 'Creating a new space for this identity…',
      startFromZero: 'start from zero',
      cancelAndClose: 'cancel and close',
      closing: 'Closing…',
      creating: 'Creating your identity…',
      invalidName: 'Use 1 to 30 characters. @ and # are not allowed.',
      importError: 'Could not import that identity.',
      createError: 'Could not create the identity.',
      settings: 'settings', close: 'close', about: 'about', faq: 'FAQ',
      settingsLanguage: 'language', exportIdentity: 'export identity', resetApp: 'reset application',
      exportingIdentity: 'Exporting identity…', exportSuccess: 'Identity exported successfully.', exportCanceled: 'Export canceled.', exportError: 'Could not export the identity.',
      resetConfirmTitle: 'Reset application?', resetConfirmMessage: 'Are you sure you want to reset? This will permanently delete your identity, profile, posts, and settings. This action cannot be undone.',
      cancel: 'cancel', confirmReset: 'confirm reset', resetting: 'Resetting application…', resetError: 'Could not reset the application.',
      aboutProject: 'project', aboutDescription: 'A decentralized social network based on Hypercore.', aboutVersion: 'version', aboutGithub: 'GitHub repository', aboutStackTitle: 'technology', donationCaption: 'Support development', donatePaypal: 'donate via PayPal', donateBmc: 'donate via Buy Me a Coffee', checkForUpdates: 'check for updates', checkingForUpdates: 'Checking for updates…', updateAvailable: 'New version {version} available!', updateDownload: 'download', updateUpToDate: 'You are on the latest version ({version}).', updateCheckError: 'Could not check for updates right now.',

      // Main app UI
      back: '← back', searchUsersTitle: 'search users',
      searchPlaceholder: 'search by name or key…', search: 'search',
      composerPlaceholder: 'broadcast something to the network…', addImage: '+ image', publish: 'publish',
      feedEmpty: 'no posts yet. publish the first one, or follow someone.',
      following: 'following', followers: 'followers',
      followPlaceholder: 'paste public key (hex)', follow: 'follow',
      avatarTitle: 'Click to change avatar', copyKeyTitle: 'Click to copy to clipboard',
      copied: 'copied!', connecting: 'connecting…',
      name: 'name', bio: 'bio', linksMax: 'links (max 3)',
      addLink: '+ add link', save: 'save',
      copyKey: 'Copy key', unfollow: 'Unfollow',
      noName: 'no name', noPeersConnected: 'no peers connected yet',
      peersConnected: '{n} peers connected', peerConnected: '1 peer connected',
      syncing: 'syncing…', you: 'you', loading: 'loading…',
      userDefault: 'User', copyFullKey: 'Click to copy full key',
      posts: 'posts', noUsersHere: 'no users here yet',
      viewProfile: 'view profile', followingDone: '✓ following',
      noFollowersYet: 'no followers yet',
      composerErrorEmpty: 'write something or attach an image before publishing.',
      searching: 'searching…', noResults: 'No results found', searchError: 'search error',
      followingRelation: 'following/follower', viaNetwork: 'via network', viaUser: 'via {name}',
      suggestedUsersTitle: 'suggested users', suggested: 'suggested',
      addLinkTitle: 'add link', title: 'title', linkTitlePlaceholder: 'e.g. My Site',
      url: 'URL', urlPlaceholder: 'https://example.com', add: 'add',
      fillTitleUrl: 'Fill in title and URL', maxLinksReached: 'Maximum of 3 links reached', link: 'Link',
      faqItems: [
        ['What is Coherence?', 'It is a decentralized social network where each user owns their data, stored locally and replicated between peers.'],
        ['How is my data protected?', 'All data is signed with your private key. Nobody can alter your posts or profile without your key.'],
        ['What happens if I lose my keys?', 'Your keys are the only way to access your account. Back up identity.json, which also stores your Hypercore address.'],
        ['How does the P2P network work?', 'The app uses Hypercore and Hyperswarm to replicate data directly between users without central servers.'],
        ['Can I recover my account on another device?', 'Yes. Import only identity.json. A seeder must be online to recover your profile, posts and followers; without one, you can keep waiting, cancel and close, or start from zero.'],
        ['What is Hypercore?', 'It is an immutable, signed, distributed database that guarantees data integrity and ordering.'],
        ['How do I follow someone?', 'You need their public key. Paste it into the Follow field and wait for the P2P connection.'],
        ['Are my posts public?', 'Yes, anyone with your public key can access your profile and posts when peers are seeding your data.'],
        ['Is the application free?', 'Yes, it is open-source and free. Contributions are welcome through donations.'],
        ['How can I contribute?', 'Contribute code through GitHub, report issues, or make donations.']
      ].map(([question, answer]) => ({ question, answer }))
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
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      element.placeholder = this.text(element.dataset.i18nPlaceholder)
    })
    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.title = this.text(element.dataset.i18nTitle)
    })
    if (typeof this.onApply === 'function') this.onApply(this.locale)
  }
}
