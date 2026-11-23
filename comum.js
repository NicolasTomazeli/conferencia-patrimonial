'use strict';
// Funções compartilhadas entre o coletor (celular) e o painel (PC).

const VERSAO_APP = '1.0.0';
const ABA_LEITURAS = 'Conferencia';
const ABA_INFO = 'Info';
const COLUNAS_LEITURA = [
  'Código da Conferência', 'Patrimônio', 'Descrição', 'Filial Base', 'Filial Atual',
  'Setor', 'Usuário', 'Primeira Leitura', 'Última Leitura', 'Qtd Leituras', 'Origem', 'Situação'
];

const $ = id => document.getElementById(id);

// ---------- Banco local (IndexedDB) ----------
let db = null;

function abrirBanco(nome) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(nome, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('kv');
      d.createObjectStore('conferencias', { keyPath: 'codigo' });
      const s = d.createObjectStore('leituras', { keyPath: ['codigo', 'patrimonio'] });
      s.createIndex('porCodigo', 'codigo');
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function operar(loja, modo, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(loja, modo);
    const req = fn(t.objectStore(loja));
    let resultado;
    if (req) req.onsuccess = () => { resultado = req.result; };
    t.oncomplete = () => resolve(resultado);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const kvLer = chave => operar('kv', 'readonly', s => s.get(chave));
const kvGravar = (chave, valor) => operar('kv', 'readwrite', s => s.put(valor, chave));
const confListar = () => operar('conferencias', 'readonly', s => s.getAll());
const confLer = codigo => operar('conferencias', 'readonly', s => s.get(codigo));
const confGravar = c => operar('conferencias', 'readwrite', s => s.put(c));
const leiturasDe = codigo => operar('leituras', 'readonly', s => s.index('porCodigo').getAll(codigo));
const leituraLer = (codigo, patrimonio) => operar('leituras', 'readonly', s => s.get([codigo, patrimonio]));
const leituraGravar = l => operar('leituras', 'readwrite', s => s.put(l));
const leituraApagar = (codigo, patrimonio) => operar('leituras', 'readwrite', s => s.delete([codigo, patrimonio]));

function apagarConferencia(codigo) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(['conferencias', 'leituras'], 'readwrite');
    t.objectStore('conferencias').delete(codigo);
    const cursor = t.objectStore('leituras').index('porCodigo').openKeyCursor(IDBKeyRange.only(codigo));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) { t.objectStore('leituras').delete(c.primaryKey); c.continue(); }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---------- Utilidades ----------
const doisDigitos = n => String(n).padStart(2, '0');

function dataHora(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
    doisDigitos(d.getHours()) + ':' + doisDigitos(d.getMinutes()) + ':' + doisDigitos(d.getSeconds());
}

// Converte "23/11/2026 17:02:11" de volta para milissegundos.
function lerDataHora(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(texto || '').trim());
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
}

// Data de aquisição pode vir como número de série do Excel.
function dataExcel(v) {
  if (v instanceof Date) return doisDigitos(v.getDate()) + '/' + doisDigitos(v.getMonth() + 1) + '/' + v.getFullYear();
  if (typeof v === 'number' && v > 59) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return doisDigitos(d.getUTCDate()) + '/' + doisDigitos(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  return v == null ? '' : String(v);
}

// Normaliza número de patrimônio: só dígitos, sem zeros à esquerda. Retorna '' se inválido.
function normalizarPatrimonio(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
  if (!/^\d{1,9}$/.test(s)) return '';
  return String(Number(s));
}

function normalizarFilial(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{1,4}$/.test(s) ? String(Number(s)) : '';
}

function situacaoDe(leitura) {
  if (!leitura.cadastrado) return 'Não cadastrado';
  return String(leitura.filialBase) === String(leitura.filialAtual) ? 'OK' : 'Transferência';
}

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

// Lê um arquivo de base (Excel do sistema ou base_ativos.txt) e devolve linhas padronizadas.
// Cada linha: { p: patrimônio, d: descrição, f: filial, dt: aquisição, v: valor, to: tipo ocorrência, cb: código do bem }
async function lerArquivoBase(arquivo) {
  const nome = arquivo.name.toLowerCase();
  let matriz;
  if (nome.endsWith('.txt') || nome.endsWith('.tsv') || nome.endsWith('.csv')) {
    const texto = await arquivo.text();
    const sep = texto.indexOf('\t') >= 0 ? '\t' : ';';
    matriz = texto.split('\n').map(l => l.replace(/\r$/, '').split(sep));
  } else {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    let melhor = null;
    for (const nomeAba of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: null, blankrows: false });
      if (m.length && m[0].some(c => semAcento(c) === 'PATRIMONIO') && (!melhor || m.length > melhor.length)) melhor = m;
    }
    if (!melhor) throw new Error('Não encontrei uma aba com a coluna PATRIMONIO.');
    matriz = melhor;
  }
  const cab = matriz[0].map(semAcento);
  const col = nomes => cab.findIndex(c => nomes.includes(c));
  const iP = col(['PATRIMONIO']), iD = col(['DESCRICAO']), iF = col(['CODFILIAL', 'FILIAL']);
  if (iP < 0 || iD < 0 || iF < 0) throw new Error('A base precisa das colunas PATRIMONIO, DESCRICAO e CODFILIAL.');
  const iDt = col(['DTAQUISICAO']), iV = col(['VRBASE']), iTo = col(['TIPOOCORRENCIA']), iCb = col(['CODBEM']);
  const linhas = [];
  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i];
    if (!r || r.length < 3) continue;
    const f = normalizarFilial(r[iF]);
    if (!f) continue;
    linhas.push({
      p: normalizarPatrimonio(r[iP]),
      d: String(r[iD] == null ? '' : r[iD]).replace(/\s+/g, ' ').trim(),
      f,
      dt: iDt >= 0 ? r[iDt] : null,
      v: iV >= 0 ? r[iV] : null,
      to: iTo >= 0 ? r[iTo] : null,
      cb: iCb >= 0 ? r[iCb] : null
    });
  }
  if (!linhas.length) throw new Error('O arquivo não tem nenhuma linha válida.');
  return linhas;
}

function baixarArquivo(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function planilhaParaBlob(wb) {
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function abaDeMatriz(matriz, larguras) {
  const ws = XLSX.utils.aoa_to_sheet(matriz);
  if (larguras) ws['!cols'] = larguras.map(w => ({ wch: w }));
  return ws;
}
