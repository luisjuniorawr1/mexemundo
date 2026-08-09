import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetRoot = join(repoRoot, 'public', 'assets', 'missao-estrela-perdida');
const sumsPath = join(targetRoot, 'docs', 'SHA256SUMS.txt');
const input = process.argv[2];

if (!input) {
  console.error('Uso: npm run assets:missao-estrela -- /caminho/missao-estrela-perdida-hd.zip');
  console.error('Também é aceito o diretório já extraído do kit.');
  process.exit(1);
}

if (!existsSync(sumsPath)) {
  console.error(`Arquivo de hashes não encontrado: ${sumsPath}`);
  process.exit(1);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function parseSums() {
  return readFileSync(sumsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/i);
      if (!match) throw new Error(`Linha inválida em SHA256SUMS.txt: ${line}`);
      return { hash: match[1].toLowerCase(), relative: match[2] };
    });
}

function findKitRoot(root) {
  if (existsSync(join(root, 'asset_manifest.json'))) return root;

  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry);
    if (!statSync(candidate).isDirectory()) continue;
    if (existsSync(join(candidate, 'asset_manifest.json'))) return candidate;
  }

  throw new Error('Não encontrei a raiz do kit Missão: Estrela Perdida.');
}

let extractedTemp = null;
let sourceRoot;
const inputPath = resolve(input);

try {
  if (!existsSync(inputPath)) throw new Error(`Entrada não encontrada: ${inputPath}`);

  if (statSync(inputPath).isDirectory()) {
    sourceRoot = findKitRoot(inputPath);
  } else {
    const lower = basename(inputPath).toLowerCase();
    if (!lower.endsWith('.zip')) throw new Error('A entrada deve ser um ZIP ou diretório extraído.');
    extractedTemp = mkdtempSync(join(tmpdir(), 'mexemundo-missao-estrela-'));
    try {
      execFileSync('unzip', ['-q', inputPath, '-d', extractedTemp], { stdio: 'inherit' });
    } catch (error) {
      throw new Error('Não foi possível extrair o ZIP. Instale o comando unzip ou passe o diretório já extraído.', { cause: error });
    }
    sourceRoot = findKitRoot(extractedTemp);
  }

  const expected = parseSums();
  const failures = [];

  console.log(`Validando ${expected.length} PNGs originais antes da cópia...`);
  for (const entry of expected) {
    const source = join(sourceRoot, entry.relative);
    if (!existsSync(source)) {
      failures.push(`${entry.relative}: ausente no kit`);
      continue;
    }
    const actual = sha256(source);
    if (actual !== entry.hash) failures.push(`${entry.relative}: hash de origem divergente`);
  }

  if (failures.length) {
    console.error(failures.join('\n'));
    throw new Error(`Kit rejeitado: ${failures.length} arquivo(s) não correspondem aos hashes aprovados.`);
  }

  console.log('Originais validados. Copiando sem resize, conversão ou recompressão...');
  for (const entry of expected) {
    const source = join(sourceRoot, entry.relative);
    const target = join(targetRoot, entry.relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  const postFailures = [];
  console.log('Validando os arquivos já copiados no repositório...');
  for (const entry of expected) {
    const target = join(targetRoot, entry.relative);
    const actual = sha256(target);
    if (actual !== entry.hash) postFailures.push(`${entry.relative}: hash alterado após a cópia`);
  }

  if (postFailures.length) {
    console.error(postFailures.join('\n'));
    throw new Error(`Falha de integridade: ${postFailures.length} arquivo(s) foram alterados na transferência.`);
  }

  console.log(`OK: ${expected.length}/${expected.length} PNGs copiados byte a byte e validados por SHA-256.`);
  console.log(`Destino: ${targetRoot}`);
} finally {
  if (extractedTemp) rmSync(extractedTemp, { recursive: true, force: true });
}
