# Bolão TI

Projeto do bolão publicado no Firebase Hosting com autenticação Firebase, dados no Firestore e gerenciamento de resultados finais atualizados manualmente.

## Estrutura ativa

- `public/index.html`: site público publicado no Hosting
- `public/admin.html`: painel administrativo protegido por login
- `.github/workflows/firebase-hosting-merge.yml`: deploy automático no site oficial a cada push em `main`
- `.github/scripts/manual-update.mjs`: script para atualizar manualmente os resultados no Firestore

## Fluxo de resultados

Os resultados das partidas são inseridos manualmente pelos administradores. Isso pode ser feito de duas formas:
1. Diretamente no painel administrativo do site (`public/admin.html`), que atualiza o Firestore em tempo real.
2. Utilizando o script de atualização manual localmente via CLI:
   ```bash
   node .github/scripts/manual-update.mjs <matchId> <homeScore> <awayScore>
   ```

## Secrets necessários no GitHub

- `FIREBASE_SERVICE_ACCOUNT_COPA2026_C344C`

## Comportamento público sem login

- visitante pode navegar pela home e pelos jogos
- palpites, participantes, classificação e enquete exigem login
- o CTA secundário do hero abre login quando a classificação estiver bloqueada

## Observações

- o site oficial sai da pasta `public`
- a `index.html` da raiz é mantida espelhada para edição local
- a página personalizada de ações de conta fica em `public/auth-action.html`
- no Firebase Console, ajuste `Authentication > Templates` para usar a action URL personalizada apontando para `/auth-action.html`

