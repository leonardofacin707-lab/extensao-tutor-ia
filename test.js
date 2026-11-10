// Script da página de teste. O navegador não deixa extensões injetarem scripts
// nas próprias páginas (chrome-extension://), então esta página responde por conta
// própria ao pedido "Detectar na página", com a mesma função de leitura das outras páginas.
import { detectarPerguntaNaPagina } from "./lib/detectar.js";

const form = document.getElementById("prova");
const monitor = document.getElementById("monitor");
const resultado = document.getElementById("resultado");
let envios = 0;

function atualizarMonitor() {
  const marcadas = form.querySelectorAll("input:checked").length;
  monitor.textContent = `Alternativas marcadas: ${marcadas} · Envios: ${envios}`;
}

form.addEventListener("change", atualizarMonitor);
form.addEventListener("submit", (e) => {
  e.preventDefault(); // página local: nada é enviado para lugar nenhum
  envios++;
  atualizarMonitor();
  const marcadas = form.querySelectorAll("input:checked").length;
  resultado.hidden = false;
  resultado.textContent = `Respostas registradas localmente (${marcadas} de 4 questões objetivas marcadas). Esta página não tem gabarito: use o Tutor IA para entender cada questão.`;
});

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg?.tipo === "detectar-pagina-teste") responder(detectarPerguntaNaPagina());
  });
}

atualizarMonitor();
