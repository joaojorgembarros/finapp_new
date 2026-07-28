# Compatibilidade de extratos bancários

## Níveis

- **Sintético:** o parser passa em uma fixture criada para desenvolvimento, mas
  ainda não foi validado com um arquivo exportado pela instituição.
- **Validado:** ao menos um extrato real anonimizado foi importado e transformado
  corretamente em testes automatizados.

## CSV

| Instituição | Conta | Situação | Observações |
| --- | --- | --- | --- |
| Nubank | Conta | Sintético | Cabeçalhos de data, valor e descrição |
| Inter | Conta | Sintético | Data com horário, tipo, valor e saldo |
| Itaú | Conta | Sintético | Saldo anterior e lançamentos |
| Bradesco | Conta | Sintético | Colunas separadas de crédito e débito |
| Santander | Conta | Sintético | Valor assinado e saldo |
| Caixa | Conta | Sintético | Data da movimentação, documento e histórico |
| Banco do Brasil | Conta | Sintético | Saldo anterior e exclusão de BB Rende Fácil |
| C6 Bank | Conta | Sintético | Data ISO com horário e valor assinado |
| Mercado Pago | Conta | Sintético | Data da operação, valor e tipo |
| PicPay | Conta | Sintético | Colunas separadas de entrada e saída |

## Ainda não coberto

- Faturas de cartão em CSV
- Variações de conta PJ
- Excel (`.xlsx`)
- OFX
- PDF textual
- PDF escaneado ou protegido por senha

Quando um extrato real anonimizado for recebido, a fixture correspondente deve ser
ajustada e a situação alterada para **Validado** somente depois que os testes cobrirem
entradas, saídas, datas, descrições, saldo e regras especiais.
