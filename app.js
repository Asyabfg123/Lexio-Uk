// LexiGo — одно приложение, слова разбиты по уровням A1–C1, внутри уровня — блоки по 100.
// Слова лежат в words-NN.js. Формат строки:
// [английское слово, транскрипция, перевод, пример EN, пример RU, уровень (необязательно)]
// Уровень берётся из строки, иначе из levels.js (window.LEXI_LEVELS), иначе A1.
(function () {
  "use strict";

  const STORAGE = "lexigo_all_v1";
  const BLOCK = 100;
  const LEVELS = [
    { id: "A1", title: "Начальный" },
    { id: "A2", title: "Элементарный" },
    { id: "B1", title: "Средний" },
    { id: "B2", title: "Выше среднего" },
    { id: "C1", title: "Продвинутый" }
  ];

  // ---------- Словарь ----------
  const levelOf = {};
  const map = window.LEXI_LEVELS || {};
  for (const lv of Object.keys(map)) {
    for (const w of map[lv].split("|")) if (w.trim()) levelOf[w.trim().toLowerCase()] = lv;
  }

  const WORDS = [];
  const seen = new Set();
  // Британская транскрипция IPA из ipa-NN.js (window.LEXI_IPA: слово → транскрипция без слешей)
  const IPA = window.LEXI_IPA || {};
  const ipaHtml = w => w.ipa ? `<div class="ipa">/${w.ipa}/</div>` : "";
  const enById = {};
  for (const r of window.LEXI_WORDS || []) {
    let id = r[0].toLowerCase();
    // "may" и "May" — разные слова; настоящие дубли пропускаем
    if (seen.has(id) && enById[id] !== r[0]) id = r[0];
    if (seen.has(id)) continue;
    seen.add(id);
    enById[id] = r[0];
    WORDS.push({
      id, en: r[0], tr: r[1], ru: r[2], exEn: r[3] || "", exRu: r[4] || "",
      level: r[5] || levelOf[id] || "A1",
      ipa: IPA[r[0]] || IPA[id] || ""
    });
  }
  const BY_LEVEL = {};
  for (const l of LEVELS) BY_LEVEL[l.id] = [];
  for (const w of WORDS) (BY_LEVEL[w.level] || BY_LEVEL.A1).push(w);
  const BLOCKS = {};
  for (const l of LEVELS) {
    BLOCKS[l.id] = [];
    const list = BY_LEVEL[l.id];
    list.forEach((w, i) => { w.n = i + 1; });
    for (let i = 0; i < list.length; i += BLOCK) BLOCKS[l.id].push(list.slice(i, i + BLOCK));
  }

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
    level: "A1",
    blockByLevel: saved.blockByLevel || {},
    mode: ["cards", "ru2en", "en2ru"].includes(saved.mode) ? saved.mode : "cards",
    lang: saved.lang === "en-US" ? "en-US" : "en-GB",
    known: new Set((saved.known || []).filter(id => seen.has(id))),
    // Слова, отмеченные в карточках «Ещё учу», — только они попадают в тесты
    study: new Set((saved.study || []).filter(id => seen.has(id))),
    queue: [],
    word: null,
    qQueue: [],
    qWord: null,
    flipped: false,
    answered: false,
    selectedIdx: null,
    options: []
  };

  const blocks = () => BLOCKS[state.level];
  function knownIn(list) { return list.filter(w => state.known.has(w.id)).length; }
  function firstUnfinished(level) {
    const b = BLOCKS[level];
    for (let i = 0; i < b.length; i++) if (knownIn(b[i]) < b[i].length) return i;
    return 0;
  }
  function blockIdx() {
    const i = state.blockByLevel[state.level];
    return Number.isInteger(i) && blocks()[i] ? i : firstUnfinished(state.level);
  }

  const firstFilled = (LEVELS.find(l => BY_LEVEL[l.id].length) || LEVELS[0]).id;
  state.level = BY_LEVEL[saved.level] && BY_LEVEL[saved.level].length ? saved.level : firstFilled;

  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        level: state.level, blockByLevel: state.blockByLevel,
        mode: state.mode, lang: state.lang, known: [...state.known], study: [...state.study]
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
    const pool = blocks()[blockIdx()];
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
  function markKnown(w) { state.known.add(w.id); state.study.delete(w.id); persist(); }
  function markUnknown(w) { state.known.delete(w.id); state.study.add(w.id); persist(); }

  // ---------- Тесты: только слова из списка «Ещё учу» ----------
  const studyWords = () => WORDS.filter(w => state.study.has(w.id));
  function nextQuiz() {
    state.qQueue = state.qQueue.filter(w => state.study.has(w.id));
    if (!state.qQueue.length) state.qQueue = shuffle(studyWords());
    if (state.qWord && state.qQueue.length > 1 && state.qQueue[0].id === state.qWord.id) {
      state.qQueue.push(state.qQueue.shift());
    }
    state.qWord = state.qQueue.shift() || null;
    state.answered = false;
    state.selectedIdx = null;
    state.options = [];
  }
  function requeueQuiz(word) { state.qQueue.splice(Math.min(3, state.qQueue.length), 0, word); }

  // Неправильные варианты — из того же уровня, что и слово
  function buildOptions(word, mode) {
    const key = mode === "ru2en" ? "en" : "ru";
    const pool = shuffle(BY_LEVEL[word.level] || []).concat(shuffle(WORDS));
    const used = new Set([word[key]]);
    const picks = [];
    for (const w of pool) {
      if (picks.length === 3) break;
      if (w.id === word.id || used.has(w[key])) continue;
      used.add(w[key]);
      picks.push(w);
    }
    return shuffle([word].concat(picks)).map(w => ({
      label: mode === "ru2en" ? w.en : w.ru,
      sub: mode === "ru2en" ? (w.ipa ? `/${w.ipa}/ · ` : "") + w.tr : "",
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
    const list = blocks()[i];
    const from = i * BLOCK + 1;
    const to = from + list.length - 1;
    const k = knownIn(list);
    return `Слова ${from}–${to} · ${k === list.length ? "✓" : k + "/" + list.length}`;
  }

  function renderChrome() {
    document.querySelectorAll(".level-btn").forEach(b => {
      const id = b.dataset.level;
      const list = BY_LEVEL[id];
      b.classList.toggle("active", id === state.level);
      b.disabled = !list.length;
      b.querySelector("small").textContent = list.length ? `${knownIn(list)}/${list.length}` : "скоро";
    });

    const sel = $("blockSelect");
    const bi = blockIdx();
    sel.innerHTML = blocks().map((_, i) => `<option value="${i}">${blockLabel(i)}</option>`).join("");
    sel.value = String(bi);
    $("prevBlock").disabled = bi === 0;
    $("nextBlock").disabled = bi === blocks().length - 1;

    const list = blocks()[bi];
    const k = knownIn(list);
    $("progressText").textContent = `Блок: ${k} / ${list.length}`;
    $("progressFill").style.width = `${(k / list.length) * 100}%`;
    $("totalBadge").textContent = `${state.known.size} / ${WORDS.length}`;
    $("accentBtn").textContent = state.lang === "en-GB" ? "🇬🇧 UK" : "🇺🇸 US";
    const n = state.study.size;
    const labels = { cards: "1. Карточки", ru2en: "2. Рус → Англ", en2ru: "3. Англ → Рус" };
    document.querySelectorAll(".mode-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === state.mode);
      b.innerHTML = labels[b.dataset.mode] + (b.dataset.mode === "cards" ? "" : `<small class="mode-count">${n}</small>`);
    });

    // В тестах уровни и блоки не нужны — показываем, сколько слов на изучении
    const quiz = state.mode !== "cards";
    $("levelsBar").style.display = quiz ? "none" : "";
    document.querySelector(".block-bar").style.display = quiz ? "none" : "";
    document.querySelector(".progress-wrap").style.display = quiz ? "none" : "";
    $("studyInfo").style.display = quiz ? "" : "none";
    $("studyInfo").textContent = `На изучении: ${n} ${plural(n, "слово", "слова", "слов")} · сюда попадают слова, отмеченные «Ещё учу»`;
    $("resetBtn").textContent = quiz ? "Очистить" : "Сброс";
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function renderCards(stage, w) {
    stage.innerHTML = `
      <div class="flashcard" id="flashcard">
        <div>
          <div class="label">${w.level} · № ${w.n}${state.study.has(w.id) ? " · на изучении" : state.known.has(w.id) ? " · повторение" : ""}</div>
          <div class="word-en">${w.en}</div>
          ${ipaHtml(w)}
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
    if (!w) {
      stage.innerHTML = `
        <div class="quiz-card">
          <div class="label">Пока пусто</div>
          <div class="feedback">В тесты попадают только слова, которые ты отметил «Ещё учу» в карточках. Отметь несколько слов — и они появятся здесь.</div>
          <button class="btn btn-primary" id="toCardsBtn" type="button">Перейти к карточкам</button>
        </div>`;
      $("toCardsBtn").addEventListener("click", () => setMode("cards"));
      return;
    }
    if (!state.options.length) state.options = buildOptions(w, state.mode);

    let feedback = "Выбери один из 4 вариантов";
    if (state.answered) {
      const ok = state.options[state.selectedIdx].isCorrect;
      feedback = `${ok ? "✅ Верно!" : "❌ Правильно:"} <b>${w.en}</b>${w.ipa ? ` <span class="ipa-inline">/${w.ipa}/</span>` : ""} <span style="color:var(--accent-soft)">${w.tr}</span> — ${w.ru}`;
    }

    stage.innerHTML = `
      <div class="quiz-card">
        <div>
          <div class="label">${ruToEn ? "Переведи на английский" : "Переведи на русский"}</div>
          <div class="quiz-word">${ruToEn ? w.ru : w.en}</div>
          ${!ruToEn ? `
            ${ipaHtml(w)}
            <div class="ru-trans quiz-trans">${w.tr}</div>
            <div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 Прослушать</button></div>` : ""}
        </div>
        <div class="options" id="options"></div>
        <div class="feedback">${feedback}</div>
        ${state.answered ? `
          ${ruToEn ? `<div class="center"><button class="audio-btn" id="speakBtn" type="button">🔊 ${w.en}</button></div>` : ""}
          <button class="btn btn-primary" id="nextBtn" type="button">Следующее слово →</button>
          ${state.options[state.selectedIdx].isCorrect ? `<button class="btn btn-easy" id="learnedBtn" type="button">✓ Выучил — убрать из изучения</button>` : ""}` : ""}
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
        if (!opt.isCorrect) requeueQuiz(w); // ошибка — слово вернётся через пару вопросов
        speak(w.en);
        render();
      });
      list.appendChild(b);
    });

    const nb = $("nextBtn");
    if (nb) nb.addEventListener("click", () => { nextQuiz(); render(); });
    const lb = $("learnedBtn");
    if (lb) lb.addEventListener("click", () => { markKnown(w); nextQuiz(); render(); });
  }

  function render() {
    renderChrome();
    if (state.mode === "cards") renderCards($("stage"), state.word);
    else renderQuiz($("stage"), state.qWord);
  }

  function setMode(mode) {
    state.mode = mode;
    persist();
    state.flipped = false;
    if (mode !== "cards" && (!state.qWord || !state.study.has(state.qWord.id))) nextQuiz();
    state.answered = false;
    state.selectedIdx = null;
    state.options = [];
    render();
  }

  function restart() {
    persist();
    state.word = null;
    buildQueue();
    nextWord();
    render();
  }

  function goToBlock(i) {
    if (!blocks()[i] || i === blockIdx()) return;
    state.blockByLevel[state.level] = i;
    restart();
  }

  // ---------- Управление ----------
  $("levelsBar").innerHTML = LEVELS.map(l =>
    `<button class="level-btn" data-level="${l.id}" type="button">${l.id}<small></small></button>`).join("");
  $("levelsBar").addEventListener("click", e => {
    const b = e.target.closest(".level-btn");
    if (!b || b.disabled || b.dataset.level === state.level) return;
    state.level = b.dataset.level;
    restart();
  });

  $("blockSelect").addEventListener("change", e => goToBlock(Number(e.target.value)));
  $("prevBlock").addEventListener("click", () => goToBlock(blockIdx() - 1));
  $("nextBlock").addEventListener("click", () => goToBlock(blockIdx() + 1));

  $("modesBar").addEventListener("click", e => {
    const b = e.target.closest(".mode-btn");
    if (!b) return;
    setMode(b.dataset.mode);
  });

  $("accentBtn").addEventListener("click", () => {
    state.lang = state.lang === "en-GB" ? "en-US" : "en-GB";
    persist();
    renderChrome();
    if (state.word) speak(state.word.en);
  });

  $("resetBtn").addEventListener("click", () => {
    if (state.mode !== "cards") {
      if (!state.study.size || !confirm(`Очистить список изучения (${state.study.size})?`)) return;
      state.study.clear();
      persist();
      state.qQueue = [];
      nextQuiz();
      render();
      return;
    }
    const bi = blockIdx();
    const from = bi * BLOCK + 1;
    const list = blocks()[bi];
    if (!confirm(`Сбросить прогресс ${state.level}, слова ${from}–${from + list.length - 1}?`)) return;
    list.forEach(w => state.known.delete(w.id));
    restart();
  });

  if (!WORDS.length) {
    $("stage").innerHTML = `<div class="quiz-card"><div class="feedback">Словарь не загрузился. Обнови страницу.</div></div>`;
    return;
  }
  buildQueue();
  nextWord();
  nextQuiz();
  render();
})();
