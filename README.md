# EletroLab Studio — protótipo 0.11.0

**Licença:** MIT. Consulte o arquivo `LICENSE` para os termos completos.

Aplicação desktop para Windows baseada em Electron, feita para **estudar comandos elétricos e programação de CLP (Ladder)**. Funciona localmente, sem internet depois de instalada.

## Numeração de fios e referências cruzadas (novidade da 0.11.0)
- Botão **Nº fios** na barra do diagrama: cada rede elétrica (equipotencial) recebe um número, da esquerda para a direita. As redes dos trilhos +24V e 0V ficam sem número, pois já têm nome. Os números também saem na folha exportada (PNG/PDF).
- **Referências cruzadas:** a bobina mostra em qual seção ficam os seus contatos (`→ Bomba`); cada contato mostra a seção da bobina (`← Comando K1`). Um contato sem bobina correspondente mostra `⚠ sem bobina`.
- Limitações: a numeração é automática e recalculada a cada edição (não dá para fixar números manualmente) e as referências usam o nome da seção, não coordenadas de folha.

## Contadores no Ladder (0.10.0)
- **CTU (contador crescente):** conta **uma vez a cada subida** do degrau (nível alto contínuo não conta de novo). O valor programado é a contagem; expõe `C1.ACC` (contagem) e `C1.DN` (verdadeiro quando ACC ≥ programado).
- **CTR (zera contador):** quando o degrau é verdadeiro, zera o contador cujo nome está na tag (ex.: C1).
- Exemplo **Contagem de peças (CTU)** no menu Exemplos…: S1 liga a esteira, clique no sensor B3 para "passar uma peça" (conta quando B3 fecha), 5 peças completam o lote, a esteira para e H1 acende; S1 zera e inicia outro lote.
- Limitações: não há CTD (contagem regressiva) nem comparadores ainda; o contador reinicia ao parar a simulação.

## Exemplo "Motor com proteção" (0.9.1)
No menu **Exemplos…** escolha **Motor com proteção (E0, F1)**. S0 (NF), S1 (NA), o relé térmico F1 (NF) e a emergência E0 (NF) são entradas do CLP; a saída Q0.0 comanda o contator K1, cujo contato alimenta o motor; Q0.1 acende o sinaleiro H1 de falha.
- Segure S1 para partir (selo). Clique em **F1** ou **E0** na simulação para simular a falha: o motor para e H1 acende, e a falha fica memorizada.
- Rearmar F1/E0 **não religa** o motor sozinho (segurança). Aperte S1 uma vez para reconhecer a falha e outra vez para partir de novo.

## Proteção, sensores e folha de desenho (0.9.0)
- **Novos componentes** (grupo "Proteção e sensores"): botão de **emergência** (NF, com trava), **relé térmico** (contato NF 95-96) e **sensor indutivo** (NA). Na simulação, um clique alterna o estado (trava); **Parar** rearma tudo.
- **Exportar folha** (menu **Folha…** no topo): gera PNG ou PDF em A3 paisagem com o diagrama, a **lista de materiais** (agrupada por tipo, com quantidades e identificações) e o **carimbo** (título, autor, data, revisão). Título, autor e revisão ficam na seção **Folha de desenho** da lateral direita e são salvos no JSON.
- Limitações: a folha é de página única (o diagrama é ajustado à área), o diagrama sai com o fundo escuro do app, e a numeração de bornes segue a dos próprios componentes (ainda não há numeração automática de fios nem referências cruzadas).

## Planta didática do tanque (0.8.0)
No menu **Exemplos…** escolha **Tanque (planta didática)**. O CLP controla uma bomba, uma válvula de dreno e dois sensores de nível, com alarme temporizado.
- **Aba Planta**: tanque animado (água, vazão, sensores B1/B2) e painel do operador com sinaleiro e botoeira clicável (segure o botão do mouse sobre S1, S0 ou S2).
- **Cartão Planta** na lateral direita: mini tanque e três parâmetros (nível inicial, vazão da bomba e do dreno em %/s). Clique no cartão para abrir a aba.
- **Novos componentes**: Sensor de nível (contato NA que fecha quando o nível ≥ valor), Bomba e Válvula de dreno (cargas de 24 V, ligam com 12 V ou mais).
- **Lógica do exemplo**: S1 liga com selo; B1 (20%) religa e B2 (80%) desliga a bomba; S2 drena manualmente; se a bomba ficar ligada 6 s sem o nível chegar a B1, o alarme H1 acende e bloqueia a bomba até S1 reconhecer.
- O modelo é simples (nível em %, vazões constantes) e serve para estudo de lógica, não de hidráulica real.

## Visualização (desde a 0.7.0)
O diagrama deixou de ser um conjunto de blocos soltos e passou a seguir a lógica de um painel real:

- **Trilhos de alimentação:** `+24V` (laranja) e `0V` (azul) horizontais. Qualquer componente ligado a um trilho fica conectado a ele sem fio extra.
- **Seções:** caixas tracejadas rotuladas (Fonte, Entradas, CLP, Comando K1, Potência K1, Sinaleiro H1). Arrastar pelo título move a seção com os componentes.
- **Bloco do CLP:** CPU com entradas (`%I`) e saídas (`%Q`) à vista, estado RUN/STOP e temporizador. Os módulos de entrada e saída ligam ao bloco por linhas tracejadas de **sinal lógico**.
- **Acoplamento do relé:** linha tracejada amarela entre a bobina K1 e o contato K1.
- **Vistas:** **Circuito** (só o diagrama), **Dividido** (diagrama em cima e Ladder embaixo, com a barra central ajustável) e **Ladder** (só os degraus).
- Legenda, zoom (+/−), **Ajustar** (enquadrar) e **Foco** (oculta os painéis laterais; tecla `F`).
- Durante a simulação, fios e trilhos energizados mudam de cor, e as tensões aparecem junto aos componentes.

Atalhos: `W` conectar fios, `V` selecionar/mover, `R` girar, `Delete` excluir, `F` foco, `Esc` cancelar.

## Como o simulador é organizado
| Camada | Arquivo | O que faz |
|---|---|---|
| Elétrica (físico) | `js/solver.js` | Solver CC (análise nodal): fontes, trilhos, botões, relés, lâmpadas, motor (carga resistiva), módulos de E/S do CLP |
| CLP (lógico) | `js/plc.js` | Motor Ladder **booleano**: degraus, contatos NA/NF, bobina, Set/Reset, temporizadores TON/TOF |
| Integração | `js/engine.js` | Ciclo de varredura: **lê entradas físicas → executa o Ladder → escreve saídas físicas**; exemplo e importação/exportação |
| Geometria e desenho | `js/geometry.js`, `js/render.js` | Posição de pinos e trilhos, hit-test, desenho do diagrama |
| Interface | `index.html`, `js/app.js`, `js/ladder-ui.js` | Editor, propriedades, abas e editor de degraus |

## O que funciona nesta versão
- Editor de circuitos com grade, mover, girar, conectar fios, trilhos e seções.
- Propriedades editáveis: nome, valor (V ou Ω), tag de E/S e bobina associada aos contatos de relé.
- Componentes: fonte CC, terra, trilhos +24V/0V, botões NA/NF, bobina e contatos de relé, sinaleiro, motor (carga), bloco do CLP e módulos de entrada e saída.
- Editor Ladder: contatos em série (E) e paralelo (OU); saídas Bobina, Set, Reset, TON e TOF; destaque do fluxo de energia na simulação.
- Tags `%I0.0`, `%Q0.0`, `%M0.0` ou nomes livres; temporizadores expõem `NOME.DN` e `NOME.ACC`. A memória aparece no painel lateral.
- Exemplo: partida com selo (S1/S0), `%Q0.0` energiza K1, o contato K1 liga o motor, e um TON de 3 s acende H1 (`%Q0.1`).
- Exportar/abrir projeto em JSON (circuito, trilhos, seções e programa Ladder). Projetos antigos abrem com aviso quando precisam de ajuste.
- Erros do simulador (curto-circuito, falta de fonte) aparecem em vermelho na barra de status, e a simulação para.

## Convenções de ligação
- **Fonte CC:** pino esquerdo = negativo (−), direito = positivo (+).
- **Módulo de entrada:** terminal `I` = sinal (+24 V), `0V` = comum. Nível alto a partir de 12 V.
- **Módulo de saída:** `L+` = alimentação do módulo, `Q` = saída (24 V quando a tag está verdadeira; alta impedância quando falsa).
- Todos os terminais de terra e todos os trilhos `0V` formam a mesma referência elétrica.
- Botões: durante a simulação, mantenha o botão do mouse pressionado sobre o botão desenhado.

## Limitações importantes
- Prova de conceito didática, **não** um simulador validado para projetos profissionais. Não use os resultados para dimensionamento, comissionamento ou intervenção em instalações reais.
- Apenas corrente contínua. Relés e contatos são ideais (sem tempo de comutação nem histerese).
- Motor, sinaleiro e bobina são cargas resistivas; não há capacitores, diodos, CA ou instalações prediais.
- Falta: contadores (CTU/CTD), comparações e aritmética no Ladder, ramos paralelos além de colunas empilhadas, GRAFCET.

## Executar no Windows (modo desenvolvedor)
1. Instale Node.js LTS a partir de https://nodejs.org/.
2. Abra o Prompt de Comando/PowerShell na pasta do projeto.
3. Execute:
   ```powershell
   npm install
   npm start
   ```

## Testes automáticos (sem interface)
```powershell
npm test
```
Cobrem solver, geometria (pinos, trilhos), motor Ladder, o exemplo completo e a importação/exportação.

## Gerar instalador .exe
```powershell
npm run dist
```
O instalador sai na pasta `dist`. A primeira geração precisa de internet para baixar as dependências.

## Testes manuais
1. Abra o programa e clique em **▶ Simular**: `%I0.0` (S0, NF) fica TRUE no painel de tags.
2. Mantenha o mouse pressionado sobre **S1 Liga**: `%Q0.0` vira TRUE, K1 energiza e o motor mostra 24 V.
3. Solte S1: o motor continua ligado (selo). Após 3 s, H1 acende.
4. Pressione **S0 Desliga**: tudo desliga.
5. Na vista **Dividido**, acompanhe o fluxo de energia nos degraus enquanto o diagrama anima.
6. Exporte o JSON, clique em **Novo** e abra o arquivo exportado.

## Próximas etapas técnicas
1. Contadores, comparadores e blocos de função no Ladder.
2. Planta didática (esteira, tanque com sensores de nível) ligada às E/S do CLP.
3. GRAFCET/SFC e diagramas de comando por seções.
4. Análise transiente e componentes reativos; CA RMS/pico.
