const searchForm = document.getElementById("searchForm");
const queryInput = document.getElementById("queryInput");
const countInput = document.getElementById("countInput");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");
const selectedCountEl = document.getElementById("selectedCount");

let currentQuery = "";
let dragState = null;
let suppressClickOnce = false;

function rectFromPoints(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function intersects(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function selectedUrls() {
  return Array.from(document.querySelectorAll(".check:checked")).map((el) => el.value);
}

function updateSelectedCount() {
  const count = selectedUrls().length;
  selectedCountEl.textContent = `선택 ${count}개`;
  downloadBtn.disabled = count === 0;
}

function renderItems(items) {
  if (!items.length) {
    resultsEl.innerHTML = "";
    statusEl.textContent = "검색 결과가 없습니다.";
    updateSelectedCount();
    return;
  }

  resultsEl.innerHTML = items
    .map(
      (item) => `
      <article class="card">
        <div class="thumb-wrap">
          <img src="${item.thumbnailUrl}" alt="${item.title}" loading="lazy" />
          <input class="check" type="checkbox" value="${item.imageUrl}" />
        </div>
        <div class="meta">
          <div class="title">${item.title}</div>
          <a class="source" href="${item.sourcePage}" target="_blank" rel="noopener noreferrer">출처 보기</a>
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".check").forEach((check) => {
    check.addEventListener("change", updateSelectedCount);
  });

  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (suppressClickOnce) {
        suppressClickOnce = false;
        return;
      }
      if (event.target.closest(".source")) return;
      if (event.target.classList.contains("check")) return;

      const check = card.querySelector(".check");
      check.checked = !check.checked;
      updateSelectedCount();
    });
  });

  updateSelectedCount();
}

function clearDragHighlights() {
  document.querySelectorAll(".card.drag-hit").forEach((card) => card.classList.remove("drag-hit"));
}

function onDragMove(event) {
  if (!dragState) return;
  const rect = rectFromPoints(dragState.startX, dragState.startY, event.clientX, event.clientY);
  dragState.moved = rect.width > 6 || rect.height > 6;
  dragState.box.style.left = `${rect.left}px`;
  dragState.box.style.top = `${rect.top}px`;
  dragState.box.style.width = `${rect.width}px`;
  dragState.box.style.height = `${rect.height}px`;

  const cards = Array.from(document.querySelectorAll(".card"));
  cards.forEach((card) => {
    const r = card.getBoundingClientRect();
    const cardRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (intersects(rect, cardRect)) card.classList.add("drag-hit");
    else card.classList.remove("drag-hit");
  });
}

function onDragEnd() {
  if (!dragState) return;
  if (dragState.moved) {
    document.querySelectorAll(".card.drag-hit .check").forEach((check) => {
      check.checked = true;
    });
    suppressClickOnce = true;
  }
  dragState.box.remove();
  dragState = null;
  clearDragHighlights();
  updateSelectedCount();
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
}

document.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  if (!resultsEl.children.length) return;
  if (event.target.closest("input, button, textarea, label, a")) return;
  if (event.target.closest(".source")) return;
  if (event.target.classList.contains("check")) return;

  dragState = {
    startX: event.clientX,
    startY: event.clientY,
    box: document.createElement("div"),
    moved: false,
  };
  dragState.box.className = "selection-box";
  dragState.box.style.left = `${event.clientX}px`;
  dragState.box.style.top = `${event.clientY}px`;
  dragState.box.style.width = "0px";
  dragState.box.style.height = "0px";
  document.body.appendChild(dragState.box);

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
});

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;
  const requestedNum = Math.min(Math.max(parseInt(countInput.value, 10) || 20, 1), 50);
  countInput.value = String(requestedNum);

  currentQuery = query;
  statusEl.textContent = "검색 중...";
  resultsEl.innerHTML = "";
  downloadBtn.disabled = true;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&num=${requestedNum}`);
    const data = await res.json();

    if (!res.ok) {
      const detailMessage =
        typeof data.detail === "string"
          ? (() => {
              try {
                const parsed = JSON.parse(data.detail);
                return parsed?.error?.message || data.detail;
              } catch (_) {
                return data.detail;
              }
            })()
          : "";
      throw new Error([data.error || "검색 실패", detailMessage].filter(Boolean).join(" - "));
    }

    statusEl.textContent = `총 ${data.count}개 결과`;
    renderItems(data.items || []);
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
    resultsEl.innerHTML = "";
    updateSelectedCount();
  }
});

downloadBtn.addEventListener("click", async () => {
  const images = selectedUrls();
  if (!images.length) return;

  statusEl.textContent = "ZIP 생성 중...";
  downloadBtn.disabled = true;

  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, query: currentQuery }),
    });

    if (!res.ok) {
      let message = "다운로드 실패";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (_) {}
      throw new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="(.+)"/);
    const filename = filenameMatch ? filenameMatch[1] : "images.zip";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.textContent = "다운로드 완료";
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
  } finally {
    updateSelectedCount();
  }
});
