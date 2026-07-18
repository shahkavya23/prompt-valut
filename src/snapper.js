(function () {
  if (window.__promptVaultSnapActive) return;
  window.__promptVaultSnapActive = true;

  let start = null;
  const layer = document.createElement("div");
  const tip = document.createElement("div");
  const box = document.createElement("div");

  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "cursor:crosshair",
    "background:rgba(6,5,7,.38)",
    "font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  ].join(";");

  tip.textContent = "Drag around the prompt. Press Esc to cancel.";
  tip.style.cssText = [
    "position:fixed",
    "left:50%",
    "top:18px",
    "transform:translateX(-50%)",
    "background:#fff7e6",
    "color:#320810",
    "border:1px solid rgba(80,32,48,.2)",
    "border-radius:8px",
    "box-shadow:0 10px 26px rgba(33,12,22,.22)",
    "padding:9px 12px",
    "font-size:13px",
    "font-weight:800",
    "white-space:nowrap"
  ].join(";");

  box.style.cssText = [
    "position:fixed",
    "display:none",
    "border:2px solid #fff7e6",
    "background:rgba(255,247,230,.12)",
    "box-shadow:0 0 0 9999px rgba(6,5,7,.42),0 8px 26px rgba(0,0,0,.28)",
    "border-radius:6px",
    "pointer-events:none"
  ].join(";");

  layer.append(tip, box);
  document.body.appendChild(layer);

  function cleanup() {
    window.__promptVaultSnapActive = false;
    layer.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function rectFrom(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(window.innerWidth, Math.max(x1, x2));
    const bottom = Math.min(window.innerHeight, Math.max(y1, y2));
    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(Math.max(0, right - left)),
      height: Math.round(Math.max(0, bottom - top))
    };
  }

  function draw(x, y) {
    const rect = rectFrom(start.x, start.y, x, y);
    box.style.display = "block";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function toast(text) {
    const notice = document.createElement("div");
    notice.textContent = text;
    notice.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "background:#fff7e6",
      "color:#320810",
      "border:1px solid rgba(80,32,48,.2)",
      "border-radius:8px",
      "box-shadow:0 10px 26px rgba(33,12,22,.22)",
      "padding:10px 12px",
      "font:800 13px Inter,ui-sans-serif,system-ui"
    ].join(";");
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 1800);
  }

  function onKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cleanup();
    toast("Snap cancelled");
  }

  layer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    try {
      layer.setPointerCapture(event.pointerId);
    } catch {}
    draw(event.clientX, event.clientY);
  });

  layer.addEventListener("pointermove", (event) => {
    if (!start) return;
    event.preventDefault();
    draw(event.clientX, event.clientY);
  });

  layer.addEventListener("pointerup", (event) => {
    if (!start) return;
    event.preventDefault();
    const rect = rectFrom(start.x, start.y, event.clientX, event.clientY);
    cleanup();
    if (rect.width < 24 || rect.height < 24) {
      toast("Snap area too small");
      return;
    }
    showCategoryDialog({
      rect,
      dpr: window.devicePixelRatio || 1,
      snappedText: textFromRect(rect),
      sourceUrl: location.href,
      sourceTitle: document.title
    });
  });

  document.addEventListener("keydown", onKeyDown, true);

  function showCategoryDialog(payload) {
    const old = document.querySelector(".pv-category-dialog-inline");
    if (old) old.remove();
    const dialog = document.createElement("div");
    dialog.className = "pv-category-dialog-inline";
    dialog.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "width:min(360px,calc(100vw - 28px))",
      "left:50%",
      "top:50%",
      "transform:translate(-50%,-50%)",
      "background:linear-gradient(180deg,#fffaff,#f7f3ff)",
      "color:#11162f",
      "border:1px solid rgba(92,66,180,.18)",
      "border-radius:12px",
      "box-shadow:0 22px 60px rgba(72,54,160,.3)",
      "padding:14px",
      "font-family:Inter,ui-sans-serif,system-ui"
    ].join(";");
    dialog.innerHTML = `
      <h3 style="margin:0 0 7px;font:800 15px/1.25 Inter,ui-sans-serif,system-ui;">Save snapped prompt</h3>
      <p style="margin:0 0 10px;color:#6c6680;font:600 12px/1.4 Inter,ui-sans-serif,system-ui;">Choose a category before saving.</p>
      <div class="pv-category-grid-inline" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button data-cancel="true">Cancel</button></div>
    `;
    const grid = dialog.querySelector(".pv-category-grid-inline");
    ["Coding", "Study", "Writing", "Research", "Design", "Other"].forEach((category) => {
      const button = document.createElement("button");
      button.textContent = category;
      button.style.cssText = "border:0;border-radius:8px;background:#eee7ff;color:#261d55;cursor:pointer;font:800 12px/1 Inter,ui-sans-serif,system-ui;padding:10px;";
      if (category === "Coding") {
        button.style.background = "linear-gradient(135deg,#6d3cff,#e344a7)";
        button.style.color = "#fffaff";
      }
      button.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "PROMPTVAULT_SAVE_SNAP", ...payload, category }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            toast(response?.reason || chrome.runtime.lastError?.message || "Snap failed");
            return;
          }
          dialog.remove();
          toast(`Saved to ${category}`);
        });
      });
      grid.appendChild(button);
    });
    const cancel = dialog.querySelector("[data-cancel]");
    cancel.style.cssText = "border:0;border-radius:8px;background:#eee7ff;color:#261d55;cursor:pointer;font:800 12px/1 Inter,ui-sans-serif,system-ui;padding:10px;";
    cancel.addEventListener("click", () => {
      dialog.remove();
      toast("Snap cancelled");
    });
    document.body.appendChild(dialog);
  }

  function textFromRect(rect) {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const pieces = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = clean(node.nodeValue);
        if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        const intersects = Array.from(range.getClientRects()).some((r) => intersectsRect(r, rect));
        range.detach();
        return intersects ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) pieces.push(clean(walker.currentNode.nodeValue));
    return Array.from(new Set(pieces)).join(" ").trim();
  }

  function intersectsRect(a, b) {
    return a.right >= b.left && a.left <= b.left + b.width && a.bottom >= b.top && a.top <= b.top + b.height;
  }
})();
