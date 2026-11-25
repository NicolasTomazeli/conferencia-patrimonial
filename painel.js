'use strict';
// Painel (PC): importa os arquivos dos coletores e cruza com a base do sistema.

let baseLinhas = [];               // todas as linhas da base
const basePorNumero = new Map();   // patrimônio -> linha
const basePorFilial = new Map();   // filial -> linhas
let baseInfo = null;
let selecionada = null;            // código da conferência aberta
let dados = null;                  // resultado do cruzamento da conferência aberta
let abaAtual = 'localizados';

const ABAS = [
  { id: 'localizados', nome: 'Localizados' },
  { id: 'aLocalizar', nome: 'A localizar' },
  { id: 'transferir', nome: 'Transferir' },
  { id: 'naoCadastrados', nome: 'Não cadastrados' }
];

const COLUNAS = {
  localizados: ['Patrimônio', 'Descrição', 'Filial Base', 'Filial Atual', 'Situação', 'Setor', 'Usuário', 'Primeira Leitura', 'Última Leitura', 'Qtd Leituras', 'Origem'],
  transferir: ['Patrimônio', 'Descrição', 'Filial Base (origem)', 'Filial Atual (destino)', 'Setor', 'Usuário', 'Primeira Leitura', 'Última Leitura'],
  naoCadastrados: ['Patrimônio', 'Filial Atual', 'Setor', 'Usuário', 'Primeira Leitura', 'Última Leitura', 'Origem'],
  aLocalizar: ['Patrimônio', 'Descrição', 'Filial Base', 'Data Aquisição', 'Valor Base', 'Código do Bem', 'Tipo Ocorrência', 'Lido em outra conferência']
};

// ---------- Base ----------
function montarBase(linhas) {
  baseLinhas = linhas;
  basePorNumero.clear(); basePorFilial.clear();
  for (const l of linhas) {
    if (l.p && !basePorNumero.has(l.p)) basePorNumero.set(l.p, l);
    if (!basePorFilial.has(l.f)) basePorFilial.set(l.f, []);
    basePorFilial.get(l.f).push(l);
  }
}

function mostrarBaseInfo() {
  $('btnBaseCelular').disabled = !baseLinhas.length;
  atualizarPublicacao();
  if (!baseLinhas.length) {
    $('basePonto').className = 'ponto aviso';
    $('baseResumo').textContent = 'Ainda não carregada';
    $('baseInfo').textContent = 'Carregue o Excel exportado do sistema, com as colunas PATRIMONIO, DESCRICAO e CODFILIAL.';
    $('baseDetalhes').open = true;
    return;
  }
  const semNumero = baseLinhas.length - baseLinhas.filter(l => l.p).length;
  $('basePonto').className = 'ponto bom';
  $('baseResumo').textContent = basePorNumero.size.toLocaleString('pt-BR') + ' ativos com plaqueta, ' + basePorFilial.size + ' filiais';
  $('baseInfo').textContent = baseLinhas.length.toLocaleString('pt-BR') + ' linhas no arquivo, ' + semNumero.toLocaleString('pt-BR') +
    ' sem número de patrimônio. Arquivo: ' + baseInfo.arquivo + ', carregado em ' + dataHora(baseInfo.em) + '.';
}

$('arqBase').addEventListener('change', async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  $('baseResumo').textContent = 'Carregando, aguarde...';
  await new Promise(r => setTimeout(r, 30));
  try {
    const linhas = await lerArquivoBase(arq);
    montarBase(linhas);
    baseInfo = { arquivo: arq.name, em: Date.now() };
    await kvGravar('base', linhas);
    await kvGravar('baseInfo', baseInfo);
    mostrarBaseInfo();
    if (selecionada) abrir(selecionada);
  } catch (e) {
    mostrarBaseInfo();
    $('baseDetalhes').open = true;
    $('baseInfo').innerHTML = '<span class="erro">Não foi possível ler o arquivo: ' + escapar(e.message) + '</span>';
  }
});

$('btnBaseCelular').addEventListener('click', () => {
  const partes = ['PATRIMONIO\tDESCRICAO\tCODFILIAL\n'];
  for (const [p, l] of basePorNumero) partes.push(p + '\t' + l.d.replace(/\t/g, ' ') + '\t' + l.f + '\n');
  baixarArquivo(new Blob(partes, { type: 'text/plain;charset=utf-8' }), 'base_ativos.txt');
});

// ---------- Publicação da base (criptografada) no repositório ----------
const REPO = { dono: 'NicolasTomazeli', nome: 'conferencia-patrimonial', ramo: 'main' };
let temSenha = false, tokenSalvo = '';

async function atualizarPublicacao() {
  const pub = await kvLer('publicacao');
  $('pubPonto').className = 'ponto ' + (pub ? 'bom' : '');
  $('pubInfo').textContent = pub ? 'Última publicação em ' + dataHora(pub.em).slice(0, 16) : 'Nada publicado por este computador';
  $('senhaInfo').innerHTML = temSenha ? '<span class="bom">A senha da base está definida neste computador.</span>' :
    'Crie a senha que os celulares vão usar para abrir a base.';
  $('tokenInfo').textContent = tokenSalvo ? 'Token salvo neste computador. Deixe o campo vazio para usá-lo.' : '';
  $('btnEsquecer').hidden = !tokenSalvo;
  $('btnPublicar').disabled = !(baseLinhas.length && temSenha);
  const pendencia = !baseLinhas.length ? 'Para publicar, carregue primeiro o Excel em "Base de ativos".' :
    !temSenha ? 'Para publicar, defina a senha da base.' : '';
  if (pendencia) {
    $('pubMsg').textContent = pendencia;
    $('pubMsg').className = 'nota aviso';
  } else if ($('pubMsg').textContent.startsWith('Para publicar')) {
    $('pubMsg').textContent = '';
  }
}

$('btnEsquecer').addEventListener('click', async () => {
  await operar('kv', 'readwrite', s => s.delete('token'));
  tokenSalvo = '';
  atualizarPublicacao();
});

async function definirSenha(senha) {
  await kvGravar('chaveBase', await chaveDaSenha(senha));
  temSenha = true;
  await prepararVivo(await kvLer('chaveBase'));
  atualizarPublicacao();
  buscarVivo();
}

$('btnGerarSenha').addEventListener('click', async () => {
  if (temSenha && !confirm('Gerar uma senha nova?\n\nDepois da próxima publicação, todos os celulares vão pedir a senha nova.')) return;
  const senha = gerarSenha();
  await definirSenha(senha);
  $('senhaGerada').value = senha;
  $('senhaNova').hidden = false;
  $('senhaDigitar').hidden = true;
});

$('btnCopiarSenha').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('senhaGerada').value); $('btnCopiarSenha').textContent = 'Copiada'; }
  catch (e) { $('senhaGerada').select(); }
});

$('btnUsarSenha').addEventListener('click', () => {
  $('senhaDigitar').hidden = false;
  $('senhaNova').hidden = true;
  $('senhaGerada').value = '';
});

$('btnSalvarSenha').addEventListener('click', async () => {
  const senha = normalizarSenha($('senhaExistente').value);
  if (senha.length < SENHA_MINIMA) { alert('A senha precisa ter pelo menos ' + SENHA_MINIMA + ' caracteres, sem contar hífens e espaços.'); return; }
  await definirSenha(senha);
  $('senhaExistente').value = '';
  $('senhaDigitar').hidden = true;
});

async function github(token, metodo, caminho, corpo) {
  const r = await fetch('https://api.github.com/repos/' + REPO.dono + '/' + REPO.nome + caminho, {
    method: metodo,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  if (r.status === 401) throw new Error('token inválido ou vencido.');
  if (r.status === 403 || r.status === 404) throw new Error('o token não tem permissão de escrita (Contents) neste repositório.');
  if (!r.ok) throw new Error('GitHub respondeu ' + r.status + '.');
  return r.json();
}

$('btnPublicar').addEventListener('click', async () => {
  const msg = (t, c) => { $('pubMsg').textContent = t; $('pubMsg').className = 'nota ' + (c || ''); };
  const token = $('token').value.trim() || tokenSalvo;
  if (!token) { msg('Informe o token do GitHub.', 'erro'); return; }
  const chave = await kvLer('chaveBase');
  if (!chave) { msg('Defina a senha da base.', 'erro'); return; }
  $('btnPublicar').disabled = true;
  try {
    msg('Criptografando a base...');
    const d = new Date();
    const versao = d.getFullYear() + doisDigitos(d.getMonth() + 1) + doisDigitos(d.getDate()) + '-' +
      doisDigitos(d.getHours()) + doisDigitos(d.getMinutes()) + doisDigitos(d.getSeconds());
    const linhas = Array.from(basePorNumero, ([p, l]) => [p, l.d, l.f]);
    const bytes = await cifrarBase(chave, { v: versao, l: linhas });
    const meta = { formato: 1, versao, sha256: await sha256Hex(bytes), tamanho: bytes.length, ativos: linhas.length, publicadaEm: dataHora(d.getTime()) };

    msg('Enviando para o GitHub...');
    // um único commit com os dois arquivos, para o celular nunca ver metade da publicação
    const ref = await github(token, 'GET', '/git/ref/heads/' + REPO.ramo);
    const pai = ref.object.sha;
    const commitPai = await github(token, 'GET', '/git/commits/' + pai);
    const blobBin = await github(token, 'POST', '/git/blobs', { content: bytesParaBase64(bytes), encoding: 'base64' });
    const blobJson = await github(token, 'POST', '/git/blobs', { content: JSON.stringify(meta, null, 2) + '\n', encoding: 'utf-8' });
    const arvore = await github(token, 'POST', '/git/trees', {
      base_tree: commitPai.tree.sha,
      tree: [
        { path: 'dados/base.bin', mode: '100644', type: 'blob', sha: blobBin.sha },
        { path: 'dados/base.json', mode: '100644', type: 'blob', sha: blobJson.sha }
      ]
    });
    const commit = await github(token, 'POST', '/git/commits', { message: 'Publica base de ativos ' + versao, tree: arvore.sha, parents: [pai] });
    await github(token, 'PATCH', '/git/refs/heads/' + REPO.ramo, { sha: commit.sha });

    if ($('lembrarToken').checked) { await kvGravar('token', token); tokenSalvo = token; }
    $('token').value = '';
    await kvGravar('publicacao', { versao, em: d.getTime(), ativos: linhas.length });
    msg('Base publicada (' + linhas.length.toLocaleString('pt-BR') + ' ativos). Os celulares recebem em cerca de 2 minutos.', 'bom');
  } catch (e) {
    msg('Não foi possível publicar: ' + e.message, 'erro');
  }
  atualizarPublicacao();
});

// ---------- Importação ----------
$('arqConf').addEventListener('change', async ev => {
  const arquivos = Array.from(ev.target.files);
  ev.target.value = '';
  const msgs = [];
  for (const arq of arquivos) {
    try {
      msgs.push(await importar(arq));
    } catch (e) {
      msgs.push('<span class="erro">' + escapar(arq.name) + ': ' + escapar(e.message) + '</span>');
    }
  }
  $('importMsg').innerHTML = msgs.join('<br>');
  await desenharConferencias();
  if (selecionada) abrir(selecionada);
});

async function importar(arq) {
  const { info, porCodigo } = await lerArquivoConferencia(arq);

  const partes = [];
  for (const [codigo, itens] of porCodigo) {
    let c = await confLer(codigo);
    if (c && c.status === 'finalizada') {
      partes.push('<span class="aviso">' + escapar(codigo) + ': já está finalizada no painel, arquivo ignorado.</span>');
      continue;
    }
    if (!c) {
      const filial = (itens[0] && itens[0].filialAtual) || normalizarFilial(info.FILIAL) || normalizarFilial(codigo.split('-')[0]);
      c = { codigo, filial, status: 'aberta', dispositivos: [], usuarios: [], arquivos: [], importadaEm: Date.now(), fechadaEm: 0, statusColetor: '' };
    }
    const acrescenta = (lista, v) => { v = String(v || '').trim(); if (v && !lista.includes(v)) lista.push(v); };
    acrescenta(c.dispositivos, info.DISPOSITIVO);
    acrescenta(c.arquivos, arq.name);
    itens.forEach(l => acrescenta(c.usuarios, l.usuario));
    if (info.STATUS) c.statusColetor = String(info.STATUS);
    c.importadaEm = Date.now();

    let novos = 0;
    for (const l of itens) {
      const antiga = await leituraLer(codigo, l.patrimonio);
      if (antiga) {
        // mesma plaqueta vinda de outro aparelho ou de um envio anterior: junta as datas
        juntarLeituras(l, antiga);
      } else novos++;
      await leituraGravar(l);
    }
    await confGravar(c);
    partes.push('<span class="bom">' + escapar(codigo) + ': ' + itens.length + ' leituras (' + novos + ' novas).</span>');
    if (!selecionada) selecionada = codigo;
  }
  return partes.join('<br>');
}

// ---------- Lista de conferências ----------
async function desenharConferencias() {
  const todas = (await confListar()).sort((a, b) => a.codigo < b.codigo ? 1 : -1);
  $('confVazia').hidden = todas.length > 0;
  const ul = $('listaConfs');
  ul.innerHTML = '';
  for (const c of todas) {
    const li = document.createElement('li');
    if (c.codigo === selecionada) li.className = 'sel';
    li.innerHTML = '<div class="txt"><div class="t1">' + escapar(c.codigo) + '</div><div class="t2">Filial ' + escapar(c.filial) +
      '</div></div><span class="estado' + (c.status === 'finalizada' ? ' fim">Finalizada' : '">Em aberto') + '</span>';
    li.addEventListener('click', () => abrir(c.codigo));
    ul.appendChild(li);
  }
  $('btnGeral').hidden = !todas.length || !selecionada;
  if (!selecionada) await desenharGeral(todas);
}

// ---------- Visão geral ----------
const AGORA_MS = 10 * 60000;   // leitura nos últimos 10 minutos = "lendo agora"

async function desenharGeral(todas) {
  todas = todas || await confListar();
  $('detalhe').hidden = true;
  $('semSelecao').hidden = todas.length > 0;
  $('geral').hidden = !todas.length;
  if (!todas.length) return;
  const linhas = [];
  for (const c of todas) {
    const lidos = await leiturasDe(c.codigo);
    let proprios = 0, transf = 0, nao = 0, ultima = 0;
    for (const l of lidos) {
      const b = baseLinhas.length ? basePorNumero.get(l.patrimonio) : (l.cadastrado ? { f: l.filialBase } : null);
      if (!b) nao++; else if (String(b.f) === String(c.filial)) proprios++; else transf++;
      if (l.ultima > ultima) ultima = l.ultima;
    }
    const total = (basePorFilial.get(String(c.filial)) || []).filter(b => b.p).length;
    const atividade = Math.max(ultima, c.vivoEm || 0);
    const noCelular = /^FINALIZADA/.test(semAcento(c.statusColetor));
    const lendoAgora = c.status !== 'finalizada' && !noCelular && Date.now() - atividade < AGORA_MS;
    linhas.push({ c, lidos: lidos.length, proprios, transf, nao, total, atividade, lendoAgora, noCelular });
  }
  linhas.sort((a, b) => (b.lendoAgora - a.lendoAgora) || (b.atividade - a.atividade));
  const agora = linhas.filter(l => l.lendoAgora).length;
  $('geralInfo').textContent = (agora ? agora + (agora === 1 ? ' filial lendo agora. ' : ' filiais lendo agora. ') : 'Nenhuma leitura nos últimos 10 minutos. ') +
    'Clique em uma linha para abrir.';
  let html = '<thead><tr><th>Conferência</th><th>Filial</th><th>Situação</th><th>Quem</th><th>Última leitura</th><th>Lidos</th><th>Da filial</th><th>A transferir</th><th>Não cadastrados</th></tr></thead><tbody>';
  for (const l of linhas) {
    const sit = l.c.status === 'finalizada' ? '<span class="estado fim">Finalizada no painel</span>' :
      l.lendoAgora ? '<span class="agora">Lendo agora</span>' :
      l.noCelular ? 'Finalizada no celular' : 'Em aberto';
    html += '<tr data-codigo="' + escapar(l.c.codigo) + '"><td>' + escapar(l.c.codigo) + '</td><td class="n">' + escapar(l.c.filial) + '</td><td>' + sit +
      '</td><td>' + escapar(l.c.usuarios.join(', ')) + '</td><td>' + (l.atividade ? dataHora(l.atividade).slice(0, 16) : '') +
      '</td><td class="n">' + l.lidos.toLocaleString('pt-BR') + '</td><td class="n">' + l.proprios.toLocaleString('pt-BR') +
      (l.total ? ' de ' + l.total.toLocaleString('pt-BR') + ' (' + pct(l.proprios, l.total) + ')' : '') +
      '</td><td class="n">' + l.transf + '</td><td class="n">' + l.nao + '</td></tr>';
  }
  $('tabGeral').innerHTML = html + '</tbody>';
}
$('tabGeral').addEventListener('click', ev => {
  const tr = ev.target.closest('tr[data-codigo]');
  if (tr) abrir(tr.dataset.codigo);
});
$('btnGeral').addEventListener('click', () => { selecionada = null; dados = null; desenharConferencias(); });

// ---------- Ao vivo: recebe os retratos enviados pelos celulares ----------
let vivoBuscando = false;

function vivoInfo(texto, classe) { $('vivoInfo').textContent = texto; $('vivoInfo').className = 'info ' + (classe || ''); }

async function aplicarRetrato(s, id) {
  if (!s || typeof s.codigo !== 'string' || !Array.isArray(s.itens)) return false;
  let c = await confLer(s.codigo);
  if (c && c.status === 'finalizada') return false;       // finalizada no painel: não recebe mais nada
  const filial = normalizarFilial(s.filial);
  if (!c) c = { codigo: s.codigo, filial, status: 'aberta', dispositivos: [], usuarios: [], arquivos: [], importadaEm: Date.now(), fechadaEm: 0, statusColetor: '' };
  const acrescenta = (lista, v) => { v = String(v || '').trim(); if (v && !lista.includes(v)) lista.push(v); };
  const disp = String(s.dispositivo || '');
  acrescenta(c.dispositivos, disp);
  acrescenta(c.usuarios, s.usuario);
  c.remotos = c.remotos || [];
  acrescenta(c.remotos, id);
  c.statusColetor = s.status === 'finalizada' ? 'Finalizada' : 'Em andamento';
  c.vivoEm = Number(s.enviadaEm) || Date.now();

  const atuais = new Map((await leiturasDe(s.codigo)).map(l => [l.patrimonio, l]));
  const noRetrato = new Set(), gravar = [], apagar = [];
  for (const it of s.itens) {
    const p = normalizarPatrimonio(it[0]);
    if (!p) continue;
    noRetrato.add(p);
    const b = basePorNumero.get(p);
    const l = {
      codigo: s.codigo, patrimonio: p, descricao: b ? b.d : '', filialBase: b ? b.f : '', filialAtual: filial,
      cadastrado: !!b, setor: String(it[1] || ''), usuario: String(it[2] || ''),
      primeira: Number(it[3]) || 0, ultima: Number(it[4]) || 0, qtd: Number(it[5]) || 1, origem: String(it[6] || ''), disp
    };
    const antiga = atuais.get(p);
    if (antiga && antiga.disp !== disp) juntarLeituras(l, antiga);   // veio também de outro aparelho ou de arquivo
    gravar.push(l);
  }
  // item removido no celular some daqui também (só os que vieram deste mesmo aparelho)
  for (const [p, l] of atuais) if (l.disp === disp && !noRetrato.has(p)) apagar.push([s.codigo, p]);
  await leiturasLote(gravar, apagar);
  await confGravar(c);
  return true;
}

async function buscarVivo() {
  if (vivoBuscando || document.hidden) return;
  if (!FIREBASE_URL) { vivoInfo(''); return; }
  if (!chaveVivoAtual) { vivoInfo('Ao vivo: defina a senha da base em "Enviar base aos celulares".', 'aviso'); return; }
  vivoBuscando = true;
  try {
    const indice = (await pedirVivo('GET', 'r')) || {};
    const vistos = (await kvLer('vivoVistos')) || {};
    let mudou = false;
    for (const id of Object.keys(indice)) {
      const t = indice[id] && indice[id].t;
      if (!/^[0-9a-f]{32}$/.test(id) || typeof t !== 'number' || vistos[id] === t) continue;
      try {
        const reg = await pedirVivo('GET', 'c/' + id);
        if (reg && typeof reg.d === 'string' && await aplicarRetrato(await decifrarVivo(reg.d), id)) mudou = true;
      } catch (e) { /* não abre com a nossa senha: ignora */ }
      vistos[id] = t;
    }
    await kvGravar('vivoVistos', vistos);
    vivoInfo('Ao vivo ligado. Última consulta às ' + dataHora(Date.now()).slice(11, 19) + '.', 'bom');
    if (mudou) { await desenharConferencias(); if (selecionada) await abrir(selecionada); }
    else if (!selecionada) await desenharGeral();
  } catch (e) {
    vivoInfo('Ao vivo: sem conexão com o banco (' + e.message + ').', 'erro');
  } finally {
    vivoBuscando = false;
  }
}

// ---------- Cruzamento ----------
async function cruzar(codigo) {
  const c = await confLer(codigo);
  const lidos = await leiturasDe(codigo);
  const temBase = baseLinhas.length > 0;

  // a base do PC é a referência: atualiza descrição e filial base de cada leitura
  for (const l of lidos) {
    if (!temBase) continue;
    const b = basePorNumero.get(l.patrimonio);
    l.cadastrado = !!b;
    l.descricao = b ? b.d : '';
    l.filialBase = b ? b.f : '';
    l.filialAtual = l.filialAtual || c.filial;
  }
  lidos.sort((a, b) => Number(a.patrimonio) - Number(b.patrimonio));

  const lidosSet = new Set(lidos.map(l => l.patrimonio));
  const localizados = lidos.filter(l => l.cadastrado);
  const transferir = localizados.filter(l => String(l.filialBase) !== String(c.filial));
  const naoCadastrados = lidos.filter(l => !l.cadastrado);

  // onde mais cada plaqueta foi lida (outras conferências importadas)
  const outras = new Map();
  const todas = await operar('leituras', 'readonly', s => s.getAll());
  for (const l of todas) {
    if (l.codigo === codigo) continue;
    if (!outras.has(l.patrimonio)) outras.set(l.patrimonio, []);
    if (!outras.get(l.patrimonio).includes(l.codigo)) outras.get(l.patrimonio).push(l.codigo);
  }

  const daFilial = basePorFilial.get(String(c.filial)) || [];
  const comPlaqueta = daFilial.filter(b => b.p);
  const aLocalizar = comPlaqueta.filter(b => !lidosSet.has(b.p))
    .map(b => Object.assign({ outra: (outras.get(b.p) || []).join(', ') }, b))
    .sort((a, b) => Number(a.p) - Number(b.p));
  const proprios = localizados.length - transferir.length;

  return {
    conf: c, temBase, lidos, localizados, transferir, naoCadastrados, aLocalizar,
    totalFilial: comPlaqueta.length, semPlaqueta: daFilial.length - comPlaqueta.length, proprios
  };
}

function linhasDaAba(id, d) {
  if (id === 'localizados') return d.localizados.map(l => [Number(l.patrimonio), l.descricao, Number(l.filialBase), Number(l.filialAtual), situacaoDe(l), l.setor, l.usuario, dataHora(l.primeira), dataHora(l.ultima), l.qtd, l.origem]);
  if (id === 'transferir') return d.transferir.map(l => [Number(l.patrimonio), l.descricao, Number(l.filialBase), Number(l.filialAtual), l.setor, l.usuario, dataHora(l.primeira), dataHora(l.ultima)]);
  if (id === 'naoCadastrados') return d.naoCadastrados.map(l => [Number(l.patrimonio), Number(l.filialAtual), l.setor, l.usuario, dataHora(l.primeira), dataHora(l.ultima), l.origem]);
  return d.aLocalizar.map(b => [Number(b.p), b.d, Number(b.f), dataExcel(b.dt), b.v == null ? '' : b.v, b.cb == null ? '' : b.cb, b.to == null ? '' : b.to, b.outra]);
}

const pct = (n, total) => total ? (100 * n / total).toFixed(1).replace('.', ',') + '%' : '—';

function linhasResumo(d) {
  const c = d.conf;
  return [
    ['Código da Conferência', c.codigo],
    ['Filial', Number(c.filial)],
    ['Situação no painel', c.status === 'finalizada' ? 'Finalizada' : 'Em aberto'],
    ['Situação no coletor', c.statusColetor || ''],
    ['Usuários', c.usuarios.join(', ')],
    ['Aparelhos', c.dispositivos.join(', ')],
    ['Arquivos importados', c.arquivos.join(', ')],
    ['Base utilizada', baseInfo ? baseInfo.arquivo : '(sem base)'],
    ['Relatório gerado em', dataHora(Date.now())],
    [],
    ['Indicador', 'Quantidade', '% da filial'],
    ['Ativos da filial no sistema (com plaqueta)', d.totalFilial, ''],
    ['Localizados da própria filial', d.proprios, pct(d.proprios, d.totalFilial)],
    ['A localizar', d.aLocalizar.length, pct(d.aLocalizar.length, d.totalFilial)],
    ['Lidos que pertencem a outra filial (transferir)', d.transferir.length, ''],
    ['Lidos não cadastrados na base', d.naoCadastrados.length, ''],
    ['Total de plaquetas lidas', d.lidos.length, ''],
    ['Ativos da filial sem número de patrimônio (fora da conferência)', d.semPlaqueta, '']
  ];
}

// ---------- Tela de detalhe ----------
async function abrir(codigo) {
  selecionada = codigo;
  dados = await cruzar(codigo);
  if (!dados.conf) { selecionada = null; dados = null; return desenharConferencias(); }
  const c = dados.conf;
  $('semSelecao').hidden = true;
  $('geral').hidden = true;
  $('detalhe').hidden = false;
  $('detTitulo').textContent = c.codigo;
  $('detInfo').textContent = 'Filial ' + c.filial + '. ' +
    (c.status === 'finalizada' ? 'Finalizada no painel em ' + dataHora(c.fechadaEm).slice(0, 16) + '. ' : 'Em aberto no painel. ') +
    'Conferida por ' + (c.usuarios.join(', ') || 'usuário não informado') +
    (c.statusColetor ? '. No celular: ' + c.statusColetor.toLowerCase() : '') + '.';
  $('detAviso').hidden = dados.temBase;
  $('detAviso').textContent = 'A base de ativos não está carregada. Sem ela, "A localizar" fica vazio e as descrições vêm só do arquivo do celular.';
  $('btnStatus').textContent = c.status === 'finalizada' ? 'Reabrir conferência' : 'Marcar como finalizada';

  const cartoes = [
    [dados.totalFilial, 'ativos da filial no sistema', ''],
    [dados.proprios, 'localizados da filial (' + pct(dados.proprios, dados.totalFilial) + ')', 'r-ok'],
    [dados.aLocalizar.length, 'a localizar (' + pct(dados.aLocalizar.length, dados.totalFilial) + ')', ''],
    [dados.transferir.length, 'de outra filial, a transferir', 'r-transf'],
    [dados.naoCadastrados.length, 'não cadastrados na base', 'r-nao'],
    [dados.semPlaqueta, 'da filial sem nº de patrimônio', '']
  ];
  $('resumo').innerHTML = cartoes.map(([n, r, cl]) => '<div class="' + (n ? cl : '') + '"><b>' + Number(n).toLocaleString('pt-BR') + '</b><span>' + escapar(r) + '</span></div>').join('');

  const abas = $('abas');
  abas.innerHTML = '';
  for (const a of ABAS) {
    const b = document.createElement('button');
    b.textContent = a.nome + ' ' + dados[a.id].length.toLocaleString('pt-BR');
    if (a.id === abaAtual) b.className = 'sel';
    b.addEventListener('click', () => { abaAtual = a.id; abrirAba(); });
    b.dataset.aba = a.id;
    abas.appendChild(b);
  }
  desenharTabela();
  desenharConferencias();
}

function abrirAba() {
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('sel', b.dataset.aba === abaAtual));
  desenharTabela();
}

function desenharTabela() {
  const filtro = semAcento($('busca').value);
  let linhas = linhasDaAba(abaAtual, dados);
  if (filtro) linhas = linhas.filter(r => semAcento(r.join(' ')).includes(filtro));
  const LIMITE = 1000;
  const cab = COLUNAS[abaAtual];
  const iDesc = cab.indexOf('Descrição');
  let html = '<thead><tr>' + cab.map(c => '<th>' + escapar(c) + '</th>').join('') + '</tr></thead><tbody>';
  for (const r of linhas.slice(0, LIMITE)) {
    html += '<tr>' + r.map((v, i) => '<td' + (i === iDesc ? ' class="larga"' : '') + '>' + escapar(v) + '</td>').join('') + '</tr>';
  }
  if (!linhas.length) html += '<tr><td colspan="' + cab.length + '">' + (filtro ? 'Nenhuma linha corresponde ao filtro.' : 'Nada nesta lista.') + '</td></tr>';
  $('tabela').innerHTML = html + '</tbody>';
  $('tabInfo').textContent = linhas.length.toLocaleString('pt-BR') + ' linhas' +
    (linhas.length > LIMITE ? ' (mostrando as primeiras ' + LIMITE + '; o Excel traz todas)' : '');
}
$('busca').addEventListener('input', () => { if (dados) desenharTabela(); });

// ---------- Ações ----------
$('btnRelatorio').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abaDeMatriz(linhasResumo(dados), [58, 40, 14]), 'Resumo');
  const larguras = { localizados: [12, 60, 11, 11, 15, 20, 18, 20, 20, 12, 10], aLocalizar: [12, 60, 11, 15, 13, 15, 15, 28], transferir: [12, 60, 20, 22, 20, 18, 20, 20], naoCadastrados: [12, 12, 20, 18, 20, 20, 10] };
  for (const a of ABAS) {
    XLSX.utils.book_append_sheet(wb, abaDeMatriz([COLUNAS[a.id]].concat(linhasDaAba(a.id, dados)), larguras[a.id]), a.nome);
  }
  baixarArquivo(planilhaParaBlob(wb), 'Relatorio_Conferencia_' + dados.conf.codigo + '.xlsx');
});

$('btnStatus').addEventListener('click', async () => {
  const c = await confLer(selecionada);
  if (c.status === 'finalizada') {
    c.status = 'aberta'; c.fechadaEm = 0;
  } else {
    if (!confirm('Marcar ' + c.codigo + ' como finalizada?\n\nNovos arquivos desta conferência serão recusados na importação.')) return;
    c.status = 'finalizada'; c.fechadaEm = Date.now();
  }
  await confGravar(c);
  abrir(selecionada);
});

$('btnExcluir').addEventListener('click', async () => {
  if (!confirm('Excluir a conferência ' + selecionada + ' e todas as leituras dela deste painel?')) return;
  const c = await confLer(selecionada);
  if (vivoLigado() && c && c.remotos) {
    for (const id of c.remotos) {
      try { await pedirVivo('DELETE', 'c/' + id); await pedirVivo('DELETE', 'r/' + id); } catch (e) {}
    }
  }
  await apagarConferencia(selecionada);
  selecionada = null; dados = null;
  desenharConferencias();
});

// ---------- Início ----------
(async function iniciar() {
  await abrirBanco('conferencia-patrimonial-painel');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $('versao').textContent = 'versão ' + VERSAO_APP;
  const salva = await kvLer('base');
  baseInfo = await kvLer('baseInfo');
  if (salva && baseInfo) montarBase(salva);
  temSenha = !!(await kvLer('chaveBase'));
  tokenSalvo = (await kvLer('token')) || '';
  await carregarVivo();
  mostrarBaseInfo();
  await desenharConferencias();
  buscarVivo();
  setInterval(buscarVivo, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) buscarVivo(); });
})();
