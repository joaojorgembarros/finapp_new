# FinApp (do zero) — novo banco

Este projeto já vem com:
- Onboarding: renda + tipo de trabalho + 3 metas
- Lançamento rápido: entrada/saída + categorias (fixa/variável)
- Abas: Início / Meu mês / Histórico / Metas
- Menu lateral: Perfil / Categorias / etc.
- Tema dark neon (mesmo estilo do seu finapp)

## 1) Instalar
```bash
npm install
```

## 2) Variáveis de ambiente
Crie um `.env` com:
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## 3) Banco (Supabase)
Use o arquivo `supabase/schema.sql` para criar tabelas + RLS.

## 4) Rodar
```bash
npx expo start
```
