// Teste ponta a ponta: carrega a extensão de verdade num Chromium e simula a API
// (nenhuma chamada real é feita, nenhum custo). Rode: npm install && npm run test:e2e
// Usa o Opera GX instalado; para outro Chromium: BROWSER=<caminho do .exe>.
import puppeteer from "puppeteer-core";
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import http from "node:http";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const ORIGEM = join(aqui, "..");
const COPIA = join(tmpdir(), "tutor-ia-ext-teste");
const SHOTS = join(tmpdir(), "tutor-ia-capturas");
const EXE = process.env.BROWSER || join(process.env.LOCALAPPDATA || "", "Programs/Opera GX/opera.exe");

rmSync(COPIA, { recursive: true, force: true });
cpSync(ORIGEM, COPIA, { recursive: true, filter: (s) => !/[\\/](tests|node_modules|tools)([\\/]|$)/.test(s.slice(ORIGEM.length)) });
mkdirSync(SHOTS, { recursive: true });
// Só na cópia de teste: permissão para o servidor local (simula o "activeTab" do clique do usuário).
const man = JSON.parse(readFileSync(join(COPIA, "manifest.json"), "utf8"));
man.host_permissions.push("http://127.0.0.1/*");
writeFileSync(join(COPIA, "manifest.json"), JSON.stringify(man, null, 2));

// Página de questionário de teste
const QUIZ = `<!doctype html><html><head><meta charset="utf-8"><title>Quiz de Estruturas de Dados</title></head><body>
<h1>Avaliação</h1><div style="height:200px"></div>
<div class="questao"><p><b>Questão 3.</b> Qual estrutura de dados segue o princípio LIFO?</p>
<form id="f"><label><input type="radio" name="q3" value="a"> a) Fila</label><br>
<label><input type="radio" name="q3" value="b"> b) Pilha</label><br>
<label><input type="radio" name="q3" value="c"> c) Árvore binária</label><br>
<label><input type="radio" name="q3" value="d"> d) Lista duplamente encadeada</label></form></div>
<button id="enviar" onclick="document.title='ENVIADO'">Enviar respostas</button></body></html>`;
const srv = http.createServer((_q, r) => r.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(QUIZ));
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const URL_QUIZ = `http://127.0.0.1:${srv.address().port}/quiz`;

const sse = (ev, d) => `event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`;
const GOOGLE = "https://generativelanguage.googleapis.com/v1beta/models/";
function respostaGemini(texto, { sig = "GSIG-" + Math.random().toString(36).slice(2), finish = "STOP" } = {}) {
  const pedacos = texto.match(/.{1,25}/gs) || [];
  const d = (o) => `data: ${JSON.stringify(o)}\r\n\r\n`;
  return [
    ...pedacos.map((t) => d({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] })),
    d({
      candidates: [{ content: { role: "model", parts: [{ text: "", thoughtSignature: sig }] }, finishReason: finish }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 60, thoughtsTokenCount: 40 },
      modelVersion: "gemini-3.8-flash",
    }),
  ].join("");
}
function respostaSSE(texto, { stop = "end_turn", sig = "assinatura-" + Math.random().toString(36).slice(2) } = {}) {
  const pedacos = texto.match(/.{1,25}/gs) || [];
  return [
    sse("message_start", { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 300, output_tokens: 1 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: sig } }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
    ...pedacos.map((t) => sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } })),
    sse("content_block_stop", { type: "content_block_stop", index: 1 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 120 } }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

const falhas = [];
const ok = (cond, msg) => {
  console.log((cond ? "  ✔ " : "  ✖ ") + msg);
  if (!cond) falhas.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: EXE,
  headless: process.env.HEADFUL ? false : true,
  pipe: true,
  enableExtensions: [COPIA],
  args: ["--no-first-run", "--no-default-browser-check"],
  defaultViewport: { width: 420, height: 900 },
});

try {
  // ---------- Service worker ----------
  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  console.log("Extensão carregada:", extId);
  ok(!!extId, "service worker registrado");
  const temSidePanel = await sw.evaluate(() => typeof chrome.sidePanel?.open === "function");
  console.log("  chrome.sidePanel disponível:", temSidePanel);

  // A instalação abre a página de opções (sem chave). Espera e fecha a aba extra.
  await new Promise((r) => setTimeout(r, 800));

  // ---------- Opções ----------
  console.log("\n[Opções]");
  const op = await browser.newPage();
  await op.setRequestInterception(true);
  let corpoTeste = null;
  let pedidoGemini = null;
  op.on("request", (req) => {
    if (req.url().startsWith(GOOGLE)) {
      pedidoGemini = { url: req.url(), headers: req.headers(), body: JSON.parse(req.postData()) };
      if (req.headers()["x-goog-api-key"] === "chave-gemini-errada") {
        return req.respond({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }) });
      }
      return req.respond({ status: 200, contentType: "text/event-stream", body: respostaGemini("Conexão funcionando.") });
    }
    if (req.url().startsWith("https://api.anthropic.com/")) {
      corpoTeste = { headers: req.headers(), body: JSON.parse(req.postData()) };
      const auth = req.headers()["x-api-key"];
      if (auth === "sk-ant-chave-errada") {
        return req.respond({ status: 401, contentType: "application/json", body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
      }
      return req.respond({ status: 200, contentType: "text/event-stream", body: respostaSSE("Conexão funcionando.") });
    }
    req.continue();
  });
  await op.goto(`chrome-extension://${extId}/options/options.html`);
  await op.waitForSelector("#modelo option");
  const visivel = (sel) => op.$eval(sel, (e) => getComputedStyle(e).display !== "none");

  // Gemini é o padrão
  ok((await op.$eval("#provedor", (e) => e.value)) === "gemini", "provedor padrão é o Google Gemini");
  ok((await visivel("section[data-provedor=gemini]")) && !(await visivel("section[data-provedor=anthropic]")), "só a seção do Gemini aparece");
  ok(/aistudio\.google\.com\/app\/apikey/.test(await op.$eval("section[data-provedor=gemini]", (e) => e.innerHTML)) && /melhorar/.test(await op.$eval("section[data-provedor=gemini]", (e) => e.textContent)), "link do AI Studio e aviso de uso de dados no plano grátis");
  await op.type("#geminiKey", "chave-gemini-errada");
  await op.click("#btn-testar");
  await op.waitForFunction(() => document.querySelector("#mensagem").textContent.startsWith("✖"));
  ok(/Chave do Gemini inválida/.test(await op.$eval("#mensagem", (e) => e.textContent)), "Gemini: chave errada mostra erro em português");
  await op.$eval("#geminiKey", (e) => (e.value = ""));
  await op.type("#geminiKey", "chave-gemini-e2e");
  await op.click("#btn-testar");
  await op.waitForFunction(() => document.querySelector("#mensagem").textContent.startsWith("✔"));
  ok(true, "Gemini: testar conexão com chave válida: " + (await op.$eval("#mensagem", (e) => e.textContent)));
  ok(
    pedidoGemini.url === `${GOOGLE}gemini-3.8-flash:streamGenerateContent?alt=sse` && !pedidoGemini.url.includes("chave-gemini") && pedidoGemini.headers["x-goog-api-key"] === "chave-gemini-e2e",
    "Gemini: endpoint streamGenerateContent, modelo padrão gemini-3.8-flash, chave só no cabeçalho"
  );
  ok(pedidoGemini.body.systemInstruction?.parts?.[0]?.text && pedidoGemini.body.contents[0].role === "user", "Gemini: systemInstruction + contents");

  // Troca para Claude
  await op.select("#provedor", "anthropic");
  ok(!(await visivel("section[data-provedor=gemini]")) && (await visivel("section[data-provedor=anthropic]")), "trocar o provedor mostra a seção do Claude");
  const nOpcoes = await op.$$eval("#modelo option", (o) => o.map((x) => x.value));
  ok(nOpcoes[0] === "claude-opus-5-5" && nOpcoes.length === 3, "lista de modelos (padrão Opus 5.5): " + nOpcoes.join(", "));
  await op.type("#apiKey", "sk-ant-chave-errada");
  await op.click("#btn-testar");
  await op.waitForFunction(() => document.querySelector("#mensagem").textContent.startsWith("✖"));
  ok(/Chave de API inválida/.test(await op.$eval("#mensagem", (e) => e.textContent)), "testar conexão com chave errada mostra erro em português");
  await op.$eval("#apiKey", (e) => (e.value = ""));
  await op.type("#apiKey", "sk-ant-teste-e2e");
  await op.type("#perfil", "estudante de ADS");
  await op.click("#btn-testar");
  await op.waitForFunction(() => document.querySelector("#mensagem").textContent.startsWith("✔"));
  ok(true, "testar conexão com chave válida: " + (await op.$eval("#mensagem", (e) => e.textContent)));
  ok(corpoTeste.headers["anthropic-version"] === "2026-10-21" && corpoTeste.body.model === "claude-opus-5-5", "requisição usa API 2026-10-21 e claude-opus-5-5");
  await op.click("button[type=submit]");
  await op.waitForFunction(() => document.querySelector("#mensagem").textContent.includes("Salvo"));
  const salvo = await sw.evaluate(() => chrome.storage.local.get(null));
  ok(salvo.apiKey === "sk-ant-teste-e2e" && salvo.perfil === "estudante de ADS", "chave e perfil salvos em storage.local");
  ok(salvo.geminiKey === "chave-gemini-e2e" && salvo.provedor === "anthropic", "as duas chaves ficam guardadas separadas");
  await op.screenshot({ path: join(SHOTS, "opcoes.png"), fullPage: true });
  await op.close();

  // ---------- Página de questionário ----------
  console.log("\n[Painel]");
  const quiz = await browser.newPage();
  await quiz.goto(URL_QUIZ);

  // Painel aberto numa janela separada (como o fallback de janela da extensão)
  const alvoPainel = browser.waitForTarget((t) => t.url().includes("/sidepanel/panel.html"));
  await sw.evaluate((u) => chrome.windows.create({ url: u, type: "popup", width: 420, height: 900, focused: false }), `chrome-extension://${extId}/sidepanel/panel.html`);
  const painel = await (await alvoPainel).page();
  await painel.setViewport({ width: 420, height: 900 });
  const erros = [];
  painel.on("pageerror", (e) => erros.push(String(e)));
  painel.on("console", (m) => m.type() === "error" && !/status of 429/.test(m.text()) && erros.push(m.text()));

  const requisicoes = [];
  const urls = [];
  let proximaResposta = null;
  await painel.setRequestInterception(true);
  painel.on("request", (req) => {
    if (!req.url().startsWith("https://api.anthropic.com/") && !req.url().startsWith(GOOGLE)) return req.continue();
    requisicoes.push(JSON.parse(req.postData()));
    urls.push(req.url());
    const r = proximaResposta || { status: 200, body: respostaSSE("Resposta padrão.") };
    proximaResposta = null;
    req.respond({ status: r.status, contentType: r.status === 200 ? "text/event-stream" : "application/json", body: r.body });
  });
  await painel.waitForSelector("#btn-detectar");
  ok(!(await painel.$eval("#aviso-chave", (e) => getComputedStyle(e).display !== "none")) && !(await painel.$eval("#status", (e) => getComputedStyle(e).display !== "none")) && !(await painel.$eval("#secao-seguir", (e) => getComputedStyle(e).display !== "none")), "aviso de chave escondido (chave configurada)");

  // Detectar: traz o questionário para frente para ser a aba ativa da janela normal
  await quiz.bringToFront();
  await painel.click("#btn-detectar");
  await painel.waitForFunction(() => document.querySelector("#origem").textContent.startsWith("✔") || document.querySelector(".erro"), { timeout: 8000 });
  const detectado = await painel.$eval("#pergunta", (e) => e.value);
  ok(/LIFO/.test(detectado) && /Pilha/.test(detectado) && /Fila/.test(detectado), "detectou enunciado + alternativas: " + JSON.stringify(detectado.slice(0, 90)));
  const marcou = await quiz.evaluate(() => [...document.querySelectorAll("input")].some((i) => i.checked) || document.title === "ENVIADO");
  ok(!marcou, "nada foi marcado nem enviado na página do questionário");

  // Dica 1
  proximaResposta = { status: 200, body: respostaSSE("## Dica 1\nPense em uma **pilha de pratos**: qual prato sai primeiro?\n\nQue estrutura funciona assim?", { sig: "SIG-1" }) };
  await painel.click("#btn-dica");
  await painel.waitForFunction(() => document.querySelectorAll(".turno-ia.dica").length === 1 && !document.querySelector(".cursor"));
  ok(requisicoes.length === 1, "1 requisição enviada");
  const r1 = requisicoes[0];
  ok(/NÃO revele a resposta/.test(r1.messages[0].content) && /LIFO/.test(r1.messages[0].content), "modo dica pede para não revelar e inclui a pergunta");
  ok(/estudante de ADS/.test(r1.system), "perfil do estudante vai no prompt do sistema");
  ok(r1.fallbacks === "default" && r1.output_config.effort === "medium" && r1.stream === true, "fallbacks:default, effort medium, streaming");
  ok(await painel.$eval(".turno-ia.dica", (e) => e.innerHTML.includes("<strong>pilha de pratos</strong>")), "markdown renderizado na resposta");
  ok(await painel.$eval("#acoes-dica", (e) => getComputedStyle(e).display !== "none"), "botões 'Mais uma dica' / 'Mostrar explicação' visíveis");

  // Dica 2: histórico deve conter o turno da IA com o bloco thinking intacto
  proximaResposta = { status: 200, body: respostaSSE("Dica 2: o último a entrar é o primeiro a sair. Qual alternativa descreve isso?", { sig: "SIG-2" }) };
  await painel.click("#btn-mais-dica");
  await painel.waitForFunction(() => document.querySelectorAll(".turno-ia.dica").length === 2 && !document.querySelector(".cursor"));
  const r2 = requisicoes[1];
  ok(r2.messages.length === 3 && r2.messages[1].role === "assistant", "dica 2 envia histórico (user, assistant, user)");
  ok(r2.messages[1].content[0].type === "thinking" && r2.messages[1].content[0].signature === "SIG-1", "bloco thinking devolvido intacto com assinatura");
  ok(/DICA 2/.test(r2.messages[2].content), "pedido da dica 2");

  // Erro da API (429) não estraga o histórico
  proximaResposta = { status: 429, body: JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }) };
  await painel.click("#btn-revelar");
  await painel.waitForSelector(".turno-ia.erro");
  ok(/Limite de uso/.test(await painel.$eval(".turno-ia.erro", (e) => e.textContent)), "erro 429 mostrado em português");
  ok(!(await painel.$eval("#btn-revelar", (e) => e.disabled)), "botões reabilitados após o erro");

  // Revelar explicação completa
  proximaResposta = {
    status: 200,
    body: respostaSSE(
      "## O que a pergunta pede\nIdentificar a estrutura LIFO.\n\n## Análise das alternativas\n- **a) Fila** — errada: é FIFO.\n- **b) Pilha** — correta: último a entrar, primeiro a sair.\n\n```c\npush(p, 1); pop(p);\n```",
      { sig: "SIG-3" }
    ),
  };
  await painel.click("#btn-revelar");
  await painel.waitForFunction(() => document.querySelectorAll(".turno-ia:not(.dica):not(.erro)").length === 1 && !document.querySelector(".cursor"));
  const r3 = requisicoes.at(-1);
  ok(r3.messages.length === 5, "após o erro, o histórico segue consistente (5 mensagens, sem a tentativa que falhou)");
  ok(/Análise das alternativas/.test(r3.messages[4].content), "pedido de explicação completa com a estrutura");
  ok(!(await painel.$eval("#acoes-dica", (e) => getComputedStyle(e).display !== "none")) && !(await painel.$eval("#status", (e) => getComputedStyle(e).display !== "none")), "botões de dica somem após revelar");
  ok(await painel.$eval(".turno-ia:not(.dica):not(.erro) pre code", (e) => e.textContent.includes("push(p, 1)")), "bloco de código renderizado");

  // Conferir raciocínio
  proximaResposta = { status: 200, body: respostaSSE("Seu raciocínio está **correto**.") };
  await painel.click("#det-tentativa summary");
  await painel.type("#tentativa", "Acho que é a b) porque o último empilhado sai primeiro");
  await painel.click("#btn-avaliar");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia")].some((e) => e.textContent.includes("raciocínio está correto")));
  ok(/<minha_tentativa>[\s\S]*último empilhado/.test(requisicoes.at(-1).messages.at(-1).content), "tentativa do estudante enviada para avaliação");

  // Dúvida livre (Enter)
  proximaResposta = { status: 200, body: respostaSSE("Porque a árvore não define ordem de remoção.") };
  await painel.type("#duvida", "por que a c) não serve?\n");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia")].some((e) => e.textContent.includes("árvore não define")) && !document.querySelector(".cursor"));
  ok(requisicoes.at(-1).messages.at(-1).content === "por que a c) não serve?", "pergunta de acompanhamento enviada");
  await painel.screenshot({ path: join(SHOTS, "painel-conversa.png"), fullPage: true });

  // Recusa do modelo
  proximaResposta = {
    status: 200,
    body: [
      sse("message_start", { type: "message_start", message: { usage: { input_tokens: 10 } } }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: null } } }),
    ].join(""),
  };
  const antes = requisicoes.length;
  await painel.type("#duvida", "outra coisa\n");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia.erro")].some((e) => e.textContent.includes("recusou")));
  ok(requisicoes.length === antes + 1, "recusa tratada com mensagem clara");

  // Persistência: recarregar o painel mantém a conversa
  const nTurnos = await painel.$$eval(".turno-ia", (e) => e.length);
  await painel.reload();
  await painel.waitForSelector(".turno-ia");
  ok((await painel.$$eval(".turno-ia", (e) => e.length)) === nTurnos, "conversa restaurada após recarregar o painel");

  // Menu de contexto: simula o que o background faz no clique (grava a pergunta pendente)
  console.log("\n[Menu de contexto → painel]");
  proximaResposta = { status: 200, body: respostaSSE("## O que a pergunta pede\nExplicar recursão.") };
  const antesMenu = requisicoes.length;
  await sw.evaluate(() =>
    chrome.storage.session.set({
      perguntaPendente: { texto: "O que é recursão?", modo: "completo", pagina: { titulo: "Aula 5", url: "https://exemplo.edu/aula5" }, ts: Date.now() },
    })
  );
  await painel.waitForFunction(() => document.querySelector("#pergunta").value === "O que é recursão?" && document.querySelectorAll(".turno-ia").length === 1 && !document.querySelector(".cursor"));
  const rm = requisicoes.at(-1);
  ok(requisicoes.length === antesMenu + 1 && rm.messages.length === 1, "pergunta do menu inicia uma conversa nova automaticamente");
  ok(/Aula 5 — https:\/\/exemplo.edu\/aula5/.test(rm.messages[0].content), "origem (título/URL) incluída");
  ok((await sw.evaluate(() => chrome.storage.session.get("perguntaPendente"))).perguntaPendente === undefined, "pergunta pendente consumida");

  // ---------- Painel usando o Gemini ----------
  console.log("\n[Painel com Gemini]");
  await sw.evaluate(() => chrome.storage.local.set({ provedor: "gemini" }));
  await painel.click("#btn-nova");
  await painel.type("#pergunta", "Quantos hosts utilizáveis tem uma sub-rede /26? a) 64 b) 62 c) 30");
  proximaResposta = { status: 200, body: respostaGemini("## Dica 1\nPense em quantos **bits** sobram para hosts.", { sig: "GSIG-1" }) };
  await painel.click("#btn-dica");
  await painel.waitForFunction(() => document.querySelectorAll(".turno-ia.dica").length === 1 && !document.querySelector(".cursor"));
  const g1 = requisicoes.at(-1);
  ok(urls.at(-1) === `${GOOGLE}gemini-3.8-flash:streamGenerateContent?alt=sse`, "painel chama o Gemini quando ele é o provedor");
  ok(/NÃO revele a resposta/.test(g1.contents[0].parts[0].text) && /estudante de ADS/.test(g1.systemInstruction.parts[0].text), "Gemini recebe o mesmo prompt do tutor (dica + perfil)");
  ok(g1.generationConfig.thinkingConfig.thinkingLevel === "MEDIUM", "esforço médio vira thinkingLevel MEDIUM");
  ok(await painel.$eval(".turno-ia.dica", (e) => e.innerHTML.includes("<strong>bits</strong>")), "resposta do Gemini renderizada em streaming");
  proximaResposta = { status: 200, body: respostaGemini("Dica 2: /26 deixa 6 bits para hosts.", { sig: "GSIG-2" }) };
  await painel.click("#btn-mais-dica");
  await painel.waitForFunction(() => document.querySelectorAll(".turno-ia.dica").length === 2 && !document.querySelector(".cursor"));
  const g2 = requisicoes.at(-1);
  ok(g2.contents.map((c) => c.role).join() === "user,model,user", "histórico do Gemini com papéis user/model");
  ok(g2.contents[1].parts[0].thoughtSignature === "GSIG-1" && /bits/.test(g2.contents[1].parts[0].text), "turno do Gemini volta com thoughtSignature");
  proximaResposta = { status: 429, body: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric" } }) };
  await painel.click("#btn-revelar");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia.erro")].some((e) => e.textContent.includes("plano gratuito")));
  ok(true, "429 do plano grátis do Gemini mostrado em português");
  proximaResposta = { status: 200, body: respostaGemini("", { finish: "SAFETY" }) };
  await painel.click("#btn-revelar");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia.erro")].some((e) => e.textContent.includes("filtro de segurança do Google")));
  ok(true, "bloqueio de segurança do Gemini vira aviso claro");
  proximaResposta = { status: 200, body: respostaGemini("## Análise das alternativas\n- **b) 62** — correta: 2^6 − 2.") };
  await painel.click("#btn-revelar");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia")].some((e) => e.textContent.includes("2^6")) && !document.querySelector(".cursor"));
  ok(requisicoes.at(-1).contents.length === 5, "erros e bloqueios não entram no histórico do Gemini");
  await painel.screenshot({ path: join(SHOTS, "painel-gemini.png"), fullPage: true });

  // Troca para Claude no meio da conversa: turnos do Gemini viram texto para a Anthropic
  await sw.evaluate(() => chrome.storage.local.set({ provedor: "anthropic" }));
  proximaResposta = { status: 200, body: respostaSSE("Claude continuando a conversa.") };
  await painel.type("#duvida", "e se fosse /27?\n");
  await painel.waitForFunction(() => [...document.querySelectorAll(".turno-ia")].some((e) => e.textContent.includes("Claude continuando")));
  const mista = requisicoes.at(-1);
  ok(urls.at(-1) === "https://api.anthropic.com/v1/messages" && mista.messages.length === 7 && mista.messages[1].content[0].type === "text", "trocar de provedor no meio da conversa funciona");

  // Botão Nova
  await painel.click("#btn-nova");
  ok((await painel.$$eval(".turno-ia", (e) => e.length)) === 0 && !(await painel.$eval("#secao-seguir", (e) => getComputedStyle(e).display !== "none")), "botão Nova limpa a conversa");

  // ---------- Página de teste (test.html) ----------
  console.log("\n[Página de teste]");
  const op2 = await browser.newPage();
  await op2.goto(`chrome-extension://${extId}/options/options.html`);
  const alvoTeste = browser.waitForTarget((t) => t.url().endsWith("/test.html"));
  await op2.click("#btn-teste");
  const teste = await (await alvoTeste).page();
  await teste.waitForSelector("#q5");
  ok((await teste.$$(".questao")).length === 5, "test.html abre pelas Opções com 5 questões");
  await op2.close();
  await teste.bringToFront();
  await teste.$eval("#q2", (e) => e.scrollIntoView({ block: "center" }));
  await painel.$eval("#origem", (e) => (e.textContent = ""));
  await painel.click("#btn-detectar");
  await painel.waitForFunction(() => document.querySelector("#origem").textContent.startsWith("✔"), { timeout: 8000 });
  const q2 = await painel.$eval("#pergunta", (e) => e.value);
  ok(/192\.168\.10\.0\/26/.test(q2) && /62/.test(q2) && !/SQL/.test(q2), "Detectar na página pega a questão 2 (redes) centralizada na tela");
  await teste.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector("#q4"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await painel.$eval("#origem", (e) => (e.textContent = ""));
  await painel.click("#btn-detectar");
  await painel.waitForFunction(() => document.querySelector("#origem").textContent.startsWith("✔"), { timeout: 8000 });
  const q4 = await painel.$eval("#pergunta", (e) => e.value);
  ok(/def adiciona/.test(q4) && /lista\.append/.test(q4) && /Selecionado|selecionado/.test(await painel.$eval("#origem", (e) => e.textContent)), "texto selecionado na test.html (com código, quebras de linha preservadas)");
  ok((await teste.$eval("#monitor", (e) => e.textContent)) === "Alternativas marcadas: 0 · Envios: 0", "nada marcado nem enviado na página de teste");

  // Painel sem chave mostra aviso
  await sw.evaluate(() => chrome.storage.local.remove("apiKey"));
  await painel.waitForFunction(() => !document.querySelector("#aviso-chave").hidden);
  ok(true, "remover a chave mostra o aviso de configuração");
  await painel.screenshot({ path: join(SHOTS, "painel-sem-chave.png") });

  ok(erros.length === 0, "sem erros de JavaScript no painel" + (erros.length ? ": " + erros.join(" | ") : ""));

  // Menus de contexto foram criados? (recriar com o mesmo id dá erro de duplicado)
  const dup = await sw.evaluate(
    () => new Promise((res) => chrome.contextMenus.create({ id: "explicar", title: "x", contexts: ["selection"] }, () => res(chrome.runtime.lastError?.message || "")))
  );
  ok(/duplicate|already/i.test(dup), "menu de contexto 'Explicar com IA' registrado");
} catch (e) {
  falhas.push(String(e?.stack || e));
  console.error(e);
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${falhas.length ? "FALHOU" : "TUDO OK"} — ${falhas.length} falha(s)`);
process.exit(falhas.length ? 1 : 0);
