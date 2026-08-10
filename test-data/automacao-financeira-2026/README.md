# Extratos sintéticos para testar a automação financeira

Os seis CSVs deste diretório são fictícios, não contêm dados pessoais e usam
layouts aceitos pelo importador. Cada cenário deve ser executado isoladamente:
use uma casa de teste limpa ou arquive o compromisso anterior antes de seguir.

## Abrir o app

Na pasta interna do projeto (`finapp-main/finapp-main`), execute uma das opções:

```powershell
npm start
```

ou, para testar no navegador:

```powershell
npm run web
```

Para testar a criação automática feita pelo onboarding, use uma conta nova. Se o
cadastro solicitar confirmação de e-mail, confirme o link e depois entre no app.
Contas antigas que guardam somente o tipo da dívida não possuem valor suficiente
para criar o compromisso automaticamente; nelas, cadastre o compromisso em
**Controle > Contas para conferir > Adicionar contas e parcelas**.

## Preparação comum

No Planejamento, selecione **Mês calendário**, deixe a reserva em **R$ 0,00** e
não faça alocações. Para conferir os totais do cenário principal, informe renda
mensal de **R$ 4.000,00** e não mantenha outras transações ou compromissos ativos.
Crie somente o compromisso indicado antes de importar o respectivo arquivo.

## Cenário principal, passo a passo

1. Crie uma conta de teste e avance pelo onboarding até **Sua renda**.
2. Informe renda fixa de **R$ 4.000,00**, renda extra de **R$ 0,00** e escolha um
   tipo de trabalho.
3. Em **Dívidas**, selecione **Cartão de crédito** e preencha:
   - valor mensal: **R$ 450,00**;
   - vencimento: dia **10**;
   - parcelas restantes: deixe vazio.
4. Escolha **Nubank** e toque em **Concluir e ver minha jornada**.
5. Na aba **Controle**, abra **Configurar planejamento**, selecione **Mês
   calendário**, deixe a reserva zerada e salve.
6. Antes de importar, confira **Projeção mensal**: o resultado esperado é
   **R$ 3.550,00** (`4.000 - 450`). O disponível realizado deve continuar zerado,
   pois nenhuma renda entrou de fato ainda.
7. Toque em **Importar extrato**, selecione
   `01-nubank-cenario-principal-agosto.csv`, confirme Nubank e importe.
8. No retorno ao Controle, confira o aviso **1 conta foi reconhecida
   automaticamente**.
9. Abra **Contas para conferir > Pagamentos confirmados**. A dívida deve aparecer
   como paga, sem continuar nos compromissos pendentes.
10. Confira os totais:
    - já entrou: **R$ 4.000,00**;
    - já saiu: **R$ 570,00**;
    - entrou menos saiu: **R$ 3.430,00**;
    - compromissos pendentes: **R$ 0,00**;
    - disponível agora: **R$ 3.430,00**;
    - projeção mensal: **R$ 3.550,00**.

O valor de R$ 450,00 já está entre as despesas do extrato. Portanto, o disponível
correto é R$ 3.430,00, e não R$ 2.980,00. Esse é o teste principal contra desconto
duplicado.

| Arquivo | Banco/layout | Compromisso a cadastrar | Resultado esperado |
| --- | --- | --- | --- |
| `01-nubank-cenario-principal-agosto.csv` | Nubank | Dívida recorrente de **R$ 450,00**, vencimento dia **10**, início em 01/08/2026 | O pagamento de 08/08 está a 2 dias do vencimento e deve ser vinculado automaticamente. São 3 lançamentos; realizado e disponível ficam em **R$ 3.430,00** (`4.000 - 450 - 120`) e a projeção em **R$ 3.550,00** (`4.000 - 450`). |
| `02-inter-fora-da-janela-agosto.csv` | Inter | Dívida recorrente de **R$ 460,00**, vencimento dia **10**, início em 01/08/2026 | O pagamento de 18/08 está 8 dias depois do vencimento; deve entrar como despesa, mas deixar o compromisso pendente e registrar **0 vínculos automáticos**. |
| `03-santander-ambiguidade-agosto.csv` | Santander | Dívida recorrente de **R$ 100,00**, vencimento dia **10**, início em 01/08/2026 | As duas despesas de R$ 100,00 estão dentro da janela. Como o valor aparece duas vezes no ciclo, nenhuma deve ser vinculada automaticamente; o compromisso continua pendente. |
| `04-itau-parcela-1-agosto.csv` | Itaú | Parcela de **R$ 347,80**, vencimento dia **15**, início em 01/08/2026, **2 parcelas** | Importe primeiro: agosto deve mostrar parcela 1/2 paga por vínculo automático. |
| `05-c6-parcela-2-setembro.csv` | C6 Bank | Use o mesmo compromisso do arquivo 04 | Importe depois: setembro deve mostrar parcela 2/2 paga por vínculo automático. |
| `06-caixa-verificacao-termino-outubro.csv` | Caixa | Use o mesmo compromisso dos arquivos 04 e 05 | Em outubro não deve existir parcela 3/2 nem ocorrer vínculo automático. A linha de R$ 347,80 é proposital e permanece apenas como despesa normal. |

## Executar os outros cenários

### Fora da janela

Em uma conta limpa, cadastre dívida de **R$ 460,00**, vencimento dia **10**, e
importe o arquivo 02. O pagamento de 18/08 está oito dias depois do vencimento:
não deve haver aviso de reconhecimento e o compromisso deve continuar pendente.
Ao tocar em **Confirmar pagamento**, ainda é possível vinculá-lo manualmente.

### Valor ambíguo

Em uma conta limpa, cadastre dívida de **R$ 100,00**, vencimento dia **10**, e
importe o arquivo 03. Existem duas despesas de R$ 100,00 dentro da janela. Nenhuma
deve ser escolhida automaticamente; a proximidade da data não pode desempatar.

### Encerramento das parcelas

Em uma conta limpa, cadastre uma **Parcela** de **R$ 347,80**, vencimento dia
**15**, início em agosto de 2026 e total de **2 parcelas**. Importe, nesta ordem:

1. arquivo 04 em agosto: parcela **1/2** reconhecida;
2. arquivo 05 em setembro: parcela **2/2** reconhecida;
3. arquivo 06 em outubro: nenhuma parcela **3/2** e nenhum vínculo automático.

No Controle, use as setas do bloco **Período** para navegar entre os meses. As
setas ficam ocultas enquanto o cartão pós-importação estiver aberto; toque em
**Agora não** ou conclua o guia para exibi-las.

## Teste de duplicidade

Depois de importar o arquivo 01 com sucesso, selecione novamente **o mesmo arquivo,
sem alterar seu conteúdo**. O app deve reconhecê-lo pelo hash, exibir que ele já foi
importado e bloquear uma segunda importação.

## Evidências

Para cada cenário, registre:

- nome do arquivo e conta de teste utilizada;
- resultado observado e resultado esperado;
- captura da projeção, do disponível e dos compromissos;
- se houve vínculo automático, manual ou nenhum vínculo;
- status: **Passou** ou **Falhou**;
- em caso de falha, aparelho/navegador, passos e mensagem apresentada.

## Validação do parser

O teste ao lado passa todos os arquivos pela função `parseCsv` e confirma banco,
datas, valores, tipos e ausência de linhas rejeitadas:

```powershell
npm test -- test-data/automacao-financeira-2026/parse-csv.test.ts
```
