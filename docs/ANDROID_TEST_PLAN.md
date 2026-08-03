# Plano de teste Android

Executar esta matriz primeiro com o APK `preview` e depois repetir os fluxos críticos usando a versão instalada pela faixa de teste interno da Google Play.

Não usar extratos, nomes, e-mails, fotos ou saldos reais nas capturas destinadas à loja.

| ID | Área | Teste | Resultado esperado | Status |
| --- | --- | --- | --- | --- |
| AND-01 | Instalação | Instalar e abrir o APK em um Android real | Aplicativo abre sem alerta ou encerramento | Pendente |
| AND-02 | Cadastro | Criar uma conta com e-mail válido | Conta criada e orientação sobre confirmação exibida | Pendente |
| AND-03 | Cadastro | Tentar cadastrar e-mail inválido ou já usado | Erro compreensível e tela continua utilizável | Pendente |
| AND-04 | Autenticação | Confirmar o e-mail e entrar | Sessão iniciada e onboarding aberto | Pendente |
| AND-05 | Autenticação | Informar senha incorreta | Erro compreensível sem expor detalhes técnicos | Pendente |
| AND-06 | Senha | Solicitar recuperação e definir nova senha | Link funciona e a nova senha permite entrar | Pendente |
| AND-07 | Onboarding | Concluir todas as etapas iniciais | Perfil e preferências são salvos uma única vez | Pendente |
| AND-08 | Movimentações | Criar receita e despesa | Valores aparecem no resumo e histórico corretos | Pendente |
| AND-09 | Movimentações | Editar e excluir uma movimentação | Totais e histórico são atualizados | Pendente |
| AND-10 | Categorias | Criar e excluir uma categoria personalizada | Categoria fica disponível e respeita vínculos existentes | Pendente |
| AND-11 | Sonhos | Criar uma meta com valor e prazo | Meta aparece na jornada com progresso correto | Pendente |
| AND-12 | Sonhos | Atualizar o progresso financeiro | Jornada e indicadores refletem a alteração | Pendente |
| AND-13 | CSV | Importar extrato compatível | Prévia é exibida antes da confirmação | Pendente |
| AND-14 | CSV | Confirmar categorias sugeridas | Movimentações são importadas nas categorias escolhidas | Pendente |
| AND-15 | CSV | Importar novamente o mesmo arquivo | Duplicidades são ignoradas e informadas | Pendente |
| AND-16 | CSV | Usar arquivo com linhas inválidas | Linhas rejeitadas são apresentadas sem impedir as válidas | Pendente |
| AND-17 | CSV | Desfazer uma importação no histórico | Somente os lançamentos daquela importação são removidos | Pendente |
| AND-18 | Perfil | Selecionar e remover foto de perfil | Foto é atualizada sem pedir câmera ou microfone | Pendente |
| AND-19 | Legal | Abrir Termos e Política de Privacidade | Páginas públicas corretas são abertas | Pendente |
| AND-20 | Sessão | Sair, fechar, reabrir e entrar novamente | Estado permanece consistente e dados reaparecem | Pendente |
| AND-21 | Segurança | Entrar com duas contas diferentes | Uma conta nunca visualiza dados da outra | Pendente |
| AND-22 | Exclusão | Excluir a conta pelo perfil | Sessão termina e conta/dados deixam de ser acessíveis | Pendente |
| AND-23 | Rede | Abrir o app sem internet e tentar salvar | Erro de conexão é compreensível e o app não encerra | Pendente |
| AND-24 | Layout | Revisar telas com fonte e escala do sistema aumentadas | Conteúdo essencial continua acessível | Pendente |

## Evidências

Para cada falha, registrar:

- ID do teste;
- modelo do aparelho e versão do Android;
- passos para reproduzir;
- resultado observado;
- captura ou gravação de tela sem dados pessoais;
- gravidade: bloqueante, alta, média ou baixa.

## Capturas da loja

Depois que os testes críticos passarem, capturar preferencialmente:

1. jornada com metas fictícias;
2. resumo financeiro com valores fictícios;
3. criação de movimentação;
4. prévia de importação CSV;
5. categorização da importação;
6. perfil e controles de privacidade.
