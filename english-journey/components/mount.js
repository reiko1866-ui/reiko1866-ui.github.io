(function mountScreens() {
  const screens = [
    ["panel-flashcards", "flashcards"],
    ["panel-builder", "sentenceBuilder"],
    ["panel-chat", "aiTeacher"]
  ];

  screens.forEach(([panelId, name]) => {
    const panel = document.getElementById(panelId);
    const render = window.EJComponents && window.EJComponents[name];
    if (!panel || typeof render !== "function") return;
    panel.innerHTML = render();
  });
})();
