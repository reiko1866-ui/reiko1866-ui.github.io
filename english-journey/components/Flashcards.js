window.EJComponents = window.EJComponents || {};

window.EJComponents.flashcards = function flashcardsScreen() {
  return `
    <div class="mb-3 flex items-end justify-between">
      <div>
        <h2 class="text-lg font-bold text-slate-900">Szókincs</h2>
        <p class="text-sm text-slate-500">Koppints a kártyára, majd dönts.</p>
      </div>
      <p class="text-sm font-semibold tabular-nums text-teal-800">
        <span id="card-position">1</span>/<span id="card-total">0</span>
      </p>
    </div>

    <div class="mb-3 h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/60">
      <div id="deck-progress" class="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-500" style="width: 0%"></div>
    </div>

    <div id="flashcard-stage">
      <div class="perspective">
        <div id="flashcard" class="flip-card w-full cursor-pointer" role="button" tabindex="0" aria-label="Kártya megfordítása">
          <article class="flip-face flex flex-col items-center justify-between rounded-[1.75rem] bg-white p-6 shadow-card ring-1 ring-slate-200/70">
            <div class="w-full text-center">
              <span class="inline-flex rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-teal-700">English</span>
            </div>
            <div class="flex flex-col items-center">
              <div id="card-icon" class="mb-4 grid h-24 w-24 place-items-center rounded-[1.75rem] bg-gradient-to-br from-teal-50 to-amber-50 text-5xl shadow-inner ring-1 ring-teal-100">🍏</div>
              <p id="card-word" class="text-4xl font-extrabold tracking-tight text-slate-900">apple</p>
              <p id="card-phonetic" class="mt-1 text-base text-slate-400">/ˈæp.əl/</p>
              <button id="speak-btn" type="button" class="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-700 px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_18px_-12px_rgba(15,118,110,0.9)] transition hover:bg-teal-600 active:scale-95">
                <span aria-hidden="true">🔊</span>
                Kiejtés
              </button>
            </div>
            <p class="text-xs font-medium text-slate-400">Koppints a jelentéshez</p>
          </article>
          <article class="flip-face flip-face-back flex flex-col items-center justify-between rounded-[1.75rem] bg-gradient-to-b from-white to-teal-50/60 p-6 shadow-card ring-1 ring-teal-100">
            <div class="w-full text-center">
              <span class="inline-flex rounded-full bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700">Magyar</span>
            </div>
            <div class="text-center">
              <p id="card-meaning" class="text-3xl font-extrabold text-slate-900">alma</p>
              <p class="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-teal-700/80">Példamondat</p>
              <p id="card-example" class="mt-2 text-lg font-semibold leading-snug text-slate-800">I eat an apple.</p>
              <p id="card-example-hu" class="mt-1 text-sm text-slate-500">Eszem egy almát.</p>
            </div>
            <p class="text-xs font-medium text-slate-400">Koppints a visszafordításhoz</p>
          </article>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <button id="know-btn" type="button" class="rounded-2xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_20px_-12px_rgba(5,150,105,0.9)] transition hover:bg-emerald-500 active:scale-[0.98]">
          Tudom
        </button>
        <button id="practice-btn" type="button" class="rounded-2xl bg-amber-400 px-4 py-3.5 text-sm font-bold text-amber-950 shadow-[0_10px_20px_-12px_rgba(245,158,11,0.9)] transition hover:bg-amber-300 active:scale-[0.98]">
          Még gyakorlom
        </button>
      </div>
    </div>

    <div id="deck-complete" class="hidden animate-pop rounded-[1.75rem] bg-white p-6 text-center shadow-card ring-1 ring-slate-200/70">
      <div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-teal-50 text-3xl">🎉</div>
      <h3 class="text-xl font-extrabold text-slate-900">Szép munka!</h3>
      <p class="mt-2 text-sm leading-relaxed text-slate-500">Végigmentél a mai szókártyákon. A „még gyakorlom” szavakkal újra kezdheted.</p>
      <button id="restart-btn" type="button" class="mt-5 w-full rounded-2xl bg-teal-700 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-teal-600 active:scale-[0.99]">
        Új kör
      </button>
    </div>
  `;
};
