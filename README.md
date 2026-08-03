# MexeMundo — Protótipo 0.6.0

Plataforma infantil de minijogos corporais controlados pela câmera do celular.

## O que já funciona

- A TV abre o jogo em `/tv` e cria um código de sala.
- O celular entra em `/celular`, processa a câmera com MediaPipe e envia somente pontos corporais.
- A conexão tenta usar WebRTC direto entre celular e TV.
- O WebSocket do servidor permanece como sinalização e fallback.
- O jogo **Estoura-Balões** possui calibração, rodada, pontuação, combo, efeitos, sons e reinício por gesto.
- Há diagnóstico de FPS, pose e atraso estimado.

## Núcleo de movimento

`MotionEngine` é a única tecnologia de movimento usada pelo menu e pelos jogos.
Ele recebe as poses mais recentes, aplica estabilização adaptativa calibrada e
mantém duas saídas: uma visual estável e uma trajetória rápida exclusiva para
colisões. Os parâmetros, métricas e o protocolo de validação estão documentados em
[`docs/motion-engine.md`](docs/motion-engine.md).

A comunicação permanece separada em dois canais:

### Canal de movimento

- WebRTC DataChannel não ordenado e sem retransmissão.
- Pacotes binários de aproximadamente 40 bytes.
- Mantém somente a pose mais recente quando existe congestionamento.
- Descarta pacotes antigos que chegam fora de ordem.
- Mede intervalo, perdas e buffer sem adicionar atraso artificial.

Use este canal para mãos, braços, direção, mira e outras entradas que perdem valor rapidamente.

### Canal confiável

- WebRTC DataChannel ordenado e confiável.
- WebSocket como fallback automático.

Use este canal para início de rodada, placar, seleção de jogo, confirmação de acerto, estado da sala e eventos multiplayer.

> A versão atual conecta uma TV e um celular por sala. Multiplayer com vários jogadores ainda precisará de um gerenciador de participantes e de uma autoridade de partida, mas deve reutilizar estes dois canais.

## Princípio de desempenho

Mais largura de banda não reduz automaticamente a latência. As poses usam poucos quilobytes por segundo; o foco do motor é:

1. processar a câmera rapidamente;
2. enviar apenas os dados essenciais;
3. priorizar sempre o quadro mais recente;
4. impedir recuos causados por pacotes fora de ordem;
5. manter eventos importantes em um canal confiável separado.

## Requisitos

- Node.js 18 ou superior.
- Navegador moderno na TV, computador ou TV Box.
- Celular com câmera frontal.
- HTTPS para liberar a câmera fora de `localhost`.

## Rodar localmente

```bash
npm install
npm start
```

Abra:

```text
http://localhost:3000/tv
http://localhost:3000/celular
```

## Publicação no Render

O repositório inclui `render.yaml`. Ao conectar o projeto ao Render, o serviço executa `npm install` e `npm start` automaticamente.

## Teste recomendado

Execute primeiro a checagem de sintaxe, os testes de regressão e o comparador
determinístico:

```bash
npm run check
npm test
npm run benchmark:motion
```

Depois valide em um celular real:

1. Apoie o celular em um local firme.
2. Use boa iluminação e evite contraluz.
3. Deixe a parte superior do corpo e as duas mãos visíveis.
4. Confirme que a tela indica conexão direta.
5. Teste mão parada, movimentos lentos e movimentos rápidos.
6. Observe FPS, poses por segundo, RTT e tempo da IA.

## Privacidade

O vídeo é processado no navegador do celular. O servidor não recebe nem armazena imagens; recebe somente coordenadas normalizadas dos pontos corporais.

## Próximos passos

- Criar perfis automáticos conforme desempenho do aparelho.
- Implementar gerenciador de vários jogadores por sala.
- Criar sincronização de relógio e autoridade da partida.
