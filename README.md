# INFRA Bets 2026

Projeto do bolao publicado no Firebase Hosting com autenticacao Firebase, dados no Firestore e sincronizacao economica de resultados finais via API-Football.

## Estrutura ativa

- `public/index.html`: site publico publicado no Hosting
- `public/admin.html`: painel administrativo protegido por login
- `.github/workflows/firebase-hosting-merge.yml`: deploy automatico no site oficial a cada push em `main`
- `.github/workflows/live-results-sync.yml`: sincronizador automatico de resultados finais
- `.github/scripts/sync-live-results.mjs`: rotina que consulta a API-Football e grava apenas finais ou backfill no Firestore

## Fluxo atual de resultados

1. O workflow roda a cada 10 minutos.
2. Consulta apenas partidas sem resultado no Firestore cujo horario ja passou de 3 horas apos o inicio da partida.
3. Faz tentativas mais rapidas nas primeiras horas apos o fim esperado do jogo e desacelera depois para economizar cota da API.
4. Limita a quantidade de datas consultadas por execucao para economizar cota da API.
5. Partidas antigas sem resultado entram em nova tentativa apenas em janelas espaçadas de backfill.
6. Atualiza apenas resultados finais em `results/{matchId}`.
7. O ranking e os palpites sao recalculados pelo site em tempo real.

## Secrets necessarios no GitHub

- `API_FOOTBALL_KEY`
- `FIREBASE_SERVICE_ACCOUNT_COPA2026_C344C`

## Comportamento publico sem login

- visitante pode navegar pela home e pelos jogos
- palpites, participantes, classificacao e enquete exigem login
- o CTA secundario do hero abre login quando a classificacao estiver bloqueada

## Observacoes

- o site oficial sai da pasta `public`
- a `index.html` da raiz e mantida espelhada para edicao local
- a pagina personalizada de acoes de conta fica em `public/auth-action.html`
- no Firebase Console, ajuste `Authentication > Templates` para usar a action URL personalizada apontando para `/auth-action.html`
- para validar a logica do sincronizador sem chamar a API:

```text
node .github/scripts/sync-live-results.mjs --dry-run
```
