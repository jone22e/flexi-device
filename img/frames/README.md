# Molduras fotográficas (renders de dispositivos)

A extensão original não desenha as molduras: ela usa um **render fotográfico por dispositivo**
(arquivo AVIF/PNG com canal alfa, em 2x, com a área da tela transparente) e posiciona o iframe
dentro do recorte, cortado por um caminho SVG com a forma da tela. O Flexi Device suporta o mesmo
mecanismo. Para usar, adicione a imagem nesta pasta e declare no dispositivo, em `js/devices.js`:

```js
{ id: 'iphone-15', name: 'iPhone 15', w: 393, h: 852, ..., 
  frame: {
    image: 'img/frames/iphone-15.png', // render com a tela transparente (2x recomendado)
    w: 438, h: 892,                    // tamanho do render em px CSS (1x)
    x: 22, y: 20,                      // canto superior esquerdo da tela dentro do render (1x)
    mask: 'M44 0H349C…Z',              // (opcional) caminho SVG da forma da tela, em px 1x, origem no canto da tela
  } }
```

`w`/`h` do dispositivo continuam sendo o viewport da página; `frame.w`/`frame.h` são o render inteiro.
Sem `frame`, o dispositivo usa a moldura desenhada em CSS.

Os PNGs desta pasta vêm de https://www.webmobilefirst.com/en/mockups/ (uso pessoal e comercial permitido, sem atribuição; só a revenda do arquivo é proibida). A posição da tela de cada um foi medida pelo canal alfa e está em `js/devices.js`.

Outras fontes de renders com licença de uso: kits de mockup (pagos ou gratuitos, por exemplo os
"Devices" do Meta Design Resources), ou renders próprios exportados do Figma/Sketch com a tela
transparente. Os arquivos da extensão original são proprietários e não devem ser copiados.
