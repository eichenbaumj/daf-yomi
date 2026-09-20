(function () {
  var root = document.documentElement;
  var KEYS = { he: "daf:he", talmudOnly: "daf:talmudOnly" };
  var CLASSES = { he: "show-he", talmudOnly: "talmud-only" };
  var LABELS = { he: ["Show Hebrew / Aramaic", "Hide Hebrew / Aramaic"], talmudOnly: ["Talmud only", "Show explanations"] };
  function read(k) { try { return localStorage.getItem(k) === "1"; } catch (e) { return false; } }
  function write(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch (e) {} }
  function sync(btn, on) {
    var name = btn.getAttribute("data-toggle");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = LABELS[name][on ? 1 : 0];
  }
  var buttons = document.querySelectorAll("button[data-toggle]");
  Array.prototype.forEach.call(buttons, function (btn) {
    var name = btn.getAttribute("data-toggle");
    var on = read(KEYS[name]);
    root.classList.toggle(CLASSES[name], on);
    sync(btn, on);
    btn.addEventListener("click", function () {
      var now = !root.classList.contains(CLASSES[name]);
      root.classList.toggle(CLASSES[name], now);
      write(KEYS[name], now);
      sync(btn, now);
    });
  });
})();
