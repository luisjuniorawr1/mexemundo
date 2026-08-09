# Notas de implementação

## Resolução e escala

Os cenários e as telas especiais foram finalizados em HD (`1920 × 1080`). Assets isolados preservam o maior tamanho útil de geração e devem ser escalados proporcionalmente pelo motor, sem distorção.

## Feedback de 100–300 ms

- Ao reconhecer uma ação, iniciar imediatamente uma mudança de escala, brilho, partícula ou transição de estado.
- `magic_success.png` e `star_collect_fx.png` podem aparecer no primeiro frame de confirmação.
- `magic_retry.png` é um feedback neutro: não substituir por X vermelho ou sinal de punição.
- `crystal_off.png` → `crystal_on.png` e `big_star_broken.png` → `big_star_restored.png` fornecem estados visuais claramente diferentes.

## Animações

Cada sequência possui frames individuais. As sequências de objetos transparentes também incluem spritesheet. `lighthouse_energy_animation` usa frames HD completos e uma spritesheet reduzida apenas para revisão.

## Composição

- `bg_star_beach.png`: área central livre para cinco colecionáveis.
- `bg_cloud_path.png`: faixa horizontal ampla para nuvens em movimento.
- `bg_wind_bridge.png`: deck central limpo para movimento lateral.
- `bg_crystal_garden.png`: três plataformas naturais para os cristais.
- `bg_lighthouse_dark.png` e `bg_lighthouse_powerup.png`: centro vazio para inserir a Grande Estrela.

## Transparência

Todos os assets isolados foram exportados em RGBA, com cantos transparentes e sem caixa de fundo. Efeitos luminosos mantêm pixels semitransparentes para composição aditiva ou alpha blend.
