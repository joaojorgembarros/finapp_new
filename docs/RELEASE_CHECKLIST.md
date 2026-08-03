# Checklist de release

- [x] Identificadores iOS e Android definidos como `com.joaojorgembarros.finapp`.
- [x] Aplicar `supabase/migrations` no projeto de produção.
- [x] Publicar Termos, Privacidade e Exclusão de conta e preencher `.env`.
- [x] Configurar as cinco variáveis públicas no ambiente `production` do EAS.
- [x] Substituir todos os marcadores `[PREENCHER ...]` em `docs/`.
- [x] Executar `npm run verify`.
- [x] Preparar textos, Segurança dos dados e roteiro do teste fechado em `docs/PLAY_STORE_RELEASE.md`.
- [x] Preparar ícone 512 × 512 e gráfico de destaque 1024 × 500 em `store-assets/`.
- [x] Preparar a matriz de validação Android em `docs/ANDROID_TEST_PLAN.md`.
- [ ] Concluir o build Android `preview` em formato APK e executar a matriz de testes.
- [ ] Concluir o build Android `production` em formato AAB.
- [ ] Gerar e testar build `preview` em Android e iPhone reais.
- [ ] Validar cadastro, confirmação de e-mail, recuperação, exclusão e isolamento entre duas contas.
- [ ] Preencher Data Safety, App Privacy, classificação etária e metadados das lojas.
- [ ] Gerar screenshots e fornecer credenciais/instruções para a revisão da Apple.
- [ ] Configurar alertas, backup e recuperação do Supabase.
