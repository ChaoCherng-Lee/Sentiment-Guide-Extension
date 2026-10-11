// popup — runs inside the extension action popup

const dot  = document.getElementById("statusDot")!
const text = document.getElementById("statusText")!
const cmd  = document.getElementById("statusCmd")!

async function checkOllama() {
  try {
    const res = await fetch("http://localhost:11434/api/tags")
    if (!res.ok) throw new Error("Ollama returned " + res.status)

    const data = await res.json()
    const models: string[] = (data.models || []).map((m: { name: string }) => m.name)

    const found =
      models.find(name => name === "gemma3:4b")      ||
      models.find(name => name === "gemma3:latest")  ||
      models.find(name => name.startsWith("gemma3")) ||
      models.find(name => name.startsWith("gemma"))

    if (found) {
      dot.classList.add("green")
      text.textContent = "Ollama running · " + found
    } else {
      dot.classList.add("red")
      text.textContent  = "No Gemma model found — run:"
      cmd.style.display = "block"
      cmd.textContent   = "ollama pull gemma3:4b"
    }
  } catch (_) {
    dot.classList.add("red")
    text.textContent  = "Ollama not detected — run:"
    cmd.style.display = "block"
    cmd.textContent   = "ollama serve"
  }
}

checkOllama()
