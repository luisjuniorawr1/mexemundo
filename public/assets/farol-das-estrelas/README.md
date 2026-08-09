# O Farol das Estrelas — assets

Este diretório é o contrato de integração do kit visual entregue em `farol-das-estrelas-hd.zip`.

## Qualidade original

O pacote recebido declara padrão **HD 1920×1080** para backgrounds e telas especiais. Os assets isolados preservam seus tamanhos originais e transparência RGBA.

A integração deve preservar os arquivos **byte a byte**:

- não redimensionar;
- não recomprimir;
- não converter PNG para outro formato;
- não gerar versões menores para substituir os originais;
- não remover alpha/transparência;
- não criar halos ou contornos artificiais.

O jogo já aponta para os nomes e subpastas registrados em `manifest.json`. Enquanto algum PNG estiver ausente no repositório, a história mantém o fallback procedural correspondente.

## Instalação do kit original

Com o ZIP original disponível no checkout do projeto, execute:

```bash
npm run assets:farol -- /caminho/farol-das-estrelas-hd.zip
```

Também é possível informar o diretório `farol-das-estrelas/` já extraído.

O instalador `scripts/install-lighthouse-assets.mjs`:

1. valida os 176 PNGs do kit contra `docs/SHA256SUMS.txt` antes da cópia;
2. copia os arquivos usando `copyFileSync`, sem processamento de imagem;
3. valida novamente os 176 SHA-256 no destino;
4. falha imediatamente se qualquer arquivo estiver ausente ou tiver um único byte diferente.

Teste realizado com o pacote recebido: **176/176 arquivos aprovados antes e depois da cópia**.

## Transporte e integridade

Base64, quando usado apenas como codificação de transporte, também preserva os bytes e não reduz a qualidade de uma imagem. Porém, o kit completo possui cerca de **125,01 MiB**, e o conector GitHub disponível nesta sessão não aceita um arquivo binário local/ZIP como parâmetro de upload. Transferir o pacote inteiro por payload textual seria impraticável e desnecessariamente pesado.

Por isso, o caminho aprovado para os PNGs finais é transferência binária normal seguida da validação com `docs/SHA256SUMS.txt`. O objetivo é garantir que o arquivo presente no repositório seja exatamente o mesmo arquivo recebido no kit.

## Organização do kit

- `backgrounds/` — 9 cenários HD;
- `characters/` — 11 estados de Lume;
- `items/` — fragmentos, cristais e estrela central;
- `obstacles/` — três nuvens e rajada de vento;
- `fx/` — feedbacks e partículas;
- `motion-icons/` — instruções visuais sem depender de leitura;
- `ui/` — progresso, botões e diálogo;
- `screens/` — capa, conclusão e mapa;
- `animations/` — frames individuais e spritesheets.

O `manifest.json` também registra as sequências, FPS e quantidade de frames fornecidos pelo kit.
