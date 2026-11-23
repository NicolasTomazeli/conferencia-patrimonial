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
    $('baseInfo').innerHTML = '<span class="aviso">Nenhuma base carregada.</span>';
    return;
  }
  const semNumero = baseLinhas.length - baseLinhas.filter(l => l.p).length;
  $('baseInfo').innerHTML = '<b>' + baseLinhas.length.toLocaleString('pt-BR') + '</b> linhas · ' + basePorFilial.size +
    ' filiais<br><span class="info">' + basePorNumero.size.toLocaleString('pt-BR') + ' com plaqueta · ' +
    semNumero.toLocaleString('pt-BR') + ' sem número<br>' + escapar(baseInfo.arquivo) + ' · ' + dataHora(baseInfo.em) + '</span>';
}

$('arqBase').addEventListener('change', async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  $('baseInfo').textContent = 'Carregando base, aguarde...';
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
    $('baseInfo').innerHTML = '<span class="erro">Erro: ' + escapar(e.message) + '</span>';
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
  $('pubInfo').textContent = pub ? 'Última publicação: ' + dataHora(pub.em) + ' · ' + pub.ativos.toLocaleString('pt-BR') + ' ativos.' :
    'Nenhuma base publicada por este computador.';
  $('senhaInfo').innerHTML = temSenha ? '<span class="bom">Senha definida neste computador.</span>' :
    '<span class="aviso">Defina a senha da base antes de publicar.</span>';
  $('tokenInfo').textContent = tokenSalvo ? 'Token salvo neste computador. Deixe o campo vazio para usá-lo.' : '';
  $('btnEsquecer').hidden = !tokenSalvo;
  $('btnPublicar').disabled = !(baseLinhas.length && temSenha);
}

$('btnEsquecer').addEventListener('click', async () => {
  await operar('kv', 'readwrite', s => s.delete('token'));
  tokenSalvo = '';
  atualizarPublicacao();
});

async function definirSenha(senha) {
  await kvGravar('chaveBase', await chaveDaSenha(senha));
  temSenha = true;
  atualizarPublicacao();
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
  const msg = (t, c) => { $('pubMsg').textContent = t; $('pubMsg').className = 'info ' + (c || ''); };
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
      ' · ' + (c.status === 'finalizada' ? 'Finalizada' : 'Em aberto') + '</div></div>';
    li.addEventListener('click', () => abrir(c.codigo));
    ul.appendChild(li);
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
  if (!dados.conf) { selecionada = null; $('detalhe').hidden = true; $('semSelecao').hidden = false; return; }
  const c = dados.conf;
  $('semSelecao').hidden = true;
  $('detalhe').hidden = false;
  $('detTitulo').textContent = 'Conferência ' + c.codigo + ' · Filial ' + c.filial;
  $('detInfo').textContent = (c.status === 'finalizada' ? 'Finalizada em ' + dataHora(c.fechadaEm) : 'Em aberto') +
    ' · usuários: ' + (c.usuarios.join(', ') || '—') + ' · aparelhos: ' + (c.dispositivos.join(', ') || '—') +
    (c.statusColetor ? ' · no coletor: ' + c.statusColetor : '');
  $('detAviso').hidden = dados.temBase;
  $('detAviso').textContent = 'Sem base carregada: "A localizar" fica vazio e os dados vêm só do arquivo do coletor.';
  $('btnStatus').textContent = c.status === 'finalizada' ? 'Reabrir conferência' : 'Marcar como finalizada';

  const cartoes = [
    [dados.totalFilial, 'ativos da filial no sistema'],
    [dados.proprios, 'localizados da filial (' + pct(dados.proprios, dados.totalFilial) + ')'],
    [dados.aLocalizar.length, 'a localizar (' + pct(dados.aLocalizar.length, dados.totalFilial) + ')'],
    [dados.transferir.length, 'de outra filial (transferir)'],
    [dados.naoCadastrados.length, 'não cadastrados'],
    [dados.semPlaqueta, 'da filial sem nº de patrimônio']
  ];
  $('resumo').innerHTML = cartoes.map(([n, r]) => '<div><b>' + Number(n).toLocaleString('pt-BR') + '</b><span>' + escapar(r) + '</span></div>').join('');

  const abas = $('abas');
  abas.innerHTML = '';
  for (const a of ABAS) {
    const b = document.createElement('button');
    b.textContent = a.nome + ' (' + dados[a.id].length.toLocaleString('pt-BR') + ')';
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
  await apagarConferencia(selecionada);
  selecionada = null; dados = null;
  $('detalhe').hidden = true;
  $('semSelecao').hidden = false;
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
  mostrarBaseInfo();
  desenharConferencias();
})();
