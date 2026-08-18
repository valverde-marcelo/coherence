
- corrigir referencia ao btc lightning

- [x] permitir smiles e links dentro do post. limitar quantidade de caracteres.
    (implementado: seletor de emojis no composer, limite de 1000 caracteres na postagem,
     "ver mais/ver menos" na exibição a partir de 300 caracteres, formatação estilo WhatsApp:
     *negrito*, _itálico_, ~tachado~ e > citação)

- [x] redimensionar imagens localmente antes da postagem (ffmpeg/exif?)
    (implementado: compressão local via canvas/JPEG quando a imagem anexada excede 400KB)

- [x] criar um protocolo para abrir links coherence://
    (implementado: registro do protocolo coherence:// no Windows — NSIS via build.protocols
     e dev via setAsDefaultProtocolClient. Rotas: coherence://profile/<chave64> e
     coherence://post/<chave64>/<seq>. Roteamento para qualquer janela aberta via registro
     em %TEMP%/coherence-deeplink + porta loopback por conta; se nenhuma estiver aberta,
     o app abre e aplica o link após escolher a conta. Perfil de quem você não segue é
     carregado sob demanda (ensureProfileLoaded); post abre o perfil e rola/destaca o post)