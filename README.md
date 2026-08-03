# MexeMundo — Protótipo 0.2

Primeiro protótipo jogável de uma plataforma infantil de minijogos corporais.

## O que já funciona

- Uma tela abre o jogo em `/tv` e cria um código de sala.
- O celular entra em `/celular`, abre a câmera e detecta o corpo com MediaPipe.
- O celular envia apenas coordenadas dos pontos corporais por WebSocket nativo.
- A TV faz calibração automática quando reconhece as duas mãos.
- O jogo **Estoura-Balões** tem rodada de 45 segundos, pontuação, combo, balões especiais, partículas, sons e tela de resultado.
- É possível reiniciar pelo botão ou mantendo as duas mãos levantadas por 2 segundos.
- Há diagnóstico de FPS, pose e atraso estimado da rede.

## Requisitos

- Node.js 20 ou superior. O servidor não possui dependências externas.
- Computador, TV Box ou navegador de TV para abrir a tela do jogo.
- Celular com navegador moderno e câmera frontal.
- Os dois dispositivos devem acessar o mesmo servidor.
- No celular, o acesso à câmera exige HTTPS, exceto em `localhost`.

## Rodar localmente

```bash
npm start
```

Abra no computador:

```text
http://localhost:3000/tv
```

Para testar o celular na mesma rede, publique o servidor com HTTPS ou use um túnel HTTPS. Depois abra:

```text
https://SEU-ENDERECO/celular
```

Digite o código mostrado na TV e permita o uso da câmera.

## Teste recomendado

1. Apoie o celular horizontal ou verticalmente, de frente para o jogador.
2. Deixe o corpo inteiro visível, com boa iluminação.
3. Mantenha cerca de 2 metros livres entre jogador e celular.
4. Observe o indicador de qualidade no celular.
5. Na TV, levante as duas mãos até a calibração terminar.
6. Durante a rodada, toque nos balões virtuais usando as mãos.

## Privacidade do protótipo

O vídeo é processado no próprio navegador do celular. O servidor recebe somente coordenadas normalizadas dos pontos do corpo e não armazena imagens.

## Próximos passos do produto

- Testar latência em Samsung, Motorola e Xiaomi intermediários.
- Criar modo de ajuste de área útil da câmera.
- Medir precisão, tempo de conexão e repetição espontânea da partida.
- Criar o segundo minijogo: Goleiro Maluco.
- Transformar o reconhecimento corporal em um motor reutilizável para vários jogos.
