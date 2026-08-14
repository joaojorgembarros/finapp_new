# Publicação no Google Play

Este documento detalha as informações de publicação do **Sonho+** para a Google Play Store, utilizando o pacote `com.joaojorgembarros.finapp`.

## Ficha principal da loja

- Nome do aplicativo: `Sonho+`
- Idioma padrão: Português (Brasil)
- Categoria: Finanças
- Aplicativo ou jogo: Aplicativo
- Gratuito ou pago: Gratuito
- Contém anúncios: Não
- Público-alvo sugerido: 18 anos ou mais
- E-mail de suporte: `joaojorgemoreirabarros@gmail.com`
- Política de privacidade: `https://joaojorgembarros.github.io/finapp_new/privacidade/`
- Exclusão de conta: `https://joaojorgembarros.github.io/finapp_new/exclusao-de-conta/`

### Descrição curta

Organize suas finanças, acompanhe metas e transforme planos em conquistas.

### Descrição completa

O Sonho+ ajuda você a entender seu dinheiro e transformar objetivos em planos possíveis.

Registre receitas e despesas, organize categorias, acompanhe sua evolução e crie metas para os sonhos que realmente importam. Você também pode importar extratos bancários em CSV, revisar os lançamentos antes de confirmar e aproveitar sugestões de categorização que tornam as próximas importações mais rápidas.

Principais recursos:

- controle de receitas e despesas;
- categorias personalizadas;
- metas financeiras ligadas aos seus sonhos;
- acompanhamento visual da sua jornada;
- importação e revisão de extratos CSV;
- histórico para desfazer importações;
- acesso protegido por conta;
- exclusão da conta e dos dados pelo próprio aplicativo.

O Sonho+ é uma ferramenta de organização financeira pessoal. Ele não oferece consultoria financeira, contábil, jurídica ou de investimentos.

## Segurança dos dados

As respostas abaixo são uma base para o formulário do Play Console e devem ser revisadas sempre que o aplicativo ganhar SDKs ou funcionalidades.

- O aplicativo coleta dados: Sim.
- O aplicativo compartilha dados com terceiros: Não. O Supabase atua como prestador de infraestrutura para operar o serviço.
- Os dados são criptografados em trânsito: Sim.
- O usuário pode solicitar exclusão: Sim, dentro do aplicativo e pela página pública.
- Conta obrigatória: Sim.

Dados coletados:

| Categoria do Google Play | Dados | Obrigatório | Finalidade |
| --- | --- | --- | --- |
| Informações pessoais | Nome | Sim | Funcionalidade e gerenciamento da conta |
| Informações pessoais | E-mail | Sim | Autenticação e gerenciamento da conta |
| Informações pessoais | IDs de usuário | Sim | Autenticação e isolamento dos dados |
| Informações financeiras | Receitas, despesas, saldos, categorias e metas informados pelo usuário | Sim para usar as funções financeiras | Funcionalidade do aplicativo |
| Fotos e vídeos | Foto de perfil | Não | Personalização do perfil |

O arquivo CSV escolhido pelo usuário é lido para preparar a importação. Os lançamentos financeiros confirmados são enviados ao Supabase; o arquivo original não é armazenado pelo aplicativo.

Não declarar, salvo mudança futura no aplicativo:

- localização;
- contatos;
- mensagens;
- áudio;
- histórico de navegação;
- publicidade;
- rastreamento entre aplicativos;
- análise de uso ou marketing.

## Materiais gráficos pendentes

- [x] ícone da loja em PNG, 512 × 512 px (`store-assets/play-store-icon-512.png`);
- [x] gráfico de destaque, 1024 × 500 px (`store-assets/play-store-feature-graphic-1024x500.png`);
- pelo menos duas capturas de tela de celular; recomendado produzir de quatro a oito;
- capturas sem dados pessoais reais, e-mails, saldos bancários identificáveis ou notificações privadas.

Telas recomendadas para as capturas:

1. jornada e sonhos;
2. resumo financeiro;
3. cadastro de movimentação;
4. importação de extrato;
5. categorização da importação;
6. perfil e controles de privacidade.

## Teste fechado obrigatório

Para conta pessoal nova, manter pelo menos 12 testadores inscritos no teste fechado durante 14 dias contínuos.

1. Criar o aplicativo no Play Console com o pacote `com.joaojorgembarros.finapp`.
2. Preencher a ficha principal e os formulários de conteúdo.
3. Criar uma faixa de teste fechado.
4. Enviar o arquivo `.aab` de produção.
5. Adicionar uma lista ou Grupo do Google com os alunos.
6. Compartilhar o link de participação e confirmar que ao menos 12 aceitaram.
7. Pedir que permaneçam inscritos e utilizem o aplicativo durante os 14 dias.
8. Registrar problemas e publicar correções na mesma faixa quando necessário.
9. Ao final, responder ao questionário e solicitar acesso à produção.

## Validação funcional antes de convidar a turma

- instalar a versão distribuída pelo Google Play em aparelho real;
- criar uma conta e confirmar o e-mail;
- entrar e sair da conta;
- recuperar a senha;
- criar, editar e excluir movimentações;
- criar uma meta e verificar o progresso;
- importar ao menos um CSV e desfazer a importação;
- testar isolamento usando duas contas diferentes;
- excluir uma conta dentro do aplicativo e confirmar a remoção dos dados;
- abrir Termos, Privacidade e Exclusão de conta pelo aplicativo.
