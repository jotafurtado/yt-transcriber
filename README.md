<p align="center">
  <img src="./assets/logo.png" alt="yt-transcriber" width="220" />
</p>

<!--<h1 align="center">yt-transcriber</h1>-->

<p align="center">
  <strong>Qualquer vídeo do YouTube, em texto, em minutos.</strong><br />
  Timestamps automáticos, identificação de quem está falando, direto do terminal.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20" />
  <img src="https://img.shields.io/badge/TypeScript-5%2B-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/UI-Ink%20TUI-8A2BE2" alt="Ink TUI" />
  <img src="https://img.shields.io/badge/motores-Gemini%20%7C%20Whisper-orange" alt="Gemini ou Whisper" />
</p>

## O que é

**yt-transcriber** é uma CLI interativa que transforma qualquer vídeo do YouTube em uma transcrição limpa e organizada — com timestamps, pontuação corrigida e identificação de falantes — sem sair do terminal.

Cole um link, escolha o motor de transcrição e pronto: o áudio é extraído, processado e salvo como `.txt` na sua pasta de saída. Sem depender de serviços web de terceiros, sem copiar e colar em ferramentas online.

## Por que usar

- **Dois motores, uma interface.** Use **Gemini** (nuvem, streaming em tempo real, ótimo para a maioria dos casos) ou **Whisper.cpp** (100% local, sem enviar áudio para lugar nenhum).
- **Timestamps e diarização de graça.** Cada transcrição já sai com marcações `[MM:SS]` e identificação de speakers quando há mais de uma pessoa falando.
- **TUI de verdade, não só um spinner.** Interface construída com Ink mostra cada etapa do processo — download, upload, transcrição — em tempo real.
- **Zero fricção de setup.** O binário do `yt-dlp` é baixado automaticamente na instalação; não é preciso instalar Python nem configurar nada à parte.
- **Funciona com ou sem flags.** Rode `./yt-transcriber` e responda às perguntas, ou passe tudo via linha de comando para uso em scripts.

## Os dois motores

| | **Gemini** | **Whisper** |
|---|---|---|
| Onde roda | Nuvem (`@google/genai`) | 100% local (`whisper-cli`) |
| Requer | `GEMINI_API_KEY` | Modelo baixado em `~/.cache/whisper.cpp/` |
| Resultado | Texto chega em streaming, em tempo real | Processado em lote |
| Ideal para | Rapidez e qualidade sem instalar nada pesado | Privacidade, uso offline, sem custo de API |

## Instalação

```bash
git clone <url-do-repositorio>
cd yt-transcriber
npm install        # também baixa o binário do yt-dlp automaticamente
npm run build
```

Configure sua chave do Gemini (necessária apenas se for usar esse motor):

```bash
echo "GEMINI_API_KEY=sua_chave_aqui" > .env
```

Se quiser usar o Whisper, instale o `whisper-cli`:

```bash
brew install whisper-cpp
```

A CLI verifica automaticamente se o modelo do Whisper existe e oferece para baixar caso não esteja presente.

## Uso

### Modo interativo (recomendado)

```bash
./yt-transcriber
```

A CLI pede o link do vídeo, deixa você escolher o motor, configurar as opções e acompanhar o progresso em tempo real, etapa por etapa.

### Modo direto

```bash
./yt-transcriber "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Totalmente não interativo (ideal para scripts)

```bash
# Gemini
./yt-transcriber --engine gemini "https://www.youtube.com/watch?v=VIDEO_ID"

# Whisper
./yt-transcriber --engine whisper --model large-v3-turbo-q5_0 --language pt "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Opções

```text
  -e, --engine <gemini|whisper>   Motor de transcrição
  -m, --model <model>             Modelo (Gemini: gemini-3.5-flash | Whisper: large-v3-turbo-q5_0)
  -l, --language <lang>           Idioma do áudio para o Whisper (auto, pt, en, es, ...)
  -o, --output-dir <dir>          Pasta de saída (padrão: output)
      --keep-audio                Mantém o arquivo de áudio baixado
  -h, --help                      Mostra a ajuda
```

Qualquer opção passada via flag pula a pergunta correspondente na interface — dá para misturar flags e prompts como preferir.

## Como funciona por baixo dos panos

```
[Link do YouTube]
       │
       ▼
 1. Extração de áudio (yt-dlp)        ──► Arquivo M4A/WebM temporário
       │
       ▼
 2. Upload / processamento local       ──► Gemini Files API ou conversão para WAV (Whisper)
       │
       ▼
 3. Transcrição inteligente            ──► Gemini 3.5 Flash ou Whisper.cpp, com timestamps e speakers
       │
       ▼
 4. Finalização                        ──► Salvo em output/, arquivos temporários limpos
```

Mais detalhes técnicos da arquitetura estão em [`AGENTS.md`](./AGENTS.md).

## Requisitos

- Node.js 20+
- `ffmpeg` no PATH (necessário apenas para o motor Whisper)
- `whisper-cli` via `brew install whisper-cpp` (necessário apenas para o motor Whisper)

## Créditos

Construído sobre [yt-dlp](https://github.com/yt-dlp/yt-dlp), [whisper.cpp](https://github.com/ggerganov/whisper.cpp), a [API do Gemini](https://ai.google.dev/) e [Ink](https://github.com/vadimdemedes/ink).
