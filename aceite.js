'use strict';
// Página do pedido de aceite: aberta pelo link do e-mail. A chave do pacote vem depois do "#".

const LISTAS = [
  { id: 'localizados', nome: 'Localizados', colunas: ['Patrimônio', 'Descrição', 'Setor'] },
  { id: 'aLocalizar', nome: 'Não localizados', colunas: ['Patrimônio', 'Descrição'] },
  { id: 'transferencias', nome: 'De outra filial', colunas: ['Patrimônio', 'Descrição', 'Filial de origem', 'Setor'] },
  { id: 'naoCadastrados', nome: 'Não cadastrados', colunas: ['Patrimônio', 'Setor'] }
];
let pacote = null, chave = null, idPedido = '', hashPacote = '', listaAtual = 'localizados', recusando = false;

function falhar(texto) {
  $('carregando').className = 'nota erro';
  $('carregando').textContent = texto;
}

function desenharLista() {
  const def = LISTAS.find(l => l.id === listaAtual);
  const filtro = semAcento($('busca').value);
  let linhas = pacote[listaAtual] || [];
  if (filtro) linhas = linhas.filter(r => semAcento(r.join(' ')).includes(filtro));
  const LIMITE = 1000;
  let html = '<thead><tr>' + def.colunas.map(c => '<th>' + escapar(c) + '</th>').join('') + '</tr></thead><tbody>';
  for (const r of linhas.slice(0, LIMITE)) {
    html += '<tr>' + r.map((v, i) => '<td' + (def.colunas[i] === 'Descrição' ? ' class="larga"' : '') + '>' + escapar(v) + '</td>').join('') + '</tr>';
  }
  if (!linhas.length) html += '<tr><td colspan="' + def.colunas.length + '">' + (filtro ? 'Nenhuma linha corresponde ao filtro.' : 'Nada nesta lista.') + '</td></tr>';
  $('tabela').innerHTML = html + '</tbody>';
  $('tabInfo').textContent = linhas.length.toLocaleString('pt-BR') + ' linhas' +
    (linhas.length > LIMITE ? ' (mostrando as primeiras ' + LIMITE + '; o Excel traz todas)' : '');
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('sel', b.dataset.lista === listaAtual));
}

function mostrarDecisao(dec) {
  $('formDecisao').hidden = true;
  const caixa = $('jaDecidido');
  caixa.hidden = false;
  const aceite = dec.decisao === 'aceite';
  caixa.className = 'nota ' + (aceite ? 'bom' : 'aviso');
  caixa.textContent = (aceite ? 'Aceite registrado' : 'Recusa registrada') + ' por ' + dec.nome + ' (' + dec.email + ') em ' +
    dataHora(dec.em) + '.' + (dec.motivo ? ' Motivo: ' + dec.motivo : '');
}

async function decidir(decisao) {
  const nome = $('nome').value.trim();
  const motivo = $('motivo').value.trim();
  const erro = texto => { $('erroDecisao').textContent = texto; };
  if (!nome) return erro('Informe o seu nome.');
  if (!$('conferi').checked) return erro('Marque que conferiu as listas.');
  if (decisao === 'recusa' && !motivo) return erro('Explique o motivo da recusa.');
  erro('');
  $('btnAceitar').disabled = $('btnRecusar').disabled = true;
  const registro = {
    decisao, motivo: decisao === 'recusa' ? motivo : '', nome, email: pacote.responsavel.email,
    em: Date.now(), fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || '', agente: navigator.userAgent,
    codigo: pacote.codigo, hashPacote
  };
  try {
    await pedirVivo('PUT', 's/' + idPedido, { t: Date.now(), d: await cifrarCom(chave, registro) });
    mostrarDecisao(registro);
  } catch (e) {
    // a decisão só pode ser gravada uma vez: se já existir, mostra a que valeu
    const s = await pedirVivo('GET', 's/' + idPedido).catch(() => null);
    if (s && s.d) return mostrarDecisao(await decifrarCom(chave, s.d));
    erro('Não foi possível registrar agora. Verifique a internet e tente de novo.');
    $('btnAceitar').disabled = $('btnRecusar').disabled = false;
  }
}

$('btnAceitar').addEventListener('click', () => {
  if (recusando) { recusando = false; $('motivoBox').hidden = true; $('btnRecusar').textContent = 'Recusar'; return; }
  decidir('aceite');
});
$('btnRecusar').addEventListener('click', () => {
  if (!recusando) {
    recusando = true;
    $('motivoBox').hidden = false;
    $('btnRecusar').textContent = 'Confirmar recusa';
    $('btnAceitar').textContent = 'Voltar';
    $('motivo').focus();
    return;
  }
  decidir('recusa');
});
$('busca').addEventListener('input', desenharLista);
$('conferi').addEventListener('change', () => { $('erroDecisao').textContent = ''; });

$('btnBaixar').addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  for (const l of LISTAS) XLSX.utils.book_append_sheet(wb, abaDeMatriz([l.colunas].concat(pacote[l.id] || []), [12, 60, 16, 16]), l.nome);
  baixarArquivo(planilhaParaBlob(wb), 'Listas_' + pacote.codigo + '.xlsx');
});

(async function iniciar() {
  const [id, chaveTexto] = location.hash.slice(1).split('.');
  if (!/^[0-9a-f]{32}$/.test(id || '') || !chaveTexto) return falhar('Este link está incompleto. Abra o endereço completo enviado por e-mail.');
  if (!FIREBASE_URL) return falhar('O app não está configurado para pedidos de aceite.');
  idPedido = id;
  try {
    chave = await chaveAprovacao(chaveTexto);
    const reg = await pedirVivo('GET', 'a/' + id);
    if (!reg || typeof reg.d !== 'string') return falhar('Pedido não encontrado. Ele pode ter sido cancelado pelo setor de Patrimônio.');
    hashPacote = await sha256Hex(new TextEncoder().encode(reg.d));
    pacote = await decifrarCom(chave, reg.d);
  } catch (e) {
    return falhar('Não foi possível abrir o pedido. Confira se o link foi copiado inteiro.');
  }
  const p = pacote;
  document.title = 'Aceite ' + p.codigo + ' · Conferência Patrimonial';
  $('titulo').textContent = 'Conferência ' + p.codigo;
  $('subtitulo').textContent = 'Filial ' + p.filial + (p.nomeFilial ? ' (' + p.nomeFilial + ')' : '') + (p.regional ? ', regional ' + p.regional : '') +
    '. Conferida por ' + (p.operador || 'usuário não informado') + ', finalizada em ' + dataHora(p.finalizadaEm || p.geradoEm).slice(0, 16) +
    '. Pedido para ' + p.responsavel.nome + ' (' + p.responsavel.email + ').';
  const r = p.resumo;
  const pct = n => r.totalFilial ? ' (' + (100 * n / r.totalFilial).toFixed(1).replace('.', ',') + '%)' : '';
  $('resumo').innerHTML = [
    [r.totalFilial, 'ativos da filial no sistema', ''],
    [r.localizados, 'localizados' + pct(r.localizados), 'r-ok'],
    [r.aLocalizar, 'não localizados' + pct(r.aLocalizar), ''],
    [r.transferencias, 'de outra filial, a transferir', 'r-transf'],
    [r.naoCadastrados, 'não cadastrados na base', 'r-nao']
  ].map(([n, t, cl]) => '<div class="' + (n ? cl : '') + '"><b>' + Number(n || 0).toLocaleString('pt-BR') + '</b><span>' + escapar(t) + '</span></div>').join('');
  $('abas').innerHTML = LISTAS.map(l => '<button data-lista="' + l.id + '">' + escapar(l.nome) + ' ' + (p[l.id] || []).length.toLocaleString('pt-BR') + '</button>').join('');
  $('abas').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-lista]');
    if (b) { listaAtual = b.dataset.lista; desenharLista(); }
  });
  $('nome').value = p.responsavel.nome || '';
  desenharLista();
  $('carregando').hidden = true;
  $('pedido').hidden = false;
  const s = await pedirVivo('GET', 's/' + id).catch(() => null);
  if (s && typeof s.d === 'string') {
    try { mostrarDecisao(await decifrarCom(chave, s.d)); } catch (e) {}
  }
})();
