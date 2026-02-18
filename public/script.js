const PAGE_SIZE = 50;

const searchForm = document.getElementById("searchForm");
const queryInput = document.getElementById("queryInput");
const countInput = document.getElementById("countInput");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("downloadBtn");
const selectedCountEl = document.getElementById("selectedCount");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfoEl = document.getElementById("pageInfo");

let currentQuery = "";
let dragState = null;
let suppressClickOnce = false;
const selectedSet = new Set();

const state = {
  requestedTotal: 0,
  currentPage: 1,
  maxPage: 1,
  pageMap: new Map(),
  nextStartMap: new Map(),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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
  return Array.from(selectedSet);
}

function updateSelectedCount() {
  const count = selectedSet.size;
  selectedCountEl.textContent = `선택 ${count}개`;
  downloadBtn.disabled = count === 0;
}

function updatePager() {
  const totalPages = Math.max(1, Math.ceil(state.requestedTotal / PAGE_SIZE));
  pageInfoEl.textContent = `페이지 ${state.currentPage} / ${totalPages}`;
  prevPageBtn.disabled = state.currentPage <= 1;

  const cachedNext = state.pageMap.has(state.currentPage + 1);
  const hasNextStart = Number.isFinite(state.nextStartMap.get(state.currentPage));
  const withinLimit = state.currentPage < totalPages;

  nextPageBtn.disabled = !(withinLimit && (cachedNext || hasNextStart));
}

function renderItems(items) {
  if (!items.length) {
    resultsEl.innerHTML = "";
    statusEl.textContent = "검색 결과가 없습니다.";
    updatePager();
    updateSelectedCount();
    return;
  }

  resultsEl.innerHTML = items
    .map(
      (item) => `
      <article class="card">
        <div class="thumb-wrap">
          <img src="${item.thumbnailUrl}" alt="${escapeHtml(item.title)}" loading="lazy" />
          <input class="check" type="checkbox" value="${item.imageUrl}" ${selectedSet.has(item.imageUrl) ? "checked" : ""} />
        </div>
        <div class="meta">
          <div class="title">${escapeHtml(item.title)}</div>
          <a class="source" href="${item.sourcePage}" target="_blank" rel="noopener noreferrer">출처 보기</a>
        </div>
      </article>
    `
    )
    .join("");

  document.querySelectorAll(".check").forEach((check) => {
    check.addEventListener("change", () => {
      if (check.checked) selectedSet.add(check.value);
      else selectedSet.delete(check.value);
      updateSelectedCount();
    });
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
      check.dispatchEvent(new Event("change"));
    });
  });

  updatePager();
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

  document.querySelectorAll(".card").forEach((card) => {
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
      check.dispatchEvent(new Event("change"));
    });
    suppressClickOnce = true;
  }
  dragState.box.remove();
  dragState = null;
  clearDragHighlights();
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

async function fetchPage(pageNumber) {
  if (state.pageMap.has(pageNumber)) return state.pageMap.get(pageNumber);

  let start = 0;
  if (pageNumber > 1) {
    const prevNext = state.nextStartMap.get(pageNumber - 1);
    start = Number.isFinite(prevNext) ? prevNext : (pageNumber - 1) * PAGE_SIZE;
  }

  const remaining = Math.max(1, state.requestedTotal - (pageNumber - 1) * PAGE_SIZE);
  const num = Math.min(PAGE_SIZE, remaining);

  const res = await fetch(`/api/search?q=${encodeURIComponent(currentQuery)}&num=${num}&start=${start}`);
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

  const items = data.items || [];
  state.pageMap.set(pageNumber, items);
  state.nextStartMap.set(pageNumber, Number.isFinite(data.nextStart) ? data.nextStart : null);
  return items;
}

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = queryInput.value.trim();
  if (!query) return;

  const requestedNum = Math.min(Math.max(parseInt(countInput.value, 10) || 100, 1), 500);
  countInput.value = String(requestedNum);

  currentQuery = query;
  state.requestedTotal = requestedNum;
  state.currentPage = 1;
  state.maxPage = Math.max(1, Math.ceil(requestedNum / PAGE_SIZE));
  state.pageMap.clear();
  state.nextStartMap.clear();
  selectedSet.clear();

  statusEl.textContent = "검색 중...";
  resultsEl.innerHTML = "";
  downloadBtn.disabled = true;

  try {
    const items = await fetchPage(1);
    statusEl.textContent = `총 ${requestedNum}개 요청 / 현재 ${items.length}개 로드`;
    renderItems(items);
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
    resultsEl.innerHTML = "";
    updatePager();
    updateSelectedCount();
  }
});

prevPageBtn.addEventListener("click", async () => {
  if (state.currentPage <= 1) return;
  state.currentPage -= 1;
  const items = state.pageMap.get(state.currentPage) || [];
  statusEl.textContent = `${state.currentPage}페이지 표시 중`;
  renderItems(items);
});

nextPageBtn.addEventListener("click", async () => {
  if (state.currentPage >= state.maxPage) return;
  const targetPage = state.currentPage + 1;

  try {
    statusEl.textContent = `${targetPage}페이지 로딩 중...`;
    const items = await fetchPage(targetPage);
    if (!items.length) {
      statusEl.textContent = "다음 페이지 결과가 없습니다.";
      state.nextStartMap.set(state.currentPage, null);
      updatePager();
      return;
    }

    state.currentPage = targetPage;
    statusEl.textContent = `${state.currentPage}페이지 표시 중`;
    renderItems(items);
  } catch (err) {
    statusEl.textContent = `오류: ${err.message}`;
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

updatePager();
updateSelectedCount();
