window.EJComponents = window.EJComponents || {};

window.EJComponents.sentenceBuilder = function sentenceBuilderScreen() {
  return `
    <div class="mb-3 flex items-end justify-between">
      <div>
        <h2 class="text-lg font-bold text-slate-900">Mondatépítő</h2>
        <p class="text-sm text-slate-500">Rakd össze a szavakat helyes angol mondattá.</p>
      </div>
      <p class="text-sm font-semibold tabular-nums text-violet-800">
        <span id="builder-position">1</span>/<span id="builder-total">0</span>
      </p>
    </div>

    <div class="mb-3 h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200/60">
      <div id="builder-progress" class="h-full rounded-full bg-gradient-to-r from-violet-500 to-teal-400 transition-all duration-500" style="width: 0%"></div>
    </div>

    <div id="builder-stage">
      <article id="builder-card" class="rounded-[1.75rem] bg-white p-5 shadow-card ring-1 ring-slate-200/70">
        <div class="flex items-start justify-between gap-3">
          <div id="builder-icon" class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-50 to-teal-50 text-3xl ring-1 ring-violet-100">🍏</div>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-700">Fordítsd le</p>
            <p id="builder-prompt" class="mt-1 text-xl font-extrabold leading-snug text-slate-900">Eszem egy almát.</p>
          </div>
        </div>

        <div id="builder-sentence" class="builder-sentence mt-5 flex min-h-[6.5rem] flex-wrap content-start gap-2 rounded-[1.35rem] bg-slate-50 p-3 ring-1 ring-dashed ring-slate-200" aria-live="polite"></div>

        <p class="mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Szavak</p>
        <div id="builder-bank" class="mt-2 flex min-h-[4.5rem] flex-wrap content-start gap-2"></div>

        <p id="builder-feedback" class="mt-4 min-h-[1.25rem] text-sm font-semibold" role="status"></p>
      </article>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <button id="builder-check" type="button" class="rounded-2xl bg-violet-700 px-4 py-3.5 text-sm font-bold text-white shadow-[0_10px_20px_-12px_rgba(109,40,217,0.9)] transition hover:bg-violet-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">
          Ellenőrzés
        </button>
        <button id="builder-clear" type="button" class="rounded-2xl bg-white px-4 py-3.5 text-sm font-bold text-slate-700 shadow-soft ring-1 ring-slate-200/80 transition hover:bg-slate-50 active:scale-[0.98]">
          Törlés
        </button>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-3">
        <button id="builder-speak" type="button" class="rounded-2xl bg-white px-4 py-3 text-sm font-bold text-teal-800 shadow-soft ring-1 ring-slate-200/80 transition hover:bg-teal-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:text-slate-400" disabled>
          🔊 Kiejtés
        </button>
        <button id="builder-next" type="button" class="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-[0_10px_20px_-12px_rgba(5,150,105,0.9)] transition hover:bg-emerald-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none" disabled>
          Következő
        </button>
      </div>
    </div>

    <div id="builder-complete" class="hidden animate-pop rounded-[1.75rem] bg-white p-6 text-center shadow-card ring-1 ring-slate-200/70">
      <div class="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-violet-50 text-3xl">🧩</div>
      <h3 class="text-xl font-extrabold text-slate-900">Mondatok kész!</h3>
      <p class="mt-2 text-sm leading-relaxed text-slate-500">Szép szórend. Új körben újra összekeverjük a szavakat.</p>
      <button id="builder-restart" type="button" class="mt-5 w-full rounded-2xl bg-violet-700 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-violet-600 active:scale-[0.99]">
        Új kör
      </button>
    </div>
  `;
};
