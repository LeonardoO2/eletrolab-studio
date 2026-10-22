# Publica uma versão no GitHub com UMA única release (sem rascunhos duplicados).
# Uso (PowerShell, na pasta do projeto):  .\publicar.ps1
# Requisitos: Node.js, GitHub CLI (winget install GitHub.cli) e "gh auth login" feito uma vez.
Set-Location $PSScriptRoot

$v = (Get-Content package.json -Raw | ConvertFrom-Json).version
$tag = "v$v"
Write-Host "Versão $v ($tag)" -ForegroundColor Cyan

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI não encontrado. Instale com: winget install GitHub.cli (depois feche e abra o PowerShell e rode: gh auth login)" }
cmd /c "gh auth status >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Faça o login antes: gh auth login" }

# já existe release com essa versão? (evita duplicar)
cmd /c "gh release view $tag >nul 2>&1"
if ($LASTEXITCODE -eq 0) { throw "A release $tag já existe no GitHub. Aumente a versão no package.json ou apague a release antiga." }

Write-Host "Rodando os testes..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Os testes falharam. Corrija antes de publicar." }

Write-Host "Gerando o instalador (pode demorar alguns minutos)..." -ForegroundColor Cyan
npm run dist
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador." }

$exe = "dist\EletroLab-Studio-Setup-$v.exe"
$files = @($exe, "$exe.blockmap", "dist\latest.yml")
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "Arquivo não encontrado: $f" } }

Write-Host "Criando a release $tag no GitHub..." -ForegroundColor Cyan
gh release create $tag @files --title $v --generate-notes
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar a release." }
Write-Host "Pronto! Release $tag publicada com $($files.Count) arquivos." -ForegroundColor Green
