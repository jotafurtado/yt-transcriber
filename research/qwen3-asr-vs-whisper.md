# Comparativo: Qwen3-ASR e Whisper

## Conclusão

O Qwen3-ASR-1.7B parece superior ao Whisper large-v3 em vários benchmarks públicos e internos publicados pelo próprio time Qwen, especialmente em fala ruidosa, dialetos chineses e alguns conjuntos de fala espontânea. Isso não prova uma vitória universal: o Whisper large-v3 vence em alguns conjuntos, e os números não representam necessariamente o desempenho em um Mac M3.

Para este projeto, a decisão depende mais do requisito de implantação:

- **Maior qualidade local e aceitação de um serviço local em Python/vLLM:** testar Qwen3-ASR-1.7B.
- **TypeScript puro, instalação simples e execução nativa no Apple Silicon:** usar Whisper via `whisper.cpp` continua sendo a opção mais prática.

## Evidências de reconhecimento

O README oficial do Qwen3-ASR informa que a avaliação foi executada com `vLLM`, `bfloat16`, busca gulosa e sem informar o idioma ao modelo. A tabela compara Qwen3-ASR com Whisper-large-v3, entre outros sistemas.

Alguns resultados públicos de WER (menor é melhor):

| Conjunto | Whisper-large-v3 | Qwen3-ASR-0.6B | Qwen3-ASR-1.7B | Resultado |
| --- | ---: | ---: | ---: | --- |
| LibriSpeech clean | 1,51 | 2,11 | 1,63 | Whisper vence |
| LibriSpeech other | 3,97 | 4,55 | 3,38 | Qwen 1.7B vence |
| GigaSpeech | 9,76 | 8,88 | 8,45 | Qwen vence |
| CommonVoice en | 9,90 | 9,92 | 7,39 | Qwen 1.7B vence |
| Fleurs-en | 4,08 | 4,39 | 3,35 | Qwen 1.7B vence |
| MLS-en | 4,87 | 6,00 | 4,58 | Whisper vence |
| WenetSpeech meeting | 19,11 | 6,88 | 5,88 | Qwen vence |
| Fleurs-zh | 4,09 | 2,88 | 2,41 | Qwen vence |

A tabela multilíngue oficial também mostra vantagem média do Qwen3-ASR-1.7B em alguns agrupamentos, mas há exceções. Em Fleurs<sup>††</sup>, por exemplo, o Whisper-large-v3 aparece com WER 8,16 contra 12,60 do Qwen3-ASR-1.7B.

Esses números são uma comparação publicada pelo Qwen. O relatório diz que os resultados do Whisper foram obtidos pelo próprio time Qwen, porque não havia números publicados para todos os conjuntos. Não encontrei, nas fontes primárias consultadas, um benchmark independente e controlado especificamente em Mac M3 comparando os dois modelos.

## Idiomas e português

O Qwen3-ASR-0.6B e o Qwen3-ASR-1.7B declaram suporte a 30 idiomas e 22 dialetos chineses, incluindo português. O conjunto multilíngue do relatório inclui português em MLS, CommonVoice, MLC-SLM e Fleurs.

O Whisper também é multilíngue e suporta transcrição em diversos idiomas. O repositório oficial alerta que o desempenho varia bastante por idioma.

A conclusão segura é que ambos suportam português; os benchmarks publicados não são suficientes para afirmar que o Qwen sempre será melhor em português brasileiro de vídeos do YouTube. Isso precisa ser medido com um corpus representativo do projeto.

## Timestamps

O Whisper produz segmentos com timestamps e tem implementações que também expõem timestamps mais granulares.

O Qwen separa essa responsabilidade em um modelo adicional: `Qwen3-ForcedAligner-0.6B`. A documentação declara suporte a alinhamento de palavras, caracteres, frases ou parágrafos, em 11 idiomas incluindo português, para trechos de até 300 segundos.

Isso pode produzir timestamps mais controláveis, mas adiciona outro modelo e outra etapa ao pipeline. Para vídeos longos, seria necessário dividir o áudio em janelas compatíveis com o alinhador.

## Streaming e duração

O Qwen3-ASR declara inferência offline e streaming com o mesmo modelo, e suporte a fala de até 20 minutos por entrada única.

O Whisper original processa o arquivo em janelas deslizantes de 30 segundos. Implementações como `whisper.cpp` fornecem modos e exemplos para uso contínuo, mas a arquitetura original não é um modelo de streaming nativo no mesmo sentido do Qwen.

## Desempenho e implantação

Os números de velocidade do Qwen no relatório foram medidos com `vLLM`, CUDA Graph e `bfloat16`, em recursos de computação voltados para GPU. O relatório cita RTF de até 0,064 para o Qwen3-ASR-0.6B em um cenário de alta concorrência, mas esse número não deve ser transferido diretamente para um Mac M3.

O Qwen3-ASR oficial é distribuído principalmente como pacote Python com backends Transformers e vLLM. O repositório consultado não oferece um runtime TypeScript ou uma implementação nativa C/C++ equivalente ao `whisper.cpp`.

O `whisper.cpp` é uma implementação C/C++ sem dependências Python, tem suporte explícito a Apple Silicon, Metal, Core ML, CPU e quantização. Isso o torna mais simples de orquestrar pelo CLI TypeScript atual por meio de `child_process`.

## Diarização

Nenhum dos dois modelos base é, por si só, uma solução completa de diarização. Eles transcrevem fala; identificar qual pessoa falou cada trecho exige uma etapa adicional de diarização ou um modelo especializado.

## Licença

- Qwen3-ASR: Apache 2.0.
- Whisper: MIT.
- whisper.cpp: MIT.

## Recomendação para o projeto

A recomendação é não decidir apenas por benchmark publicado. O teste correto seria separar 5–10 trechos representativos dos vídeos reais, com:

- português brasileiro;
- música ou ruído de fundo;
- nomes próprios e termos técnicos;
- fala rápida;
- múltiplos participantes;
- trechos longos.

Medir WER/CER quando houver transcrição de referência, além de tempo total, uso de memória, qualidade dos timestamps e facilidade de instalação no Mac M3.

Minha hipótese inicial é:

1. **Qwen3-ASR-1.7B** pode entregar texto melhor em áudio difícil e multilíngue.
2. **Whisper.cpp com Whisper large-v3-turbo** terá integração e operação local mais simples.
3. Para um projeto que precisa continuar 100% TypeScript, Whisper.cpp é o caminho de menor risco; para priorizar qualidade e aceitar um processo local Python separado, Qwen3-ASR merece o A/B test.

## Fontes primárias

- Qwen3-ASR, repositório oficial: https://github.com/QwenLM/Qwen3-ASR
- Qwen3-ASR Technical Report: https://arxiv.org/abs/2601.21337
- Whisper, repositório oficial da OpenAI: https://github.com/openai/whisper
- whisper.cpp, repositório oficial: https://github.com/ggml-org/whisper.cpp
