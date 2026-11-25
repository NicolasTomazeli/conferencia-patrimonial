'use strict';
// Endereço do banco "ao vivo" (Firebase Realtime Database). Não é segredo: os dados trafegam criptografados.
// Vazio = acompanhamento ao vivo desligado.
const FIREBASE_URL = 'https://patrimono-24cd4-default-rtdb.firebaseio.com';

// Endereço do script do Google que envia os e-mails de pedido de aceite (veja email-apps-script.gs).
// Vazio = o pedido de aceite é criado, mas o e-mail não sai.
const EMAIL_URL = '';
