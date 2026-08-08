export const POSE_TIMEOUT_MS = 260;
export const NARRATIVE_TIME_SCALE = 1.55;

export const BACKGROUND_ATLAS_URLS = {
  bg1: '/assets/filhote-perdido/backgrounds/bg1.webp',
  bg2: '/assets/filhote-perdido/backgrounds/bg2.webp',
  bg3: '/assets/filhote-perdido/backgrounds/bg3.webp',
  bg4: '/assets/filhote-perdido/backgrounds/bg4.webp'
};

export const BACKGROUND_FRAMES = {
  entrada: { atlas: 'bg1', x: 0, y: 0, w: 300, h: 169 },
  trilha: { atlas: 'bg1', x: 300, y: 0, w: 300, h: 169 },
  cipos: { atlas: 'bg1', x: 600, y: 0, w: 300, h: 169 },
  macas: { atlas: 'bg2', x: 0, y: 0, w: 300, h: 169 },
  caminho_riacho: { atlas: 'bg2', x: 300, y: 0, w: 300, h: 169 },
  riacho: { atlas: 'bg2', x: 600, y: 0, w: 300, h: 169 },
  margem_oposta: { atlas: 'bg3', x: 0, y: 0, w: 300, h: 169 },
  tunel: { atlas: 'bg3', x: 300, y: 0, w: 300, h: 169 },
  entardecer: { atlas: 'bg3', x: 600, y: 0, w: 300, h: 169 },
  vagalumes: { atlas: 'bg4', x: 0, y: 0, w: 300, h: 169 },
  resgate: { atlas: 'bg4', x: 300, y: 0, w: 300, h: 169 },
  reencontro: { atlas: 'bg4', x: 600, y: 0, w: 300, h: 169 }
};

export const SPRITE_ATLAS_URLS = {
  chars: '/assets/filhote-perdido/sprites/chars.webp',
  objects: '/assets/filhote-perdido/sprites/objects.webp'
};

export const SPRITES = {
  raposa_preocupada: { atlas: 'chars', x: 10, y: 4, w: 27, h: 40 },
  raposa_falando: { atlas: 'chars', x: 60, y: 4, w: 24, h: 40 },
  raposa_andando: { atlas: 'chars', x: 104, y: 4, w: 31, h: 40 },
  raposa_pegadas: { atlas: 'chars', x: 151, y: 4, w: 34, h: 40 },
  raposa_apontando: { atlas: 'chars', x: 10, y: 52, w: 27, h: 40 },
  raposa_agradecendo: { atlas: 'chars', x: 60, y: 52, w: 23, h: 40 },
  raposa_feliz: { atlas: 'chars', x: 107, y: 52, w: 25, h: 40 },
  raposa_reencontro: { atlas: 'chars', x: 150, y: 52, w: 35, h: 40 },
  filhote_galhos: { atlas: 'chars', x: 4, y: 107, w: 40, h: 26 },
  filhote_feliz: { atlas: 'chars', x: 56, y: 100, w: 31, h: 40 },
  filhote_reencontro: { atlas: 'chars', x: 102, y: 100, w: 35, h: 40 },
  filhote_comemorando: { atlas: 'chars', x: 153, y: 100, w: 30, h: 40 },
  esquilo_falando: { atlas: 'chars', x: 7, y: 148, w: 33, h: 40 },
  esquilo_pedindo: { atlas: 'chars', x: 60, y: 148, w: 24, h: 40 },
  esquilo_agradecendo: { atlas: 'chars', x: 102, y: 148, w: 36, h: 40 },
  esquilo_final: { atlas: 'chars', x: 148, y: 149, w: 40, h: 38 },
  pegada_brilhando: { atlas: 'objects', x: 4, y: 4, w: 39, h: 40 },
  pegada_falsa_01: { atlas: 'objects', x: 54, y: 4, w: 35, h: 40 },
  pegada_falsa_02: { atlas: 'objects', x: 102, y: 4, w: 35, h: 40 },
  maca: { atlas: 'objects', x: 150, y: 4, w: 36, h: 40 },
  pelo_galho: { atlas: 'objects', x: 4, y: 52, w: 39, h: 40 },
  cesta_vazia: { atlas: 'objects', x: 54, y: 52, w: 35, h: 40 },
  cesta_cheia: { atlas: 'objects', x: 101, y: 52, w: 38, h: 40 },
  cipos_fechados: { atlas: 'objects', x: 148, y: 64, w: 40, h: 16 },
  cipos_meio: { atlas: 'objects', x: 4, y: 114, w: 40, h: 11 },
  ponte: { atlas: 'objects', x: 52, y: 104, w: 40, h: 32 },
  galho_baixo: { atlas: 'objects', x: 100, y: 102, w: 40, h: 35 },
  vagalume_01: { atlas: 'objects', x: 148, y: 107, w: 40, h: 26 },
  vagalume_02: { atlas: 'objects', x: 4, y: 155, w: 40, h: 25 },
  vagalume_03: { atlas: 'objects', x: 52, y: 155, w: 40, h: 26 },
  resgate_fechado: { atlas: 'objects', x: 100, y: 161, w: 40, h: 14 },
  resgate_meio: { atlas: 'objects', x: 148, y: 162, w: 40, h: 11 },
  resgate_aberto: { atlas: 'objects', x: 4, y: 211, w: 40, h: 9 }
};

export const SCENE_BACKGROUND = {
  arrival: 'entrada', mother: 'entrada', tracks: 'trilha', 'trail-walk': 'trilha', vines: 'cipos',
  'after-vines': 'macas', squirrel: 'macas', apples: 'macas', 'squirrel-thanks': 'macas',
  'creek-walk': 'caminho_riacho', 'bridge-intro': 'riacho', bridge: 'riacho', 'far-bank': 'margem_oposta',
  'tunnel-intro': 'tunel', duck: 'tunel', 'dusk-walk': 'entardecer', 'firefly-intro': 'vagalumes',
  fireflies: 'vagalumes', whisper: 'resgate', 'rescue-intro': 'resgate', rescue: 'resgate',
  reunion: 'reencontro', ending: 'reencontro'
};

export const CHAPTERS = [
  ['arrival', 'mother', 'tracks'],
  ['trail-walk', 'vines', 'after-vines', 'squirrel'],
  ['apples', 'squirrel-thanks', 'creek-walk'],
  ['bridge-intro', 'bridge', 'far-bank'],
  ['tunnel-intro', 'duck', 'dusk-walk'],
  ['firefly-intro', 'fireflies', 'whisper', 'rescue-intro'],
  ['rescue', 'reunion', 'ending']
];

export const NARRATIVE = {
  arrival: { next: 'mother', beats: [
    [6500, 'UMA TRILHA DIFERENTE', 'A floresta parecia muito tranquila…', 'Até que um som baixinho veio de trás das árvores.'],
    [6500, 'ESCUTE…', 'Alguém está procurando alguma coisa', 'Entre as folhas, uma raposa aparece olhando para todos os lados.']
  ]},
  mother: { next: 'tracks', beats: [
    [6500, 'MAMÃE RAPOSA', '“Meu filhote saiu para explorar…”', '“Ele sempre volta antes do pôr do sol, mas hoje ainda não voltou.”'],
    [6500, 'MAMÃE RAPOSA', '“Eu encontrei umas pegadinhas!”', '“Você pode me ajudar a seguir o caminho dele?”'],
    [4500, 'SUA MISSÃO', 'Vamos encontrar o pequeno explorador', 'A raposa vai acompanhar você durante a aventura.']
  ]},
  'trail-walk': { next: 'vines', beats: [
    [7000, 'MAIS FUNDO NA FLORESTA', 'As pegadas seguem pela trilha', 'Passarinhos voam entre as árvores enquanto a mamãe raposa corre logo atrás.'],
    [7000, 'UMA PISTA', 'As marcas continuam do outro lado…', 'Mas a vegetação ficou cada vez mais fechada.']
  ]},
  'after-vines': { next: 'squirrel', beats: [
    [6500, 'CAMINHO ABERTO', 'Conseguimos passar!', 'Do outro lado existe uma pequena clareira cheia de árvores frutíferas.'],
    [5500, 'OLHA ALI!', 'Um esquilo está pulando de galho em galho', 'Ele parece ter visto alguma coisa importante.']
  ]},
  squirrel: { next: 'apples', beats: [
    [6500, 'ESQUILO', '“Um filhote de raposa passou por aqui!”', '“Ele estava seguindo uma borboleta e correu em direção ao riacho.”'],
    [6500, 'ESQUILO', '“Eu mostro o caminho…”', '“…mas minhas maçãs caíram todas. Você me ajuda a juntá-las primeiro?”'],
    [4500, 'VAMOS AJUDAR', 'Prepare a cesta', 'Mova as duas mãos juntas para levar a cesta de um lado para o outro.']
  ]},
  'squirrel-thanks': { next: 'creek-walk', beats: [
    [6500, 'ESQUILO', '“Cinco maçãs! Conseguimos!”', 'O esquilo guarda tudo e aponta rapidamente para uma trilha estreita.'],
    [6500, 'NOVA PISTA', '“Ele foi por ali, perto da água!”', 'A mamãe raposa reconhece uma nova pegada e vocês continuam juntos.']
  ]},
  'creek-walk': { next: 'bridge-intro', beats: [
    [7000, 'PERTO DO RIACHO', 'O som da água fica cada vez mais forte', 'A trilha desce entre pedras, samambaias e raízes enormes.'],
    [7000, 'QUASE LÁ', 'Uma pegada aparece na margem', 'O filhote realmente atravessou para o outro lado.']
  ]},
  'bridge-intro': { next: 'bridge', beats: [
    [6500, 'O RIACHO', 'A ponte está quebrada', 'Mas existe um tronco firme ligando as duas margens.'],
    [5500, 'COM CUIDADO', 'Vamos atravessar devagar', 'Incline o corpo para ajudar a mamãe raposa a manter o equilíbrio.']
  ]},
  'far-bank': { next: 'tunnel-intro', beats: [
    [6500, 'OUTRO LADO', 'Chegamos!', 'Algumas gotinhas caem do tronco enquanto a floresta volta a ficar silenciosa.'],
    [6500, 'MAIS UMA PISTA', 'Há pelos laranjas presos num galho', 'O filhote passou por aqui há pouco tempo.']
  ]},
  'tunnel-intro': { next: 'duck', beats: [
    [6500, 'TÚNEL DE ÁRVORES', 'A trilha passa por baixo de galhos baixos', 'A mamãe raposa consegue passar, mas você vai precisar se abaixar.'],
    [4500, 'ATENÇÃO', 'Observe os galhos chegando', 'Abaixe o corpo quando eles passarem por você.']
  ]},
  'dusk-walk': { next: 'firefly-intro', beats: [
    [7000, 'FIM DE TARDE', 'A luz começa a mudar', 'O sol se esconde atrás das árvores e pequenas luzes aparecem na mata.'],
    [7000, 'QUE LUZES SÃO ESSAS?', 'Vaga-lumes começam a formar um caminho', 'Talvez eles tenham visto para onde o filhote foi.'],
    [5500, 'MAMÃE RAPOSA', '“Estamos chegando perto, eu sinto!”', 'Ela olha para você e continua seguindo as luzes.']
  ]},
  'firefly-intro': { next: 'fireflies', beats: [
    [6000, 'LUZES DA FLORESTA', 'Os vaga-lumes querem ajudar', 'Encoste neles com qualquer uma das mãos para reuni-los.'],
    [4500, 'TRÊS LUZES', 'Quando estiverem juntos…', '…eles poderão iluminar a parte mais escura da trilha.']
  ]},
  whisper: { next: 'rescue-intro', beats: [
    [6500, 'SILÊNCIO…', 'A floresta fica completamente quieta', 'Então vocês escutam um som baixinho atrás dos arbustos.'],
    [6500, 'MAMÃE RAPOSA', '“É ele!”', 'A raposa reconhece o chamado e corre até uma pequena clareira.'],
    [5000, 'ENCONTRAMOS!', 'O filhote está ali', 'Ele está bem, mas alguns galhos fecharam a passagem por onde entrou.']
  ]},
  'rescue-intro': { next: 'rescue', beats: [
    [6000, 'ÚLTIMO DESAFIO', 'Vamos abrir espaço para ele sair', 'Coloque as mãos à frente e abra os braços devagar.'],
    [4500, 'JUNTOS', 'A mamãe raposa está esperando', 'Quando o caminho abrir, o filhote poderá correr até ela.']
  ]},
  reunion: { next: 'ending', beats: [
    [7000, 'REENCONTRO', 'O filhote corre para a mamãe!', 'Ela encosta o focinho nele e finalmente relaxa.'],
    [6500, 'MAMÃE RAPOSA', '“Obrigada por não desistir!”', '“Você seguiu cada pista e ajudou todos que encontramos pelo caminho.”'],
    [6500, 'A FLORESTA COMEMORA', 'O esquilo aparece com as maçãs', 'Os vaga-lumes dançam no ar e os pássaros voltam a cantar.'],
    [5000, 'MISSÃO CUMPRIDA', 'O pequeno explorador está seguro', 'E agora ele tem uma história enorme para contar quando chegar em casa.']
  ]}
};
