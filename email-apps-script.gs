// Conferência Patrimonial: envio automático dos e-mails de pedido de aceite.
// Cole este código em um projeto do Google Apps Script e publique como "App da Web"
// (Executar como: Eu; Quem pode acessar: Qualquer pessoa). O endereço gerado vai em config.js.
//
// Proteções: só envia para e-mails dos domínios abaixo, só aceita links que apontam para o
// próprio app, monta o texto aqui (quem chama não escolhe o conteúdo) e limita reenvios.

const APP = 'https://nicolastomazeli.github.io/conferencia-patrimonial/';
const DOMINIOS = ['lbv.org.br'];          // domínios aceitos como destinatário: ajuste se precisar
const MAX_ENVIOS_POR_PEDIDO = 3;
const ASSUNTO = {
  conferencia: 'Aceite pendente: conferência',
  transferencia: 'Aceite pendente: transferência',
  baixa: 'Aceite pendente: baixa'
};

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const para = String(d.para || '').trim().toLowerCase();
    const dominio = para.split('@')[1] || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para) || DOMINIOS.indexOf(dominio) < 0) return resposta('destinatario recusado');
    const id = String(d.id || '');
    if (!/^[0-9a-f]{32}$/.test(id) || String(d.link || '').indexOf(APP + 'aceite.html#' + id + '.') !== 0) return resposta('link recusado');

    const props = PropertiesService.getScriptProperties();
    const enviados = Number(props.getProperty('env_' + id) || 0);
    if (enviados >= MAX_ENVIOS_POR_PEDIDO) return resposta('limite de reenvios');

    const tipo = ASSUNTO[d.tipo] ? d.tipo : 'conferencia';
    const r = d.resumo || {};
    const filial = esc(d.filial) + (d.nomeFilial ? ' (' + esc(d.nomeFilial) + ')' : '');
    const linha = (rot, n) => '<tr><td style="padding:6px 16px 6px 0;color:#55626f">' + rot + '</td><td style="padding:6px 0;font-weight:bold;font-size:16px">' + Number(n || 0).toLocaleString('pt-BR') + '</td></tr>';
    const html =
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#17212b;max-width:560px">' +
      '<p>Olá, ' + esc(d.nome || '') + '.</p>' +
      '<p>A conferência <b>' + esc(d.codigo) + '</b> da filial ' + filial + (d.regional ? ', regional ' + esc(d.regional) : '') +
      ', foi finalizada e aguarda o seu aceite.</p>' +
      '<table style="border-collapse:collapse;margin:12px 0">' +
      linha('Localizados da filial', r.localizados) + linha('Não localizados', r.aLocalizar) +
      linha('De outra filial (transferir)', r.transferencias) + linha('Não cadastrados', r.naoCadastrados) + '</table>' +
      '<p><a href="' + esc(d.link) + '" style="display:inline-block;padding:12px 20px;background:#3a3d9e;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Ver as listas e dar o aceite</a></p>' +
      '<p style="color:#55626f;font-size:13px">Este link é pessoal e vale como o seu registro de aceite. Não encaminhe este e-mail.</p>' +
      '</div>';
    MailApp.sendEmail({
      to: para,
      subject: ASSUNTO[tipo] + ' ' + String(d.codigo || '') + (d.nomeFilial ? ' - ' + String(d.nomeFilial) : ''),
      htmlBody: html,
      name: 'Conferência Patrimonial'
    });
    props.setProperty('env_' + id, String(enviados + 1));
    return resposta('ok');
  } catch (err) {
    return resposta('erro: ' + err.message);
  }
}

// Rode uma vez pelo editor para autorizar o envio de e-mails.
function autorizar() {
  Logger.log('E-mails restantes hoje: ' + MailApp.getRemainingDailyQuota());
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resposta(texto) {
  return ContentService.createTextOutput(texto);
}
