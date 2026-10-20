// Wordly Learn – dictionary + flashcards. Bootstrap 5 for layout and components.
const API_URL = "https://api.datamuse.com/words";
const WIKTIONARY_URL = "https://en.wiktionary.org/api/rest_v1/page/definition/";

// --- DOM references ---
const form = document.getElementById("search-form");
const input = document.getElementById("word-input");
const messageEl = document.getElementById("message");
const resultEl = document.getElementById("result");
const wordsListEl = document.getElementById("words-list");
const practiceAreaEl = document.getElementById("practice-area");
const savedCountEl = document.getElementById("saved-count");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const themeToggle = document.getElementById("theme-toggle");
const searchButton = document.getElementById("search-button");

// --- State ---
// Each saved word: { word, partOfSpeech, definition, status: "new" | "learning" | "known" }
function loadWords() {
  try {
    const stored = JSON.parse(localStorage.getItem("learn-words") || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((word) =>
      word &&
      typeof word.word === "string" &&
      typeof word.definition === "string" &&
      ["new", "learning", "known"].includes(word.status)
    );
  } catch (error) {
    showMessage("Your saved words could not be read from this browser. You can still search and practise during this visit.", "warning");
    return [];
  }
}

let words = loadWords();
let currentCard = null;
let activeSearch = null;

// --- Helpers ---
function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function showMessage(text, type = "danger") {
  messageEl.innerHTML = "";
  if (text) messageEl.appendChild(makeEl("div", `alert alert-${type} shadow-sm mb-0`, text));
}

function isSaved(word) {
  return words.some((w) => w.word === word.toLowerCase());
}

function persist() {
  try {
    localStorage.setItem("learn-words", JSON.stringify(words));
  } catch (error) {
    showMessage("Your browser could not save this change. Check its storage settings and try again.", "warning");
  }
  savedCountEl.textContent = words.length;
  renderWords();
}

const STATUS_STYLE = { new: "text-bg-secondary", learning: "text-bg-warning", known: "text-bg-success" };

// --- Fetch ---
async function fetchDatamuse(url, signal) {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("The Datamuse dictionary service is temporarily unavailable. Please try again shortly.");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("The dictionary returned an unexpected response. Please try again.");
  return data;
}

async function fetchWiktionaryWord(word, signal) {
  const response = await fetch(`${WIKTIONARY_URL}${encodeURIComponent(word)}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Wiktionary is temporarily unavailable.");

  const data = await response.json();
  const meanings = (Array.isArray(data.en) ? data.en : [])
    .filter((meaning) => typeof meaning.partOfSpeech === "string" && Array.isArray(meaning.definitions))
    .map((meaning) => ({
      partOfSpeech: meaning.partOfSpeech.toLowerCase(),
      definitions: meaning.definitions
        .map((definition) => {
          const examples = Array.isArray(definition.examples) ? definition.examples : [];
          const example = examples.find((item) => typeof item === "string" && item);
          return {
            definition: htmlToText(definition.definition),
            ...(example ? { example: htmlToText(example) } : {}),
          };
        })
        .filter((definition) => definition.definition),
      synonyms: [],
    }))
    .filter((meaning) => meaning.definitions.length > 0);

  if (meanings.length === 0) return null;
  return {
    word,
    phonetic: "",
    phonetics: [],
    meanings,
    sourceUrls: [`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`],
    useSpeechSynthesis: true,
  };
}

function htmlToText(html) {
  return new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim();
}

function toDictionaryEntry(word, result, synonymResults) {
  const meanings = new Map();
  const definitions = Array.isArray(result.defs) ? result.defs : [];

  definitions.forEach((rawDefinition) => {
    if (typeof rawDefinition !== "string") return;
    const separator = rawDefinition.indexOf("\t");
    const partCode = separator === -1 ? "" : rawDefinition.slice(0, separator).trim();
    const definition = (separator === -1 ? rawDefinition : rawDefinition.slice(separator + 1)).trim();
    if (!definition) return;

    const partOfSpeech = ({ n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "unknown" })[partCode] || partCode || "definition";
    if (!meanings.has(partOfSpeech)) meanings.set(partOfSpeech, { partOfSpeech, definitions: [], synonyms: [] });
    meanings.get(partOfSpeech).definitions.push({ definition });
  });

  const synonyms = synonymResults.map((item) => item.word).filter((synonym) => synonym && synonym.toLowerCase() !== word);
  meanings.forEach((meaning) => {
    meaning.synonyms = synonyms;
  });

  const pronunciation = (result.tags || []).find((tag) => typeof tag === "string" && tag.startsWith("pron:"));
  return {
    word: result.word,
    phonetic: pronunciation ? `ARPAbet: ${pronunciation.slice("pron:".length).trim()}` : "",
    phonetics: [],
    meanings: [...meanings.values()],
    sourceUrls: ["https://www.datamuse.com/api/"],
    useSpeechSynthesis: true,
  };
}

async function fetchWord(word, signal) {
  const params = new URLSearchParams({ sp: word, md: "dpr", max: "1" });
  const synonymParams = new URLSearchParams({ rel_syn: word, max: "12" });
  const [wiktionaryResult, datamuseResult] = await Promise.allSettled([
    fetchWiktionaryWord(word, signal),
    (async () => {
      const results = await fetchDatamuse(`${API_URL}?${params}`, signal);
      const match = results.find((item) => typeof item.word === "string" && item.word.toLowerCase() === word);
      if (!match) return null;

      let synonymResults = [];
      let synonymError = false;
      try {
        synonymResults = await fetchDatamuse(`${API_URL}?${synonymParams}`, signal);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        synonymError = true;
      }
      return { entry: toDictionaryEntry(word, match, synonymResults), synonymError };
    })(),
  ]);

  if (signal.aborted) throw new DOMException("Search cancelled.", "AbortError");

  const dictionaryEntry = wiktionaryResult.status === "fulfilled" ? wiktionaryResult.value : null;
  const datamuseData = datamuseResult.status === "fulfilled" ? datamuseResult.value : null;
  if (dictionaryEntry) {
    if (datamuseData?.entry) {
      dictionaryEntry.phonetic = datamuseData.entry.phonetic;
      dictionaryEntry.meanings.forEach((meaning) => {
        const matchingMeaning = datamuseData.entry.meanings.find((item) => item.partOfSpeech === meaning.partOfSpeech);
        meaning.synonyms = matchingMeaning?.synonyms || datamuseData.entry.meanings[0]?.synonyms || [];
      });
    }
    dictionaryEntry.synonymError = datamuseResult.status === "rejected" || datamuseData?.synonymError === true;
    return dictionaryEntry;
  }

  if (datamuseData?.entry?.meanings.length) {
    datamuseData.entry.fallbackNotice = true;
    datamuseData.entry.synonymError = datamuseData.synonymError;
    return datamuseData.entry;
  }

  if (wiktionaryResult.status === "rejected" || datamuseResult.status === "rejected") {
    throw new Error("The dictionary services could not be reached. Check your connection and try again.");
  }
  throw new Error(`No definitions found for "${word}". Check the spelling and try again.`);
}

async function searchWord(rawWord) {
  if (activeSearch) {
    activeSearch.abort();
    searchButton.disabled = false;
    searchButton.textContent = "Search";
    resultEl.innerHTML = "";
  }
  activeSearch = null;
  const word = rawWord.trim().toLowerCase();
  if (!word) return showMessage("Type a word to search.", "warning");
  if (!/^[a-z]+(?:['-][a-z]+)*$/.test(word)) return showMessage("Enter an English word using letters, with an optional apostrophe or hyphen.", "warning");

  const controller = new AbortController();
  activeSearch = controller;
  showMessage("");
  resultEl.innerHTML = "";
  searchButton.textContent = "Searching…";
  const loading = makeEl("div", "text-center py-5");
  loading.setAttribute("role", "status");
  loading.appendChild(makeEl("span", "spinner-border text-success"));
  loading.appendChild(makeEl("span", "visually-hidden", " Searching dictionary"));
  resultEl.appendChild(loading);

  try {
    const entry = await fetchWord(word, controller.signal);
    if (activeSearch === controller) {
      renderResult(entry);
      if (entry.fallbackNotice) {
        showMessage("Wiktionary is unavailable, so this result is from Datamuse. Example sentences may not be available.", "warning");
      } else if (entry.synonymError) {
        showMessage("The definition loaded, but synonym suggestions and phonetic data are unavailable right now.", "warning");
      }
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    resultEl.innerHTML = "";
    showMessage(error instanceof TypeError ? "Can't reach the dictionary. Check your internet connection and try again." : error.message);
  } finally {
    if (activeSearch === controller) {
      activeSearch = null;
      searchButton.disabled = false;
      searchButton.textContent = "Search";
    }
  }
}

// --- Search result ---
function renderResult(entry) {
  resultEl.innerHTML = "";
  const first = entry.meanings[0];
  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
  const audio = (phonetics.find((p) => p.audio) || {}).audio;
  const phonetic = entry.phonetic || (phonetics.find((p) => p.text) || {}).text || "";

  const card = makeEl("div", "card shadow-sm border-0 mt-4");
  const body = makeEl("div", "card-body p-4");

  const head = makeEl("div", "d-flex flex-wrap align-items-center gap-3");
  const title = makeEl("h2", "m-0 fw-bold");
  head.append(title, makeEl("span", "text-body-secondary", phonetic));

  if (audio || entry.useSpeechSynthesis) {
    const listen = makeEl("button", "btn btn-success btn-sm rounded-pill", "Listen");
    listen.type = "button";
    listen.addEventListener("click", () => {
      if (audio) {
        new Audio(audio).play().catch(() => showMessage("Audio playback is unavailable for this pronunciation.", "warning"));
      } else if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(entry.word));
      } else {
        showMessage("Audio playback is not supported by this browser.", "warning");
      }
    });
    head.appendChild(listen);
  }

  const saveBtn = makeEl("button", "btn btn-sm rounded-pill ms-auto");
  saveBtn.type = "button";
  const refreshSave = () => {
    const saved = isSaved(entry.word);
    saveBtn.textContent = saved ? "Saved ✓" : "Save to My words";
    saveBtn.classList.toggle("btn-warning", saved);
    saveBtn.classList.toggle("btn-outline-success", !saved);
    // <mark> highlights the word when it is saved
    title.replaceChildren(makeEl(saved ? "mark" : "span", "", entry.word));
  };
  saveBtn.addEventListener("click", () => {
    toggleSaved(entry, first);
    refreshSave();
  });
  head.appendChild(saveBtn);
  body.appendChild(head);
  refreshSave();

  entry.meanings.forEach((meaning) => {
    body.appendChild(makeEl("span", "badge rounded-pill text-bg-success mt-4 mb-2 fst-italic", meaning.partOfSpeech));
    const list = makeEl("ol", "ps-3 mb-2");
    meaning.definitions.slice(0, 3).forEach((def) => {
      const li = makeEl("li", "mb-2", def.definition);
      if (def.example) li.appendChild(makeEl("div", "text-body-secondary fst-italic", `"${def.example}"`));
      list.appendChild(li);
    });
    body.appendChild(list);

    if (Array.isArray(meaning.synonyms) && meaning.synonyms.length) {
      const row = makeEl("div", "d-flex flex-wrap gap-2 align-items-center");
      row.appendChild(makeEl("small", "fw-bold", "Synonyms:"));
      meaning.synonyms.slice(0, 8).forEach((syn) => {
        const chip = makeEl("button", "btn btn-sm btn-outline-secondary rounded-pill");
        chip.type = "button";
        chip.appendChild(makeEl(isSaved(syn) ? "mark" : "span", "", syn));
        chip.addEventListener("click", () => {
          input.value = syn;
          searchWord(syn);
        });
        row.appendChild(chip);
      });
      body.appendChild(row);
    }
  });

  if (entry.sourceUrls && entry.sourceUrls.length) {
    const source = makeEl("p", "small text-body-secondary mt-4 mb-0", "Source: ");
    const link = makeEl("a", "", entry.sourceUrls[0]);
    link.href = entry.sourceUrls[0];
    link.target = "_blank";
    link.rel = "noopener";
    source.appendChild(link);
    body.appendChild(source);
  }
  card.appendChild(body);
  resultEl.appendChild(card);
}

// --- Saved words ---
function toggleSaved(entry, meaning) {
  const w = entry.word.toLowerCase();
  if (isSaved(w)) {
    words = words.filter((item) => item.word !== w);
  } else {
    words.push({ word: w, partOfSpeech: meaning.partOfSpeech, definition: meaning.definitions[0].definition, status: "new" });
  }
  persist();
}

function renderWords() {
  wordsListEl.innerHTML = "";
  if (words.length === 0) {
    wordsListEl.appendChild(makeEl("p", "text-center text-body-secondary py-5", "No words yet. Search a word and select Save to My words."));
    return;
  }
  words.forEach((item) => {
    const col = makeEl("div", "col-md-6");
    const card = makeEl("div", "card h-100 border-0 shadow-sm card-hover");
    const body = makeEl("div", "card-body d-flex flex-column");

    const top = makeEl("div", "d-flex justify-content-between align-items-start mb-1");
    top.appendChild(makeEl("h3", "h5 m-0")).appendChild(makeEl("mark", "", item.word));
    top.appendChild(makeEl("span", `badge ${STATUS_STYLE[item.status]}`, item.status));
    body.appendChild(top);
    body.appendChild(makeEl("small", "fst-italic text-body-secondary", item.partOfSpeech));
    body.appendChild(makeEl("p", "my-2 flex-grow-1", item.definition));

    const actions = makeEl("div", "d-flex gap-2");
    const open = makeEl("button", "btn btn-sm btn-outline-success rounded-pill", "Open");
    open.type = "button";
    open.addEventListener("click", () => {
      input.value = item.word;
      bootstrap.Tab.getOrCreateInstance(document.querySelector('[data-bs-target="#tab-search"]')).show();
      searchWord(item.word);
    });
    const remove = makeEl("button", "btn btn-sm btn-outline-danger rounded-pill", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      words = words.filter((w) => w.word !== item.word);
      persist();
    });
    actions.append(open, remove);
    body.appendChild(actions);
    card.appendChild(body);
    col.appendChild(card);
    wordsListEl.appendChild(col);
  });
}

// --- Practice (flashcards) ---
function updateProgress() {
  const known = words.filter((w) => w.status === "known").length;
  const percent = words.length ? Math.round((known / words.length) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressBar.parentElement.setAttribute("aria-valuenow", String(percent));
  progressText.textContent = words.length ? `${known} of ${words.length} words learned` : "";
}

function startPractice() {
  updateProgress();
  practiceAreaEl.innerHTML = "";

  if (words.length === 0) {
    practiceAreaEl.appendChild(makeEl("p", "text-center text-body-secondary py-5", "Save some words first, then come back to practise them."));
    return;
  }
  const pool = words.filter((w) => w.status !== "known" && w !== currentCard);
  const fallback = words.filter((w) => w.status !== "known");
  if (fallback.length === 0) {
    const done = makeEl("div", "text-center py-5");
    done.appendChild(makeEl("h3", "h4", "You know all your saved words!"));
    const reset = makeEl("button", "btn btn-success rounded-pill mt-2", "Practise them again");
    reset.type = "button";
    reset.addEventListener("click", () => {
      words.forEach((w) => (w.status = "new"));
      currentCard = null;
      persist();
      startPractice();
    });
    done.appendChild(reset);
    practiceAreaEl.appendChild(done);
    return;
  }

  const choices = pool.length ? pool : fallback;
  currentCard = choices[Math.floor(Math.random() * choices.length)];
  renderFlashcard(currentCard);
}

function renderFlashcard(item) {
  const flip = makeEl("div", "flip");
  flip.innerHTML = `<div class="flip-inner"><div class="flip-face flip-front"></div><div class="flip-face flip-back"></div></div>`;
  const front = flip.querySelector(".flip-front");
  const back = flip.querySelector(".flip-back");
  front.appendChild(makeEl("div", "flip-word", item.word));
  front.appendChild(makeEl("small", "text-body-secondary mt-3", "Tap the card to see the meaning"));
  back.appendChild(makeEl("small", "fst-italic text-body-secondary", item.partOfSpeech));
  back.appendChild(makeEl("p", "m-0 mt-2", item.definition));

  const answers = makeEl("div", "d-flex justify-content-center gap-2 mt-4 d-none");
  const learning = makeEl("button", "btn btn-warning rounded-pill", "Still learning");
  const known = makeEl("button", "btn btn-success rounded-pill", "Got it");
  learning.type = known.type = "button";
  learning.addEventListener("click", () => answer("learning"));
  known.addEventListener("click", () => answer("known"));
  answers.append(learning, known);

  flip.addEventListener("click", () => {
    flip.classList.toggle("flipped");
    answers.classList.remove("d-none");
  });

  practiceAreaEl.innerHTML = "";
  practiceAreaEl.append(flip, answers);
}

function answer(status) {
  currentCard.status = status;
  persist();
  startPractice();
}

// --- Theme ---
function applyTheme(theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);
  themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  try {
    localStorage.setItem("learn-theme", theme);
  } catch (error) {
    showMessage("Your theme changed, but this browser could not remember the preference.", "warning");
  }
}

// --- Events ---
form.addEventListener("submit", (event) => {
  event.preventDefault(); // no page reload
  searchWord(input.value);
});
themeToggle.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark");
});
document.getElementById("practice-tab").addEventListener("shown.bs.tab", startPractice);

// --- Start ---
let savedTheme = "light";
try {
  savedTheme = localStorage.getItem("learn-theme") || "light";
} catch (error) {
  showMessage("Browser storage is unavailable. Your theme and saved words may not persist.", "warning");
}
applyTheme(savedTheme === "dark" ? "dark" : "light");
savedCountEl.textContent = words.length;
renderWords();
