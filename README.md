# INFRA Bets 2026

Projeto do bolao publicado no Firebase Hosting com autenticacao Firebase, dados no Firestore e sincronizacao economica de resultados finais via API-Football.

## Estrutura ativa

- `public/index.html`: site publico publicado no Hosting
- `public/admin.html`: painel administrativo protegido por login
- `.github/workflows/firebase-hosting-merge.yml`: deploy automatico no site oficial a cada push em `main`
- `.github/workflows/live-results-sync.yml`: sincronizador automatico de resultados finais
- `.github/scripts/sync-live-results.mjs`: rotina que consulta a API-Football e grava apenas finais ou backfill no Firestore

## Fluxo atual de resultados

1. O workflow roda a cada 20 minutos.
2. Consulta apenas partidas do dia no horario do Brasil.
3. Entre 00h e 05h, tambem consulta o dia anterior.
4. Atualiza apenas resultados finais em `results/{matchId}`.
5. O ranking e os palpites sao recalculados pelo site em tempo real.

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
- para validar a logica do sincronizador sem chamar a API:

```text
node .github/scripts/sync-live-results.mjs --dry-run
```
