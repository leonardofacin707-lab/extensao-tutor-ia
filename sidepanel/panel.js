import { ErroApi } from "../lib/anthropic.js";
import { enviarConversa, chaveDe, provedorDe, PROVEDORES } from "../lib/provedores.js";
import { carregarConfig } from "../lib/config.js";
import { renderizarMarkdown } from "../lib/markdown.js";
import {
  promptDoSistema,
  mensagemInicial,
  mensagemMaisDica,
  mensagemRevelar,
  mensagemAvaliarRaciocinio,
} from "../lib/prompts.js";

const $ = (id) => document.getElementById(id);
const el = {
  pergunta: $("pergunta"),
  origem: $("origem"),
  conversa: $("conversa"),
  status: $("status"),
  statusTexto: $("status-texto"),
  secaoSeguir: $("secao-seguir"),
  acoesDica: $("acoes-dica"),
  tentativa: $("tentativa"),
  detTentativa: $("det-tentativa"),
  duvida: $("duvida"),
  uso: $("uso"),
  avisoChave: $("aviso-chave"),
};
const botoesDeEnvio = ["btn-dica", "btn-completo", "btn-mais-dica", "btn-revelar", "btn-avaliar", "btn-perguntar", "btn-detectar"].map($);

// ---------- Estado ----------
let estado = novoEstado();
let config = null;
let controlador = null; // AbortController da requisição em andamento

function novoEstado() {
  return {
    pergunta: "",
    pagina: null,
    modo: null, // "dica" | "completo"
    nivelDica: 0,
    revelado: false,
    messages: [], // histórico enviado à API (conteúdo da IA guardado intacto)
    turnos: [], // o que aparece na tela: { quem: "usuario"|"ia", texto, classe }
    uso: { entrada: 0, saida: 0 },
  };
}

async function salvarEstado() {
  try {
    await chrome.storage.session.set({ sessaoPainel: estado });
  } catch {
    /* sem storage.session: tudo bem, só não persiste */
  }
}

async function restaurarEstado() {
  try {
    const { sessaoPainel } = await chrome.storage.session.get("sessaoPainel");
    if (sessaoPainel && sessaoPainel.turnos) estado = { ...novoEstado(), ...sessaoPainel };
  } catch {
    /* ignora */
  }
  el.pergunta.value = estado.pergunta || "";
  redesenharConversa();
}

// ---------- Interface ----------
function redesenharConversa() {
  el.conversa.replaceChildren(...estado.turnos.map(criarTurno));
  atualizarControles();
}

function criarTurno(t) {
  const div = document.createElement("div");
  if (t.quem === "usuario") {
    div.className = "turno-usuario";
    div.textContent = t.texto;
  } else {
    div.className = "turno-ia" + (t.classe ? " " + t.classe : "");
    div.innerHTML = renderizarMarkdown(t.texto); // markdown.js escapa todo o HTML
    if (t.classe !== "erro") div.append(criarMeta(t.texto));
  }
  return div;
}

function criarMeta(texto) {
  const meta = document.createElement("div");
  meta.className = "meta";
  const copiar = document.createElement("button");
  copiar.type = "button";
  copiar.className = "link";
  copiar.textContent = "Copiar explicação";
  copiar.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(texto);
      copiar.textContent = "Copiado!";
    } catch {
      copiar.textContent = "Não foi possível copiar";
    }
    setTimeout(() => (copiar.textContent = "Copiar explicação"), 1500);
  });
  meta.append(copiar);
  return meta;
}

function ocupado() {
  return controlador !== null;
}

function atualizarControles() {
  const temConversa = estado.messages.length > 0;
  el.secaoSeguir.hidden = !temConversa;
  el.acoesDica.hidden = !(estado.modo === "dica" && !estado.revelado);
  for (const b of botoesDeEnvio) b.disabled = ocupado();
  el.status.hidden = !ocupado();
  const total = estado.uso.entrada + estado.uso.saida;
  el.uso.textContent = total ? ` · ${total.toLocaleString("pt-BR")} tokens nesta pergunta` : "";
}

function mostrarErro(msg) {
  estado.turnos.push({ quem: "ia", texto: msg, classe: "erro" });
  redesenharConversa();
  rolarParaFim();
}

function rolarParaFim() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

// ---------- Conversa com a IA ----------
async function enviar({ textoParaIa, rotulo, classe = "" }) {
  if (ocupado()) return;
  config = await carregarConfig();
  if (!chaveDe(config)) {
    el.avisoChave.hidden = false;
    mostrarErro(`Configure a chave do ${PROVEDORES[provedorDe(config)].nome} nas Opções antes de pedir explicações.`);
    return;
  }

  const mensagensEnviadas = [...estado.messages, { role: "user", content: textoParaIa }];
  estado.turnos.push({ quem: "usuario", texto: rotulo });
  redesenharConversa();

  // Bolha da resposta em streaming
  const bolha = document.createElement("div");
  bolha.className = "turno-ia cursor" + (classe ? " " + classe : "");
  el.conversa.append(bolha);
  let textoParcial = "";
  let agendado = false;
  const desenhar = () => {
    agendado = false;
    bolha.innerHTML = renderizarMarkdown(textoParcial);
  };

  controlador = new AbortController();
  el.statusTexto.textContent = "Pensando…";
  atualizarControles();
  rolarParaFim();

  try {
    const resp = await enviarConversa(
      {
        config,
        system: promptDoSistema({ perfil: config.perfil }),
        messages: mensagensEnviadas,
      },
      {
        signal: controlador.signal,
        onTexto: (delta) => {
          textoParcial += delta;
          el.statusTexto.textContent = "Escrevendo…";
          if (!agendado) {
            agendado = true;
            requestAnimationFrame(desenhar);
          }
        },
      }
    );

    estado.uso.entrada += resp.uso.entrada || 0;
    estado.uso.saida += resp.uso.saida || 0;

    if (resp.fim === "recusa") {
      // Não entra no histórico: a conversa continua válida para a próxima tentativa.
      estado.turnos.pop();
      bolha.remove();
      mostrarErro(
        `A IA não respondeu: ${resp.motivo || "a solicitação foi recusada"}. Se for uma questão de estudo comum, ` +
          "tente reformular o texto ou trocar de modelo/provedor nas Opções."
      );
      return false;
    }

    let texto = resp.texto;
    if (resp.fim === "limite") texto += "\n\n> A resposta foi cortada por ser longa demais.";
    estado.messages = [...mensagensEnviadas, resp.turno];
    estado.turnos.push({ quem: "ia", texto: texto || "(resposta vazia)", classe });
    return true;
  } catch (e) {
    estado.turnos.pop(); // remove o rótulo do usuário: a pergunta não entrou no histórico
    bolha.remove();
    if (e?.name === "AbortError") {
      if (textoParcial) {
        estado.turnos.push({ quem: "usuario", texto: rotulo });
        estado.turnos.push({ quem: "ia", texto: textoParcial + "\n\n> (interrompido — esta parte não foi guardada na conversa)", classe });
      }
    } else {
      const msg = e instanceof ErroApi ? e.message : "Erro inesperado: " + (e?.message || e);
      estado.turnos.push({ quem: "ia", texto: msg, classe: "erro" });
      if (!(e instanceof ErroApi)) console.error("[Tutor IA]", e);
    }
    return false;
  } finally {
    controlador = null;
    redesenharConversa();
    rolarParaFim();
    salvarEstado();
  }
}

async function iniciar(modo) {
  const pergunta = el.pergunta.value.trim();
  if (!pergunta) {
    el.pergunta.focus();
    el.origem.textContent = "Cole ou detecte uma pergunta primeiro.";
    return;
  }
  if (ocupado()) controlador.abort();
  const pagina = estado.pergunta === pergunta ? estado.pagina : null;
  estado = { ...novoEstado(), pergunta, pagina, modo, nivelDica: modo === "dica" ? 1 : 0, revelado: modo === "completo" };
  redesenharConversa();
  await enviar({
    textoParaIa: mensagemInicial({ pergunta, modo, pagina }),
    rotulo: modo === "dica" ? "💡 Dica 1" : "📖 Explicação completa",
    classe: modo === "dica" ? "dica" : "",
  });
}

async function maisDica() {
  const nivel = estado.nivelDica + 1;
  const ok = await enviar({ textoParaIa: mensagemMaisDica(nivel), rotulo: `💡 Dica ${nivel}`, classe: "dica" });
  if (ok) {
    estado.nivelDica = nivel;
    salvarEstado();
  }
}

async function revelar() {
  const ok = await enviar({ textoParaIa: mensagemRevelar(), rotulo: "📖 Mostrar explicação completa" });
  if (ok) {
    estado.revelado = true;
    redesenharConversa();
    salvarEstado();
  }
}

async function avaliar() {
  const t = el.tentativa.value.trim();
  if (!t) return el.tentativa.focus();
  const ok = await enviar({ textoParaIa: mensagemAvaliarRaciocinio(t), rotulo: "✍️ Minha tentativa: " + t });
  if (ok) {
    el.tentativa.value = "";
    el.detTentativa.open = false;
  }
}

async function perguntar() {
  const d = el.duvida.value.trim();
  if (!d) return el.duvida.focus();
  const ok = await enviar({ textoParaIa: d, rotulo: d });
  if (ok) el.duvida.value = "";
}

// ---------- Ler pergunta da página ----------
async function detectar() {
  el.origem.textContent = "Lendo a página…";
  let r;
  try {
    r = await chrome.runtime.sendMessage({ tipo: "detectar" });
  } catch (e) {
    r = { ok: false, erro: String(e?.message || e) };
  }
  if (!r?.ok) {
    el.origem.textContent = "";
    mostrarErro(r?.erro || "Não foi possível ler a página.");
    return;
  }
  if (!r.texto) {
    el.origem.textContent = "Nada encontrado. Selecione o texto da pergunta e tente de novo.";
    return;
  }
  el.pergunta.value = r.texto;
  estado.pergunta = r.texto;
  estado.pagina = r.pagina || null;
  el.origem.textContent = r.origem === "selecao" ? "✔ Texto selecionado capturado." : "✔ Questão com alternativas detectada — confira o texto.";
}

async function processarPendente(p) {
  if (!p || !p.texto) return;
  await chrome.storage.session.remove("perguntaPendente");
  if (ocupado()) controlador.abort();
  el.pergunta.value = p.texto;
  estado.pergunta = p.texto.trim();
  estado.pagina = p.pagina || null;
  el.origem.textContent = "✔ Recebido do menu de contexto.";
  await iniciar(p.modo === "dica" ? "dica" : "completo");
}

// ---------- Eventos ----------
$("btn-dica").addEventListener("click", () => iniciar("dica"));
$("btn-completo").addEventListener("click", () => iniciar("completo"));
$("btn-mais-dica").addEventListener("click", maisDica);
$("btn-revelar").addEventListener("click", revelar);
$("btn-avaliar").addEventListener("click", avaliar);
$("btn-perguntar").addEventListener("click", perguntar);
$("btn-detectar").addEventListener("click", detectar);
$("btn-parar").addEventListener("click", () => controlador?.abort());
el.duvida.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    perguntar();
  }
});
el.pergunta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    iniciar(config?.modoPadrao === "completo" ? "completo" : "dica");
  }
});
$("btn-nova").addEventListener("click", () => {
  if (ocupado()) controlador.abort();
  estado = novoEstado();
  el.pergunta.value = "";
  el.origem.textContent = "";
  redesenharConversa();
  salvarEstado();
  el.pergunta.focus();
});
const abrirOpcoes = () => chrome.runtime.openOptionsPage();
$("btn-opcoes").addEventListener("click", abrirOpcoes);
$("btn-config-chave").addEventListener("click", abrirOpcoes);

chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area === "session" && mudancas.perguntaPendente?.newValue) processarPendente(mudancas.perguntaPendente.newValue);
  if (area === "local" && (mudancas.apiKey || mudancas.geminiKey || mudancas.provedor)) {
    carregarConfig().then((c) => {
      config = c;
      el.avisoChave.hidden = !!chaveDe(c);
    });
  }
});

// ---------- Início ----------
(async () => {
  config = await carregarConfig();
  el.avisoChave.hidden = !!chaveDe(config);
  await restaurarEstado();
  const { perguntaPendente } = await chrome.storage.session.get("perguntaPendente");
  if (perguntaPendente && Date.now() - perguntaPendente.ts < 60_000) await processarPendente(perguntaPendente);
})();
