# MotionEngine: rastreamento de mãos com baixa latência

Este documento registra a arquitetura de movimento anterior, a arquitetura atual,
os parâmetros ajustáveis e o procedimento de validação. O objetivo é manter as
mãos quietas quando o jogador está parado e reagir já na primeira pose útil quando
o movimento começa, sem introduzir uma suavização posicional fixa.

## Invariantes preservados

- O reconhecimento continua usando **MediaPipe Pose Landmarker**, no modo `VIDEO`,
  com o modelo Lite float16 e GPU com fallback para CPU.
- A câmera continua solicitando **360 × 640** e até 60 fps. A resolução não foi
  aumentada porque não existe ganho mensurado que justifique mais custo de IA,
  aquecimento e consumo de bateria.
- O caminho preferencial continua sendo **WebRTC direto**, com DataChannel de pose
  não ordenado, sem retransmissão e com pacotes binários de 40 bytes.
- WebSocket continua sendo sinalização e fallback. Eventos importantes continuam
  separados em um canal confiável.
- O visual, as regras, os raios de colisão, a pontuação, o ritmo e a dificuldade dos
  jogos não foram intencionalmente alterados.
- Não existe fila de poses no motor: há somente mailboxes substituíveis para a pose
  mais recente e para a extremidade mais recente da trajetória de colisão.

## Mapa anterior

```text
Câmera 360x640
  -> requestVideoFrameCallback/rAF
  -> MediaPipe Pose Landmarker
  -> StableTurboPointFilter no celular
       - EMA de velocidade
       - dead-zone posicional por velocidade
       - alpha posicional adaptativo
  -> payload de quatro pontos
  -> WebRTC binário ou relay JSON
  -> validação de sequence
  -> target na TV
       -> MotionCursor
            - outra dead-zone
            - outro alpha adaptativo
       -> updateMotion de Estoura-Balões
            - outra dead-zone/predição para pulsos
            - EMA para ombros
       -> updateMotion de Goleiro Maluco
            - cópia do algoritmo anterior
  -> mesma posição filtrada para desenho e colisão
  -> requestAnimationFrame/canvas
```

As posições atravessavam mais de uma decisão de dead-zone. Isso produzia
`stick-slip`: pequenos deslocamentos eram acumulados por duas camadas e apareciam
como um salto quando o último limiar era vencido. A implementação de movimento
também estava copiada nos dois jogos, tornando inevitável que ajustes divergissem.

## Mapa atual

```text
Câmera 360x640
  -> um callback por frame disponível
  -> MediaPipe Pose Landmarker
  -> MotionSource compartilhado no celular
       - preserva x/y medidos, sem suavização posicional
       - histerese de visibilidade
       - velocidade causal e limitada
       - métricas de câmera/IA
  -> RealtimeClient
       -> WebRTC direto, binário, unordered, maxRetransmits=0
       -> relay WebSocket latest-only no emissor e no servidor
       -> sequence gaps, fora de ordem e coalescência
  -> MotionEngine compartilhado na TV/menu/jogos
       - rejeita sequence velha e pose velha por idade quando disponível
       - perfil menu ou game
       - uma única estabilização posicional adaptativa
       - visual: posição estável + velocidade visual estabilizada
       - collision: última medição + pequena previsão causal
       - métricas e gravação
  -> consumidores
       -> MotionCursor: somente mapeia e desenha
       -> jogos: desenham visual e colidem com collisionFrom -> collision
  -> requestAnimationFrame/canvas
```

### Responsabilidades

`MotionSource`, em `public/js/motion-engine.js`, é o adaptador do MediaPipe no
celular. Ele converte confiança em visibilidade com histerese, mantém as posições
normalizadas medidas e calcula uma velocidade limitada. A posição não é filtrada
nessa etapa; assim, a calibração observa o ruído real do sensor e o motor da TV pode
produzir as trilhas visual e de colisão a partir da mesma amostra.

`RealtimeClient`, em `public/js/realtime.js`, mantém o caminho direto binário. No
DataChannel e no fallback WebSocket, congestionamento substitui a pose pendente
pela mais nova. O servidor repete a mesma regra por destinatário. Poses nunca usam
o DataChannel confiável como fallback intermediário.

`MotionEngine`, em `public/js/motion-engine.js`, é a única implementação de
movimento consumida pelo menu, Estoura-Balões e Goleiro Maluco. Cada chamada de
`ingest()` aceita ou rejeita uma amostra, atualiza o estado adaptativo e substitui a
pose mais recente. `sample()` entrega quatro visões:

- `received`: última pose aceita, antes da estabilização visual;
- `visual`: posição estabilizada usada para cursor e desenho das mãos;
- `collisionFrom`: início ainda não consumido do segmento rápido;
- `collision`: fim mais recente do segmento rápido.

O consumo de `collisionFrom -> collision` mantém apenas o segmento acumulado desde
o último frame, sem guardar uma lista de poses.

`MotionCursor`, em `public/js/motion-ui.js`, agora somente aplica o mapeamento da
calibração para a tela, atualiza hover/dwell e escreve o `transform`. Ele não aplica
dead-zone ou alpha adicionais.

## Suavizações duplicadas removidas

| Antes | Depois |
|---|---|
| `StableTurboPointFilter` suavizava x/y no celular | `MotionSource` preserva x/y e filtra somente a estimativa de velocidade |
| `MotionCursor.updatePose()` tinha dead-zone e alpha próprios | Cursor somente mapeia a saída `visual` do motor |
| `tv.js` tinha `normalizePose()` e `updateMotion()` locais | Estoura-Balões consome `MotionEngine.sample()` |
| `goalkeeper.js` copiava o mesmo filtro | Goleiro consome o mesmo `MotionEngine.sample()` |
| Posição visual também era a trajetória de colisão | Saídas `visual` e `collision` são independentes |
| Velocidade recebida alterava diretamente rotação/tamanho da luva | A luva usa `displayVx`/`displaySpeed`, derivados da trajetória visual estabilizada |

Ainda existem filtros de velocidade, porque derivar velocidade quadro a quadro sem
atenuação amplifica ruído. Eles não são uma segunda suavização de posição e não
atrasam diretamente x/y.

## Causas de tremor identificadas

1. **Dead-zones em cascata.** Celular, cursor e jogos podiam congelar e liberar a
   mesma posição em momentos diferentes.
2. **Derivada de ruído.** Variações pequenas de landmark produzem velocidades
   grandes quando divididas por intervalos curtos; uma rajada de rede podia tornar
   o intervalo de chegada muito menor que a cadência real da câmera.
3. **Troca brusca de regime.** Limiares de velocidade sem evidência direcional ou
   histerese alternavam rapidamente entre “parado” e “movendo”.
4. **Calibração pós-filtro.** O jitter era medido depois que o filtro do celular já
   havia escondido parte do ruído.
5. **Unidades do cursor.** A posição era ampliada por `scaleX/scaleY`, mas a
   dead-zone adicional do cursor não era transformada na mesma unidade.
6. **Visibilidade binária em um único limiar.** Confiança perto de 0,3 fazia a mão
   piscar entre visível e invisível.
7. **Backlog no relay.** WebSocket ordenado podia entregar corretamente uma série
   de poses que já havia perdido valor temporal.
8. **Velocidade bruta no visual.** A luva podia girar e pulsar mesmo quando a
   posição estava retida pela dead-zone.
9. **Cadência irregular.** IA mais lenta que a câmera pula frames implicitamente;
   sem medir isso, holds e saltos pareciam apenas falha do filtro.
10. **Condições de captura.** Pouca luz, contraluz, motion blur, autofocus e captura
    abaixo dos 60 fps pedidos ainda afetam o Pose Landmarker.

O novo motor trata 1–8. O item 9 é medido, não eliminado; o item 10 continua sendo
uma limitação física e deve ser controlado no protocolo de teste.

## Algoritmo adaptativo

Todas as distâncias estão em coordenadas normalizadas da câmera e as velocidades
em unidades normalizadas por segundo.

O `dt` do movimento vem de `sourceIntervalMs`, medido no callback da câmera e
preservado no pacote binário. O intervalo de chegada só é fallback quando a origem
não o informa; assim, duas poses entregues juntas pela rede não parecem um gesto
mais rápido. `poseFrequencyHz` continua usando chegada porque mede a cadência que a
TV efetivamente recebe.

### Raio de repouso calibrado

Para cada ponto:

```text
base = jitter > 0
  ? jitter * jitterScale
  : deadZone > 0
    ? deadZone * 0.55
    : minRestRadius

pointScale = pulso ? 1 : anchorResponseScale
restRadius = clamp(
  base * pointScale,
  minRestRadius * pointScale,
  maxRestRadius * pointScale
)
```

`jitter` vem da calibração com a mão direita parada. Ombros usam um raio menor para
continuar acompanhando o corpo sem dominar o movimento das mãos.

### Evidência de início de movimento

```text
rawStep = distância entre as duas últimas medições
direction = cosseno entre o passo atual e o anterior
sourceSpeed = max(norm(vx, vy), rawStep / dt)
distance = distância entre medição e posição visual

meaningfulStep = rawStep >= restRadius * stepFraction
consistent = passos significativos consecutivos com direction >= directionCosine

fastOnset = sourceSpeed >= fastSpeed
         ou distance >= distanceForFullResponse
slowOnset = sourceSpeed >= startSpeed
         e consistent >= consistentSamples
confirmedOnset = sourceSpeed >= startSpeed
              e consistent >= confirmedSamples
displacedOnset = distance > 3.5 * restRadius
              ou (distance > restRadius e consistent >= confirmedSamples)
```

Movimento rápido vence a estabilização imediatamente. Movimento lento precisa de
evidência direcional curta. Depois de `consistentSamples`, o motor libera apenas
um passo-sonda limitado a `restRadius * probeStepScale`; ele confirma o gesto em
`confirmedSamples`. Assim, o começo aparece já na segunda pose coerente sem deixar
que microjitter acumulado destrave toda a trajetória.

### Resposta visual

Quando há movimento:

```text
speedScore = clamp(
  (sourceSpeed - stopSpeed) /
  (speedForFullResponse - stopSpeed)
)

distanceScore = clamp(
  (distance - 0.25 * restRadius) /
  (distanceForFullResponse - 0.25 * restRadius)
)

response = max(speedScore, distanceScore)
alpha = movingAlpha + (maxAlpha - movingAlpha) * response
alpha no primeiro frame = max(alpha, onsetAlpha)
alpha em fastOnset = maxAlpha

visual += (raw - visual) * alpha
```

Não há alpha posicional fixo: ele varia com velocidade, distância, estado e
calibração. No início de um gesto, `onsetAlpha` impede a antiga sensação de arrasto.

Enquanto ainda não existe gesto confirmado, a âncora de repouso acompanha apenas o
ruído contido. O motor volta ao repouso após `stopSamples` amostras com evidência
quieta:

```text
consistent < consistentSamples
e distance <= 1.35 * restRadius
e rawStep <= 2.75 * restRadius
```

Ao parar, desvios menores que o raio retornam à âncora de repouso em vez de se
acumularem. `stopSpeed` participa do score de resposta, não é uma suavização fixa.

### Trajetória de colisão

```text
leadSeconds = pulso em movimento ? collisionLeadMs / 1000 : 0
collision = raw + rawVelocity * leadSeconds
```

Somente a trilha de colisão usa essa previsão curta. O desenho continua usando a
trilha visual. Os jogos preservam seus algoritmos de colisão varrida e seus raios;
apenas passam a usar `collisionFrom -> collision`.

## Perfis e parâmetros de tuning

Os valores ficam centralizados em `MOTION_PROFILES`.

| Parâmetro | `menu` | `game` | Efeito |
|---|---:|---:|---|
| `jitterScale` | 1.9 | 1.25 | Multiplicador do jitter calibrado para formar o raio de repouso |
| `minRestRadius` | 0.0038 | 0.0022 | Piso do raio de repouso |
| `maxRestRadius` | 0.020 | 0.014 | Teto do raio de repouso |
| `stepFraction` | 0.34 | 0.28 | Fração do raio exigida para um passo contar como evidência |
| `consistentSamples` | 2 | 2 | Passos direcionais necessários para liberar uma sonda pequena |
| `confirmedSamples` | 6 | 5 | Passos direcionais necessários para confirmar um gesto lento |
| `probeStepScale` | 0.05 | 0.12 | Máximo da sonda visual como fração do raio de repouso |
| `directionCosine` | 0.20 | 0.05 | Consistência mínima de direção entre passos |
| `startSpeed` | 0.035 | 0.028 | Velocidade mínima do início lento |
| `stopSpeed` | 0.022 | 0.018 | Limite inferior do score de resposta por velocidade |
| `fastSpeed` | 0.72 | 0.28 | Velocidade que libera resposta máxima imediata |
| `speedForFullResponse` | 0.62 | 0.48 | Velocidade que leva o score de resposta a 1 |
| `distanceForFullResponse` | 0.040 | 0.026 | Erro que leva o score de resposta a 1 e caracteriza onset rápido |
| `movingAlpha` | 0.52 | 0.64 | Resposta mínima enquanto a mão está em movimento |
| `onsetAlpha` | 0.82 | 0.92 | Resposta mínima na primeira amostra de movimento |
| `maxAlpha` | 0.96 | 1.00 | Resposta máxima |
| `stopSamples` | 3 | 3 | Amostras quietas exigidas para voltar ao repouso |
| `anchorResponseScale` | 0.72 | 0.68 | Escala do raio de repouso para ombros |
| `collisionLeadMs` | 8 | 10 | Previsão exclusiva da trilha de colisão |
| `maxPoseAgeMs` | 240 | 240 | Idade máxima aceita/exibida quando a idade de origem existe |

O menu prioriza quietude para dwell e seleção. O jogo usa raio menor, onset maior e
alpha maior para reagir mais cedo. `tv.js` e `goalkeeper.js` selecionam `game`
durante countdown/partida e `menu` nos demais estados.

### Parâmetros do MotionSource

| Parâmetro | Valor padrão | Efeito |
|---|---:|---|
| `visibilityOn` | 0.34 | Confiança necessária para uma mão invisível reaparecer |
| `visibilityOff` | 0.24 | Confiança abaixo da qual uma mão visível desaparece |
| `velocityResponse` | 0.42 | Resposta base da velocidade; aumenta com velocidade instantânea até 0.78 |

### Guia de ajuste

- Mão parada ainda oscila: aumente primeiro `jitterScale`; use
  `minRestRadius` somente quando não houver calibração confiável.
- Movimento lento demora a começar: aumente `probeStepScale`, reduza
  `confirmedSamples`, `stepFraction` ou `startSpeed`, ou aumente `onsetAlpha`.
- Ruído dispara movimento falso: aumente `directionCosine`, `startSpeed` ou
  `confirmedSamples`, ou reduza `probeStepScale`.
- Mão em movimento fica atrasada: aumente `movingAlpha` ou reduza
  `speedForFullResponse`/`distanceForFullResponse`.
- A mão demora a parar: reduza `stopSamples`. Confirme que isso não corta gestos
  lentos antes de adotar.
- Colisões rápidas parecem ficar atrás da mão: ajuste `collisionLeadMs` somente
  com replay determinístico e conferência de dificuldade. Esse parâmetro não deve
  ser usado para corrigir atraso visual.
- Altere um parâmetro por vez e compare a mesma gravação nos dois perfis.

Não aumente a resolução para compensar tuning. A captura permanece em 360 × 640
até que um teste A/B mostre redução de jitter ou falhas de reconhecimento maior que
o custo adicional de processamento, sem piorar frequência ou latência.

## Transporte, descarte e latest-only

No caminho direto:

- o pacote de pose continua binário e com versão 1;
- `ordered: false` e `maxRetransmits: 0` evitam head-of-line e retransmissão de
  posições vencidas;
- se já existe pendência ou `bufferedAmount > 0`, somente um
  `pendingPosePacket` é mantido;
- uma nova pose substitui a pendente e incrementa `coalesced`;
- uma pose pendente por mais de 220 ms expira em vez de ser enviada atrasada;
- o receptor rejeita duplicata ou sequence fora de ordem considerando wrap uint16.
- ao entrar um novo celular na sala, o servidor limpa a mailbox antiga, envia
  `pose-stream-reset` pelo canal confiável e a TV fecha o DataChannel da origem
  anterior; eventos atrasados de um canal substituído são ignorados por identidade;
- trocar apenas entre relay e direto preserva a sequência atual.

No relay:

- o emissor mantém um único `pendingRelayPose`;
- o flush verifica `WebSocket.bufferedAmount` em intervalos curtos de 8 ms;
- a mailbox do emissor também expira depois de 220 ms;
- o servidor mantém, por destinatário, somente `pendingPoseMessage` enquanto um
  envio está em andamento ou há buffer;
- a mailbox do servidor aplica o mesmo limite de 220 ms;
- eventos confiáveis não compartilham essa compactação.

No motor:

- `ingest()` rejeita sequence velha/duplicada;
- gaps são contabilizados pelo delta de sequence;
- `captureAgeMs > maxPoseAgeMs`, quando disponível, é rejeitado;
- `sample()` oculta uma pose que ficou mais de `maxPoseAgeMs` sem atualização;
- a primeira pose após timeout, ou após um pulso reaparecer, começa uma trajetória
  de colisão nova e nunca varre desde uma coordenada antiga;
- `latest`, `collisionFrom` e `collisionTo` são estados substituíveis, não filas.

Limitação: `bufferedAmount` representa o buffer visível à API, não todas as filas
internas do navegador, SCTP, sistema operacional ou rede. Latest-only reduz backlog
controlável, mas não prova ausência de toda fila externa.

## Métricas

Na TV/menu, execute `mexeMundoMotion.metrics()` no console. No celular, o mesmo
comando retorna as métricas de `MotionSource` dentro de `source`.

| Campo | Cálculo/interpretação | Limitação |
|---|---|---|
| `stationaryJitterRaw` | Raiz da EMA do resíduo quadrático das mãos recebidas em amostras de baixa evidência direcional | Não é desvio-padrão de uma janela fixa; usa centro próprio do sinal raw e reinicia o centro depois de movimento real |
| `stationaryJitterVisual` | Mesmo cálculo usando a posição visual e centro próprio | Valores são normalizados, não pixels |
| `estimatedLatencyMs` | `processingMs + RTT/2 + receiveToDisplayMs` quando não há idade de captura | É estimativa, descrita em detalhe abaixo |
| `poseFrequencyHz` | `1000 / EMA(intervalo de chegada)`, com EMA `0.82 * anterior + 0.18 * atual` | Mede poses aceitas na TV, não frames capturados |
| `sourcePoseFrequencyHz` | Frequência da IA informada pelo celular, quando disponível | No pacote binário v1 depende dos metadados já presentes no pacote |
| `posesAccepted` | Total aceito desde o último reset | Resets de sessão zeram o contador |
| `droppedFrames` | Maior contagem conhecida de gaps de sequence entre transporte e motor | Não inclui toda perda anterior ao primeiro pacote observado |
| `sequenceGaps` | Soma de `deltaSequence - 1` | Coalescência deliberada também aparece como gap no receptor |
| `staleOrOutOfOrder` | Duplicatas/fora de ordem rejeitadas pelo motor e transporte | As duas camadas podem observar estágios diferentes |
| `staleByAge` | Poses rejeitadas porque `captureAgeMs > maxPoseAgeMs` | O pacote binário v1 não inclui `captureAgeMs` |
| `outgoingCoalesced` | Poses pendentes substituídas no emissor, quando essa métrica do emissor é fornecida ao motor | Na TV atual normalmente fica zero; coalescência remota é inferida por gap no receptor |
| `expired` | Poses que venceram o TTL de 220 ms em uma mailbox de transporte | Pode ocorrer no emissor direto, relay ou servidor |
| `receivedDisplayedDistance` | EMA, alpha 0.10, da distância média entre recebido e visual para as mãos | Antes do mapeamento do cursor; unidade normalizada |
| `receivedDisplayedMax` | Maior distância observada desde reset | Não decai; use reset entre cenários |
| `bufferedAmount` | Buffer reportado pelo transporte ativo | Não inclui buffers internos/externos invisíveis à API |
| `transportMode` | `direct` ou `relay` | Pode mudar durante reconexão |
| `transportRttMs` | RTT medido pelo ping do transporte | RTT do relay não representa necessariamente celular → TV |

No celular, `MotionSource.getMetrics()` fornece:

- `framesObserved`: callbacks de vídeo observados;
- `cameraFramesDropped`: gaps de `presentedFrames`, quando o navegador fornece o
  campo;
- `poseFrequencyHz`: frequência de processamento baseada no intervalo do frame;
- `intervalMs`: EMA do intervalo;
- `processingMs`: duração da última inferência.

O FPS dos jogos usa agora o tempo real entre frames para a métrica; o `dt` limitado
a 40 ms continua sendo usado somente pela simulação para evitar saltos de física.

### Limitação da latência estimada

Na implementação atual, a fórmula normalmente usada é:

```text
estimatedLatencyMs = processingMs + RTT/2 + receiveToDisplayMs
receiveToDisplayMs = sampleTime - receivedAt
```

Se uma futura origem confiável fornecer `captureAgeMs`, o motor prefere:

```text
estimatedLatencyMs = captureAgeMs + receiveToDisplayMs
```

**`RTT/2 + processamento + receive→display é uma estimativa, não latência
glass-to-glass.** Ela não mede com precisão exposição da câmera, buffers do sensor,
assimetria de rede, agendamento da IA, compositor, scanout da tela ou resposta do
painel. O pacote binário v1 preservado não carrega `capturedAt/captureAgeMs`; no
caminho direto, portanto, a estimativa é deliberadamente aproximada e comparativa,
não uma medição absoluta. No relay, o RTT disponível pode medir TV ↔ servidor ↔ TV
e não inclui integralmente o trecho celular → servidor → TV.

Use a métrica para comparar versões no mesmo equipamento e rede, nunca para afirmar
uma latência física absoluta.

## Gravação e replay pelo console

Não há gravação de vídeo. O arquivo contém somente poses normalizadas, visibilidade,
velocidade, metadados e tempos relativos.

### Gravar

No console do celular, menu ou jogo:

```js
mexeMundoMotion.startRecording()
```

Execute a sequência e finalize:

```js
const recording = mexeMundoMotion.stopRecording()
mexeMundoMotion.download(recording, 'sequencia-real.json')
```

O schema exportado é:

```js
{
  schema: 'mexemundo.pose-sequence',
  version: 1,
  coordinateSpace: 'normalized-mirrored',
  frames: [
    { tMs: 0, pose: { /* pose transmitida/recebida */ } }
  ]
}
```

A gravação no celular captura a pose de origem antes do transporte. A gravação na
TV captura apenas poses aceitas e inclui a irregularidade de chegada da rede.

### Reproduzir

Na TV/menu, o replay injeta diretamente no `MotionEngine`, isolando filtro e
renderização:

```js
const playback = mexeMundoMotion.play(recording, { speed: 1 })
```

Por padrão o motor é resetado antes do replay. Para preservar o estado atual:

```js
const playback = mexeMundoMotion.play(recording, { speed: 1, reset: false })
```

Interrompa com:

```js
playback.stop()
```

No celular, `play()` reenvia a gravação pelo transporte com sequences novas. Esse
modo valida compactação, WebRTC/relay e recepção, além do motor da TV:

```js
mexeMundoMotion.play(recording, { speed: 1 })
```

O replay usa somente um timer. Se o event loop atrasar, frames vencidos são pulados
e apenas o mais recente é entregue, reproduzindo a semântica latest-only.
`speed` deve ser positivo e também escala o atraso do primeiro frame. Enquanto um
replay roda, poses live são pausadas naquele ponto da cadeia; terminar, interromper,
resetar ou desconectar cancela o timer antes de reabrir o fluxo live.

Para avaliar um perfil de modo determinístico sem depender da página:

```js
const {
  MotionEngine,
  replayPoseRecording,
  validatePoseRecording
} = await import('/js/motion-engine.js')

validatePoseRecording(recording)
const engine = new MotionEngine({ profile: 'menu' })
let finalTime = 0
replayPoseRecording(recording, (pose, tMs) => {
  finalTime = tMs + 1 // evita que t=0 seja confundido com estado ainda vazio
  engine.ingest(pose, finalTime)
  engine.sample(finalTime)
})
engine.getMetrics(finalTime)
```

Repita com `profile: 'game'`. Para usar a calibração real, passe o objeto salvo em
`sessionStorage` como `calibration`.

`PoseRecorder` mantém frames em memória até `stopRecording()`. Evite gravações muito
longas; ainda não existe limite automático de duração ou tamanho.

## Comparação determinística antes/depois

`npm run benchmark:motion` reproduz a cadeia antiga completa e o `MotionEngine`
sobre a mesma fixture sem relógio de rede. Seed, cadência e calibração são fixos;
somente o tempo de CPU depende da máquina. Uma execução desta branch em Node 24:

| Métrica | Cadeia anterior | MotionEngine | Diferença |
|---|---:|---:|---:|
| Jitter estacionário visual RMS | 0 | 0,000212 | +0,000212 |
| Início lento a 0,04 unidade/s | 200,00 ms | 33,33 ms | −166,67 ms |
| Início lento a 0,08 unidade/s | 100,00 ms | 33,33 ms | −66,67 ms |
| CPU por pose, mediana de 5 | 0,0012 ms | 0,0044 ms | +0,0032 ms |

A entrada parada dessa fixture tem jitter RMS de aproximadamente `0,002905`; a
saída nova o reduz em cerca de 93%. O zero anterior não era reconhecimento mais
preciso: era o congelamento total causado pelas dead-zones duplicadas, que também
segurava um gesto lento por 3–6 poses. A nova saída aceita um resíduo visual pequeno
e limitado para sinalizar o começo em uma pose. O teste de regressão exige jitter
visual menor que 90% do raw e onset em no máximo um intervalo de pose.

Esses números validam o algoritmo e evitam regressão de código, mas não são uma
medição glass-to-glass nem substituem o protocolo com câmera e aparelho reais.

O mesmo comparador cobre a disponibilidade e exatidão das novas métricas:

| Métrica sintética | Cadeia anterior | MotionEngine | Referência |
|---|---:|---:|---:|
| Latência estimada (`process=10`, `RTT=40`, idade visual `=5`) | indisponível | 35 ms | 35 ms |
| Frequência de poses aceitas | 30 Hz | 30 Hz | 30 Hz |
| Descartes reportados (1 gap + 1 duplicata) | 1 | 2 | 2 |
| Distância média recebido→exibido em trajetória contínua | 0,000517 | 0,001772 | ver nota |
| Distância média entrada raw→exibido, referência comum | 0,008684 | 0,001772 | ver nota |

`received→displayed` segue exatamente a métrica da TV, mas os sinais recebidos não
são uma referência comum: antes, a TV já recebia a posição suavizada no celular;
agora, recebe a posição raw. Por isso a linha é descritiva e tem limite de regressão
`< 0,003`, não critério “menor sempre vence”. Contra a mesma entrada raw, a distância
cai 79,6% (`0,008684 → 0,001772`) e não cresce ao longo da sequência. Colisões usam
a trilha rápida independente. O comparador falha com exit não zero se jitter, onset,
CPU, latência, frequência, descartes ou o limite de distância regredirem.

## Validação com uma sequência real

Sequências sintéticas são úteis para regressão, mas não substituem landmark noise,
oclusão e cadência de um celular real. Use este protocolo antes de ajustar valores
ou aprovar merge.

### Captura

1. Fixe o celular; registre modelo do aparelho, navegador, iluminação, distância,
   modo de transporte e configurações reais da câmera.
2. Confirme que a captura continua em 360 × 640 pedido. Registre a resolução
   efetivamente concedida pelo navegador se ela diferir.
3. Inicie a gravação no celular para excluir jitter de rede da fonte.
4. Faça uma sequência de 25–35 segundos:
   - 5 s com as duas mãos paradas;
   - início lento da mão direita, parada e retorno;
   - início lento da mão esquerda, parada e retorno;
   - três varreduras rápidas horizontais e três verticais;
   - pequena oclusão e reaparecimento de cada pulso;
   - gesto de mãos levantadas usado pela interface.
5. Salve o JSON e não edite seus tempos ou poses.

### Comparação

Use exatamente o mesmo JSON para `menu` e `game`. Para comparar antes/depois, use
as métricas guardadas antes da mudança ou execute o JSON em um worktree isolado do
commit-base com um harness temporário de diagnóstico. O baseline não possui a API
de replay por padrão; não copie novamente o filtro legado para os jogos apenas para
fazer a comparação. Se não houver medição anterior reproduzível, marque o baseline
como indisponível em vez de inventar números. Não compare duas capturas corporais
diferentes como se fossem equivalentes.

Registre pelo menos:

| Cenário | Baseline | MotionEngine | Critério |
|---|---:|---:|---|
| `stationaryJitterVisual`, mão parada |  |  | Deve cair, sem pulsos periódicos |
| Latência estimada mediana/p95 |  |  | Não piorar mais que um frame de tela |
| Tempo entre início real e primeiro movimento visual |  |  | Até uma pose aceita para onset claro |
| `poseFrequencyHz` |  |  | Não regredir materialmente no mesmo aparelho |
| `cameraFramesDropped` |  |  | Não aumentar pela mudança de movimento |
| `sequenceGaps`/`outgoingCoalesced` |  |  | Explicáveis por congestionamento, sem backlog crescente |
| `receivedDisplayedDistance`, lento |  |  | Baixa e sem crescimento acumulado |
| `receivedDisplayedDistance`, rápido |  |  | Pico curto e retorno rápido |
| Acertos/defesas da mesma trajetória |  |  | Sem perda causada pela estabilização visual |
| FPS real da TV |  |  | Sem regressão material |

Além das métricas, filme a tela externamente em câmera lenta para verificar onset e
quietude. Esse vídeo pode aproximar glass-to-glass; a fórmula interna não pode.

### Verificação dos jogos

- No menu, mantenha a mão sobre cada alvo e confirme que o dwell não reinicia por
  microjitter nem seleciona um alvo vizinho.
- Em Estoura-Balões, repita varreduras que tangenciam um balão. A mão desenhada deve
  ficar estável, enquanto o segmento de colisão continua capturando o gesto rápido.
- No Goleiro, repita defesas laterais. A luva não deve pulsar ou girar por velocidade
  bruta; o número de defesas não deve cair por causa da estabilização visual.
- Teste direto e relay, incluindo troca de tela/menu, substituição do celular,
  desconexão curta, timeout de colisão e sequence wrap em teste automatizado.
- Execute os testes automatizados e a checagem de sintaxe após a validação real.

Não altere raio de mão, raio de bola/balão, spawn, pontuação ou duração para fazer a
nova trajetória “passar” no teste; isso mudaria regras ou dificuldade.

## Riscos conhecidos

- **Variação entre aparelhos:** thresholds normalizados não removem diferenças de
  ruído, exposição e frequência. A calibração continua essencial.
- **Calibração unilateral:** o perfil mede a mão direita e aplica o jitter às duas;
  oclusão pode tornar a mão esquerda mais ruidosa.
- **Troca de perfil sem reset:** preserva continuidade ao entrar/sair da partida,
  mas o estado anterior influencia as primeiras amostras do novo perfil.
- **Trajetória de colisão mais rápida:** pode capturar movimentos antes perdidos.
  Isso é desejado para responsividade, mas deve ser conferido para não alterar
  involuntariamente a dificuldade efetiva.
- **Timestamp incompleto:** o pacote binário v1 não transporta idade de captura;
  descarte por idade e latência absoluta permanecem limitados no modo direto.
- **Relay:** os timers de flush podem acrescentar até cerca de 8 ms quando há uma
  pose pendente, em troca de impedir backlog crescente.
- **Buffers externos:** latest-only não controla buffers internos do navegador ou
  da rede.
- **Gravação em memória:** uma sessão longa pode consumir memória até ser parada.
- **Dados de movimento:** não há vídeo, mas o JSON ainda representa movimento de
  uma pessoa; trate-o como dado de teste privado.
- **Métrica de jitter:** depende de amostras com baixa evidência direcional e de
  centros EMA separados para raw e visual; use também inspeção visual e gravação
  externa.

## Rollback

Não há migração de banco, armazenamento no servidor ou mudança de protocolo do
pacote binário. O rollback é somente de código.

1. Não faça merge automático. Preserve esta branch e o commit-base para comparação.
2. Se a validação real indicar regressão, publique novamente o commit anterior da
   branch principal ou reverta, em um commit próprio, a integração do MotionEngine,
   as alterações latest-only e os testes correspondentes.
3. Recarregue celular e TV para encerrar DataChannels e estados JS antigos.
4. Se o cursor continuar diferente depois do rollback, remova da sessão do navegador
   `mexemundo-motion-profile-v1` e calibre novamente. O perfil v2 mantém os mesmos
   campos básicos, mas recalibrar evita comparar estados de versões diferentes.
5. Confirme após rollback: MediaPipe ativo, câmera 360 × 640 solicitada, WebRTC
   binário direto, fallback relay, menu, colisões e diagnóstico.

Um rollback não exige alterar visual, regras ou dificuldade e não deve ser feito por
merge direto na `main`; use o fluxo normal de branch, revisão e validação.
