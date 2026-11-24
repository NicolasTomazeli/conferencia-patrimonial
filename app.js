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

// ---------- Câmera ----------
$('btnCamera').addEventListener('click', ligarCamera);

async function ligarCamera() {
  iniciarAudio();
  if (!('BarcodeDetector' in window)) {
    $('camMsg').className = 'nota erro';
    $('camMsg').textContent = 'Este navegador não lê código de barras. Abra o app no Chrome, ou digite os números.';
    return;
  }
  try {
    detector = detector || new BarcodeDetector({ formats: ['code_128'] });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    $('video').srcObject = stream;
    await $('video').play();
    track = stream.getVideoTracks()[0];
    track.addEventListener('ended', pararCamera);
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
    lanterna = false;
    $('btnLanterna').hidden = !caps.torch;
    $('ligarCam').hidden = true;
    $('camMsg').textContent = '';
    $('camMsg').className = 'nota';
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    candidato = null; repeticoes = 0;
    if (!lendo) { lendo = true; cicloLeitura(); }
  } catch (e) {
    $('camMsg').className = 'nota erro';
    $('camMsg').textContent = 'Não foi possível abrir a câmera. Verifique se o app tem permissão de câmera. (' + e.message + ')';
  }
}

function pararCamera() {
  lendo = false;
  if (track) { try { track.stop(); } catch (e) {} track = null; }
  $('video').srcObject = null;
  $('btnLanterna').hidden = true;
  $('ligarCam').hidden = false;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

$('btnLanterna').addEventListener('click', () => {
  if (!track) return;
  lanterna = !lanterna;
  track.applyConstraints({ advanced: [{ torch: lanterna }] }).catch(() => {});
});

async function cicloLeitura() {
  if (!lendo || !track) { lendo = false; return; }
  try {
    const achados = await detector.detect($('video'));
    const valor = achados.length ? normalizarPatrimonio(achados[0].rawValue) : '';
    if (valor) {
      // exige o mesmo valor em 2 quadros seguidos, para evitar leitura errada
      if (valor === candidato) repeticoes++; else { candidato = valor; repeticoes = 1; }
      if (repeticoes >= 2) {
        const agora = Date.now();
        if (valor === ultimoValor && agora - ultimoEm < 3000) {
          ultimoEm = agora;       // mesma plaqueta ainda na frente da câmera
        } else {
          ultimoValor = valor; ultimoEm = agora;
          await registrar(valor, 'Câmera');
        }
      }
    } else {
      candidato = null; repeticoes = 0;
    }
  } catch (e) {}
  setTimeout(cicloLeitura, 80);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pararCamera();
});

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
  const salva = await kvLer('base');
  baseInfo = await kvLer('baseInfo');
  if (salva && baseInfo) montarBase(salva);
  mostrarBaseInfo();
  $('rodape').textContent = 'Versão ' + VERSAO_APP + ', aparelho ' + dispositivo;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  irMenu();
})();
