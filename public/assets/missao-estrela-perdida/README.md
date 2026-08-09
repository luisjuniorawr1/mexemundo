# Missão: Estrela Perdida — assets HD

Kit visual original da história espacial do MexeMundo.

## Padrão de resolução

- backgrounds e telas principais: **HD 1920×1080 (16:9)**;
- personagens, objetos, FX e frames: resolução útil própria do asset;
- **nenhuma imagem 4K**;
- PNGs transparentes permanecem RGBA.

## Integridade

Os PNGs devem ser preservados **byte a byte**. Não redimensionar, reexportar, recomprimir, converter perfil de cor ou remover transparência.

O arquivo `docs/SHA256SUMS.txt` contém o SHA-256 aprovado de todos os **148 PNGs**.

ZIP aprovado nesta integração:

- tamanho: `80029968` bytes;
- SHA-256: `181e56952d0ae866825298b95b2e5bd360c617d8be3ee31b508a2b607484b3fa`.

## Instalação

```bash
npm run assets:missao-estrela -- /caminho/missao-estrela-perdida-hd.zip
```

O instalador valida todos os hashes antes da cópia, usa `copyFileSync` sem processamento de imagem e valida novamente depois da cópia.
