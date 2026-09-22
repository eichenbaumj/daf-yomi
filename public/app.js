(function () {
  var root = document.documentElement;
  // Three reading options, each remembered in this browser and applied as a class on <html>. "text" hides the daf itself
  // so a reader can browse the notes day to day; it stays hidden across pages until they bring the text back.
  // Button labels come from the page (data-off / data-on), so every language renders its own.
  var KEYS = { he: "daf:he", talmudOnly: "daf:talmudOnly", text: "daf:textHidden" };
  var CLASSES = { he: "show-he", talmudOnly: "talmud-only", text: "text-hidden" };
  function read(k) { try { return localStorage.getItem(k) === "1"; } catch (e) { return false; } }
  function write(k, v) { try { localStorage.setItem(k, v ? "1" : "0"); } catch (e) {} }
  function sync(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    var label = btn.getAttribute(on ? "data-on" : "data-off");
    if (label) btn.textContent = label;
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
// The stage is always left-to-right (a time axis), whatever the page direction.
(function () {
  var zoom = document.querySelector(".zoom");
  if (!zoom) return;
  var regions = JSON.parse(zoom.getAttribute("data-regions"));
  var today = parseFloat(zoom.getAttribute("data-today"));
  var caps = JSON.parse(zoom.getAttribute("data-caps"));
  var vals = JSON.parse(zoom.getAttribute("data-vals"));
  var hintIn = zoom.getAttribute("data-hint-in") || "tap to zoom in";
  var hintOut = zoom.getAttribute("data-hint-out") || "tap to zoom out";
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
    hint.textContent = L === max ? hintOut : hintIn;
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

// "Share this note". The button is hidden until this runs: without JS there is nothing it could do. It shares the
// permalink and nothing else (Joe: never paste the words as text; the thread should show the card), through the share
// sheet on a phone and the clipboard elsewhere. Nothing is recorded anywhere.
(function () {
  var boxes = document.querySelectorAll(".note-actions");
  if (!boxes.length) return;
  var coarse = false;
  try { coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (e) {}
  Array.prototype.forEach.call(boxes, function (box) {
    var btn = box.querySelector("button.share");
    if (!btn) return;
    var url = btn.getAttribute("data-share-url") || location.href;
    var done = btn.getAttribute("data-share-done") || "";
    var label = btn.textContent;
    function flash() { btn.textContent = done; setTimeout(function () { btn.textContent = label; }, 2000); }
    // The clipboard API first; when it is missing or refuses (some browsers deny it even on a click), the old
    // select-and-copy path, which works on the click's own activation.
    function legacyCopy(s) {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement("textarea");
        ta.value = s; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy refused"));
      });
    }
    function copy(s) {
      var modern = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(s) : Promise.reject(new Error("no clipboard api"));
      return modern.catch(function () { return legacyCopy(s); });
    }
    btn.hidden = false;
    btn.addEventListener("click", function () {
      if (coarse && navigator.share) {
        navigator.share({ url: url }).catch(function () {});
        return;
      }
      copy(url).then(flash, function () {});
    });
  });
})();

// Where you are on the page. The map's current unit follows the reader down the text, and once the map has scrolled
// away a running head (as in a printed book) says "3 of 6 · An objection: ...", with the page turns at its ends.
// Tapping it goes back to the map. All of it is an enhancement: the map's links work without it.
(function () {
  var map = document.getElementById("pagemap");
  var bar = document.querySelector(".here-bar");
  var segs = document.querySelectorAll(".seg[data-unit]");
  if (!map || !bar || !segs.length || !("IntersectionObserver" in window)) return;
  var items = map.querySelectorAll(".pagemap-unit");
  var text = bar.querySelector(".here-text");
  var visible = {}, current = 0, mapAway = false;
  function render() {
    for (var i = 0; i < items.length; i++) {
      if (i + 1 === current) items[i].setAttribute("aria-current", "location");
      else items[i].removeAttribute("aria-current");
    }
    if (current) text.textContent = items[current - 1].getAttribute("data-head") || "";
    bar.hidden = !(current && mapAway);
  }
  // A band a third of the way down the viewport. Units are contiguous and in order, so the smallest unit among the
  // segments crossing the band is the one the reader is in. No geometry, no scroll listener.
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) visible[e.target.id] = +e.target.getAttribute("data-unit");
      else delete visible[e.target.id];
    });
    var min = 0;
    for (var k in visible) if (!min || visible[k] < min) min = visible[k];
    current = min;
    render();
  }, { rootMargin: "-15% 0px -55% 0px" });
  Array.prototype.forEach.call(segs, function (s) { io.observe(s); });
  new IntersectionObserver(function (entries) {
    mapAway = !entries[entries.length - 1].isIntersecting;
    render();
  }).observe(map);
})();
