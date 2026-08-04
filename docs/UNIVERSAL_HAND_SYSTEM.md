# Sistema Universal de Mãos do MexeMundo

## Regra principal

O MexeMundo possui um único sistema de reconhecimento bilateral. Jogos não implementam, configuram nem calibram rastreamento de mãos.

A calibração pode ser apresentada durante a preparação de qualquer jogo, mas o perfil criado pertence à plataforma inteira e é reutilizado por todos os jogos no mesmo aparelho e navegador.

## Responsabilidades do núcleo universal

Somente o núcleo universal pode definir ou alterar:

- versão e modelo do MediaPipe;
- quantidade de mãos;
- confiança de detecção, presença e rastreamento;
- resolução e frequência solicitadas à câmera;
- execução em worker e fallback de CPU/GPU;
- descarte de quadros e frequência adaptativa;
- identidade contínua da mão esquerda e direita;
- centro da palma;
- filtros temporais e zona de repouso;
- recuperação após oclusão;
- calibração e perfil por aparelho;
- validade temporal dos pacotes;
- posição visual e trajetória de colisão;
- formato do protocolo enviado aos jogos.

Essas configurações ficam em `public/js/hand-system-config.js`.

## Responsabilidades permitidas aos jogos

Um jogo pode definir somente sua mecânica, por exemplo:

- tamanho visual das mãos;
- formato e tamanho da área de colisão do objeto;
- regras, pontuação e dificuldade;
- tempo da partida;
- posição de alvos, balões, bolas ou instrumentos;
- significado de gestos já fornecidos pelo núcleo.

Um jogo não pode:

- importar MediaPipe;
- acessar landmarks brutos diretamente;
- criar outro perfil em `localStorage`;
- definir zona morta ou filtro próprio;
- escolher confiança de detecção;
- trocar a identidade das mãos;
- criar predição ou suavização paralela.

## Contrato para jogos novos

Todo jogo novo deve consumir `UniversalHandInput` de `public/js/game-hand-input.js`.

```js
import { UniversalHandInput } from './game-hand-input.js';

const hands = new UniversalHandInput();

socket.on('pose', (payload) => {
  hands.ingest(payload);
});

function frame(now) {
  const input = hands.sample(now);
  const visual = input.visual;
  const collision = input.collision;

  // visual.left / visual.right para desenhar
  // collision.left / collision.right para testar contatos
}
```

## Perfil universal

O perfil oficial usa:

- chave: `mexemundo-universal-hand-profile-v1`;
- escopo: `universal-two-hand`;
- uma configuração individual para cada mão;
- versão do sistema que o criou;
- informações de desempenho do aparelho.

Trocar de jogo não cria outro perfil. O perfil só é recriado quando:

1. não existe um perfil válido;
2. a versão do núcleo exige migração;
3. o usuário solicita recalibração;
4. o sistema detecta que a câmera ou o comportamento mudou de forma incompatível.

## Versionamento

Mudanças de mecânica de um jogo não alteram o sistema de mãos.

Mudanças no rastreamento devem atualizar `HAND_SYSTEM_VERSION` e ser validadas nos jogos existentes antes da publicação. O objetivo é impedir que um jogo novo resolva um problema local alterando configurações que afetariam toda a plataforma.
