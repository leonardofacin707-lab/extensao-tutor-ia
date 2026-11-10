# Tutor IA — extensão de estudos para o Opera

Extensão para o **Opera** (e outros navegadores Chromium, Manifest V3) que funciona como um **tutor**:
você seleciona ou detecta uma pergunta numa página (exercício, questionário, material de estudo) e a IA
**explica** o conceito, o raciocínio passo a passo e por que cada alternativa está certa ou errada.

Provedores de IA disponíveis (você escolhe nas Opções):

- **Google Gemini** (padrão): tem **plano grátis** pelo Google AI Studio.
- **Anthropic Claude**: pago por uso.

> **Sem fraude, por desenho.** A extensão só **lê** texto. Ela nunca preenche respostas, nunca clica em
> alternativas, nunca envia formulários e não tenta burlar plataformas de prova. Quem decide e responde
> é você. Há um teste automático (`tests/unit.test.mjs`) que falha se o código tentar clicar, marcar ou
> enviar algo na página. Use a ferramenta de acordo com as regras da sua instituição: se uma prova
> proíbe consulta, não consulte.

## O que ela faz

| Recurso | Como usar |
|---|---|
| **Explicar com IA** | Selecione a pergunta (com as alternativas) → botão direito → **Explicar com IA** |
| **Modo dica** | Botão direito → **Só uma dica (sem resposta)**. Depois: **Mais uma dica** (pistas progressivas) ou **Mostrar explicação completa** |
| **Detectar na página** | No painel, clique em **Detectar na página**: pega o texto selecionado ou, se não houver, a questão com alternativas (radio/checkbox) mais próxima do centro da tela |
| **Conferir meu raciocínio** | Escreva o que você acha e por quê. O tutor avalia o seu raciocínio como um professor |
| **Dúvidas de acompanhamento** | Campo "Tem outra dúvida sobre isso?" no fim do painel (a conversa mantém o contexto) |
| **Atalhos** | `Alt+Shift+E` explica a seleção · `Alt+Shift+D` dá uma dica · `Ctrl+Enter` na caixa de pergunta |

A explicação completa segue sempre a mesma estrutura: **O que a pergunta pede → Conceito-chave →
Raciocínio passo a passo → Análise das alternativas → Para fixar**.

## Instalação no Opera (sem empacotar)

1. Abra `opera://extensions` na barra de endereços.
2. Ative o **Modo de desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Escolha a pasta **`extensao-tutor-ia`** (a pasta que contém o `manifest.json`).
5. A página de **Opções** abre sozinha na primeira vez. Escolha o provedor (o padrão é o **Google Gemini**),
   cole a chave dele, clique em **Testar conexão** e depois em **Salvar**.
6. Opcional: fixe o ícone do Tutor IA na barra (ícone de cubo/extensões → alfinete).

### Página de teste

A extensão traz uma página com 5 questões de exemplo de ADS (`test.html`): lógica, redes, segurança e
Python, quatro objetivas e uma dissertativa. Para abri-la, entre nas **Opções** da extensão e clique em
**Abrir página de teste**. Lá você pode experimentar:

- selecionar uma questão, clicar com o botão direito e escolher **Explicar com IA** ou **Só uma dica**;
- abrir o painel e clicar em **Detectar na página** com uma questão no meio da tela;
- marcar alternativas e clicar em **Enviar respostas**. O contador no topo mostra que só você marcou
  e enviou algo, e o envio é só local, sem gabarito.

Funciona do mesmo jeito no Chrome, Edge, Brave e Opera GX (`chrome://extensions`, `edge://extensions` etc.).

Depois de editar algum arquivo ou atualizar a extensão, volte em `opera://extensions` e clique no botão de
**recarregar** do Tutor IA. As chaves e configurações salvas continuam lá.

### Onde o painel aparece

Ao clicar no ícone da extensão (ou usar o menu de contexto), o tutor abre no **painel lateral** do
navegador (API `sidePanel`, que o teste confirmou estar disponível no Opera GX). Se a sua versão do Opera não suportar painel lateral
de extensões, o tutor abre automaticamente numa **janela pequena** separada, com as mesmas funções.

## Chaves de API

Cada provedor tem a sua chave. As duas ficam guardadas separadas, e você pode trocar de provedor quando quiser.

### Google Gemini (grátis)

1. Entre em **https://aistudio.google.com/app/apikey** com a sua conta Google.
2. Clique em **Create API key** e copie a chave.
3. Nas **Opções** da extensão, escolha **Google Gemini**, cole a chave e clique em **Testar conexão** e
   depois em **Salvar**.

O modelo padrão é o `gemini-3.8-flash` (estável e gratuito). O campo **Modelo (opcional)** aceita outro nome,
por exemplo `gemini-3.5-flash-lite`, que é mais leve e rápido. Deixe vazio para usar o padrão.

> ⚠ **Privacidade no plano grátis:** no plano gratuito, o Google pode usar o conteúdo enviado (as
> perguntas e as respostas) para melhorar os produtos dele. Não cole dados pessoais, senhas ou
> informações sigilosas. Segundo a página de preços do Google, isso não acontece no plano pago do Gemini.

**Limites do plano grátis:** o Google limita as requisições por minuto e por dia (os números de cada
modelo aparecem no AI Studio). Se aparecer "Limite do plano gratuito do Gemini atingido", espere cerca de
1 minuto. O limite diário zera à meia-noite do horário do Pacífico, por volta das 4h–5h de Brasília. Trocar
para o `gemini-3.5-flash-lite` também pode ajudar.

### Anthropic Claude (pago)

1. Crie uma conta em **https://platform.claude.com**, adicione créditos e gere uma chave em **API Keys**
   (começa com `sk-ant-`).
2. Nas **Opções**, escolha **Anthropic Claude** e cole a chave.

Modelos: `claude-opus-5-5` (padrão, explica melhor), `claude-sonnet-5-5` (mais rápido e barato) ou
`claude-haiku-5-5` (o mais barato). O uso é cobrado na sua conta da Anthropic.

### Segurança das chaves

- As chaves ficam em `chrome.storage.local`: só neste navegador, sem sincronização.
- Cada chave só é enviada para o servidor do próprio provedor (`generativelanguage.googleapis.com` ou
  `api.anthropic.com`). Essas são as únicas permissões de site da extensão. A chave do Gemini vai no
  cabeçalho `x-goog-api-key`, nunca na URL.
- **Nenhuma chave está embutida no código.** Um teste automático verifica isso.
- O painel mostra o total de tokens usados na pergunta atual.

## Configurações (página de Opções)

- **Provedor:** Google Gemini (padrão) ou Anthropic Claude, cada um com a sua chave e o seu modelo.
- **Profundidade do raciocínio:** baixa, média (recomendada) ou alta. No Claude ela vira `effort`; no
  Gemini, `thinkingLevel` (LOW, MEDIUM ou HIGH).
- **Sobre você:** texto opcional, por exemplo "estudante de ADS, sei Python e C". O tutor adapta os exemplos.
- **Leitura das páginas:** por padrão a extensão só lê a aba quando você clica no ícone, usa o menu de
  contexto ou o atalho (permissão `activeTab`). Se quiser que **Detectar na página** funcione sempre, libere a
  leitura em todos os sites (permissão opcional, que você pode revogar no mesmo botão).

## Estrutura do projeto

```
extensao-tutor-ia/
├── manifest.json          # Manifest V3
├── background.js          # service worker: menu de contexto, atalhos, abre o painel, lê a aba
├── sidepanel/             # painel do tutor (HTML/CSS/JS)
├── options/               # página de opções (chave, modelo, perfil, permissões)
├── lib/
│   ├── provedores.js      # escolhe o provedor e converte o histórico da conversa
│   ├── gemini.js          # cliente da API Gemini (streamGenerateContent, SSE)
│   ├── anthropic.js       # cliente da API de Mensagens da Anthropic (SSE)
│   ├── prompts.js         # instruções do tutor (modo dica, explicação completa, avaliação)
│   ├── markdown.js        # renderizador de Markdown seguro (escapa todo HTML)
│   ├── detectar.js        # função que LÊ a pergunta na página (não altera nada)
│   └── config.js          # leitura e gravação das opções
├── test.html / test.js    # página de teste com 5 questões de exemplo
├── icons/                 # ícones gerados por tools/gerar-icones.mjs
└── tests/                 # testes unitários e ponta a ponta
```

### Detalhes técnicos

- **Gemini:** `POST https://generativelanguage.googleapis.com/v1beta/models/{modelo}:streamGenerateContent?alt=sse`,
  com `systemInstruction` (prompt do tutor), `contents` (histórico com papéis `user`/`model`) e
  `generationConfig.thinkingConfig.thinkingLevel`. As respostas do Gemini voltam ao histórico com a
  `thoughtSignature` preservada.
- **Trocar de provedor no meio da conversa** funciona. Cada provedor recebe os próprios turnos intactos e os
  turnos do outro provedor como texto simples.
- **Claude:** `POST https://api.anthropic.com/v1/messages` com `stream: true`, `anthropic-version: 2026-10-21`
  e `output_config.effort`. O cabeçalho `anthropic-dangerous-direct-browser-access` é obrigatório para
  chamar a API direto do navegador. Ele é seguro aqui porque a chave é sua e fica só no seu navegador.
- **HTTP direto em vez dos SDKs:** a extensão é carregada sem etapa de build. Os SDKs oficiais precisariam
  de um bundler, então `lib/gemini.js` e `lib/anthropic.js` implementam os contratos REST documentados,
  em arquivos pequenos.
- **Recusa por engano:** nos modelos Opus 5.5 e Sonnet 5.5 a requisição usa `fallbacks: "default"`
  (beta `server-side-fallback-2026-07-01`). Se o filtro de segurança recusar uma questão comum por engano,
  a API refaz a resposta em outro modelo. Se mesmo assim houver recusa, o painel avisa.
- **Conversa:** a resposta da IA volta para o histórico com todos os blocos intactos, inclusive os blocos
  de raciocínio com assinatura, como a API exige. Erros e respostas interrompidas não entram no histórico.
- **Segurança:** todo texto da IA ou da página passa por `escaparHtml` antes de virar HTML. A CSP da
  extensão só permite os scripts da própria extensão.

## Testes

Os testes precisam do Node.js 18 ou mais recente. Rode-os de dentro da pasta `extensao-tutor-ia`.

```bash
npm test
```

São 40 testes unitários, sem dependências. Eles cobrem:

- os clientes do Gemini e do Claude com `fetch` simulado: endpoint, cabeçalhos, chave fora da URL, leitura do stream e preservação da assinatura do raciocínio;
- a conversão do histórico entre os dois provedores;
- os erros em português (chave inválida, 429 do plano grátis, 403, 404, região, 503) e os bloqueios de segurança;
- o Markdown, incluindo proteção contra XSS, os prompts e o manifest;
- a garantia de que o código não interage com formulários nem embute chaves.

```bash
npm install
```

```bash
npm run test:e2e
```

O teste ponta a ponta carrega a extensão de verdade no **Opera GX** (via `puppeteer-core`) com a API
**simulada**, sem custo e sem precisar de chave. Ele cobre:

- as Opções: Gemini como padrão, testar conexão com o Gemini e com o Claude (inclusive com chave errada) e as duas chaves salvas separadas;
- a conversa no painel com o Gemini (dica 1 → dica 2 → 429 do plano grátis → bloqueio de segurança → explicação) e a troca de provedor no meio da conversa;
- com o Claude: salvar as opções, detecção de uma questão com alternativas numa página de teste (e confirma que nada foi
marcado), dica 1 → dica 2 → erro 429 → explicação completa, avaliação de raciocínio, dúvida de
acompanhamento, recusa do modelo, restauração da conversa ao recarregar o painel, fluxo do menu de
contexto e aviso de chave ausente. Para outro navegador, defina `BROWSER` com o caminho do executável
antes de rodar.

> Depois do `npm install`, a pasta `node_modules/` fica dentro da pasta da extensão. Ela não atrapalha,
> mas você pode apagá-la depois dos testes.

## Solução de problemas

| Problema | Solução |
|---|---|
| "Chave de API inválida" / "Chave do Gemini inválida" | Confira se o provedor certo está escolhido e se a chave foi colada sem espaços. Depois clique em **Testar conexão** |
| "Limite do plano gratuito do Gemini atingido" | Espere 1 minuto (limite por minuto) ou até as ~4h–5h de Brasília (limite diário), ou use o `gemini-3.5-flash-lite` |
| "A API gratuita do Gemini não está disponível para esta conta ou região" | Confira se a conta Google tem acesso ao AI Studio, ou use o Claude |
| "Problema de créditos/cobrança" | Adicione créditos na sua conta em platform.claude.com |
| "Sem permissão para ler esta aba" | Clique no ícone do Tutor IA com a aba da questão aberta, use o menu de contexto, ou libere a leitura nas Opções |
| "Detectar" não encontra nada | Selecione o texto da pergunta com o mouse e tente de novo (ou cole no painel) |
| Questão com imagem, tabela ou código como figura | A extensão lê só texto. Descreva ou digite a parte que está na imagem |
| Páginas `opera://` ou da loja de extensões | O navegador não deixa extensões lerem essas páginas |
| Atalhos não funcionam | Ajuste em `opera://extensions/shortcuts` (podem conflitar com outro programa) |
