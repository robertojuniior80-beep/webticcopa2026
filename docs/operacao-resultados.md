# Procedimento Rapido de Resultados

## Objetivo

Atualizar partidas encerradas com o menor custo e a menor manutencao possivel.

## Procedimento padrao

1. Voce envia a partida ou o ID
2. Eu confiro o placar final, quando necessario
3. Eu gravo em `results/{matchId}`
4. Eu confirmo para voce que o backend foi atualizado

## Mensagens prontas

```text
atualize A1 para 2 x 0
```

```text
grave no firestore B2 com 1 x 1
```

```text
partida encerrada: Brazil 3 x 1 Morocco
```

```text
atualize o resultado de Canada x Qatar
```

## Melhor padrao

O formato mais rapido e:

```text
atualize [ID] para [placar]
```

Exemplo:

```text
atualize A1 para 2 x 0
```

## Quando usar nome dos times

Use nome dos times quando:

- nao souber o ID
- quiser que eu confirme a partida
- houver mais de uma partida no mesmo dia e voce quiser evitar erro

## Resultado esperado

Depois da gravacao:

- a partida aparece como finalizada
- o ranking e recalculado
- os pontos dos participantes sao atualizados
