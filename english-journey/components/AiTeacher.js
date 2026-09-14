window.EJComponents = window.EJComponents || {};

window.EJComponents.aiTeacher = function aiTeacherScreen() {
  return `
    <div class="mb-3 flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold text-slate-900">AI Tanár</h2>
        <p class="text-sm text-slate-500">Gyakorolj egyszerű párbeszédet a tanároddal.</p>
      </div>
      <span class="rounded-full bg-teal-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-teal-700">A0 chat</span>
    </div>

    <div class="flex min-h-[24rem] flex-col rounded-[1.75rem] bg-white p-4 shadow-card ring-1 ring-slate-200/70">
      <div class="mb-3 flex items-center gap-3 rounded-2xl bg-teal-50 px-3 py-2.5">
        <div class="grid h-11 w-11 place-items-center rounded-2xl bg-white text-xl shadow-soft">🤖</div>
        <div class="min-w-0">
          <p class="text-sm font-extrabold text-slate-900">Miss Willow</p>
          <p class="text-xs font-medium text-teal-700">Simple English · beginner</p>
        </div>
      </div>

      <div id="chat-thread" class="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        <div class="flex items-start gap-2">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-100 text-lg">🤖</div>
          <div class="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">
            Hi! I’m Miss Willow. Write a short sentence. We can start with <strong>hello</strong>.
          </div>
        </div>
        <div class="flex items-start gap-2">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-100 text-lg">🤖</div>
          <div class="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-700">
            Szia! Írj egy rövid angol mondatot. Kezdhetjük a <strong>hello</strong> szóval.
          </div>
        </div>
      </div>

      <div id="chat-suggestions" class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="chat-chip rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-teal-50 hover:text-teal-800" data-chat="Hello!">Hello!</button>
        <button type="button" class="chat-chip rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-teal-50 hover:text-teal-800" data-chat="How are you?">How are you?</button>
        <button type="button" class="chat-chip rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-teal-50 hover:text-teal-800" data-chat="I am happy.">I am happy.</button>
      </div>

      <form id="chat-form" class="mt-3 flex gap-2">
        <label class="sr-only" for="chat-input">Üzenet</label>
        <input id="chat-input" type="text" autocomplete="off" placeholder="Write a short message…" class="min-w-0 flex-1 rounded-2xl border-0 bg-slate-100 px-4 py-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-teal-500" />
        <button type="submit" class="rounded-2xl bg-teal-700 px-4 py-3 text-sm font-bold text-white transition hover:bg-teal-600">Küldés</button>
      </form>
    </div>
  `;
};
