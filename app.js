'use strict';
// Coletor (celular): cria conferências, lê plaquetas e gera o Excel.

const base = new Map();            // patrimônio -> [descrição, filial base]
const totalPorFilial = new Map();  // filial -> quantidade de ativos com plaqueta
let baseInfo = null;
let dispositivo = '';
let conf = null;                   // conferência aberta na tela de leitura
let leituras = new Map();          // patrimônio -> leitura (da conferência aberta)

// câmera
let track = null, detector = null, lendo = false, lanterna = false, wakeLock = null, audio = null;
let candidato = null, repeticoes = 0, ultimoValor = null, ultimoEm = 0;

// ---------- Navegação ----------
const TELAS = ['telaMenu', 'telaNova', 'telaLista', 'telaLeitura'];
function mostrar(tela) {
  TELAS.forEach(t => { $(t).hidden = t !== tela; });
  window.scrollTo(0, 0);
}

async function irMenu() {
  pararCamera();
  conf = null;
  const todas = await confListar();
  const abertas = todas.filter(c => c.status === 'aberta').sort((a, b) => b.criadaEm - a.criadaEm);
  const ul = $('abertas');
  ul.innerHTML = '';
  for (const c of abertas) {
    const qtd = (await leiturasDe(c.codigo)).length;
    const li = document.createElement('li');
    li.innerHTML = '<div class="txt"><div class="t1">' + escapar(c.codigo) + '</div><div class="t2">Filial ' +
      escapar(c.filial) + ', ' + qtd + (qtd === 1 ? ' item lido' : ' itens lidos') + '</div></div>';
    const b = document.createElement('button');
    b.className = 'mini';
    b.textContent = 'Continuar';
    b.addEventListener('click', () => abrirLeitura(c.codigo));
    li.appendChild(b);
    ul.appendChild(li);
  }
  $('secAbertas').hidden = !abertas.length;
  const finalizadas = todas.length - abertas.length;
  $('btnFinalizadas').hidden = !finalizadas;
  $('btnFinalizadas').textContent = 'Conferências finalizadas (' + finalizadas + ')';
  liberarMenu();
  atualizarInstalar();
  mostrar('telaMenu');
  verificarBase(false);
}

// ---------- Instalação ----------
let promptInstalar = null;
const jaInstalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function atualizarInstalar() {
  if (jaInstalado()) { $('instalar').hidden = true; return; }
  $('instalar').hidden = false;
  $('instalarLinha').hidden = !promptInstalar;
  $('instalarTexto').textContent = promptInstalar ?
    'Ele ganha um ícone na tela inicial e funciona sem internet.' :
    'Abra o menu do navegador (os três pontinhos no canto) e toque em "Adicionar à tela inicial" ou "Instalar app". Use o Chrome.';
}
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); promptInstalar = ev; atualizarInstalar(); });
window.addEventListener('appinstalled', () => { promptInstalar = null; $('instalar').hidden = true; });
$('btnInstalar').addEventListener('click', async () => {
  if (!promptInstalar) return;
  promptInstalar.prompt();
  try { await promptInstalar.userChoice; } catch (e) {}
  promptInstalar = null;
  atualizarInstalar();
});

// ---------- Base ----------
function montarBase(linhas) {
  base.clear(); totalPorFilial.clear();
  for (const [p, d, f] of linhas) {
    if (base.has(p)) continue;
    base.set(p, [d, f]);
    totalPorFilial.set(f, (totalPorFilial.get(f) || 0) + 1);
  }
}

function mostrarBaseInfo() {
  if (!base.size) {
    $('basePonto').className = 'ponto aviso';
    $('baseResumo').textContent = 'Ainda não carregada';
    $('baseInfo').textContent = 'Sem a base, o app não reconhece as plaquetas.';
    $('baseDetalhes').open = true;
    return;
  }
  $('basePonto').className = 'ponto bom';
  $('baseResumo').textContent = base.size.toLocaleString('pt-BR') + ' ativos, atualizada em ' + dataHora(baseInfo.em).slice(0, 10);
  $('baseInfo').textContent = totalPorFilial.size + ' filiais. Origem: ' + baseInfo.arquivo + ', carregada em ' + dataHora(baseInfo.em) + '.';
}

function liberarMenu() {
  $('btnNova').disabled = !base.size;
  $('menuMsg').className = 'nota aviso';
  $('menuMsg').textContent = base.size ? '' : 'Antes de começar, carregue a base de ativos logo abaixo.';
}

$('arqBase').addEventListener('change', async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  syncMsg('Carregando a base, aguarde...');
  try {
    const linhas = (await lerArquivoBase(arq)).filter(l => l.p).map(l => [l.p, l.d, l.f]);
    if (!linhas.length) throw new Error('Nenhum ativo com número de patrimônio no arquivo.');
    montarBase(linhas);
    baseInfo = { arquivo: arq.name, em: Date.now(), total: base.size };
    await kvGravar('base', Array.from(base, ([p, v]) => [p, v[0], v[1]]));
    await kvGravar('baseInfo', baseInfo);
    mostrarBaseInfo();
    syncMsg('Base carregada do arquivo.', 'bom');
    irMenu();
  } catch (e) {
    syncMsg('Não foi possível carregar o arquivo: ' + e.message, 'erro');
    mostrarBaseInfo();
  }
});

// ---------- Atualização automática da base ----------
let verificando = false, verificadoEm = 0, metaPendente = null;

function syncMsg(texto, classe) {
  $('syncMsg').textContent = texto || '';
  $('syncMsg').className = 'nota ' + (classe || '');
}

function pedirSenha(texto) {
  $('senhaBox').hidden = false;
  $('baseDetalhes').open = true;
  syncMsg(texto, 'aviso');
}

// Consulta a base publicada. Sem "forcar", no máximo uma vez a cada 5 minutos e sem mensagens de rotina.
async function verificarBase(forcar) {
  if (verificando) return;
  if (!forcar && Date.now() - verificadoEm < 5 * 60000) return;
  if (!navigator.onLine) { if (forcar) syncMsg('Sem internet no momento.', 'aviso'); return; }
  verificando = true;
  try {
    const r = await fetch('dados/base.json?t=' + Date.now(), { cache: 'no-store' });
    verificadoEm = Date.now();
    if (r.status === 404) { if (forcar) syncMsg('Nenhuma base publicada ainda.'); return; }
    if (!r.ok) throw new Error('erro ' + r.status);
    const meta = await r.json();
    if (!meta || typeof meta.versao !== 'string' || !/^[0-9a-f]{64}$/.test(meta.sha256 || '')) throw new Error('informações da base inválidas');
    if (baseInfo && baseInfo.versao === meta.versao) {
      $('senhaBox').hidden = true;
      if (forcar) syncMsg('A base já está na versão mais recente.', 'bom');
      return;
    }
    metaPendente = meta;
    const chave = await kvLer('chaveBase');
    if (!chave) { pedirSenha('Há uma base publicada. Digite a senha para baixar.'); return; }
    await baixarBase(meta, chave);
  } catch (e) {
    if (forcar) syncMsg('Não foi possível verificar: ' + e.message, 'erro');
  } finally {
    verificando = false;
  }
}

async function baixarBase(meta, chave) {
  syncMsg('Baixando a base nova...');
  const r = await fetch('dados/base.bin?v=' + encodeURIComponent(meta.versao), { cache: 'no-store' });
  if (!r.ok) throw new Error('erro ' + r.status + ' ao baixar');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (await sha256Hex(bytes) !== meta.sha256) throw new Error('a publicação ainda está sendo processada, tente em 1 minuto');
  let obj;
  try {
    obj = await decifrarBase(chave, bytes);
  } catch (e) {
    await operar('kv', 'readwrite', s => s.delete('chaveBase'));
    pedirSenha('Senha incorreta ou alterada. Digite a senha atual.');
    return false;
  }
  if (!obj || obj.v !== meta.versao || !Array.isArray(obj.l) || !obj.l.length) throw new Error('conteúdo da base inválido');
  montarBase(obj.l);
  baseInfo = { arquivo: 'Base publicada', em: Date.now(), total: base.size, versao: meta.versao };
  await kvGravar('base', Array.from(base, ([p, v]) => [p, v[0], v[1]]));
  await kvGravar('baseInfo', baseInfo);
  await prepararVivo(chave);
  if (vivoPendentes.size) agendarVivo(0);
  metaPendente = null;
  $('senhaBox').hidden = true;
  $('senhaBase').value = '';
  mostrarBaseInfo();
  liberarMenu();
  syncMsg('Base atualizada automaticamente: ' + base.size.toLocaleString('pt-BR') + ' ativos.', 'bom');
  return true;
}

$('btnVerificar').addEventListener('click', () => { syncMsg('Verificando...'); verificarBase(true); });

$('btnSenha').addEventListener('click', async () => {
  const senha = normalizarSenha($('senhaBase').value);
  if (senha.length < SENHA_MINIMA) { syncMsg('Senha incompleta.', 'erro'); return; }
  if (!metaPendente || verificando) return;
  verificando = true;
  $('btnSenha').disabled = true;
  try {
    const chave = await chaveDaSenha(senha);
    await kvGravar('chaveBase', chave);
    await baixarBase(metaPendente, chave);
  } catch (e) {
    syncMsg('Não foi possível baixar: ' + e.message, 'erro');
  } finally {
    verificando = false;
    $('btnSenha').disabled = false;
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('telaMenu').hidden) verificarBase(false);
});

// ---------- Nova conferência ----------
$('btnNova').addEventListener('click', async () => {
  $('novaFilial').value = '';
  $('novaFilialInfo').textContent = '';
  $('novaErro').textContent = '';
  $('novaSetor').value = '';
  $('novaUsuario').value = (await kvLer('usuario')) || '';
  mostrar('telaNova');
});

$('novaFilial').addEventListener('input', () => {
  const f = normalizarFilial($('novaFilial').value);
  const n = totalPorFilial.get(f);
  $('novaFilialInfo').textContent = !f ? '' :
    n ? 'Filial ' + f + ': ' + n.toLocaleString('pt-BR') + ' ativos com plaqueta na base.' :
    'Atenção: a base não tem ativos nesta filial.';
  $('novaFilialInfo').className = 'info' + (f && !n ? ' aviso' : '');
});

$('btnCriar').addEventListener('click', async () => {
  const filial = normalizarFilial($('novaFilial').value);
  const usuario = $('novaUsuario').value.trim();
  if (!filial) { $('novaErro').textContent = 'Informe o número da filial.'; return; }
  if (!usuario) { $('novaErro').textContent = 'Informe seu nome.'; return; }
  await kvGravar('usuario', usuario);

  const d = new Date();
  const prefixo = filial.padStart(3, '0') + '-' + d.getFullYear() + doisDigitos(d.getMonth() + 1) + doisDigitos(d.getDate());
  let seq = ((await kvLer('seq:' + prefixo)) || 0) + 1;
  while (await confLer(prefixo + '-' + doisDigitos(seq))) seq++;
  await kvGravar('seq:' + prefixo, seq);

  const nova = {
    codigo: prefixo + '-' + doisDigitos(seq),
    filial, usuario, dispositivo,
    setorAtual: $('novaSetor').value.trim(),
    status: 'aberta',
    criadaEm: Date.now(), finalizadaEm: 0,
    baseArquivo: baseInfo ? baseInfo.arquivo : ''
  };
  await confGravar(nova);
  marcarVivo(nova.codigo, true);
  abrirLeitura(nova.codigo);
});

// ---------- Importar conferência (continuar a partir de um Excel parcial) ----------
$('arqConf').addEventListener('change', async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  const aviso = (texto, classe) => { $('menuMsg').className = 'nota ' + classe; $('menuMsg').textContent = texto; };
  try {
    const { info, porCodigo } = await lerArquivoConferencia(arq);
    if (porCodigo.size > 1) throw new Error('o arquivo tem mais de uma conferência.');
    const [codigo, itens] = porCodigo.entries().next().value;
    if (/^FINALIZADA/.test(semAcento(info.STATUS))) {
      throw new Error('a conferência ' + codigo + ' já foi finalizada e não pode receber novas leituras.');
    }
    let c = await confLer(codigo);
    if (c && c.status === 'finalizada') {
      throw new Error('a conferência ' + codigo + ' já está finalizada neste aparelho.');
    }
    if (!c) {
      const filial = (itens[0] && itens[0].filialAtual) || normalizarFilial(info.FILIAL) || normalizarFilial(codigo.split('-')[0]);
      if (!filial) throw new Error('não foi possível identificar a filial da conferência.');
      const maisRecente = itens.reduce((a, l) => (!a || l.ultima > a.ultima ? l : a), null);
      c = {
        codigo, filial,
        usuario: (await kvLer('usuario')) || String(info.USUARIO || '').trim() || 'Não informado',
        dispositivo,
        setorAtual: maisRecente ? maisRecente.setor : '',
        status: 'aberta',
        criadaEm: lerDataHora(info.INICIO) || Date.now(), finalizadaEm: 0,
        baseArquivo: baseInfo ? baseInfo.arquivo : ''
      };
      await confGravar(c);
    }
    let novos = 0;
    for (const l of itens) {
      // a base deste aparelho é a referência para descrição e filial
      const b = base.get(l.patrimonio);
      if (base.size) { l.cadastrado = !!b; l.descricao = b ? b[0] : ''; l.filialBase = b ? b[1] : ''; }
      l.filialAtual = c.filial;
      const antiga = await leituraLer(codigo, l.patrimonio);
      if (antiga) juntarLeituras(l, antiga); else novos++;
      await leituraGravar(l);
    }
    marcarVivo(codigo, true);
    await abrirLeitura(codigo);
    $('camMsg').className = 'nota bom';
    $('camMsg').textContent = 'Conferência importada: ' + itens.length + ' leituras no arquivo, ' + novos + ' novas neste aparelho.';
  } catch (e) {
    aviso('Não foi possível importar: ' + e.message, 'erro');
  }
});

// ---------- Listas ----------
async function abrirLista(status) {
  const todas = (await confListar()).filter(c => c.status === status).sort((a, b) => b.criadaEm - a.criadaEm);
  $('listaTitulo').textContent = status === 'aberta' ? 'Continuar conferência' : 'Conferências finalizadas';
  $('listaVazia').hidden = todas.length > 0;
  $('listaDica').hidden = status === 'aberta' || !todas.length;
  const ul = $('listaConfs');
  ul.innerHTML = '';
  for (const c of todas) {
    const qtd = (await leiturasDe(c.codigo)).length;
    const li = document.createElement('li');
    li.innerHTML = '<div class="txt"><div class="t1">' + escapar(c.codigo) + '</div><div class="t2">Filial ' +
      escapar(c.filial) + ', ' + qtd + ' itens, ' + dataHora(status === 'aberta' ? c.criadaEm : c.finalizadaEm).slice(0, 16) + '</div></div>';
    const b = document.createElement('button');
    b.className = 'mini' + (status === 'aberta' ? '' : ' sec');
    b.textContent = status === 'aberta' ? 'Abrir' : 'Enviar';
    b.addEventListener('click', () => status === 'aberta' ? abrirLeitura(c.codigo) : exportar(c.codigo));
    li.appendChild(b);
    ul.appendChild(li);
  }
  mostrar('telaLista');
}
$('btnFinalizadas').addEventListener('click', () => abrirLista('finalizada'));
document.querySelectorAll('[data-voltar]').forEach(b => b.addEventListener('click', irMenu));

// ---------- Leitura ----------
async function abrirLeitura(codigo) {
  conf = await confLer(codigo);
  if (!conf || conf.status !== 'aberta') return irMenu();
  leituras = new Map((await leiturasDe(codigo)).map(l => [l.patrimonio, l]));
  $('leFilial').textContent = conf.filial;
  $('leCodigo').textContent = conf.codigo;
  $('leSetor').value = conf.setorAtual || '';
  $('ultNum').textContent = '—';
  $('ultDesc').textContent = 'Nenhuma leitura ainda.';
  $('ultSit').textContent = '';
  $('ultimo').className = 'plaqueta';
  $('manual').value = '';
  $('camMsg').textContent = '';
  $('camMsg').className = 'nota';
  $('ligarCam').hidden = false;
  vivoMsg('');
  atualizarContadores();
  desenharLista();
  mostrar('telaLeitura');
}

$('leSetor').addEventListener('change', async () => {
  if (!conf) return;
  conf.setorAtual = $('leSetor').value.trim();
  await confGravar(conf);
});

function atualizarContadores() {
  let filial = 0, transf = 0, nao = 0;
  for (const l of leituras.values()) {
    const s = situacaoDe(l);
    if (s === 'OK') filial++; else if (s === 'Transferência') transf++; else nao++;
  }
  $('cTotal').textContent = leituras.size;
  $('cFilial').textContent = filial;
  $('cTransf').textContent = transf;
  $('cNao').textContent = nao;
  const total = totalPorFilial.get(conf.filial) || 0;
  $('cFilialRot').textContent = 'de ' + total.toLocaleString('pt-BR') + ' ativos desta filial';
  $('barra').style.width = (total ? Math.min(100, 100 * filial / total) : 0) + '%';
}

function desenharLista() {
  const itens = Array.from(leituras.values()).sort((a, b) => b.ultima - a.ultima);
  const ul = $('listaLidos');
  ul.innerHTML = '';
  $('listaNada').textContent = itens.length ? 'Toque em um item para remover.' : 'Os itens aparecem aqui conforme você lê.';
  for (const l of itens.slice(0, 100)) {
    const s = situacaoDe(l);
    const li = document.createElement('li');
    const tag = s === 'Transferência' ? '<span class="tag transf">Filial ' + escapar(l.filialBase) + '</span>' :
      s === 'Não cadastrado' ? '<span class="tag nao">Não cadastrado</span>' : '';
    li.innerHTML = '<div class="txt"><div class="t1">' + escapar(l.patrimonio) + ' ' + tag + '</div><div class="t2">' +
      escapar(l.descricao || 'Sem descrição') + (l.setor ? ' (' + escapar(l.setor) + ')' : '') + '</div></div>';
    li.addEventListener('click', async () => {
      if (!confirm('Remover o patrimônio ' + l.patrimonio + ' desta conferência?')) return;
      await leituraApagar(conf.codigo, l.patrimonio);
      marcarVivo(conf.codigo);
      leituras.delete(l.patrimonio);
      atualizarContadores();
      desenharLista();
    });
    ul.appendChild(li);
  }
  $('listaMais').hidden = itens.length <= 100;
  $('listaMais').textContent = 'Mostrando os 100 mais recentes de ' + itens.length + '. Todos vão para o Excel.';
}

async function registrar(valor, origem) {
  if (!conf) return;
  const p = normalizarPatrimonio(valor);
  if (!p) { som('erro'); return; }
  const agora = Date.now();
  const item = base.get(p);
  let l = leituras.get(p);
  const repetido = !!l;
  if (l) {
    l.ultima = agora;
    l.qtd++;
  } else {
    l = {
      codigo: conf.codigo, patrimonio: p,
      descricao: item ? item[0] : '', filialBase: item ? item[1] : '',
      filialAtual: conf.filial, cadastrado: !!item,
      setor: conf.setorAtual || '', usuario: conf.usuario,
      primeira: agora, ultima: agora, qtd: 1, origem
    };
    leituras.set(p, l);
  }
  await leituraGravar(l);
  marcarVivo(conf.codigo);
  semBarrasDesde = Date.now();

  const s = situacaoDe(l);
  $('ultNum').textContent = p;
  $('ultDesc').textContent = l.cadastrado ? l.descricao : 'Número não encontrado na base';
  $('ultSit').textContent = (s === 'OK' ? 'Pertence a esta filial.' :
    s === 'Transferência' ? 'Atenção: pertence à filial ' + l.filialBase + '.' :
    'Não cadastrado. Confira o número.') + (repetido ? ' Já lido antes (' + l.qtd + ' vezes).' : '');
  $('ultimo').className = 'plaqueta ' + (s === 'OK' ? 's-ok' : s === 'Transferência' ? 's-transf' : 's-nao');
  som(repetido ? 'repetido' : s === 'OK' ? 'ok' : s === 'Transferência' ? 'transf' : 'erro');
  $('mira').classList.add('ok');
  setTimeout(() => $('mira').classList.remove('ok'), 400);
  atualizarContadores();
  desenharLista();
}

$('btnManual').addEventListener('click', () => {
  const v = $('manual').value;
  if (!normalizarPatrimonio(v)) { $('manual').focus(); return; }
  iniciarAudio();
  registrar(v, 'Manual');
  $('manual').value = '';
});
$('manual').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('btnManual').click(); });

// ---------- Som e vibração ----------
function iniciarAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
}
function tom(freq, inicio, dur, vol) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq; g.gain.value = vol;
  o.connect(g); g.connect(audio.destination);
  o.start(audio.currentTime + inicio); o.stop(audio.currentTime + inicio + dur);
}
function som(tipo) {
  try {
    if (tipo === 'ok') { tom(1200, 0, 0.12, 0.25); vibrar(80); }
    else if (tipo === 'repetido') { tom(900, 0, 0.06, 0.12); vibrar(30); }
    else if (tipo === 'transf') { tom(800, 0, 0.12, 0.3); tom(800, 0.18, 0.12, 0.3); vibrar([90, 60, 90]); }
    else { tom(300, 0, 0.4, 0.3); vibrar([250]); }
  } catch (e) {}
}
function vibrar(p) { if (navigator.vibrate) navigator.vibrate(p); }

// ---------- Câmera e leitor ----------
// Pontos que deixam a leitura mais forte:
//  - escolhe a câmera traseira principal (não a grande-angular) e permite trocar;
//  - pede vídeo em alta resolução e começa com zoom 2x, para ler de mais longe e sem perder o foco;
//  - analisa todos os quadros, alternando a região da mira em resolução cheia com o quadro inteiro;
//  - aceita na hora um número que existe na base; número desconhecido precisa aparecer em 2 quadros.
let cameras = [], cameraId = null, formatos = null, quadro = 0, recorte = null;

// Leitor de reforço (ZXing em WebAssembly). Entra quando o leitor nativo não acha nada no quadro:
// ele tenta três formas diferentes de separar barras e fundo, o que resolve plaquetas com pouco
// contraste, reflexo ou barras finas. Também é o único leitor em navegadores sem leitor nativo.
const REFORCO_MODOS = ['FixedThreshold', 'GlobalHistogram', 'LocalAverage'];
const REFORCO_LARGURA = 1600;
let reforco = null, reforcoTela = null, reforcoVez = 0;

// Último recurso: ler o número impresso embaixo do código de barras (OCR).
// Só entra depois de um tempo sem conseguir ler as barras. Como um dígito trocado quase sempre
// cai em outro ativo que existe, o número nunca é registrado sozinho: o app mostra o número e a
// descrição, e a pessoa confirma com um toque.
const OCR_ESPERA = 1500;      // ms sem ler barras antes de tentar o número
const OCR_LARGURA = 1200;
let ocr = null, ocrOcupado = false, ocrTela = null, ocrAnterior = '', ocrProposta = '', semBarrasDesde = 0, ocrVez = 0;
const ocrRecusados = new Map();   // número -> até quando ignorar

function carregarOcr() {
  if (ocr) return ocr;
  ocr = (async () => {
    if (typeof Tesseract === 'undefined') return null;
    try {
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: 'lib/ocr/worker.min.js', corePath: 'lib/ocr/core', langPath: 'lib/ocr/lang',
        workerBlobURL: false, gzip: true
      });
      await w.setParameters({ tessedit_char_whitelist: '0123456789', user_defined_dpi: '300' });
      return w;
    } catch (e) { console.debug('ocr indisponível', e); return null; }
  })();
  return ocr;
}

async function tentarOcr(fonte, largura, altura) {
  if (ocrOcupado || ocrProposta || !largura) return;
  ocrOcupado = true;
  try {
    const w = await carregarOcr();
    if (!w) return;
    const escala = Math.min(1, OCR_LARGURA / largura);
    ocrTela = ocrTela || document.createElement('canvas');
    ocrTela.width = Math.round(largura * escala); ocrTela.height = Math.round(altura * escala);
    const ctx = ocrTela.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.drawImage(fonte, 0, 0, ocrTela.width, ocrTela.height);
    // tons de cinza com o contraste esticado: é o que mais ajuda a reconhecer os dígitos
    const img = ctx.getImageData(0, 0, ocrTela.width, ocrTela.height), px = img.data;
    let min = 255, max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = (px[i] * 3 + px[i + 1] * 6 + px[i + 2]) / 10;
      px[i] = g; if (g < min) min = g; if (g > max) max = g;
    }
    const faixa = (max - min) || 1;
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = (px[i] - min) * 255 / faixa;
    ctx.putImageData(img, 0, 0);
    // alterna dois modos de análise da página; a proposta exige o mesmo número nos dois
    await w.setParameters({ tessedit_pageseg_mode: ocrVez++ % 2 ? '3' : '11' });
    const r = await w.recognize(ocrTela);
    console.debug('ocr', ocrTela.width + 'x' + ocrTela.height, JSON.stringify(r.data.text));
    if (!lendo || ocrProposta) return;
    // a plaqueta sempre traz 6 dígitos; só interessa número que existe na base e ainda não foi lido
    const agora = Date.now();
    const candidatos = (r.data.text.match(/\d+/g) || []).filter(t => t.length === 6).map(normalizarPatrimonio)
      .filter(p => p && base.has(p) && !leituras.has(p) && !(ocrRecusados.get(p) > agora));
    const visto = candidatos.find(p => p === ocrAnterior);
    ocrAnterior = candidatos[0] || '';
    if (visto) proporOcr(visto);          // mesmo número em duas leituras seguidas
  } catch (e) { console.debug('ocr erro', e);
  } finally {
    ocrOcupado = false;
  }
}

function proporOcr(p) {
  const item = base.get(p);
  ocrProposta = p;
  $('ocrNum').textContent = p.padStart(6, '0');
  $('ocrDesc').textContent = item[0] + (String(item[1]) === String(conf.filial) ? '' : ' (pertence à filial ' + item[1] + ')');
  $('ocrBox').hidden = false;
  som('repetido');
}

function fecharOcr() {
  ocrProposta = ''; ocrAnterior = '';
  semBarrasDesde = Date.now();
  $('ocrBox').hidden = true;
}

$('btnOcrSim').addEventListener('click', async () => {
  const p = ocrProposta;
  fecharOcr();
  if (p && conf) await registrar(p, 'Número impresso');
});
$('btnOcrNao').addEventListener('click', () => {
  if (ocrProposta) ocrRecusados.set(ocrProposta, Date.now() + 30000);
  fecharOcr();
});

function carregarReforco() {
  if (reforco) return reforco;
  reforco = (async () => {
    if (typeof ZXingWASM === 'undefined') return false;
    try {
      ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (arq, prefixo) => arq.endsWith('.wasm') ? 'lib/zxing_reader.wasm' : prefixo + arq }
      });
      await ZXingWASM.getZXingModule();
      return true;
    } catch (e) { return false; }
  })();
  return reforco;
}

async function lerReforco(fonte, largura, altura) {
  if (!(await carregarReforco()) || !largura || !altura) return [];
  const escala = Math.min(1, REFORCO_LARGURA / largura);
  const w = Math.round(largura * escala), h = Math.round(altura * escala);
  reforcoTela = reforcoTela || document.createElement('canvas');
  if (reforcoTela.width !== w || reforcoTela.height !== h) { reforcoTela.width = w; reforcoTela.height = h; }
  const ctx = reforcoTela.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.drawImage(fonte, 0, 0, w, h);
  const modo = REFORCO_MODOS[reforcoVez++ % REFORCO_MODOS.length];
  const achados = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, w, h), {
    formats: ['Code128', 'Code39'], binarizer: modo, tryHarder: true,
    tryRotate: false, tryInvert: false, tryDownscale: false, maxNumberOfSymbols: 2
  });
  return achados.map(a => a.text);
}

$('btnCamera').addEventListener('click', () => ligarCamera());

function abrirStream(deviceId) {
  const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
  Object.assign(video, { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } });
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

// No Android os rótulos são do tipo "camera2 0, facing back". A principal costuma ser a de número 0.
function cameraPrincipal(lista) {
  return lista.find(d => /(^|\D)0(\D|$)/.test(d.label.replace(/camera2/i, ''))) || lista[0];
}

async function ligarCamera(trocarPara) {
  iniciarAudio();
  const aviso = texto => { $('camMsg').className = 'nota erro'; $('camMsg').textContent = texto; };
  const temNativo = 'BarcodeDetector' in window;
  const temReforco = await carregarReforco();
  if (!temNativo && !temReforco) {
    aviso('Este navegador não lê código de barras. Abra o app no Chrome, ou digite os números.');
    return;
  }
  try {
    if (temNativo && !formatos) {
      const suportados = await BarcodeDetector.getSupportedFormats();
      formatos = ['code_128', 'code_39'].filter(f => suportados.includes(f));
      if (!formatos.length) formatos = ['code_128'];
      detector = new BarcodeDetector({ formats: formatos });
    }
    if (track) { try { track.stop(); } catch (e) {} track = null; }
    if (trocarPara) cameraId = trocarPara;
    else if (!cameraId) cameraId = (await kvLer('cameraId')) || null;

    let stream;
    try { stream = await abrirStream(cameraId); }
    catch (e) { if (!cameraId) throw e; cameraId = null; stream = await abrirStream(null); }

    // com a permissão concedida, os rótulos aparecem: confere se estamos na câmera principal
    const todas = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    cameras = todas.filter(d => /back|rear|traseira|environment/i.test(d.label));
    if (!cameraId && cameras.length > 1) {
      const alvo = cameraPrincipal(cameras);
      const atual = stream.getVideoTracks()[0].getSettings().deviceId;
      if (alvo && alvo.deviceId && alvo.deviceId !== atual) {
        stream.getTracks().forEach(t => t.stop());
        try { stream = await abrirStream(alvo.deviceId); cameraId = alvo.deviceId; }
        catch (e) { stream = await abrirStream(null); }
      }
    }

    $('video').srcObject = stream;
    await $('video').play();
    track = stream.getVideoTracks()[0];
    track.addEventListener('ended', pararCamera);
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const avancado = [];
    if (caps.focusMode && caps.focusMode.includes('continuous')) avancado.push({ focusMode: 'continuous' });
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) avancado.push({ exposureMode: 'continuous' });
    if (avancado.length) track.applyConstraints({ advanced: avancado }).catch(() => {});

    montarZoom(caps);
    lanterna = false;
    $('btnLanterna').hidden = !caps.torch;
    $('btnLanterna').classList.remove('ligado');
    $('btnTrocar').hidden = cameras.length < 2;
    $('ligarCam').hidden = true;
    $('camMsg').textContent = '';
    $('camMsg').className = 'nota';
    const cfg = track.getSettings();
    $('camInfo').textContent = 'Câmera ' + (cfg.width || '?') + '×' + (cfg.height || '?') + ', leitor ' +
      (temNativo ? 'nativo' : '') + (temNativo && temReforco ? ' + ' : '') + (temReforco ? 'reforço' : '') + '.';
    try { if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    candidato = null; repeticoes = 0;
    semBarrasDesde = Date.now();
    setTimeout(carregarOcr, 1200);          // prepara o leitor de números em segundo plano
    if (!lendo) { lendo = true; proximoQuadro(); }
  } catch (e) {
    aviso('Não foi possível abrir a câmera. Verifique se o app tem permissão de câmera. (' + e.message + ')');
  }
}

async function montarZoom(caps) {
  const caixa = $('zoomBox');
  caixa.innerHTML = '';
  if (!caps.zoom || !(caps.zoom.max > caps.zoom.min)) { caixa.hidden = true; return; }
  const niveis = [1, 2, 3, 4].filter(z => z >= caps.zoom.min && z <= caps.zoom.max);
  if (niveis.length < 2) { caixa.hidden = true; return; }
  const salvo = Number(await kvLer('zoom')) || 2;
  const inicial = niveis.includes(salvo) ? salvo : niveis[Math.min(1, niveis.length - 1)];
  const aplicar = z => {
    track.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
    caixa.querySelectorAll('button').forEach(b => b.classList.toggle('ligado', Number(b.dataset.z) === z));
  };
  for (const z of niveis) {
    const b = document.createElement('button');
    b.textContent = z + 'x';
    b.dataset.z = z;
    b.addEventListener('click', () => { aplicar(z); kvGravar('zoom', z); });
    caixa.appendChild(b);
  }
  caixa.hidden = false;
  aplicar(inicial);
}

function pararCamera() {
  lendo = false;
  if (track) { try { track.stop(); } catch (e) {} track = null; }
  $('video').srcObject = null;
  $('btnLanterna').hidden = true;
  $('btnTrocar').hidden = true;
  $('zoomBox').hidden = true;
  $('camInfo').textContent = '';
  if (ocrProposta) fecharOcr();
  $('ligarCam').hidden = false;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

$('btnLanterna').addEventListener('click', () => {
  if (!track) return;
  lanterna = !lanterna;
  $('btnLanterna').classList.toggle('ligado', lanterna);
  track.applyConstraints({ advanced: [{ torch: lanterna }] }).catch(() => {});
});

$('btnTrocar').addEventListener('click', async () => {
  if (cameras.length < 2) return;
  const atual = track ? track.getSettings().deviceId : cameraId;
  const i = cameras.findIndex(d => d.deviceId === atual);
  const proxima = cameras[(i + 1) % cameras.length];
  await kvGravar('cameraId', proxima.deviceId);
  ligarCamera(proxima.deviceId);
});

function proximoQuadro() {
  const v = $('video');
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => analisarQuadro());
  else setTimeout(analisarQuadro, 50);
}

// Recorta do vídeo a área que aparece dentro da mira (o vídeo é cortado para preencher a caixa).
function regiaoDaMira(v) {
  const vw = v.videoWidth, vh = v.videoHeight, bw = v.clientWidth, bh = v.clientHeight;
  if (!vw || !vh || !bw || !bh) return null;
  const escala = Math.max(bw / vw, bh / vh);
  const visW = bw / escala, visH = bh / escala;
  const x = (vw - visW) / 2 + visW * 0.03, y = (vh - visH) / 2 + visH * 0.2;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(visW * 0.94), h: Math.round(visH * 0.6) };
}

async function analisarQuadro() {
  if (!lendo || !track) { lendo = false; return; }
  const v = $('video');
  try {
    quadro++;
    let fonte = v;
    const r = quadro % 3 ? regiaoDaMira(v) : null;   // 2 de cada 3 quadros: só a mira, em resolução cheia
    if (r) {
      recorte = recorte || document.createElement('canvas');
      if (recorte.width !== r.w || recorte.height !== r.h) { recorte.width = r.w; recorte.height = r.h; }
      recorte.getContext('2d', { alpha: false }).drawImage(v, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      fonte = recorte;
    }
    let brutos = detector ? (await detector.detect(fonte)).map(a => a.rawValue) : [];
    if (!brutos.some(normalizarPatrimonio)) {
      // nada pelo leitor nativo: passa o mesmo quadro pelo leitor de reforço
      brutos = await lerReforco(fonte, r ? r.w : v.videoWidth, r ? r.h : v.videoHeight);
    }
    const validos = brutos.map(normalizarPatrimonio).filter(Boolean);
    const valor = validos.find(p => base.has(p)) || validos[0] || '';
    if (valor) {
      if (ocrProposta) fecharOcr();       // as barras leram: a proposta pelo número não é mais necessária
      semBarrasDesde = Date.now();
    } else if (r && Date.now() - semBarrasDesde > OCR_ESPERA) {
      tentarOcr(recorte, r.w, r.h);       // não espera: o laço das barras continua rodando
    }
    if (valor) {
      if (valor === candidato) repeticoes++; else { candidato = valor; repeticoes = 1; }
      if (base.has(valor) || repeticoes >= 2) {
        const agora = Date.now();
        if (valor === ultimoValor && agora - ultimoEm < 3000) {
          ultimoEm = agora;       // mesma plaqueta ainda na frente da câmera
        } else {
          ultimoValor = valor; ultimoEm = agora;
          await registrar(valor, 'Câmera');
        }
      }
    } else if (!r) {
      candidato = null; repeticoes = 0;
    }
  } catch (e) {}
  if (lendo) proximoQuadro();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pararCamera();
});

// ---------- Envio ao vivo para o painel ----------
const VIVO_INTERVALO = 15000;
let vivoPendentes = new Set(), vivoTimer = null, vivoUltimo = 0, vivoEnviando = false;

function vivoMsg(texto) { $('vivoMsg').textContent = texto; }

// Marca a conferência para envio. "ja" envia sem esperar o intervalo.
function marcarVivo(codigo, ja) {
  if (!FIREBASE_URL) return;
  vivoPendentes.add(codigo);
  kvGravar('vivoPendentes', Array.from(vivoPendentes)).catch(() => {});
  agendarVivo(ja ? 0 : Math.max(0, VIVO_INTERVALO - (Date.now() - vivoUltimo)));
}

function agendarVivo(espera) {
  if (vivoTimer) { if (espera > 0) return; clearTimeout(vivoTimer); }
  vivoTimer = setTimeout(enviarVivo, espera);
}

async function enviarVivo() {
  vivoTimer = null;
  if (vivoEnviando) { agendarVivo(2000); return; }
  if (!vivoPendentes.size) return;
  if (!vivoLigado()) { vivoMsg(''); return; }
  if (!navigator.onLine) { vivoMsg('Sem internet. O envio ao painel será feito quando o sinal voltar.'); return; }
  vivoEnviando = true;
  try {
    for (const codigo of Array.from(vivoPendentes)) {
      const c = await confLer(codigo);
      if (!c) { vivoPendentes.delete(codigo); continue; }
      const itens = (await leiturasDe(codigo)).map(l =>
        [l.patrimonio, l.setor, l.usuario, l.primeira, l.ultima, l.qtd, l.origem]);
      const agora = Date.now();
      const retrato = {
        codigo: c.codigo, filial: c.filial, usuario: c.usuario, dispositivo: c.dispositivo,
        status: c.status, criadaEm: c.criadaEm, finalizadaEm: c.finalizadaEm, enviadaEm: agora, itens
      };
      const id = await idVivo(c.codigo, c.dispositivo);
      await pedirVivo('PUT', 'c/' + id, { t: agora, d: await cifrarVivo(retrato) });
      await pedirVivo('PUT', 'r/' + id, { t: agora });
      vivoPendentes.delete(codigo);
    }
    vivoUltimo = Date.now();
    await kvGravar('vivoPendentes', Array.from(vivoPendentes));
    vivoMsg('Painel atualizado às ' + dataHora(vivoUltimo).slice(11, 16) + '.');
  } catch (e) {
    vivoMsg('Não foi possível enviar ao painel agora. O app tenta de novo sozinho.');
    agendarVivo(30000);
  } finally {
    vivoEnviando = false;
  }
}
window.addEventListener('online', () => { if (vivoPendentes.size) agendarVivo(0); });

// ---------- Exportação ----------
async function montarExcel(codigo) {
  const c = await confLer(codigo);
  const itens = (await leiturasDe(codigo)).sort((a, b) => a.primeira - b.primeira);
  const linhas = [COLUNAS_LEITURA];
  for (const l of itens) {
    linhas.push([
      c.codigo, Number(l.patrimonio), l.descricao, l.filialBase === '' ? '' : Number(l.filialBase), Number(l.filialAtual),
      l.setor, l.usuario, dataHora(l.primeira), dataHora(l.ultima), l.qtd, l.origem, situacaoDe(l)
    ]);
  }
  const info = [
    ['Campo', 'Valor'],
    ['Código da Conferência', c.codigo],
    ['Filial', Number(c.filial)],
    ['Status', c.status === 'finalizada' ? 'Finalizada' : 'Parcial (em andamento)'],
    ['Usuário', c.usuario],
    ['Dispositivo', c.dispositivo],
    ['Início', dataHora(c.criadaEm)],
    ['Finalização', dataHora(c.finalizadaEm)],
    ['Exportado em', dataHora(Date.now())],
    ['Total de itens', itens.length],
    ['Base utilizada', c.baseArquivo || ''],
    ['Versão do app', VERSAO_APP]
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abaDeMatriz(linhas, [22, 12, 60, 11, 11, 20, 18, 20, 20, 12, 10, 16]), ABA_LEITURAS);
  XLSX.utils.book_append_sheet(wb, abaDeMatriz(info, [26, 36]), ABA_INFO);
  const nome = 'Conferencia_' + c.codigo + (c.status === 'finalizada' ? '' : '_PARCIAL') + '.xlsx';
  return { blob: planilhaParaBlob(wb), nome };
}

async function exportar(codigo) {
  const { blob, nome } = await montarExcel(codigo);
  const arquivo = new File([blob], nome, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: nome });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // usuário fechou a tela de compartilhar
  }
  baixarArquivo(blob, nome);
}

$('btnParcial').addEventListener('click', () => { if (conf) exportar(conf.codigo); });

$('btnFinalizar').addEventListener('click', async () => {
  if (!conf) return;
  if (!leituras.size) { alert('Nenhum item lido ainda.'); return; }
  if (!confirm('Finalizar a conferência ' + conf.codigo + ' com ' + leituras.size +
    ' itens?\n\nDepois de finalizada, ela não pode mais receber leituras.')) return;
  const codigo = conf.codigo;
  conf.status = 'finalizada';
  conf.finalizadaEm = Date.now();
  await confGravar(conf);
  marcarVivo(codigo, true);
  pararCamera();
  await exportar(codigo);
  abrirLista('finalizada');
});

$('btnPausar').addEventListener('click', irMenu);

// ---------- Início ----------
(async function iniciar() {
  await abrirBanco('conferencia-patrimonial');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  dispositivo = await kvLer('dispositivo');
  if (!dispositivo) {
    dispositivo = Math.random().toString(36).slice(2, 6).toUpperCase();
    await kvGravar('dispositivo', dispositivo);
  }
  await carregarVivo();
  vivoPendentes = new Set((await kvLer('vivoPendentes')) || []);
  if (vivoPendentes.size) agendarVivo(3000);
  const salva = await kvLer('base');
  baseInfo = await kvLer('baseInfo');
  if (salva && baseInfo) montarBase(salva);
  mostrarBaseInfo();
  $('rodape').textContent = 'Versão ' + VERSAO_APP + ', aparelho ' + dispositivo;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  irMenu();
})();
