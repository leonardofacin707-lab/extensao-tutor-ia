import { MODELOS, ErroApi } from "../lib/anthropic.js";
import { MODELOS_GEMINI, MODELO_PADRAO_GEMINI } from "../lib/gemini.js";
import { carregarConfig, salvarConfig } from "../lib/config.js";
import { enviarConversa, PROVEDORES } from "../lib/provedores.js";

const $ = (id) => document.getElementById(id);
const campos = ["provedor", "geminiKey", "modeloGemini", "apiKey", "modelo", "esforco", "modoPadrao", "perfil"];
const PERMISSAO = { origins: ["<all_urls>"] };

for (const m of MODELOS) $("modelo").append(new Option(m.nome, m.id));
for (const m of MODELOS_GEMINI) $("lista-gemini").append(new Option(m.nome, m.id));
$("modeloGemini").placeholder = `vazio = ${MODELO_PADRAO_GEMINI} (padrão)`;

function mensagem(texto, tipo = "") {
  const m = $("mensagem");
  m.textContent = texto;
  m.className = tipo;
}

function lerFormulario() {
  const v = Object.fromEntries(campos.map((c) => [c, $(c).value]));
  for (const c of ["geminiKey", "apiKey", "modeloGemini", "perfil"]) v[c] = v[c].trim();
  return v;
}

function mostrarProvedor() {
  const p = $("provedor").value;
  document.querySelectorAll("section[data-provedor]").forEach((s) => (s.hidden = s.dataset.provedor !== p));
}

function validar(v) {
  if (v.apiKey && !v.apiKey.startsWith("sk-ant-")) return "A chave da Anthropic normalmente começa com \"sk-ant-\". Confira se colou certo.";
  if (v.modeloGemini && !/^[\w.-]+$/.test(v.modeloGemini)) return "Nome de modelo do Gemini inválido (use algo como gemini-3.8-flash).";
  return "";
}

async function carregar() {
  const cfg = await carregarConfig();
  for (const c of campos) $(c).value = cfg[c] ?? "";
  mostrarProvedor();
  atualizarPermissao();
}

$("provedor").addEventListener("change", () => {
  mostrarProvedor();
  mensagem("");
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = lerFormulario();
  const erro = validar(v);
  if (erro) return mensagem(erro, "erro");
  await salvarConfig(v);
  mensagem("✔ Salvo.", "ok");
});

document.querySelectorAll(".btn-mostrar").forEach((b) =>
  b.addEventListener("click", () => {
    const i = $(b.dataset.alvo);
    i.type = i.type === "password" ? "text" : "password";
    b.textContent = i.type === "password" ? "Mostrar" : "Ocultar";
  })
);

$("btn-testar").addEventListener("click", async () => {
  const v = lerFormulario();
  const erro = validar(v);
  if (erro) return mensagem(erro, "erro");
  const b = $("btn-testar");
  b.disabled = true;
  mensagem(`Testando ${PROVEDORES[v.provedor].nome}…`);
  try {
    const r = await enviarConversa({
      config: v,
      esforco: "low",
      maxTokens: 2048,
      system: "Responda em português, numa frase curta.",
      messages: [{ role: "user", content: "Diga apenas: conexão funcionando." }],
    });
    mensagem(`✔ Funcionou! (${r.modelo || PROVEDORES[v.provedor].nome}) — lembre de clicar em Salvar.`, "ok");
  } catch (e) {
    mensagem("✖ " + (e instanceof ErroApi ? e.message : String(e?.message || e)), "erro");
  } finally {
    b.disabled = false;
  }
});

async function atualizarPermissao() {
  const tem = await chrome.permissions.contains(PERMISSAO);
  $("estado-permissao").textContent = tem ? "✔ Leitura liberada em todos os sites." : "";
  $("btn-permissao").textContent = tem ? "Revogar leitura em todos os sites" : "Liberar leitura em todos os sites";
  $("btn-permissao").dataset.tem = tem ? "1" : "";
}

$("btn-permissao").addEventListener("click", async () => {
  if ($("btn-permissao").dataset.tem) await chrome.permissions.remove(PERMISSAO);
  else await chrome.permissions.request(PERMISSAO);
  atualizarPermissao();
});

$("btn-teste").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("test.html") }));

carregar();
