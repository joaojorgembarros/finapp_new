# FinApp

Aplicativo mobile de controle financeiro desenvolvido com **React Native**, **Expo** e **Supabase**.

## Funcionalidades

- Cadastro de receitas e despesas
- Controle do saldo mensal
- Metas financeiras
- Histórico por mês
- Organização por categorias

## Tecnologias

- React Native
- Expo
- TypeScript
- Supabase (Auth + Banco de dados)
- PostgreSQL

## Como executar

```bash
npm install
npx expo start
```

## Verificação

```bash
npm run verify
```

## Banco e release

- O schema canônico está em `supabase/migrations` e deve ser aplicado com `supabase db push`.
- Copie `.env.example` para `.env` e configure Supabase e URLs legais.
- Builds de loja usam os perfis de `eas.json`.
- Os identificadores iOS e Android são `com.joaojorgembarros.finapp`; antes da primeira publicação, preencha os documentos em `docs/` e publique as URLs legais.
