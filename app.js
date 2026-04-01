let books, chapters, titles, contents;
let hiraSongs = [];
let haaSongs = [];
let salamoPsalms = [];
let navigationStack = [];
let currentView = null;
let searchResults = [];
let currentScopeBookId = null; // book id for section-scoped search
let globalSearchOutsideHandler = null;
let navOutsideHandler = null;
let currentBookViewMode = "chapters"; // "chapters" or "pages" for special books
let currentFontSize = 100; // percentage, default 100%
let currentContentHtml = null; // Store original HTML content for zoom scaling
let currentTitleIndex = -1; // Track current title index for prev/next navigation
let currentTitlesList = []; // Store current list of titles for prev/next navigation
let autoScrollInterval = null;
let autoScrolling = false;
const AUTO_SCROLL_SPEED = 10; // px per second
const specialBooks = ["Fihirana", "Salamo", "Hanandratra Anao Aho"];
const numberedBooks = ["Fihirana", "Hanandratra Anao Aho"];

// Load saved font size on page load
async function loadFontSize() {
    const saved = localStorage.getItem("fontSizePercentage");
    if (saved) {
        currentFontSize = parseInt(saved);
        applyFontSize();
    }
}

async function loadData() {
    books = await fetch("data/books.json").then(r => r.json());

    // New rewritten structured data sources for special books.
    hiraSongs = await fetch("data/HIRA.json").then(r => r.json()).then(d => d.songs || []);
    haaSongs = await fetch("data/HAA.json").then(r => r.json()).then(d => d.songs || []);
    salamoPsalms = await fetch("data/SALAMO.json").then(r => r.json()).then(d => d.psalms || []);

    // old data intentionally ignored for now.
    chapters = [];
    titles = [];
    contents = [];

    setupSearch();
    showBooks();
}

function applyZoomToHtml(htmlString, zoomPercent) {
    // Scale all font-size values in inline styles according to zoom factor
    return htmlString.replace(/font-size:\s*(\d+(?:\.\d+)?)\s*pt/gi, (match, fontSize) => {
        const baseFontSize = parseFloat(fontSize);
        const zoomedFontSize = baseFontSize * (zoomPercent / 100);
        return `font-size:${zoomedFontSize}pt`;
    });
}

function renderContent(htmlContent) {
    // Helper function to render content HTML with current zoom applied
    const container = document.getElementById("content");
    const scaledHtml = applyZoomToHtml(htmlContent, currentFontSize);
    container.innerHTML = `<div id="lyrics">${scaledHtml}</div>`;
    window.scrollTo(0, 0);
    stopAutoScroll();
    const btn = document.getElementById("autoScrollBtn");
    if (btn) btn.style.display = "flex";
}

function updateBottomNav() {
    const backBtn = document.getElementById("bnav-back");
    const prevBtn = document.getElementById("bnav-prev");
    const nextBtn = document.getElementById("bnav-next");

    // Back: enabled when there's somewhere to go back to
    if (backBtn) backBtn.disabled = navigationStack.length === 0;

    // Prev/Next: only enabled in lyrics/content view
    const inLyrics = currentContentHtml !== null;
    if (prevBtn) prevBtn.disabled = !inLyrics || currentTitleIndex <= 0;
    if (nextBtn) nextBtn.disabled = !inLyrics || currentTitleIndex >= currentTitlesList.length - 1;
}

function navigatePrev() {
    stopAutoScroll();
    if (currentTitleIndex > 0) {
        showContent(currentTitlesList[currentTitleIndex - 1].id);
    }
}

function navigateNext() {
    stopAutoScroll();
    if (currentTitleIndex < currentTitlesList.length - 1) {
        showContent(currentTitlesList[currentTitleIndex + 1].id);
    }
}

function focusSearch() {
    // If section search is visible, focus it; otherwise open/focus global search
    const sectionContainer = document.getElementById("sectionSearchContainer");
    const sectionField = document.getElementById("sectionSearchField");
    if (sectionContainer && sectionContainer.style.display !== "none" && sectionField) {
        sectionField.focus();
        sectionField.scrollIntoView({ behavior: "instant", block: "nearest" });
        return;
    }
    // Otherwise open global search if not already visible, then focus
    const globalContainer = document.getElementById("globalSearchContainer");
    if (globalContainer && globalContainer.style.display === "none") {
        toggleGlobalSearch();
    } else {
        const globalField = document.getElementById("globalSearchField");
        if (globalField) globalField.focus();
    }
}

// NEW helper: remove any floating toggle button
function removeFloatingToggle() {
    const btn = document.getElementById("floatingToggleBtn");
    if (btn) btn.style.display = "none";
}

function renderToggleButton(bookId, currentMode) {
    const btn = document.getElementById("floatingToggleBtn");
    if (!btn) return;
    btn.style.display = "flex";

    if (currentMode === "sections") {
        btn.innerText = "📋";
        btn.title = "Switch to titles view";
        btn.onclick = () => showFlatSongsView(bookId);
    } else {
        btn.innerText = "🏷️";
        btn.title = "Switch to sections view";
        btn.onclick = () => showGroupedSongsView(bookId);
    }
}

function setupSearch() {
    const globalField = document.getElementById("globalSearchField");
    const sectionField = document.getElementById("sectionSearchField");

    if (globalField) {
        globalField.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query === "") {
                searchResults = [];
                restoreCurrentView();
            } else {
                performSearch(query);
            }
        });
        globalField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                globalField.blur();
            }
        });
    }

    if (sectionField) {
        sectionField.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (query === "") {
                searchResults = [];
                restoreCurrentView();
            } else {
                performSearch(query, currentScopeBookId);
            }
        });
        sectionField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                sectionField.blur();
            }
        });
    }
}

function toggleGlobalSearch() {
    const container = document.getElementById("globalSearchContainer");
    const searchBtn = document.getElementById("bnav-search");
    if (!container) return;
    const shown = container.style.display !== "none";
    if (shown) {
        // hide and remove outside click listener
        container.style.display = "none";
        if (globalSearchOutsideHandler) {
            document.removeEventListener("mousedown", globalSearchOutsideHandler);
            globalSearchOutsideHandler = null;
        }
    } else {
        // show and focus
        container.style.display = "block";
        const field = document.getElementById("globalSearchField");
        if (field) field.focus();

        // add outside-click handler to close when clicking outside
        globalSearchOutsideHandler = function (e) {
            const target = e.target;
            if (!container.contains(target) && target !== searchBtn && !searchBtn.contains(target)) {
                const field = document.getElementById("globalSearchField");
                const hasText = field && field.value.trim() !== "";
                if (!hasText) {
                    container.style.display = "none";
                    document.removeEventListener("mousedown", globalSearchOutsideHandler);
                    globalSearchOutsideHandler = null;
                }
            }
        };
        // use mousedown to catch before focus shifts
        document.addEventListener("mousedown", globalSearchOutsideHandler);
    }
}

function performSearch(query, scopeBookId = null) {
    searchResults = [];
    const normalized = query.toLowerCase().trim();
    if (!normalized) {
        showSearchResults();
        return;
    }

    // Search books (only new ones)
    books
        .filter(book => specialBooks.includes(book.name))
        .forEach(book => {
            if (book.name.toLowerCase().includes(normalized)) {
                if (scopeBookId == null || book.id == scopeBookId) {
                    searchResults.push({ type: "book", id: book.id, title: book.name });
                }
            }
        });

    // Search HIRA and H.A.A songs
    [
        { bookName: "Fihirana", bookId: books.find(b => b.name === "Fihirana")?.id, data: hiraSongs },
        { bookName: "H.A.A", bookId: books.find(b => b.name === "H.A.A")?.id, data: haaSongs }
    ].forEach(bookInfo => {
        if (!bookInfo.bookId) return;
        if (scopeBookId != null && scopeBookId != bookInfo.bookId) return;

        bookInfo.data.forEach(song => {
            let matched = false;
            if (String(song.id).toLowerCase().includes(normalized)) matched = true;
            if (!matched && song.title && song.title.toLowerCase().includes(normalized)) matched = true;

            if (matched) {
                searchResults.push({ type: "song", bookId: bookInfo.bookId, id: song.id, title: song.title, subtitle: `${bookInfo.bookName} → ${song.section || ""}` });
            }
        });
    });

    // Search Salamo psalms
    const salamoBookId = books.find(b => b.name === "Salamo")?.id;
    if ((scopeBookId == null || scopeBookId == salamoBookId) && salamoBookId != null) {
        salamoPsalms.forEach(psalm => {
            let matched = false;
            if (String(psalm.id).includes(normalized)) matched = true;

            if (matched) {
                searchResults.push({ type: "psalm", id: psalm.id, title: `Salamo ${psalm.id}` });
            }
        });
    }

    showSearchResults();
}

function showSearchResults() {
    // ensure toggle removed when showing search results (search is not a special-view)
    removeFloatingToggle();

    const container = document.getElementById("content");
    container.innerHTML = "";

    searchResults.forEach(result => {
        const div = document.createElement("div");
        div.className = "item";

        let displayTitle = result.title;
        if (result.subtitle) {
            div.innerHTML = `<strong>${displayTitle}</strong><br><small style="color: #666;">${result.subtitle}</small>`;
        } else {
            div.innerText = displayTitle;
        }

        div.onclick = () => {
            const g = document.getElementById("globalSearchField");
            const s = document.getElementById("sectionSearchField");
            if (g) g.value = "";
            if (s) s.value = "";
            const gd = document.getElementById("globalSearchContainer");
            if (gd) gd.style.display = "none";
            searchResults = [];

            if (result.type === "book") {
                navigationStack.push(showBooks);
                showSections(result.id);
            } else if (result.type === "song") {
                navigationStack.push(showBooks);
                navigationStack.push(() => showSections(result.bookId));
                const book = books.find(b => b.id == result.bookId);
                if (book && (isHiraBook(book) || isHaaBook(book))) {
                    const song = getBookData(book).find(item => item.id == result.id);
                    if (song) {
                        navigationStack.push(() => showSections(result.bookId));
                    }
                }
                showSong(result.bookId, result.id);
            } else if (result.type === "psalm") {
                const salamoBook = books.find(b => b.name === "Salamo");
                if (salamoBook) {
                    navigationStack.push(showBooks);
                    navigationStack.push(() => showSections(salamoBook.id));
                }
                showSalamoContent(result.id);
            }
        };

        container.appendChild(div);
    });
}

function restoreCurrentView() {
    if (currentView) {
        currentView();
    }
}

function updateHeader(title, subtitle = "") {
    document.getElementById("headerTitle").innerText = title;
    document.getElementById("headerSubtitle").innerText = subtitle;
    updateBottomNav();
}

function goBack() {
    stopAutoScroll();
    const autoBtn = document.getElementById("autoScrollBtn");
    if (autoBtn) autoBtn.style.display = "none";
    currentContentHtml = null;
    currentTitleIndex = -1;
    currentTitlesList = [];
    const previous = navigationStack.pop();
    const g = document.getElementById("globalSearchField");
    const s = document.getElementById("sectionSearchField");
    if (g) g.value = "";
    if (s) s.value = "";
    const sectionContainer = document.getElementById("sectionSearchContainer");
    if (sectionContainer) sectionContainer.style.display = "none";
    searchResults = [];
    updateBottomNav();
    if (previous) previous();
}

function showBooks() {
    removeFloatingToggle();

    navigationStack = [];
    currentView = showBooks;
    updateHeader("Boky Fivavahana");

    currentScopeBookId = null;
    const sectionContainer = document.getElementById("sectionSearchContainer");
    if (sectionContainer) sectionContainer.style.display = "none";

    const container = document.getElementById("content");
    container.innerHTML = "";

    // Only show rewritten data sources for now.
    books
        .filter(book => specialBooks.includes(book.name))
        .forEach(book => {
            const div = document.createElement("div");
            div.className = "item";
            div.innerText = book.name;
            div.onclick = () => {
                navigationStack.push(showBooks);
                showSections(book.id);
            };
            container.appendChild(div);
        });

    // If no special books are present, display a placeholder message.
    if (container.children.length === 0) {
        const empty = document.createElement("div");
        empty.className = "item";
        empty.innerText = "Tsy mbola misy boky azo vakiana ankehitriny.";
        container.appendChild(empty);
    }
}

function isHiraBook(book) {
    return book && book.name === "Fihirana";
}

function isHaaBook(book) {
    return book && book.name === "H.A.A";
}

function isSalamoBook(book) {
    return book && book.name === "Salamo";
}

function getBookData(book) {
    if (isHiraBook(book)) return hiraSongs;
    if (isHaaBook(book)) return haaSongs;
    if (isSalamoBook(book)) return salamoPsalms;
    return null;
}

function showSections(bookId) {
    const book = books.find(b => b.id == bookId);
    if (!book) return;

    currentBookViewMode = "sections";
    currentView = () => showSections(bookId);
    updateHeader(book.name);

    currentScopeBookId = bookId;
    const sectionContainer = document.getElementById("sectionSearchContainer");
    const sectionField = document.getElementById("sectionSearchField");
    if (sectionContainer) sectionContainer.style.display = "block";
    if (sectionField) sectionField.placeholder = `Hitady @${book.name}...`;

    removeFloatingToggle();

    if (isHiraBook(book) || isHaaBook(book)) {
        showFlatSongsView(bookId);
        return;
    }

    if (isSalamoBook(book)) {
        showSalamoList(bookId);
        return;
    }

    // Non-implemented books for now
    const container = document.getElementById("content");
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerText = "Boky tsy mbola voasoratra ao amin'ny rafitra vaovao. Ho ampiana avy eo.";
    container.appendChild(empty);
}

function showGroupedSongsView(bookId) {
    const book = books.find(b => b.id == bookId);
    if (!book) return;

    currentView = () => showGroupedSongsView(bookId);
    updateHeader(book.name);
    removeFloatingToggle();

    currentScopeBookId = bookId;
    const sectionContainer = document.getElementById("sectionSearchContainer");
    const sectionField = document.getElementById("sectionSearchField");
    if (sectionContainer) sectionContainer.style.display = "block";
    if (sectionField) sectionField.placeholder = `Hitady @${book.name}...`;

    const source = getBookData(book) || [];
    // Preserve original order: collect sections as encountered in source
    const sectionSet = new Set();
    const sections = [];
    source.forEach(item => {
        const section = (item.section || "").trim();
        if (section && !sectionSet.has(section)) {
            sectionSet.add(section);
            sections.push(section);
        }
    });

    const container = document.getElementById("content");
    container.innerHTML = "";

    sections.forEach((section, idx) => {
        const accordionId = `accordion-${idx}`;
        const contentId = `accordion-content-${idx}`;

        // Header (accordion toggle)
        const headerDiv = document.createElement("div");
        headerDiv.className = "item accordion-header";
        headerDiv.innerText = `▶ ${section}`;
        headerDiv.id = accordionId;

        // Content container (collapsed initially)
        const contentDiv = document.createElement("div");
        contentDiv.id = contentId;
        contentDiv.className = "accordion-content";
        contentDiv.style.display = "none";

        // Toggle on header click
        headerDiv.onclick = () => {
            const isVisible = contentDiv.style.display !== "none";
            if (isVisible) {
                contentDiv.style.display = "none";
                headerDiv.innerText = `▶ ${section}`;
            } else {
                contentDiv.style.display = "block";
                headerDiv.innerText = `▼ ${section}`;
            }
        };

        container.appendChild(headerDiv);
        container.appendChild(contentDiv);

        // Collect songs for this section
        const sectionSongs = source.filter(item => (item.section || "").trim() === section);
        sectionSongs.forEach(song => {
            const songDiv = document.createElement("div");
            songDiv.className = "item accordion-song";
            songDiv.innerText = `${song.id} - ${song.title}`;
            songDiv.onclick = () => {
                navigationStack.push(() => showGroupedSongsView(bookId));
                showSong(bookId, song.id);
            };
            contentDiv.appendChild(songDiv);
        });
    });

    renderToggleButton(bookId, "sections");
}

function showFlatSongsView(bookId) {
    const book = books.find(b => b.id == bookId);
    if (!book) return;

    currentView = () => showFlatSongsView(bookId);
    updateHeader(book.name);
    removeFloatingToggle();

    currentScopeBookId = bookId;
    const sectionContainer = document.getElementById("sectionSearchContainer");
    const sectionField = document.getElementById("sectionSearchField");
    if (sectionContainer) sectionContainer.style.display = "block";
    if (sectionField) sectionField.placeholder = `Hitady @${book.name}...`;

    const source = getBookData(book) || [];
    const container = document.getElementById("content");
    container.innerHTML = "";

    // Display all songs in a flat list, sorted by id
    source
        .sort((a, b) => (a.id || 0) - (b.id || 0))
        .forEach(song => {
            const div = document.createElement("div");
            div.className = "item";
            div.innerText = `${song.id} - ${song.title}`;
            div.onclick = () => {
                navigationStack.push(() => showFlatSongsView(bookId));
                showSong(bookId, song.id);
            };
            container.appendChild(div);
        });

    renderToggleButton(bookId, "titles");
}

function showSong(bookId, songId) {
    const book = books.find(b => b.id == bookId);
    const source = getBookData(book) || [];
    const song = source.find(item => item.id == songId);
    if (!song) return;

    const bookTitle = book ? book.name : "";
    currentView = () => showSong(bookId, songId);

    let headerSubtitle = `${song.id} - ${song.title}`;
    updateHeader(bookTitle, headerSubtitle);

    const sectionContainer = document.getElementById("sectionSearchContainer");
    if (sectionContainer) sectionContainer.style.display = "none";

    const lines = [];

    if (song.intro) {
        lines.push(`<div id=\"intro\">${song.intro}</div>`);
    }
    if (song.headnote) {
        lines.push(`<div id=\"headnote\">${song.headnote}</div>`);
    }

    if (song.verses && song.verses.length > 0) {
        song.verses.forEach(v => {

            if (v.verse_number === 2 && song.chorus && song.chorus.length > 0) {
                lines.push("<div class=\"verse chorus\">")
                lines.push(`<div class=\"chorus-title\">Fiverenana:</div>`);
                lines.push("<p>")
                lines.push(song.chorus.join("<br />"));
                lines.push("</p>")
                lines.push('</div>');
            }

            lines.push("<div class=\"verse\">")
            lines.push(`<span><strong>${v.verse_number}.</strong></span>`);
            const verseLines = Array.isArray(v.lines) ? v.lines : [v.lines];
            lines.push("<p>")
            lines.push(verseLines.join("<br />"));
            lines.push("</p>");
            lines.push('</div>');
        });
    }

    if (song.footnote) {
        lines.push(`<div id=\"footnote\">${song.footnote}</div>`);
    }

    currentContentHtml = lines.join("\n");
    renderContent(currentContentHtml);

    // Setup prev/next listing scoped to the entire book
    currentTitlesList = source;
    currentTitleIndex = source.findIndex(item => item.id == songId);

    updateBottomNav();
}

function showSalamoList(bookId) {
    const book = books.find(b => b.id == bookId);
    currentView = () => showSalamoList(bookId);
    updateHeader(book ? book.name : "Salamo");

    currentScopeBookId = bookId;
    const sectionContainer = document.getElementById("sectionSearchContainer");
    const sectionField = document.getElementById("sectionSearchField");
    if (sectionContainer) sectionContainer.style.display = "block";
    if (sectionField) sectionField.placeholder = `Hitady @${book ? book.name : "ato"}...`;

    const container = document.getElementById("content");
    container.innerHTML = "";

    salamoPsalms.forEach(psalm => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerText = `Salamo ${psalm.id}`;
        div.onclick = () => {
            navigationStack.push(() => showSalamoList(bookId));
            showSalamoContent(psalm.id);
        };
        container.appendChild(div);
    });
}

function showSalamoContent(psalmId) {
    const psalm = salamoPsalms.find(p => p.id == psalmId);
    const book = books.find(b => b.name === "Salamo");
    if (!psalm || !book) return;

    currentView = () => showSalamoContent(psalmId);
    updateHeader(book.name, `Salamo ${psalm.id}`);

    const sectionContainer = document.getElementById("sectionSearchContainer");
    if (sectionContainer) sectionContainer.style.display = "none";

    const lines = [];
    if (psalm.verses && psalm.verses.length > 0) {
        psalm.verses.forEach(v => {
            const verseLines = Array.isArray(v.lines) ? v.lines : [v.lines];
            verseLines.forEach(line => {
                lines.push(`<p class=\"line\"><strong>${v.verse_number}.</strong> ${line}</p>`);
            });
        });
    }

    currentContentHtml = lines.join("\n");
    renderContent(currentContentHtml);

    currentTitlesList = salamoPsalms.map(p => ({ id: p.id }));
    currentTitleIndex = currentTitlesList.findIndex(p => p.id == psalmId);

    updateBottomNav();
}


function showContent(titleId) {
    const book = books.find(b => b.id == currentScopeBookId);
    if (!book) return;

    if (isHiraBook(book) || isHaaBook(book)) {
        showSong(currentScopeBookId, titleId);
    } else if (isSalamoBook(book)) {
        showSalamoContent(titleId);
    } else {
        // legacy placeholder for other books
        removeFloatingToggle();
        updateHeader(book ? book.name : "Boky", "Content tsy misy amin'izao rafitra vaovao izao");

        const sectionContainer = document.getElementById("sectionSearchContainer");
        if (sectionContainer) sectionContainer.style.display = "none";

        const container = document.getElementById("content");
        container.innerHTML = "<div class='item'>Tsy azo jerena amin&#39;ity drafitra vaovao ity ny pejy taloha.</div>";

        currentContentHtml = container.innerHTML;
        currentTitlesList = [];
        currentTitleIndex = -1;
        updateBottomNav();
    }
}

function toggleMenu() {
    const menu = document.getElementById("navMenu");
    const menuBtn = document.getElementById("bnav-menu");
    if (!menu) return;
    const shown = menu.style.display !== "none";
    if (shown) {
        menu.style.display = "none";
        if (navOutsideHandler) {
            document.removeEventListener("mousedown", navOutsideHandler);
            navOutsideHandler = null;
        }
    } else {
        menu.style.display = "block";
        // attach outside click handler
        navOutsideHandler = function (e) {
            const target = e.target;
            if (!menu.contains(target) && target !== menuBtn && !menuBtn.contains(target)) {
                menu.style.display = "none";
                if (navOutsideHandler) {
                    document.removeEventListener("mousedown", navOutsideHandler);
                    navOutsideHandler = null;
                }
            }
        };
        document.addEventListener("mousedown", navOutsideHandler);
    }
}

function navigateToBook(bookName) {
    const navMenu = document.getElementById("navMenu");
    if (navMenu) navMenu.style.display = "none";
    if (navOutsideHandler) {
        document.removeEventListener("mousedown", navOutsideHandler);
        navOutsideHandler = null;
    }
    const g = document.getElementById("globalSearchField");
    const s = document.getElementById("sectionSearchField");
    if (g) g.value = "";
    if (s) s.value = "";
    searchResults = [];

    const book = books.find(b => b.name === bookName);
    if (book) {
        navigationStack = [showBooks];
        showSections(book.id);
    }
}

function zoomIn() {
    currentFontSize = Math.min(currentFontSize + 10, 150);
    applyFontSize();
    if (currentContentHtml) {
        renderContent(currentContentHtml);
    }
}

function zoomOut() {
    currentFontSize = Math.max(currentFontSize - 10, 80);
    applyFontSize();
    if (currentContentHtml) {
        renderContent(currentContentHtml);
    }
}

function applyFontSize() {
    const root = document.documentElement;
    root.style.fontSize = (16 * (currentFontSize / 100)) + "px";
    localStorage.setItem("fontSizePercentage", currentFontSize);
}

function stopAutoScroll(e) {
    // If the touch was on the scroll button, let toggleAutoScroll handle it
    if (e) {
        const btn = document.getElementById("autoScrollBtn");
        if (btn && btn.contains(e.target)) return;
    }
    autoScrolling = false;
    if (autoScrollInterval) {
        cancelAnimationFrame(autoScrollInterval);
        autoScrollInterval = null;
    }
    const btn = document.getElementById("autoScrollBtn");
    const icon = document.getElementById("autoScrollIcon");
    if (btn) btn.classList.remove("scrolling");
    if (icon) icon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
    document.removeEventListener("touchstart", stopAutoScroll);
}

function startAutoScroll() {
    autoScrolling = true;
    const btn = document.getElementById("autoScrollBtn");
    const icon = document.getElementById("autoScrollIcon");
    if (btn) btn.classList.add("scrolling");
    if (icon) icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

    // Use rAF for smooth, reliable scrolling on Android WebView
    let lastTime = null;
    let accumulated = 0; // fractional pixel accumulator

    function rafScroll(timestamp) {
        if (!autoScrolling) return;
        if (lastTime !== null) {
            const delta = timestamp - lastTime; // ms since last frame
            accumulated += AUTO_SCROLL_SPEED * delta / 1000; // px/s → px this frame
            const pixels = Math.floor(accumulated);
            if (pixels >= 1) {
                window.scrollBy(0, pixels);
                accumulated -= pixels;
            }
        }
        lastTime = timestamp;
        const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
        if (atBottom) {
            stopAutoScroll();
        } else {
            autoScrollInterval = requestAnimationFrame(rafScroll);
        }
    }
    autoScrollInterval = requestAnimationFrame(rafScroll);

    // Stop on manual touch — delay so the starting tap doesn't immediately cancel
    setTimeout(() => {
        document.addEventListener("touchstart", stopAutoScroll, { passive: true });
    }, 300);
}

function toggleAutoScroll() {
    if (autoScrolling) {
        stopAutoScroll();
    } else {
        startAutoScroll();
    }
}


function showAbout() {
    currentView = showAbout;
    updateHeader("Mombamomba");
    if (navigationStack.length === 0) {
        navigationStack = [showBooks];
        updateBottomNav();
    }

    const navMenu = document.getElementById("navMenu");
    if (navMenu) navMenu.style.display = "none";

    if (navOutsideHandler) {
        document.removeEventListener("mousedown", navOutsideHandler);
        navOutsideHandler = null;
    }

    // hide section search and remove toggle button
    const sectionContainer = document.getElementById("sectionSearchContainer");
    if (sectionContainer) sectionContainer.style.display = "none";
    removeFloatingToggle();

    const container = document.getElementById("content");
    if (container) {
        container.innerHTML = `
        <h2>Boky Fivavahana Anglikana</h2>
        <p>Voninahitra ho an'Andriamanitra irery ihany.</p>
        <p>Raha misy olana na fanamarihana: <a href="mailto:tsiorymanana7@gmail.com">tsiorymanana7@gmail.com</a> / +261347048504</p>
        <p>Mampiasà finaritra.</p>
        `;
    }
}

// Handle Android hardware back button
document.addEventListener("DOMContentLoaded", () => {

    loadFontSize();
    loadData();

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        // Set Android navigation bar color to match bottom nav
        const NavigationBar = window.Capacitor.Plugins.NavigationBar;
        if (NavigationBar) {
            NavigationBar.setNavigationBarColor({ color: '#2e4175', darkButtons: false });
        }

        //Handle Back button
        const App = window.Capacitor.Plugins.App;
        const Toast = window.Capacitor.Plugins.Toast;
        let lastBackPress = 0;
        App.addListener("backButton", () => {
            if (navigationStack.length > 0) {
                goBack();
                return;
            }
            if (currentView && currentView !== showBooks) {
                goBack();
                return;
            }
            const now = Date.now();
            if (now - lastBackPress < 2000) {
                App.exitApp();
            } else {
                lastBackPress = now;
                Toast.show({
                    text: 'Tsindrio ihany raha hiala'
                });
            }
        });

    }
});