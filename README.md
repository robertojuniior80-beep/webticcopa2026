# INFRA Bets · Operacao Manual

Este projeto agora esta otimizado para um fluxo simples:

- site publicado no Firebase Hosting
- dados em tempo real no Firestore
- atualizacao manual de resultados por aqui, sem depender do admin

## Como o fluxo funciona

1. A partida termina
2. Voce me pede a atualizacao no chat
3. Eu confirmo o placar final
4. Eu gravo o resultado em `results/{matchId}` no Firestore
5. O site recalcula ranking, pontos e cards automaticamente

## Formato mais rapido para pedir atualizacao

Use qualquer uma destas mensagens:

```text
atualize o resultado de Mexico x South Africa
```

```text
grave no firestore o resultado de Brazil x Morocco
```

```text
partida encerrada: Czech Republic 1 x 2 South Korea
```

```text
atualize A1 para 2 x 0
```

## Formato recomendado

Quando quiser ganhar mais velocidade, prefira este padrao:

```text
atualize [ID da partida] para [gols casa] x [gols fora]
```

Exemplos:

```text
atualize A1 para 2 x 0
atualize B3 para 1 x 1
atualize D4 para 0 x 3
```

## Se voce nao souber o ID da partida

Pode mandar assim:

```text
atualize o resultado de Mexico x South Africa
```

ou assim:

```text
partida das 16h terminou: Mexico 2 x 0 South Africa
```

Eu identifico a partida correta e faço a gravacao.

## O que eu faco por padrao

- confirmo o placar final quando necessario
- verifico o documento atual no Firestore
- gravo o resultado final
- preservo o site publicado e o ranking automatico

## O que nao precisamos mais usar

- lancamento manual pelo admin para resultado final
- automacao externa por API
- Firebase Functions para sincronizacao

## Observacoes

- Se um resultado ja existir no Firestore, eu atualizo o mesmo documento.
- O caminho principal de operacao agora e `Firestore + Hosting`.
- O admin continua existindo, mas nao e mais o fluxo principal para encerrar partidas.

## Sincronizacao economica com API-Football

Tambem existe agora um sincronizador automatico por GitHub Actions em:

- `.github/workflows/live-results-sync.yml`
- `.github/scripts/sync-live-results.mjs`

Como ele economiza a cota gratis:

- roda a cada 20 minutos
- consulta apenas jogos do dia no horario do Brasil
- tambem olha o dia anterior apenas entre 00h e 05h, para capturar finais de jogos noturnos
- grava no Firestore apenas quando encontra placar final novo

Secrets necessarias no GitHub:

- `API_FOOTBALL_KEY`
- `FIREBASE_SERVICE_ACCOUNT_COPA2026_C344C`

Observacoes importantes:

- o sincronizador atualiza somente placares finais em `results/{matchId}`
- ele nao grava placar parcial ao vivo, para nao distorcer o ranking durante a partida
- para testar a logica localmente sem chamar API, rode:

```text
node .github/scripts/sync-live-results.mjs --dry-run
```
