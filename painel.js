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

// ---------- Filiais, cargos e termos de transferência ----------
let filiais = new Map();   // número -> { local, uf, completo }
let cargos = [], logoTermo = '', responsaveis = {};

const nomeFilial = f => { const x = filiais.get(String(f)); return x ? x.local + '/' + x.uf : ''; };
const proprio = t => String(t || '').toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

function mostrarFiliais() {
  $('filPonto').className = 'ponto ' + (filiais.size ? 'bom' : 'aviso');
  $('filResumo').textContent = filiais.size ? filiais.size + ' filiais cadastradas' : 'Cadastro não carregado';
  $('filInfo').textContent = filiais.size ?
    'Nomes, endereços, CNPJ e cargos vieram da planilha de termos. Carregue de novo quando ela mudar.' :
    'Carregue a planilha "Termos de Transferência e Baixa". O painel usa dela a lista de filiais (aba cnpjs), os cargos e o logotipo.';
  $('listaCargos').innerHTML = cargos.map(c => '<option value="' + escapar(c) + '">').join('');
}

$('arqModelo').addEventListener('change', async ev => {
  const arq = ev.target.files[0];
  ev.target.value = '';
  if (!arq) return;
  $('filResumo').textContent = 'Carregando, aguarde...';
  await new Promise(r => setTimeout(r, 30));
  try {
    // lê só as abas necessárias: a planilha traz também a base inteira, que não interessa aqui
    const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array', sheets: ['cnpjs', 'config'], bookFiles: true });
    if (!wb.Sheets.cnpjs) throw new Error('a planilha não tem a aba "cnpjs".');
    const novas = new Map();
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets.cnpjs, { header: 1, defval: '' }).slice(1)) {
      const f = normalizarFilial(r[0]);
      if (f) novas.set(f, { local: String(r[1]).trim(), uf: String(r[2]).trim(), completo: String(r[3]).trim() });
    }
    if (!novas.size) throw new Error('nenhuma filial encontrada na aba "cnpjs".');
    filiais = novas;
    cargos = wb.Sheets.config ? XLSX.utils.sheet_to_json(wb.Sheets.config, { header: 1, defval: '' }).map(r => String(r[2] || '').trim()).filter(Boolean) : [];
    const img = wb.files && Object.keys(wb.files).find(k => /^xl\/media\/image1\.(jpe?g|png)$/i.test(k));
    if (img && wb.files[img].content) {
      logoTermo = 'data:image/' + (/png$/i.test(img) ? 'png' : 'jpeg') + ';base64,' + bytesParaBase64(new Uint8Array(wb.files[img].content));
    }
    await kvGravar('filiais', Array.from(filiais));
    await kvGravar('cargos', cargos);
    await kvGravar('logoTermo', logoTermo);
    mostrarFiliais();
    await desenharConferencias();
    if (selecionada) abrir(selecionada);
  } catch (e) {
    mostrarFiliais();
    $('filDetalhes').open = true;
    $('filInfo').innerHTML = '<span class="erro">Não foi possível ler a planilha: ' + escapar(e.message) + '</span>';
  }
});

// Agrupa os itens a transferir pela filial de origem (a filial onde o bem está cadastrado).
function gruposDeTransferencia(d = dados) {
  const grupos = new Map();
  for (const l of d.transferir) {
    const origem = String(l.filialBase);
    if (!grupos.has(origem)) grupos.set(origem, []);
    grupos.get(origem).push(l);
  }
  return Array.from(grupos).sort((a, b) => Number(a[0]) - Number(b[0]));
}

function campoResp(prefixo, filial, rotulo) {
  const r = responsaveis[filial] || {};
  return '<div class="campos2"><label class="campo">' + escapar(rotulo) + '<input type="text" data-resp="' + prefixo + '-nome" data-filial="' + escapar(filial) +
    '" value="' + escapar(r.nome || '') + '" placeholder="Nome completo"></label><label class="campo">Cargo<input type="text" list="listaCargos" data-resp="' +
    prefixo + '-cargo" data-filial="' + escapar(filial) + '" value="' + escapar(r.cargo || '') + '" placeholder="Escolha ou digite"></label></div>';
}

$('btnTermos').addEventListener('click', () => {
  const grupos = gruposDeTransferencia();
  const destino = String(dados.conf.filial);
  const hoje = new Date();
  $('termoData').value = hoje.getFullYear() + '-' + doisDigitos(hoje.getMonth() + 1) + '-' + doisDigitos(hoje.getDate());
  $('termoInfo').className = 'info';
  $('termoInfo').textContent = !grupos.length ? 'Esta conferência não tem itens de outra filial, então não há termo a gerar.' :
    (grupos.length === 1 ? 'Será gerado 1 termo' : 'Serão gerados ' + grupos.length + ' termos, um por filial de origem') +
    ', com destino na filial ' + destino + (nomeFilial(destino) ? ' (' + nomeFilial(destino) + ')' : '') + '.' +
    (filiais.size ? '' : ' Sem o cadastro de filiais, os termos saem só com o número da filial: carregue a planilha em "Filiais e termo".');
  let html = grupos.length ? '<div class="grupo-termo"><h3>Destino: filial ' + escapar(destino) + (nomeFilial(destino) ? ', ' + escapar(nomeFilial(destino)) : '') +
    '</h3>' + campoResp('destino', destino, 'Responsável na filial destino') + '</div>' : '';
  for (const [origem, itens] of grupos) {
    html += '<div class="grupo-termo"><h3>Saída: filial ' + escapar(origem) + (nomeFilial(origem) ? ', ' + escapar(nomeFilial(origem)) : '') + ' (' +
      itens.length + (itens.length === 1 ? ' item' : ' itens') + ')</h3>' + campoResp('saida', origem, 'Responsável na filial de saída') + '</div>';
  }
  $('termoGrupos').innerHTML = html;
  $('btnTermoImprimir').disabled = $('btnTermoCsv').disabled = !grupos.length;
  $('termoBox').hidden = false;
  $('termoBox').scrollIntoView({ block: 'nearest' });
});
$('btnTermoCancelar').addEventListener('click', () => { $('termoBox').hidden = true; });

// Lê os campos do formulário e guarda os responsáveis para a próxima vez.
async function lerResponsaveis() {
  document.querySelectorAll('#termoGrupos input[data-resp]').forEach(i => {
    const f = i.dataset.filial, campo = i.dataset.resp.split('-')[1];
    responsaveis[f] = responsaveis[f] || {};
    responsaveis[f][campo] = i.value.trim();
  });
  await kvGravar('responsaveis', responsaveis);
}

function valorTermo(b) {
  if (!b) return '';
  if (Number(b.to) === 99 || Number(b.to) === 100) return 'Baixado';
  return typeof b.v === 'number' ? b.v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (b.v == null ? '' : String(b.v));
}

$('btnTermoImprimir').addEventListener('click', async () => {
  await lerResponsaveis();
  const grupos = gruposDeTransferencia();
  const destino = String(dados.conf.filial);
  const faltando = [destino].concat(grupos.map(g => g[0])).filter(f => !(responsaveis[f] && responsaveis[f].nome && responsaveis[f].cargo));
  if (!$('termoData').value || faltando.length) {
    $('termoInfo').className = 'info erro';
    $('termoInfo').textContent = !$('termoData').value ? 'Informe a data do documento.' :
      'Preencha nome e cargo dos responsáveis das filiais: ' + faltando.join(', ') + '.';
    return;
  }
  const [ano, mes, dia] = $('termoData').value.split('-');
  const data = dia + '/' + mes + '/' + ano;
  const descricao = f => f + (filiais.get(f) ? ' - ' + filiais.get(f).completo : '');
  const assinatura = f => proprio(responsaveis[f].nome) + ' - ' + proprio(responsaveis[f].cargo);
  let html = '';
  for (const [origem, itens] of grupos) {
    const linhas = itens.map((l, i) => {
      const b = basePorNumero.get(l.patrimonio);
      return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + escapar(l.patrimonio) + '</td><td class="c">' + escapar(b && b.cb != null ? b.cb : '') +
        '</td><td>' + escapar(l.descricao) + '</td><td class="c">' + escapar(b ? dataExcel(b.dt) : '') + '</td><td class="d">' + escapar(valorTermo(b)) +
        '</td><td class="c">' + escapar(origem) + '</td></tr>';
    }).join('');
    html += '<section class="termo"><div class="cab">' + (logoTermo ? '<img src="' + logoTermo + '" alt="">' : '') +
      '<div>LEGIÃO DA BOA VONTADE</div><div>PRESIDENTE: FRANCISCO DE ASSIS PERIOTTO</div><div class="titulo">DECLARAÇÃO DE TRANSFERÊNCIA</div></div>' +
      '<div class="decl">Declaramos, para os devidos fins, que os bens móveis e/ou equipamentos relacionados abaixo foram transferidos da filial ' +
      escapar(descricao(origem)) + ', para a filial ' + escapar(descricao(destino)) + '</div>' +
      '<table><thead><tr><th class="c">N°</th><th class="c">Plaquinha</th><th class="c">Código do Bem</th><th>Descrição</th><th class="c">Data</th><th class="c">Valor</th><th class="c">Filial</th></tr></thead><tbody>' +
      linhas + '</tbody></table>' +
      '<div class="assina"><div>Por ser verdade, assino a presente declaração</div><div>' + escapar((nomeFilial(origem) || 'Filial ' + origem) + ' - ' + data) + '</div>' +
      '<div class="linha-ass">____________________________________________________</div><div>' + escapar(assinatura(origem)) + '</div>' +
      '<div class="linha-ass">____________________________________________________</div><div>' + escapar(assinatura(destino)) + '</div>' +
      '<div>Destino - ' + escapar(nomeFilial(destino) || 'Filial ' + destino) + '</div>' +
      '<div class="aprov">____________________________________________________</div><div>Aprovação</div></div></section>';
  }
  $('impressao').innerHTML = html;
  $('termoInfo').className = 'info';
  $('termoInfo').textContent = 'Na janela de impressão, escolha "Salvar como PDF" para guardar os termos.';
  document.title = 'Termos de Transferencia ' + dados.conf.codigo;
  window.print();
  document.title = 'Painel · Conferência Patrimonial';
});

function csvTransferencias(d) {
  const sep = ';';
  const campo = v => { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const linhas = [['Conferencia', 'Patrimonio', 'Codigo do Bem', 'Descricao', 'Filial Origem', 'Filial Destino', 'Data Aquisicao', 'Valor Base', 'Setor', 'Lido em']];
  for (const [origem, itens] of gruposDeTransferencia(d)) {
    for (const l of itens) {
      const b = basePorNumero.get(l.patrimonio);
      linhas.push([d.conf.codigo, l.patrimonio, b && b.cb != null ? b.cb : '', l.descricao, origem, d.conf.filial,
        b ? dataExcel(b.dt) : '', b && typeof b.v === 'number' ? String(b.v).replace('.', ',') : '', l.setor, dataHora(l.ultima)]);
    }
  }
  // o BOM no início faz o Excel abrir os acentos corretamente
  return new Blob(['﻿' + linhas.map(r => r.map(campo).join(sep)).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
$('btnTermoCsv').addEventListener('click', () => baixarArquivo(csvTransferencias(dados), 'Transferencias_' + dados.conf.codigo + '.csv'));

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
    li.innerHTML = '<div class="txt"><div class="t1">' + escapar(c.codigo) + '</div><div class="t2">Filial ' + escapar(c.filial) + (nomeFilial(c.filial) ? ', ' + escapar(nomeFilial(c.filial)) : '') +
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
  let html = '<thead><tr><th>Conferência</th><th>Filial</th><th>Situação</th><th>Aceite</th><th>Quem</th><th>Última leitura</th><th>Lidos</th><th>Da filial</th><th>A transferir</th><th>Não cadastrados</th></tr></thead><tbody>';
  for (const l of linhas) {
    const sit = l.c.status === 'finalizada' ? '<span class="estado fim">Finalizada no painel</span>' :
      l.lendoAgora ? '<span class="agora">Lendo agora</span>' :
      l.noCelular ? 'Finalizada no celular' : 'Em aberto';
    html += '<tr data-codigo="' + escapar(l.c.codigo) + '"><td>' + escapar(l.c.codigo) + '</td><td class="n">' + escapar(l.c.filial) + (nomeFilial(l.c.filial) ? ' <small>' + escapar(nomeFilial(l.c.filial)) + '</small>' : '') + '</td><td>' + sit +
      '</td><td>' + situacaoAceite(l.c) + '</td><td>' + escapar(l.c.usuarios.join(', ')) + '</td><td>' + (l.atividade ? dataHora(l.atividade).slice(0, 16) : '') +
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
  const ap = s.aprovacao;
  if (ap && ap.id && !(c.aprovacao && c.aprovacao.id)) c.aprovacao = ap;
  else if (ap && ap.id && c.aprovacao.id === ap.id) c.aprovacao.enviadoEm = Math.max(c.aprovacao.enviadoEm || 0, ap.enviadoEm || 0);
  else if (ap && ap.semResponsavel && !c.aprovacao) c.aprovacao = ap;

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
    if (await verificarAceites()) mudou = true;
    vivoInfo('Ao vivo ligado. Última consulta às ' + dataHora(Date.now()).slice(11, 19) + '.', 'bom');
    if (mudou) { await desenharConferencias(); if (selecionada) await abrir(selecionada); }
    else if (!selecionada) await desenharGeral();
  } catch (e) {
    vivoInfo('Ao vivo: sem conexão com o banco (' + e.message + ').', 'erro');
  } finally {
    vivoBuscando = false;
  }
}

// ---------- Aceite do responsável ----------
function situacaoAceite(c) {
  const dec = c.decisao, ap = c.aprovacao;
  if (dec && dec.decisao === 'aceite') return '<span class="estado fim">Aceita</span>';
  if (dec) return '<span class="estado">Recusada</span>';
  if (ap && ap.id) return 'Aguardando ' + escapar(String(ap.nome || '').split(' ')[0]);
  if (ap && ap.semResponsavel) return '<span class="erro">Sem responsável</span>';
  return '';
}

function mostrarAceite(c) {
  const ap = c.aprovacao, dec = c.decisao;
  const finalizadaNoCelular = /^FINALIZADA/.test(semAcento(c.statusColetor));
  let texto = '', classe = '', botao = 'Enviar para aceite', mostra = finalizadaNoCelular && !c.arquivadoEm;
  if (dec && dec.decisao === 'aceite') {
    texto = 'Aceita por ' + dec.nome + ' (' + dec.email + ') em ' + dataHora(dec.em) + '.' +
      (dec.confere === false ? ' Atenção: o conteúdo aceito não confere com o que foi enviado.' : '') +
      (c.arquivadoEm ? ' Arquivos gravados em ' + c.pastaArquivo + '.' :
        c.arquivoErro ? ' ' + c.arquivoErro : ' Os arquivos serão gravados assim que a pasta estiver conectada, na aba Acessos.');
    classe = c.arquivoErro || dec.confere === false ? 'aviso' : 'bom';
    mostra = false;
  } else if (dec) {
    texto = 'Recusada por ' + dec.nome + ' (' + dec.email + ') em ' + dataHora(dec.em) + '. Motivo: ' + dec.motivo;
    classe = 'aviso';
    botao = 'Enviar novo pedido de aceite';
  } else if (ap && ap.id) {
    texto = 'Aguardando o aceite de ' + ap.nome + ' (' + ap.para + '). ' +
      (ap.enviadoEm ? 'E-mail enviado em ' + dataHora(ap.enviadoEm).slice(0, 16) + '.' : 'O e-mail ainda não saiu.');
    botao = 'Reenviar e-mail';
  } else if (ap && ap.semResponsavel) {
    texto = 'Finalizada sem pedido de aceite: ' + (ap.regional ? 'a regional ' + ap.regional : 'a regional desta filial') +
      ' não tinha responsável cadastrado. Cadastre em Acessos e clique em "Enviar para aceite".';
    classe = 'aviso';
  } else if (finalizadaNoCelular) {
    texto = 'Ainda sem pedido de aceite.';
  }
  $('aceiteInfo').className = 'nota ' + classe;
  $('aceiteInfo').textContent = texto;
  $('btnAceite').hidden = !mostra;
  $('btnAceite').textContent = botao;
}

$('btnAceite').addEventListener('click', async () => {
  const c = await confLer(selecionada);
  const aviso = (t, cl) => { $('aceiteInfo').className = 'nota ' + (cl || ''); $('aceiteInfo').textContent = t; };
  if (!vivoLigado()) return aviso('Defina a senha da base em "Enviar base aos celulares" para criar pedidos de aceite.', 'erro');
  $('btnAceite').disabled = true;
  try {
    if (!(c.aprovacao && c.aprovacao.id) || c.decisao) {
      const { regional, responsavel } = responsavelDaFilial(cadastroAtual(), c.filial);
      if (!responsavel) {
        aviso(regional ? 'A regional ' + regional + ' não tem responsável. Cadastre em Acessos.' :
          'A filial ' + c.filial + ' não está em nenhuma regional da pasta. Confira em Acessos.', 'erro');
        return;
      }
      const d = await cruzar(c.codigo);
      const pacote = montarPacoteConferencia({
        conf: c, itens: d.lidos, regional, responsavel, operador: c.usuarios.join(', '), nomeFilial: nomeFilial(c.filial),
        descricao: p => { const b = basePorNumero.get(p); return b ? [b.d, b.f] : null; },
        ativosFilial: (basePorFilial.get(String(c.filial)) || []).filter(b => b.p).map(b => [b.p, b.d])
      });
      c.aprovacao = await criarAprovacao(pacote);
      delete c.decisao;
      await confGravar(c);
    }
    await enviarEmailAceite(c.aprovacao);
    c.aprovacao.enviadoEm = Date.now();
    await confGravar(c);
    await abrir(c.codigo);
  } catch (e) {
    aviso('Não foi possível enviar: ' + e.message + '.', 'erro');
  } finally {
    $('btnAceite').disabled = false;
  }
});

// Procura decisões novas dos responsáveis e grava os arquivos das conferências aceitas.
async function verificarAceites() {
  let mudou = false;
  const podeGravar = await pastaPermitida(false);
  for (const c of await confListar()) {
    const ap = c.aprovacao;
    if (!ap || !ap.id) continue;
    if (!c.decisao) {
      try {
        const reg = await pedirVivo('GET', 's/' + ap.id);
        if (!reg || typeof reg.d !== 'string') continue;
        c.decisao = await decifrarCom(await chaveAprovacao(ap.chave), reg.d);
        c.decisao.confere = c.decisao.hashPacote === ap.hash;
        await confGravar(c);
        mudou = true;
      } catch (e) { continue; }
    }
    if (c.decisao.decisao === 'aceite' && !c.arquivadoEm && podeGravar && await arquivar(c.codigo)) mudou = true;
  }
  return mudou;
}

function comprovanteBlob(c) {
  const dec = c.decisao, ap = c.aprovacao;
  const linhas = [
    'COMPROVANTE DE ACEITE ELETRÔNICO',
    '',
    'Conferência: ' + c.codigo,
    'Filial: ' + c.filial + (nomeFilial(c.filial) ? ' - ' + nomeFilial(c.filial) : ''),
    'Regional: ' + (ap.regional || ''),
    'Decisão: ' + (dec.decisao === 'aceite' ? 'ACEITE' : 'RECUSA'),
    dec.motivo ? 'Motivo: ' + dec.motivo : null,
    'Nome informado: ' + dec.nome,
    'E-mail do pedido: ' + dec.email,
    'Data e hora da decisão: ' + dataHora(dec.em) + (dec.fuso ? ' (' + dec.fuso + ')' : ''),
    'Pedido criado em: ' + dataHora(ap.criadoEm),
    'E-mail enviado em: ' + (ap.enviadoEm ? dataHora(ap.enviadoEm) : 'não registrado'),
    'Identificador do pedido: ' + ap.id,
    'Código de verificação do conteúdo (SHA-256): ' + ap.hash,
    'Conteúdo aceito confere com o enviado: ' + (dec.confere ? 'sim' : 'NÃO'),
    'Navegador usado: ' + dec.agente,
    '',
    'Aceite registrado pelo link pessoal enviado ao e-mail acima. Não equivale a assinatura com certificado digital.'
  ].filter(x => x !== null);
  return new Blob(['﻿' + linhas.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' });
}

async function gravarArquivo(dir, nome, blob) {
  const arq = await dir.getFileHandle(nome, { create: true });
  const w = await arq.createWritable();
  await w.write(blob);
  await w.close();
}

async function arquivar(codigo) {
  const c = await confLer(codigo);
  const destino = estrutura.filiais[String(c.filial)];
  if (!destino) {
    c.arquivoErro = 'A filial ' + c.filial + ' não tem pasta em nenhuma regional. Crie a pasta e clique em "Reler a pasta" na aba Acessos.';
    await confGravar(c);
    return false;
  }
  try {
    const d = await cruzar(codigo);
    let dir = await (await pastaHandle.getDirectoryHandle(destino.regional)).getDirectoryHandle(destino.pasta);
    dir = await (await dir.getDirectoryHandle(PASTA_TIPO.conferencia, { create: true })).getDirectoryHandle(codigo, { create: true });
    await gravarArquivo(dir, 'Relatorio_' + codigo + '.xlsx', relatorioBlob(d));
    await gravarArquivo(dir, 'Localizados_' + codigo + '.xlsx', planilhaUmaAba('localizados', d));
    await gravarArquivo(dir, 'Nao_localizados_' + codigo + '.xlsx', planilhaUmaAba('aLocalizar', d));
    if (d.transferir.length) await gravarArquivo(dir, 'Transferencias_' + codigo + '.csv', csvTransferencias(d));
    await gravarArquivo(dir, 'Comprovante_aceite_' + codigo + '.txt', comprovanteBlob(c));
    c.arquivadoEm = Date.now();
    c.pastaArquivo = [destino.regional, destino.pasta, PASTA_TIPO.conferencia, codigo].join('\\');
    c.status = 'finalizada';
    c.fechadaEm = c.fechadaEm || Date.now();
    delete c.arquivoErro;
    await confGravar(c);
    return true;
  } catch (e) {
    c.arquivoErro = 'Não foi possível gravar na pasta (' + e.message + ').';
    await confGravar(c);
    return false;
  }
}

// ---------- Aba Acessos: pasta, regionais e usuários ----------
let pastaHandle = null;
let estrutura = { filiais: {}, regionais: {}, lidaEm: 0 };   // filial -> { regional, pasta }
let usuarios = [];
let editandoId = null;

function cadastroAtual() {
  const filialRegional = {};
  for (const [f, x] of Object.entries(estrutura.filiais)) filialRegional[f] = x.regional;
  const nomes = {};
  for (const [f, x] of filiais) nomes[f] = x.local + '/' + x.uf;
  return { v: Date.now(), filialRegional, nomes, usuarios: usuarios.map(u => ({ nome: u.nome, email: u.email, perfil: u.perfil, regional: u.regional })) };
}

async function publicarCadastro() {
  const msg = (t, c) => { $('acessosMsg').className = 'nota ' + (c || ''); $('acessosMsg').textContent = t; };
  if (!FIREBASE_URL) return msg('');
  if (!vivoLigado()) return msg('Defina a senha da base (aba Conferências, "Enviar base aos celulares") para os celulares receberem este cadastro.', 'aviso');
  try {
    await pedirVivo('PUT', 'cad', { t: Date.now(), d: await cifrarVivo(cadastroAtual()) });
    msg('Cadastro enviado aos celulares às ' + dataHora(Date.now()).slice(11, 16) + '.', 'bom');
  } catch (e) {
    msg('Não foi possível enviar o cadastro aos celulares (' + e.message + ').', 'erro');
  }
}

async function pastaPermitida(pedir) {
  if (!pastaHandle) return false;
  if (!pastaHandle.queryPermission) return true;
  const modo = { mode: 'readwrite' };
  let s = await pastaHandle.queryPermission(modo);
  if (s !== 'granted' && pedir) s = await pastaHandle.requestPermission(modo);
  return s === 'granted';
}

// A pasta escolhida tem uma subpasta por regional, e dentro dela uma subpasta por filial (o número).
async function lerEstrutura() {
  const nova = { filiais: {}, regionais: {}, lidaEm: Date.now() };
  const repetidas = [];
  for await (const [nome, h] of pastaHandle.entries()) {
    if (h.kind !== 'directory' || /^[._~$]/.test(nome) || /^\d+$/.test(nome)) continue;
    nova.regionais[nome] = [];
    for await (const [sub, hs] of h.entries()) {
      const f = hs.kind === 'directory' ? normalizarFilial(sub) : '';
      if (!f) continue;
      if (nova.filiais[f]) repetidas.push(f);
      nova.filiais[f] = { regional: nome, pasta: sub };
      nova.regionais[nome].push(f);
    }
    nova.regionais[nome].sort((a, b) => a - b);
  }
  estrutura = nova;
  await kvGravar('estrutura', estrutura);
  return repetidas;
}

async function mostrarPasta() {
  const ok = await pastaPermitida(false);
  const nReg = Object.keys(estrutura.regionais).length, nFil = Object.keys(estrutura.filiais).length;
  $('pastaInfo').textContent = !pastaHandle ? 'Escolha a pasta "01 - Controle de Ativos" no R:. O painel lê dela as regionais e filiais, e grava ali os arquivos das conferências aceitas.' :
    'Pasta "' + pastaHandle.name + '": ' + nReg + ' regionais e ' + nFil + ' filiais, lida em ' + dataHora(estrutura.lidaEm).slice(0, 16) + '.' +
    (ok ? '' : ' O navegador pede autorização de novo a cada vez que o painel é aberto: clique em "Reconectar".');
  $('btnPasta').textContent = pastaHandle ? (ok ? 'Reler a pasta' : 'Escolher outra pasta') : 'Escolher pasta';
  $('btnPastaReconectar').hidden = !pastaHandle || ok;
}

$('btnPasta').addEventListener('click', async () => {
  const msg = (t, c) => { $('pastaMsg').className = 'nota ' + (c || ''); $('pastaMsg').textContent = t; };
  try {
    if (!(pastaHandle && await pastaPermitida(false))) {
      if (!window.showDirectoryPicker) return msg('Este navegador não grava em pastas. Use o Edge ou o Chrome no computador.', 'erro');
      pastaHandle = await window.showDirectoryPicker({ id: 'controle-ativos', mode: 'readwrite' });
      await kvGravar('pasta', pastaHandle);
    }
    const repetidas = await lerEstrutura();
    msg(repetidas.length ? 'Atenção: estas filiais aparecem em mais de uma regional: ' + repetidas.join(', ') + '. Vale a última encontrada.' : '', repetidas.length ? 'aviso' : '');
    await desenharAcessos();
    await publicarCadastro();
    if (await verificarAceites()) await desenharConferencias();
  } catch (e) {
    if (e.name !== 'AbortError') msg('Não foi possível abrir a pasta (' + e.message + ').', 'erro');
  }
});

$('btnPastaReconectar').addEventListener('click', async () => {
  if (await pastaPermitida(true)) {
    await lerEstrutura().catch(() => {});
    await desenharAcessos();
    if (await verificarAceites()) await desenharConferencias();
  }
});

function preencherRegionais() {
  const atual = $('uRegional').value;
  const nomes = Object.keys(estrutura.regionais).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('uRegional').innerHTML = nomes.length ? nomes.map(n => '<option>' + escapar(n) + '</option>').join('') : '<option value="">Escolha a pasta primeiro</option>';
  if (nomes.includes(atual)) $('uRegional').value = atual;
}

async function desenharAcessos() {
  await mostrarPasta();
  preencherRegionais();
  const nomes = Object.keys(estrutura.regionais).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const semPasta = Array.from(basePorFilial.keys()).filter(f => !estrutura.filiais[f]).sort((a, b) => a - b);
  $('acessosInfo').textContent = !nomes.length ? 'As regionais aparecem aqui depois que a pasta é escolhida.' :
    nomes.length + ' regionais. ' + (semPasta.length ? semPasta.length + ' filiais da base ainda não têm pasta: ' + semPasta.slice(0, 15).join(', ') + (semPasta.length > 15 ? '...' : '') + '.' : 'Todas as filiais da base têm pasta.');
  let html = '<thead><tr><th>Regional</th><th>Filiais</th><th>Responsável pelo aceite</th><th>Operadores</th></tr></thead><tbody>';
  for (const n of nomes) {
    const resp = usuarios.find(u => u.perfil === 'Responsável' && u.regional === n);
    const ops = usuarios.filter(u => u.perfil === 'Operador' && u.regional === n);
    html += '<tr><td>' + escapar(n) + '</td><td class="larga">' + estrutura.regionais[n].map(f => escapar(f) + (nomeFilial(f) ? ' <small>' + escapar(nomeFilial(f)) + '</small>' : '')).join(', ') +
      '</td><td>' + (resp ? escapar(resp.nome) + '<br><small>' + escapar(resp.email) + '</small>' : '<span class="erro">Sem responsável</span>') + '</td><td>' + ops.length + '</td></tr>';
  }
  $('tabRegionais').innerHTML = html + '</tbody>';
  let hu = '<thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Regional</th><th></th></tr></thead><tbody>';
  for (const u of usuarios.slice().sort((a, b) => (a.regional + a.nome).localeCompare(b.regional + b.nome, 'pt-BR'))) {
    hu += '<tr><td>' + escapar(u.nome) + '</td><td>' + escapar(u.email) + '</td><td>' + escapar(u.perfil) + '</td><td>' + escapar(u.regional) +
      (estrutura.regionais[u.regional] ? '' : ' <small class="erro">não está na pasta</small>') + '</td><td class="acoes-linha"><button class="mini sec" data-editar="' +
      u.id + '">Editar</button> <button class="mini perigo" data-remover="' + u.id + '">Remover</button></td></tr>';
  }
  if (!usuarios.length) hu += '<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';
  $('tabUsuarios').innerHTML = hu + '</tbody>';
}

function limparFormUsuario() {
  editandoId = null;
  $('uTitulo').textContent = 'Novo usuário';
  $('uNome').value = $('uEmail').value = '';
  $('uPerfil').value = 'Responsável';
  $('uErro').textContent = '';
  $('btnUCancelar').hidden = true;
}

$('btnUSalvar').addEventListener('click', async () => {
  const nome = $('uNome').value.trim().replace(/\s+/g, ' ');
  const email = $('uEmail').value.trim().toLowerCase();
  const perfil = $('uPerfil').value, regional = $('uRegional').value;
  const erro = t => { $('uErro').textContent = t; };
  if (!nome) return erro('Informe o nome.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro('Informe um e-mail válido.');
  if (!regional) return erro('Escolha a regional. Se a lista estiver vazia, escolha a pasta primeiro.');
  if (usuarios.some(u => u.email === email && u.id !== editandoId)) return erro('Já existe um usuário com este e-mail.');
  const outro = usuarios.find(u => u.perfil === 'Responsável' && u.regional === regional && u.id !== editandoId);
  if (perfil === 'Responsável' && outro) return erro('A regional ' + regional + ' já tem responsável: ' + outro.nome + '. Mude antes o perfil dessa pessoa para Operador.');
  if (editandoId) Object.assign(usuarios.find(u => u.id === editandoId), { nome, email, perfil, regional });
  else usuarios.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nome, email, perfil, regional });
  await kvGravar('usuarios', usuarios);
  limparFormUsuario();
  await desenharAcessos();
  await publicarCadastro();
});
$('btnUCancelar').addEventListener('click', limparFormUsuario);

$('tabUsuarios').addEventListener('click', async ev => {
  const ed = ev.target.closest('[data-editar]'), rm = ev.target.closest('[data-remover]');
  if (ed) {
    const u = usuarios.find(x => x.id === ed.dataset.editar);
    editandoId = u.id;
    $('uTitulo').textContent = 'Editar usuário';
    $('uNome').value = u.nome; $('uEmail').value = u.email; $('uPerfil').value = u.perfil;
    preencherRegionais();
    $('uRegional').value = u.regional;
    $('uErro').textContent = '';
    $('btnUCancelar').hidden = false;
    $('uNome').focus();
  } else if (rm) {
    const u = usuarios.find(x => x.id === rm.dataset.remover);
    if (!confirm('Remover ' + u.nome + '?')) return;
    usuarios = usuarios.filter(x => x.id !== u.id);
    await kvGravar('usuarios', usuarios);
    await desenharAcessos();
    await publicarCadastro();
  }
});

// ---------- Navegação entre abas ----------
document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', async () => {
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('sel', x === b));
  ['abaConf', 'abaAcessos'].forEach(id => { $(id).hidden = id !== b.dataset.aba; });
  if (b.dataset.aba === 'abaAcessos') await desenharAcessos();
}));

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
  $('detInfo').textContent = 'Filial ' + c.filial + (nomeFilial(c.filial) ? ' (' + nomeFilial(c.filial) + ')' : '') + '. ' +
    (c.status === 'finalizada' ? 'Finalizada no painel em ' + dataHora(c.fechadaEm).slice(0, 16) + '. ' : 'Em aberto no painel. ') +
    'Conferida por ' + (c.usuarios.join(', ') || 'usuário não informado') +
    (c.statusColetor ? '. No celular: ' + c.statusColetor.toLowerCase() : '') + '.';
  $('detAviso').hidden = dados.temBase;
  $('detAviso').textContent = 'A base de ativos não está carregada. Sem ela, "A localizar" fica vazio e as descrições vêm só do arquivo do celular.';
  $('btnStatus').textContent = c.status === 'finalizada' ? 'Reabrir conferência' : 'Marcar como finalizada';
  mostrarAceite(c);
  $('btnTermos').textContent = 'Termos de transferência' + (dados.transferir.length ? ' (' + dados.transferir.length + ')' : '');
  if (!$('termoBox').hidden && $('termoBox').dataset.codigo !== c.codigo) $('termoBox').hidden = true;
  $('termoBox').dataset.codigo = c.codigo;

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
const LARGURAS = { localizados: [12, 60, 11, 11, 15, 20, 18, 20, 20, 12, 10], aLocalizar: [12, 60, 11, 15, 13, 15, 15, 28], transferir: [12, 60, 20, 22, 20, 18, 20, 20], naoCadastrados: [12, 12, 20, 18, 20, 20, 10] };

function relatorioBlob(d) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abaDeMatriz(linhasResumo(d), [58, 40, 14]), 'Resumo');
  for (const a of ABAS) XLSX.utils.book_append_sheet(wb, abaDeMatriz([COLUNAS[a.id]].concat(linhasDaAba(a.id, d)), LARGURAS[a.id]), a.nome);
  return planilhaParaBlob(wb);
}

function planilhaUmaAba(id, d) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, abaDeMatriz([COLUNAS[id]].concat(linhasDaAba(id, d)), LARGURAS[id]), ABAS.find(a => a.id === id).nome);
  return planilhaParaBlob(wb);
}

$('btnRelatorio').addEventListener('click', () => baixarArquivo(relatorioBlob(dados), 'Relatorio_Conferencia_' + dados.conf.codigo + '.xlsx'));

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
  filiais = new Map((await kvLer('filiais')) || []);
  cargos = (await kvLer('cargos')) || [];
  logoTermo = (await kvLer('logoTermo')) || '';
  responsaveis = (await kvLer('responsaveis')) || {};
  pastaHandle = (await kvLer('pasta')) || null;
  estrutura = (await kvLer('estrutura')) || estrutura;
  usuarios = (await kvLer('usuarios')) || [];
  mostrarFiliais();
  mostrarBaseInfo();
  await desenharConferencias();
  buscarVivo();
  setInterval(buscarVivo, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) buscarVivo(); });
})();
