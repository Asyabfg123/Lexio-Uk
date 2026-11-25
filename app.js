// LexiGo — общий движок для starter.html и pro.html.
// Каждая страница задаёт window.LEXI_CONFIG = { storageKey, levels: [{id, title}], words: [...] }
// Формат слова: [en, транскрипция, перевод, пример EN, пример RU] внутри объекта уровня.
(function () {
  "use strict";

  const CFG = window.LEXI_CONFIG;

  // Разворачиваем компактный словарь в объекты
  const WORDS = [];
  for (const levelId of Object.keys(CFG.words)) {
    CFG.words[levelId].forEach((row, i) => {
      WORDS.push({
        id: levelId.toLowerCase() + "_" + row[0],
        level: levelId,
        en: row[0], tr: row[1], ru: row[2], exEn: row[3], exRu: row[4]
      });
    });
  }
  const BY_LEVEL = {};
  for (const w of WORDS) (BY_LEVEL[w.level] = BY_LEVEL[w.level] || []).push(w);

  // ---------- Хранилище ----------
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(CFG.storageKey)) || {}; } catch (e) { return {}; }
  }
  const saved = loadSaved();

  const state = {
    level: BY_LEVEL[saved.level] ? saved.level : CFG.levels[0].id,
    mode: ["cards", "ru2en", "en2ru"].includes(saved.mode) ? saved.mode : "cards",
    lang: saved.lang === "en-US" ? "en-US" : "en-GB",
    known: new Set(saved.known || []),
    queue: [],
    word: null,
    flipped: false,
    answered: false,
    selectedIdx: null,
    options: []
  };

  function persist() {
    try {
      localStorage.setItem(CFG.storageKey, JSON.stringify({
        level: state.level, mode: state.mode, lang: state.lang, known: [...state.known]
      }));
    } catch (e) { /* приватный режим и т.п. — просто не сохраняем */ }
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

  // Очередь: сначала невыученные слова (в случайном порядке), потом выученные — для повторения
  function buildQueue() {
    const pool = BY_LEVEL[state.level];
    const fresh = shuffle(pool.filter(w => !state.known.has(w.id)));
    const learned = shuffle(pool.filter(w => state.known.has(w.id)));
    state.queue = fresh.concat(learned);
  }

  function nextWord() {
    if (!state.queue.length) buildQueue();
    // не показываем одно и то же слово два раза подряд
    if (state.word && state.queue.length > 1 && state.queue[0].id === state.word.id) {
      state.queue.push(state.queue.shift());
    }
    state.word = state.queue.shift();
    state.flipped = false;
    state.answered = false;
    state.selectedIdx = null;
    state.options = [];
  }

  // Слово, которое ещё не выучено, возвращается в очередь через пару карточек
  function requeue(word) {
    const pos = Math.min(3, state.queue.length);
    state.queue.splice(pos, 0, word);
  }

  function markKnown(word) { state.known.add(word.id); persist(); }
  function markUnknown(word) { state.known.delete(word.id); persist(); }

  function buildOptions(word, mode) {
    const key = mode === "ru2en" ? "en" : "ru";
    const used = new Set([word[key]]);
    const picks = [];
    const candidates = shuffle(BY_LEVEL[word.level]).concat(shuffle(WORDS));
    for (const w of candidates) {
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
  function loadVoices() {
    if ("speechSynthesis" in window) voices = window.speechSynthesis.getVoices() || [];
  }
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

  function renderChrome() {
    const pool = BY_LEVEL[state.level];
    const knownInLevel = pool.filter(w => state.known.has(w.id)).length;
    $("accentBtn").textContent = state.lang === "en-GB" ? "🇬🇧 UK" : "🇺🇸 US";
    $("progressText").textContent = `Выучено ${knownInLevel} / ${pool.length}`;
    $("progressFill").style.width = `${(knownInLevel / pool.length) * 100}%`;
    document.querySelectorAll(".level-btn").forEach(b => b.classList.toggle("active", b.dataset.level === state.level));
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === state.mode));
  }

  function renderCards(stage, w) {
    stage.innerHTML = `
      <div class="flashcard" id="flashcard">
        <div>
          <div class="label">Уровень ${w.level}${state.known.has(w.id) ? " · повторение" : ""}</div>
          <div class="word-en">${w.en}</div>
          <div class="ru-trans">${w.tr}</div>
          <div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 Прослушать</button></div>
          ${state.flipped ? `
            <div class="answer-box">
              <div class="word-ru">${w.ru}</div>
              <div class="example-en">${w.exEn}</div>
              <div class="example-ru">${w.exRu}</div>
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
    const stage = $("stage");
    if (state.mode === "cards") renderCards(stage, state.word);
    else renderQuiz(stage, state.word);
  }

  // ---------- Шапка ----------
  function buildChrome() {
    const lv = $("levelsBar");
    lv.style.gridTemplateColumns = `repeat(${CFG.levels.length}, 1fr)`;
    lv.innerHTML = CFG.levels.map(l =>
      `<button class="level-btn" data-level="${l.id}" type="button">${l.id}<small>${l.title} · ${BY_LEVEL[l.id].length}</small></button>`
    ).join("");

    lv.addEventListener("click", e => {
      const b = e.target.closest(".level-btn");
      if (!b || b.dataset.level === state.level) return;
      state.level = b.dataset.level;
      persist();
      state.word = null;
      buildQueue();
      nextWord();
      render();
    });

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
      if (!confirm(`Сбросить прогресс уровня ${state.level}?`)) return;
      BY_LEVEL[state.level].forEach(w => state.known.delete(w.id));
      persist();
      state.word = null;
      buildQueue();
      nextWord();
      render();
    });
  }

  buildChrome();
  buildQueue();
  nextWord();
  render();
})();
