// LexiGo — одно приложение, общий список слов от частых к редким, блоками по 100.
// Слова лежат в words-NN.js (по 250 штук): каждый файл добавляет строки в window.LEXI_WORDS.
// Формат строки: [английское слово, транскрипция с ударением, перевод, пример EN, пример RU]
(function () {
  "use strict";

  const STORAGE = "lexigo_all_v1";
  const BLOCK = 100;

  // ---------- Словарь ----------
  const WORDS = [];
  const seen = new Set();
  for (const r of window.LEXI_WORDS || []) {
    const id = r[0].toLowerCase();
    if (seen.has(id)) continue; // дубли пропускаем
    seen.add(id);
    WORDS.push({ id, n: WORDS.length + 1, en: r[0], tr: r[1], ru: r[2], exEn: r[3] || "", exRu: r[4] || "" });
  }
  const BLOCKS = [];
  for (let i = 0; i < WORDS.length; i += BLOCK) BLOCKS.push(WORDS.slice(i, i + BLOCK));

  // ---------- Хранилище ----------
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; }
  }
  let saved = readJSON(STORAGE);
  if (!saved) {
    // переносим прогресс из старых Starter / Pro
    const known = [];
    for (const k of ["lexistarter_v2", "lexipro_v2"]) {
      const old = readJSON(k);
      if (old && old.known) old.known.forEach(id => known.push(id.replace(/^[abc][12]_/, "")));
    }
    saved = { known };
  }

  const state = {
    block: 0,
    mode: ["cards", "ru2en", "en2ru"].includes(saved.mode) ? saved.mode : "cards",
    lang: saved.lang === "en-US" ? "en-US" : "en-GB",
    known: new Set((saved.known || []).filter(id => seen.has(id))),
    queue: [],
    word: null,
    flipped: false,
    answered: false,
    selectedIdx: null,
    options: []
  };

  function knownIn(block) { return BLOCKS[block].filter(w => state.known.has(w.id)).length; }
  function firstUnfinished() {
    for (let i = 0; i < BLOCKS.length; i++) if (knownIn(i) < BLOCKS[i].length) return i;
    return 0;
  }
  state.block = Number.isInteger(saved.block) && BLOCKS[saved.block] ? saved.block : firstUnfinished();

  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        block: state.block, mode: state.mode, lang: state.lang, known: [...state.known]
      }));
    } catch (e) { /* приватный режим — просто не сохраняем */ }
  }

  // ---------- Утилиты ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Очередь блока: сначала невыученные, потом выученные — для повторения
  function buildQueue() {
    const pool = BLOCKS[state.block];
    state.queue = shuffle(pool.filter(w => !state.known.has(w.id)))
      .concat(shuffle(pool.filter(w => state.known.has(w.id))));
  }

  function nextWord() {
    if (!state.queue.length) buildQueue();
    if (state.word && state.queue.length > 1 && state.queue[0].id === state.word.id) {
      state.queue.push(state.queue.shift());
    }
    state.word = state.queue.shift();
    state.flipped = false;
    state.answered = false;
    state.selectedIdx = null;
    state.options = [];
  }

  function requeue(word) { state.queue.splice(Math.min(3, state.queue.length), 0, word); }
  function markKnown(w) { state.known.add(w.id); persist(); }
  function markUnknown(w) { state.known.delete(w.id); persist(); }

  // Неправильные варианты — из того же и соседних блоков, чтобы сложность была похожей
  function buildOptions(word, mode) {
    const key = mode === "ru2en" ? "en" : "ru";
    const near = [];
    for (let b = state.block - 1; b <= state.block + 1; b++) if (BLOCKS[b]) near.push(...BLOCKS[b]);
    const used = new Set([word[key]]);
    const picks = [];
    for (const w of shuffle(near)) {
      if (picks.length === 3) break;
      if (w.id === word.id || used.has(w[key])) continue;
      used.add(w[key]);
      picks.push(w);
    }
    return shuffle([word].concat(picks)).map(w => ({
      label: mode === "ru2en" ? w.en : w.ru,
      sub: mode === "ru2en" ? w.tr : "",
      isCorrect: w.id === word.id
    }));
  }

  // ---------- Озвучка ----------
  const PREFERRED = {
    "en-GB": ["Daniel", "Serena", "Kate", "Arthur", "Martha", "Oliver", "Stephanie", "Google UK English"],
    "en-US": ["Samantha", "Alex", "Ava", "Allison", "Tom", "Google US English"]
  };
  let voices = [];
  function loadVoices() { if ("speechSynthesis" in window) voices = window.speechSynthesis.getVoices() || []; }
  function pickVoice(lang) {
    const norm = v => (v.lang || "").replace("_", "-").toLowerCase();
    const exact = voices.filter(v => norm(v) === lang.toLowerCase());
    for (const name of PREFERRED[lang]) {
      const v = exact.find(x => x.name.indexOf(name) === 0);
      if (v) return v;
    }
    return exact[0] || null;
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!voices.length) loadVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.lang;
    u.rate = 0.9;
    const v = pickVoice(state.lang);
    if (v) u.voice = v;
    synth.speak(u);
  }
  if ("speechSynthesis" in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  // ---------- Отрисовка ----------
  const $ = id => document.getElementById(id);

  function blockLabel(i) {
    const from = i * BLOCK + 1;
    const to = from + BLOCKS[i].length - 1;
    const k = knownIn(i);
    return `Слова ${from}–${to} · ${k === BLOCKS[i].length ? "✓" : k + "/" + BLOCKS[i].length}`;
  }

  function renderChrome() {
    const sel = $("blockSelect");
    sel.innerHTML = BLOCKS.map((_, i) => `<option value="${i}">${blockLabel(i)}</option>`).join("");
    sel.value = String(state.block);
    $("prevBlock").disabled = state.block === 0;
    $("nextBlock").disabled = state.block === BLOCKS.length - 1;

    const k = knownIn(state.block);
    const total = BLOCKS[state.block].length;
    $("progressText").textContent = `Блок: ${k} / ${total}`;
    $("progressFill").style.width = `${(k / total) * 100}%`;
    $("totalBadge").textContent = `${state.known.size} / ${WORDS.length}`;
    $("accentBtn").textContent = state.lang === "en-GB" ? "🇬🇧 UK" : "🇺🇸 US";
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === state.mode));
  }

  function renderCards(stage, w) {
    stage.innerHTML = `
      <div class="flashcard" id="flashcard">
        <div>
          <div class="label">№ ${w.n}${state.known.has(w.id) ? " · повторение" : ""}</div>
          <div class="word-en">${w.en}</div>
          <div class="ru-trans">${w.tr}</div>
          <div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 Прослушать</button></div>
          ${state.flipped ? `
            <div class="answer-box">
              <div class="word-ru">${w.ru}</div>
              ${w.exEn ? `<div class="example-en">${w.exEn}</div><div class="example-ru">${w.exRu}</div>` : ""}
            </div>` : ""}
        </div>
        <div class="hint">${state.flipped ? "Нажми на карточку, чтобы скрыть перевод" : "Нажми на карточку, чтобы увидеть перевод"}</div>
      </div>
      <div class="actions">
        <button class="btn btn-hard" id="hardBtn" type="button">Ещё учу</button>
        <button class="btn btn-easy" id="easyBtn" type="button">Знаю</button>
      </div>`;

    $("speakBtn").addEventListener("click", e => { e.stopPropagation(); speak(w.en); });
    $("flashcard").addEventListener("click", () => { state.flipped = !state.flipped; render(); });
    $("hardBtn").addEventListener("click", () => { markUnknown(w); requeue(w); nextWord(); render(); });
    $("easyBtn").addEventListener("click", () => { markKnown(w); nextWord(); render(); });
  }

  function renderQuiz(stage, w) {
    const ruToEn = state.mode === "ru2en";
    if (!state.options.length) state.options = buildOptions(w, state.mode);

    let feedback = "Выбери один из 4 вариантов";
    if (state.answered) {
      const ok = state.options[state.selectedIdx].isCorrect;
      feedback = `${ok ? "✅ Верно!" : "❌ Правильно:"} <b>${w.en}</b> <span style="color:var(--accent-soft)">${w.tr}</span> — ${w.ru}`;
    }

    stage.innerHTML = `
      <div class="quiz-card">
        <div>
          <div class="label">${ruToEn ? "Переведи на английский" : "Переведи на русский"}</div>
          <div class="quiz-word">${ruToEn ? w.ru : w.en}</div>
          ${!ruToEn ? `
            <div class="ru-trans quiz-trans">${w.tr}</div>
            <div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 Прослушать</button></div>` : ""}
        </div>
        <div class="options" id="options"></div>
        <div class="feedback">${feedback}</div>
        ${state.answered ? `
          ${ruToEn ? `<div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 ${w.en}</button></div>` : ""}
          <button class="btn btn-primary" id="nextBtn" type="button">Следующее слово →</button>` : ""}
      </div>`;

    const sb = $("speakBtn");
    if (sb) sb.addEventListener("click", () => speak(w.en));

    const list = $("options");
    state.options.forEach((opt, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt-btn";
      b.innerHTML = `<div>${opt.label}</div>${opt.sub ? `<div class="sub">${opt.sub}</div>` : ""}`;
      if (state.answered) {
        b.disabled = true;
        if (opt.isCorrect) b.classList.add("correct");
        else if (idx === state.selectedIdx) b.classList.add("wrong");
      }
      b.addEventListener("click", () => {
        if (state.answered) return;
        state.answered = true;
        state.selectedIdx = idx;
        if (opt.isCorrect) markKnown(w);
        else { markUnknown(w); requeue(w); }
        speak(w.en);
        render();
      });
      list.appendChild(b);
    });

    const nb = $("nextBtn");
    if (nb) nb.addEventListener("click", () => { nextWord(); render(); });
  }

  function render() {
    renderChrome();
    if (state.mode === "cards") renderCards($("stage"), state.word);
    else renderQuiz($("stage"), state.word);
  }

  function goToBlock(i) {
    if (!BLOCKS[i] || i === state.block) return;
    state.block = i;
    persist();
    state.word = null;
    buildQueue();
    nextWord();
    render();
  }

  // ---------- Управление ----------
  $("blockSelect").addEventListener("change", e => goToBlock(Number(e.target.value)));
  $("prevBlock").addEventListener("click", () => goToBlock(state.block - 1));
  $("nextBlock").addEventListener("click", () => goToBlock(state.block + 1));

  $("modesBar").addEventListener("click", e => {
    const b = e.target.closest(".mode-btn");
    if (!b) return;
    state.mode = b.dataset.mode;
    persist();
    state.flipped = false;
    state.answered = false;
    state.selectedIdx = null;
    state.options = [];
    render();
  });

  $("accentBtn").addEventListener("click", () => {
    state.lang = state.lang === "en-GB" ? "en-US" : "en-GB";
    persist();
    renderChrome();
    if (state.word) speak(state.word.en);
  });

  $("resetBtn").addEventListener("click", () => {
    const from = state.block * BLOCK + 1;
    if (!confirm(`Сбросить прогресс слов ${from}–${from + BLOCKS[state.block].length - 1}?`)) return;
    BLOCKS[state.block].forEach(w => state.known.delete(w.id));
    persist();
    state.word = null;
    buildQueue();
    nextWord();
    render();
  });

  if (!WORDS.length) {
    $("stage").innerHTML = `<div class="quiz-card"><div class="feedback">Словарь не загрузился. Обнови страницу.</div></div>`;
    return;
  }
  buildQueue();
  nextWord();
  render();
})();
