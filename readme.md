# Flexi Device — Simulador Mobile (extensão Chrome)

Extensão Manifest V3 que mostra o site da aba atual em molduras de iPhone, iPad e Android lado a lado, com user agent mobile real. Sem dependências e sem build.

## Instalar (modo desenvolvedor)

1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha esta pasta.
3. Abra qualquer site e clique no ícone da extensão (ou botão direito → *Ativar/desativar Flexi Device*).

Clique de novo no ícone, ou no **X** da barra superior, para sair. A aba é recarregada com os headers normais.

## Como funciona

| Camada | Arquivo | O que faz |
|---|---|---|
| Service worker | `js/background.js` | Ativa/desativa por aba, cria regras `declarativeNetRequest` de sessão (só para aquela aba) que removem `X-Frame-Options` / `Content-Security-Policy` e trocam `User-Agent` + client hints. Injeta o content script e reinjeta após navegação. Faz a captura de tela com `tabs.captureVisibleTab`. |
| Content script | `js/content.js` | Monta a interface dentro de um Shadow DOM (o CSS da página não interfere). Cada dispositivo é um `<iframe>` no tamanho exato do viewport, escalado via `transform` para caber na tela. |
| Estilos | `css/content.css` | Molduras desenhadas em CSS, barras de navegador, painel de definições e temas. |

Os headers só são alterados enquanto o simulador está ativo naquela aba. Ao fechar, as regras são removidas e a aba recarrega.

As molduras são reduzidas com `zoom` (não `transform: scale`) e todas as bordas são alinhadas a pixels inteiros do dispositivo. Isso evita o fio claro que o compositor do Chrome deixa ao redor de um iframe escalado enquanto a página rola.

## Recursos

- Catálogo com 80 dispositivos (`js/devices.js`): iPhones, iPads, Samsung, Google, Xiaomi, Motorola, OnePlus, notebooks e desktops
- Seletor com busca, filtros (ano, Flagship, Top), favoritos e seções por marca; troca de dispositivo direto no cabeçalho de cada moldura
- Dispositivos personalizados (nome, largura, altura, tipo, estilo), salvos em `chrome.storage.local`
- Vários dispositivos ao mesmo tempo, cada um ocupando uma fração igual da tela (1/n), centralizado e escalado para caber
- Arrastar e soltar (pela moldura ou pelo rótulo) para reordenar os dispositivos
- Divisores entre os dispositivos para redimensionar a área de cada um (duplo clique iguala)
- Dispositivo selecionado com borda azul; girar, captura e troca de modelo agem sobre ele
- Navegação sincronizada: ao trocar de página em um dispositivo, os outros acompanham (frames da mesma origem da aba)
- Rolagem sincronizada por proporção, com opção para desligar
- Painel de definições (engrenagem): moldura on/off, UI realista, rolagem sincronizada, tema (sistema/claro/escuro), modo de tela (navegador com barra de URL e toolbar do Safari ou Chrome, PWA só com barra de status, tela cheia), URL e hora personalizadas, user agent
- Molduras em CSS com anel metálico em gradiente, Dynamic Island com lente, notch, furo de câmera, botões laterais, iPhone SE com botão físico, iPad com câmera frontal e barra de abas, notebook com base de alumínio
- Seleção de user agent: iOS (Safari), Android (Chrome) ou desktop
- Captura de tela por dispositivo (PNG, recorte da moldura)
- Interface em português (pt-BR) e inglês

## Limitações

- Páginas internas do Chrome, a Web Store e `file://` não são suportadas.
- A captura de tela usa a resolução em que a moldura aparece na tela. Dispositivos reduzidos por escala geram imagens menores.
- Sites que detectam iframe por JavaScript (`window.top !== window.self`) podem se comportar diferente.
- Sem gravação de vídeo nesta versão.
