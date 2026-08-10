# Fixtures sintéticas de extratos bancários

Estes arquivos não foram exportados pelos bancos e não contêm dados pessoais reais.
Eles reproduzem variações comuns de cabeçalhos, delimitadores, datas, valores,
crédito, débito e saldo para testar o importador durante o desenvolvimento.

## Arquivos disponíveis

| Arquivo | Instituição identificada | O que exercita |
| --- | --- | --- |
| `nubank-conta.csv` | Nubank | CSV com vírgula, data ISO e valores com ponto decimal |
| `inter-conta.csv` | Inter | Ponto e vírgula, data com horário, tipo e saldo corrente |
| `itau-conta.csv` | Itaú | Saldo anterior, débito e crédito em linhas separadas |
| `bradesco-conta.csv` | Bradesco | Colunas separadas de crédito e débito |
| `santander-conta.csv` | Santander | Valores assinados e saldo corrente |
| `caixa-conta.csv` | Caixa | Cabeçalho `Data Mov.`, documento e saldo corrente |
| `banco-do-brasil-conta.csv` | Banco do Brasil | Saldo anterior e linha automática `BB Rende Fácil`, que deve ser ignorada |
| `c6-bank-conta.csv` | C6 Bank | CSV com vírgula, data ISO com horário e ponto decimal |
| `mercado-pago-conta.csv` | Mercado Pago | Tipo explícito de entrada e saída |
| `mp-wallet.csv` | Mercado Pago | Layout alternativo com resumo e saldo final explícito |
| `picpay-conta.csv` | PicPay | Colunas separadas de entrada e saída |

Cada arquivo possui ao menos uma entrada e uma saída válidas. Para testar no app,
abra **Importar extrato**, selecione um dos arquivos `.csv`, confirme o banco
sugerido e revise a prévia antes de importar.

O parser e todos os exemplos podem ser validados com:

```bash
npm test -- src/lib/csvImport.test.ts
```

Cada fixture deve ser substituída ou validada quando recebermos um extrato real
anonimizado da instituição correspondente. Nenhuma compatibilidade deve ser
divulgada como homologada com base apenas nestes exemplos.
