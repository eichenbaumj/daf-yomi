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

// The zooming position bar. Each layer is drawn in its own frame (fraction of the
// cycle); showing level L means mapping L's region onto the stage in every layer.
(function () {
  var zoom = document.querySelector(".zoom");
  if (!zoom) return;
  var regions = JSON.parse(zoom.getAttribute("data-regions"));
  var today = parseFloat(zoom.getAttribute("data-today"));
  var caps = JSON.parse(zoom.getAttribute("data-caps"));
  var vals = JSON.parse(zoom.getAttribute("data-vals"));
  var layers = zoom.querySelectorAll(".zl");
  var mark = zoom.querySelector(".zmark");
  var cap = zoom.querySelector(".zcap"), val = zoom.querySelector(".zval"), hint = zoom.querySelector(".zoom-hint");
  var level = 0, max = regions.length - 1;
  function show(L) {
    level = L;
    var R = regions[L];
    for (var k = 0; k < layers.length; k++) {
      var K = regions[k];
      var a = (R[0] - K[0]) / (K[1] - K[0]), b = (R[1] - K[0]) / (K[1] - K[0]);
      var s = 1 / (b - a);
      layers[k].style.transform = "scaleX(" + s + ") translateX(" + (-a * 100) + "%)";
      layers[k].classList.toggle("on", k === L);
    }
    mark.style.left = (((today - R[0]) / (R[1] - R[0])) * 100) + "%";
    cap.textContent = caps[L];
    val.textContent = vals[L];
    zoom.classList.toggle("max", L === max);
    hint.textContent = L === max ? "tap to zoom out" : "tap to zoom in";
    zoom.setAttribute("aria-pressed", L > 0 ? "true" : "false");
  }
  zoom.addEventListener("click", function (e) {
    show(level === max ? 0 : level + 1);
  });
  zoom.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "+") { e.preventDefault(); show(level === max ? 0 : level + 1); }
    else if (e.key === "Escape" || e.key === "ArrowLeft" || e.key === "-") { e.preventDefault(); show(level === 0 ? 0 : level - 1); }
  });
  show(0);
})();
