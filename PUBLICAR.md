# Publicar e atualizar o EletroLab Studio

Repositório: https://github.com/LeonardoO2/eletrolab-studio (público)

## Forma recomendada: script `publicar.ps1` (uma única release)
O `npm run release` pode criar rascunhos duplicados (o electron-builder envia os arquivos em paralelo). O script abaixo evita isso: gera o instalador e deixa o GitHub CLI criar **uma** release com os três arquivos (`.exe`, `.blockmap`, `latest.yml`). Não precisa de `GH_TOKEN`.

Uma vez:
```
winget install GitHub.cli
gh auth login
```
(feche e abra o PowerShell depois de instalar). A cada versão: suba o `"version"` no `package.json` e rode
```
.\publicar.ps1
```
O script roda os testes, gera o instalador, confere os arquivos e publica a release já pública. Se a release dessa versão já existir, ele para em vez de duplicar.

## 1) Primeiro envio do código (uma vez)
No PowerShell, dentro da pasta do projeto:

```
git init
git add .
git commit -m "EletroLab Studio v0.11.0"
git branch -M main
git remote add origin https://github.com/LeonardoO2/eletrolab-studio.git
git push -u origin main
```
(O GitHub pode pedir login no navegador na primeira vez.)

## 2) Criar o token para publicar releases (uma vez)
GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token.
Marque o escopo **repo** e copie o token. **Nunca coloque o token em arquivo do projeto nem envie ao GitHub.**

## 3) Alternativa: publicar com `npm run release` (pode duplicar rascunhos)
1. Rode `npm test` (tudo deve passar).
2. Aumente `"version"` no `package.json` (ex.: 0.11.0 → 0.12.0). Sem isso o programa instalado não enxerga a novidade. A janela do programa lê a versão daí; opcionalmente atualize também `VERSION` em `js/engine.js`, que só é gravada nos arquivos de projeto salvos.
3. No PowerShell:
```
npm install
$env:GH_TOKEN="cole_o_token_aqui"
npm run release
```
4. O electron-builder cria uma release **rascunho** no GitHub com o instalador (`EletroLab-Studio-Setup-X.Y.Z.exe`) e o `latest.yml`.
   Abra Releases no GitHub, revise e clique em **Publish release**. Só releases publicadas são vistas pelo programa.
5. Opcional: `git add . && git commit -m "v0.12.0" && git push` para guardar o código dessa versão.

## 4) Como o usuário recebe
- Primeira instalação: baixar o `.exe` da release e executar.
- Depois: ao abrir o programa instalado, ele consulta o GitHub, baixa a versão nova e pergunta se quer reiniciar.
- A atualização automática só funciona no programa **instalado** pelo `.exe` (não em `npm start`).
- Para conferir: menu **Ajuda → Verificar atualizações…** mostra o resultado, e **Ajuda → Abrir registro de atualização** abre o `update.log` com os detalhes.
- Teste de ponta a ponta: instale a versão N, publique a N+1 e abra o programa instalado (N); ele baixa e pergunta se quer reiniciar.

## Observações
- Sem assinatura de código o Windows mostra o aviso do SmartScreen na instalação ("Mais informações → Executar assim mesmo").
- Para testar só o instalador, sem publicar: `npm run dist` (gera na pasta `dist`).
- Os projetos salvos em JSON continuam abrindo nas versões novas.
