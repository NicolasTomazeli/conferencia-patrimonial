# Conferência Patrimonial

Coletor de conferência patrimonial por leitura de código de barras (Code 128) e painel de apuração.

Este repositório contém **somente o código**. Nenhum dado de patrimônio é armazenado aqui: a base de ativos e as conferências ficam apenas no aparelho de quem usa.

## Partes

| Arquivo | Uso |
|---|---|
| `index.html` + `app.js` | Coletor, para o celular (Chrome no Android). Instalar com "Adicionar à tela inicial". |
| `painel.html` + `painel.js` | Painel, para o PC. Importa os arquivos dos coletores e cruza com a base. |
| `comum.js` | Funções compartilhadas (banco local, leitura da base, Excel). |
| `sw.js` + `manifest.json` | Instalação como app e funcionamento sem internet. |
| `lib/xlsx.full.min.js` | SheetJS 0.20.3, para ler e gerar Excel. |

## Fluxo

1. No painel, carregar a base do sistema (Excel com as colunas `PATRIMONIO`, `DESCRICAO`, `CODFILIAL`) e clicar em **Gerar base para o celular**.
2. Enviar o `base_ativos.txt` para o celular e, no coletor, tocar em **Atualizar base**.
3. No coletor: **Nova conferência**, ler as plaquetas, **Finalizar**. O app gera `Conferencia_<código>.xlsx`.
4. No painel: **Importar conferências** e exportar o relatório.

O código da conferência segue o formato `FFF-AAAAMMDD-NN` (filial, data, sequência no aparelho).

## Atualização automática da base

O painel publica a base em `dados/base.bin` (criptografada) e `dados/base.json` (versão e hash). O coletor consulta esses arquivos ao abrir e atualiza sozinho.

- **Cifra:** AES-256-GCM, com sal e IV aleatórios a cada publicação e cabeçalho autenticado.
- **Chave:** PBKDF2-HMAC-SHA-256 com 600.000 iterações, a partir de uma senha gerada com 100 bits de entropia.
- **Conteúdo:** somente patrimônio, descrição e filial. Valores não são publicados.
- **Senha e token** nunca são enviados ao repositório. A senha fica no navegador como chave não extraível; o token do GitHub só é guardado se a opção "Lembrar" for marcada.
- As páginas usam Content-Security-Policy restrita: só carregam scripts do próprio site e só se conectam ao próprio site e a `api.github.com`.

## Acompanhamento ao vivo

Com `FIREBASE_URL` preenchido em `config.js`, o coletor envia cada conferência para um Firebase Realtime Database e o painel mostra o andamento sem importar arquivos.

- Cada envio é um retrato completo da conferência, cifrado com AES-256-GCM. A chave vem da mesma senha da base, com sal próprio. O banco só guarda texto cifrado.
- O coletor envia ao criar, ao finalizar e, durante a leitura, no máximo a cada 15 segundos. Sem internet, guarda e envia quando o sinal volta.
- O painel consulta o banco a cada 15 segundos e ignora o que não abre com a senha.
- As regras do banco estão em `firebase-regras.json`.
