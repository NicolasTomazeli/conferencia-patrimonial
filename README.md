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
