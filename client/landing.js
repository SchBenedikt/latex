/* LaTeX Studio landing page: theme, screenshots, local projects, tour, feature
 * explorer, templates, shortcuts and install instructions. No dependencies. */
(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var THEME_KEY = 'latex-landing-theme';

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* --------------------------------------------------------------- Theme */

  function initTheme() {
    var button = document.getElementById('theme-toggle');
    var meta = document.querySelector('meta[name="theme-color"]');
    var sync = function () {
      var theme = document.documentElement.dataset.theme || 'light';
      if (meta) meta.setAttribute('content', theme === 'dark' ? '#141718' : '#f7f6f2');
      if (button) button.setAttribute('aria-pressed', String(theme === 'dark'));
    };
    if (button) {
      button.addEventListener('click', function () {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
        sync();
      });
    }
    sync();
  }

  /* ------------------------------------------------ Scroll + navigation */

  function initScroll() {
    var bar = document.getElementById('scroll-progress-bar');
    var toTop = document.getElementById('to-top');
    var header = document.querySelector('.site-header');
    var onScroll = function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (bar) bar.style.transform = 'scaleX(' + p + ')';
      if (toTop) toTop.classList.toggle('visible', window.scrollY > 700);
      if (header) header.classList.toggle('scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if (toTop) toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    // Mobile menu
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('site-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
      nav.addEventListener('click', function (event) {
        if (event.target.tagName === 'A') {
          nav.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Active section in the navigation
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-nav]'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = { features: 'features', demo: 'demo-title', templates: 'templates-title', quickstart: 'quickstart', faq: 'faq-title' };
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        links.forEach(function (a) { a.classList.toggle('active', map[a.dataset.nav] === id); });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    Object.keys(map).forEach(function (key) {
      var section = document.getElementById(map[key]);
      if (section) observer.observe(section);
    });
  }

  function initReveal() {
    var targets = document.querySelectorAll('.pillar, .project-card, .feat-card, .tpl-card, .key-row, .privacy-list li, .faq-list details, .cmd-block, .footer-links > div');
    if (!('IntersectionObserver' in window) || reduceMotion) return;
    targets.forEach(function (t) { t.classList.add('reveal'); });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.1 });
    targets.forEach(function (target) { observer.observe(target); });
  }

  /* ---------------------------------------------------- Local workspace */

  function initProjects() {
    var section = document.getElementById('workspace-projects');
    var grid = document.getElementById('project-grid');
    var note = document.getElementById('project-note');
    if (!section || !grid) return;

    fetch('/api/state', { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('no local server'); return res.json(); })
      .then(function (state) {
        var projects = (state.projects || []).slice(0, 6);
        if (state.version) {
          var badge = document.getElementById('version-badge');
          if (badge) badge.textContent = 'v' + state.version;
          var footer = document.getElementById('footer-version');
          if (footer) footer.textContent = 'LaTeX Studio v' + state.version;
        }
        if (!projects.length) return;
        section.hidden = false;
        projects.forEach(function (name) {
          var card = el('article', 'project-card');
          card.appendChild(el('b', null, name));
          var meta = el('span', null, 'reading project …');
          card.appendChild(meta);
          var link = el('a', 'mini-btn', 'Open main document →');
          link.href = '/studio?project=' + encodeURIComponent(name);
          card.appendChild(link);
          grid.appendChild(card);

          Promise.all([
            fetch('/api/project/config?project=' + encodeURIComponent(name)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
            fetch('/api/projects/files?project=' + encodeURIComponent(name)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
          ]).then(function (results) {
            var config = (results[0] && results[0].config) || {};
            var files = (results[1] && results[1].files) || [];
            var main = config.mainFile || 'main.tex';
            meta.textContent = [main, config.engine || 'pdflatex', files.length + (files.length === 1 ? ' file' : ' files')].join(' · ');
            link.href = '/studio?project=' + encodeURIComponent(name) + '&file=' + encodeURIComponent(main);
          });
        });
        if (note) note.textContent = state.root ? 'Projects live in ' + state.root : '';
      })
      .catch(function () {
        // Hosted build (or no API): the browser workspace has no shared project list.
        if (note) note.textContent = '';
      });
  }

  /* ---------------------------------------------------------- Live demo */

  var PANEL_HINTS = {
    files: 'Project files — the tree mirrors the folders on disk.',
    outline: 'Numbered table of contents — click a heading to jump to that section.',
    bibliography: 'Bibliography manager — click Cite to insert the key into the document.',
    history: 'Change history — every saved version with a line diff and one-click restore.',
  };
  var VIEW_HINTS = {
    source: 'Source only — side panels still work, the preview is hidden.',
    split: 'Split view — the default: source and page side by side.',
    pdf: 'PDF focus — reading mode without the editor.',
  };

  function initDemo() {
    var demo = document.getElementById('app-demo');
    if (!demo) return;
    var body = document.getElementById('demo-body');
    var status = document.getElementById('demo-status');
    var hint = document.getElementById('demo-hint');
    var citeLine = document.getElementById('demo-cite-line');
    var diff = document.getElementById('demo-diff');
    var buildButton = document.getElementById('demo-build');
    var setHint = function (text) { if (hint) hint.textContent = text; };
    var setStatus = function (text) { if (status) status.textContent = text; };

    /* Panels */
    var railButtons = Array.prototype.slice.call(demo.querySelectorAll('[data-demo-panel]'));
    var panels = Array.prototype.slice.call(demo.querySelectorAll('[data-demo-panel-body]'));
    var selectPanel = function (name, focus) {
      railButtons.forEach(function (button) {
        var active = button.dataset.demoPanel === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        if (active && focus) button.focus();
      });
      panels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset.demoPanelBody === name); });
      if (PANEL_HINTS[name]) setHint(PANEL_HINTS[name]);
    };
    railButtons.forEach(function (button) {
      button.addEventListener('click', function () { selectPanel(button.dataset.demoPanel); });
    });

    /* Layout switch */
    var viewButtons = Array.prototype.slice.call(demo.querySelectorAll('[data-demo-view]'));
    viewButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        viewButtons.forEach(function (other) {
          var active = other === button;
          other.classList.toggle('active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        body.dataset.view = button.dataset.demoView;
        if (VIEW_HINTS[button.dataset.demoView]) setHint(VIEW_HINTS[button.dataset.demoView]);
      });
    });

    /* SyncTeX: source line <-> page block */
    var syncNodes = Array.prototype.slice.call(demo.querySelectorAll('[data-demo-sync]'));
    var flashTimer = null;
    var flash = function (key, origin) {
      clearTimeout(flashTimer);
      syncNodes.forEach(function (node) { node.classList.toggle('sync-active', node.dataset.demoSync === key); });
      if (origin === 'source') {
        // The page pane is a short scrollable strip in the compact layout:
        // bring the matching block into view without moving the whole page.
        var block = demo.querySelector('.demo-pdf-block[data-demo-sync="' + key + '"]');
        var strip = block && block.closest('.demo-pdf');
        if (block && strip && strip.scrollHeight > strip.clientHeight + 4) {
          var offset = block.offsetTop - (strip.clientHeight - block.clientHeight) / 2;
          strip.scrollTo({ top: Math.max(0, offset), behavior: reduceMotion ? 'auto' : 'smooth' });
        }
        setHint('SyncTeX: source line jumped to the matching block on the page.');
        setStatus('SyncTeX → page 1');
      } else if (origin === 'page') {
        setHint('SyncTeX: the page block jumped back to its source line.');
        setStatus('SyncTeX → source');
      }
      flashTimer = setTimeout(function () {
        syncNodes.forEach(function (node) { node.classList.remove('sync-active'); });
        setStatus('Ready');
      }, reduceMotion ? 700 : 2600);
    };
    syncNodes.forEach(function (node) {
      var source = node.classList.contains('demo-line');
      node.addEventListener('click', function () { flash(node.dataset.demoSync, source ? 'source' : 'page'); });
    });

    /* Outline jump */
    Array.prototype.forEach.call(demo.querySelectorAll('[data-demo-jump]'), function (row) {
      row.addEventListener('click', function () {
        var key = row.dataset.demoJump;
        var line = demo.querySelector('.demo-line[data-demo-sync="' + key + '"]');
        Array.prototype.forEach.call(demo.querySelectorAll('.demo-outline'), function (other) { other.classList.toggle('current', other === row); });
        if (line) {
          line.classList.add('sync-active');
          setTimeout(function () { line.classList.remove('sync-active'); }, reduceMotion ? 500 : 1600);
        }
        setHint('Outline jump: line ' + (line ? line.querySelector('i').textContent : '–') + ' of main.tex.');
      });
    });

    /* Citation insertion */
    Array.prototype.forEach.call(demo.querySelectorAll('[data-demo-cite]'), function (row) {
      row.addEventListener('click', function () {
        var key = row.dataset.demoCite;
        if (row.classList.contains('done')) return;
        row.classList.add('done');
        row.querySelector('em').textContent = 'Inserted ✓';
        if (citeLine) {
          citeLine.hidden = false;
          citeLine.querySelector('.c-cite').textContent = '\\cite{' + key + '}';
        }
        setStatus('Citation inserted');
        setHint('\\cite{' + key + '} inserted at the cursor — the matching entry is already in references.bib.');
      });
    });

    /* History diff */
    Array.prototype.forEach.call(demo.querySelectorAll('[data-demo-diff]'), function (row) {
      row.addEventListener('click', function () {
        if (!diff) return;
        var opening = diff.hidden;
        diff.hidden = !opening;
        row.querySelector('em').textContent = opening ? 'Hide diff' : 'Diff';
        setHint(opening
          ? 'Line diff of the saved version — restore it, or compare before you do.'
          : 'Saved versions keep their own diff; restore with one click.');
      });
    });

    /* Build replay */
    if (buildButton) {
      buildButton.addEventListener('click', function () {
        if (demo.classList.contains('building')) return;
        demo.classList.add('building');
        demo.classList.remove('ok');
        setStatus('Compiling main.tex …');
        setHint('pdflatex main.tex — the console streams the real output.');
        setTimeout(function () {
          demo.classList.remove('building');
          demo.classList.add('ok');
          setStatus('Build ok · 1.2 s · 1 page');
          setHint('Build finished: 1 page, no warnings. Ctrl+B runs this in the app.');
        }, reduceMotion ? 120 : 1100);
      });
    }

    selectPanel('files');
  }

  /* -------------------------------------------------------------- Tour */

  var TOUR = {
    write: {
      heading: 'Write with a LaTeX-aware editor',
      text: 'Syntax highlighting, autocomplete and snippets that know commands, environments, labels and citations — so boilerplate writes itself.',
      points: ['Autocomplete for commands, environments, labels and cite keys (Ctrl+Space)', 'Automatic \\end{…} closing, comment toggle (Ctrl+/) and \\textbf / \\emph / math wrapping', 'Guided wizards for tables, figures, equations, lists and citations'],
      demo: '<div class="mock mock-editor">' +
        '<div class="mock-bar"><span>main.tex</span><em>autocomplete</em></div>' +
        '<div class="mock-code">' +
        '<div><span class="mc-l">7</span><span class="mc-cmd">\\begin</span><span class="mc-arg">{eq</span><span class="mock-caret"></span></div>' +
        '<div><span class="mc-l">8</span><span class="mc-dim">  f(x) = \\int g(t)\\,dt</span></div>' +
        '</div>' +
        '<div class="mock-pop">' +
        '<div class="mock-pop-item active"><b>equation</b><span>Equation (numbered)</span></div>' +
        '<div class="mock-pop-item"><b>equation*</b><span>Equation (unnumbered)</span></div>' +
        '<div class="mock-pop-item"><b>align</b><span>Aligned equations</span></div>' +
        '</div></div>',
    },
    build: {
      heading: 'Build and see exactly what happened',
      text: 'One shortcut compiles with pdfLaTeX, XeLaTeX, LuaLaTeX or pLaTeX. Errors and warnings link straight back to the source line.',
      points: ['Problems panel with clickable file:line targets', 'Full compiler log one tab away (Ctrl+J)', 'Missing package? Install it from the error and rebuild automatically'],
      demo: '<div class="mock mock-console">' +
        '<div class="mock-bar"><span>$ pdflatex main.tex</span><em>console</em></div>' +
        '<div class="mock-log">' +
        '<div class="ml dim">This is pdfTeX, Version 3.141592653</div>' +
        '<div class="ml">./main.tex:12: Undefined control sequence</div>' +
        '<div class="ml warn">⚠ 1 warning — click to jump to the line</div>' +
        '<div class="ml ok">✓ Build succeeded · 1.2 s · 1 page</div>' +
        '</div></div>',
    },
    navigate: {
      heading: 'Navigate the document, not the files',
      text: 'The outline is a real table of contents: numbered like your document, grouped by file, with one-click jumps to any heading.',
      points: ['Numbers like 1.1.2, computed across chapters and files', 'Filter, collapse and expand; current section highlighted', 'Two-way SyncTeX: Ctrl+click the PDF lands on the source line'],
      demo: '<div class="mock mock-toc">' +
        '<div class="mock-bar"><span>Outline</span><em>thesis</em></div>' +
        '<div class="mock-toc-group">main.tex</div>' +
        '<div class="mock-toc-row"><b>1</b><span>Introduction</span></div>' +
        '<div class="mock-toc-row sub"><b>1.1</b><span>Methods</span></div>' +
        '<div class="mock-toc-row sub hl"><b>1.2</b><span>Results</span><em>you are here</em></div>' +
        '<div class="mock-toc-group">chapters/discussion.tex</div>' +
        '<div class="mock-toc-row"><b>2</b><span>Discussion</span></div>' +
        '</div>',
    },
    cite: {
      heading: 'Cite without leaving the document',
      text: 'The bibliography manager knows every entry of your .bib files and every citation in the project — and tells you when the two disagree.',
      points: ['Cited, never-cited and missing keys at a glance', 'Insert \\cite{…} or your biblatex command straight from the panel', 'Zotero browser with collections, tags and PDF previews'],
      demo: '<div class="mock mock-cite">' +
        '<div class="mock-bar"><span>Bibliography</span><em>2 entries · 1 cited · 1 missing</em></div>' +
        '<div class="mock-cite-row active"><b>wenzel2025</b><span>cited 3× · Wenzel, Petersen · 2025</span></div>' +
        '<div class="mock-cite-row"><b>knuth1984</b><span>never cited · Knuth · 1984</span></div>' +
        '<div class="mock-cite-chip">⚠ ghost2019 cited in chapters/results.tex · no BibTeX entry</div>' +
        '</div>',
    },
    organize: {
      heading: 'Nothing gets lost',
      text: 'The change history keeps every saved version of a file. Compare it with a line diff, restore it with one click, or capture the whole project as a snapshot.',
      points: ['Automatic local history of saved versions with line diffs', 'Project snapshots before big rewrites — restore all text files at once', 'ZIP export/import, public GitHub import and deep links to file and line'],
      demo: '<div class="mock mock-history">' +
        '<div class="mock-bar"><span>Change history</span><em>today</em></div>' +
        '<div class="mock-hist-row"><i class="mh-save">✎</i><b>chapters/methods.tex</b><span>+24 chars</span><em class="mh-btn">Restore</em></div>' +
        '<div class="mock-hist-row"><i class="mh-snap">💾</i><b>Snapshot created</b><span>before rewrite</span></div>' +
        '<div class="mock-hist-row"><i class="mh-build">▶</i><b>Build</b><span>pdflatex · success</span></div>' +
        '<div class="mock-diff"><span class="add">+ We describe the methods in detail.</span><span class="del">− We describe the methods.</span></div>' +
        '</div>',
    },
  };

  function initTour() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tour]'));
    var heading = document.getElementById('tour-heading');
    var text = document.getElementById('tour-text');
    var points = document.getElementById('tour-points');
    var demo = document.getElementById('tour-demo');
    var hint = document.getElementById('tour-hint');
    if (!tabs.length || !heading || !demo) return;
    var order = tabs.map(function (t) { return t.dataset.tour; });
    var current = order[0];
    var timer = null;
    var userTook = false;

    var show = function (key) {
      var item = TOUR[key];
      if (!item) return;
      current = key;
      tabs.forEach(function (tab) {
        var active = tab.dataset.tour === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      heading.textContent = item.heading;
      text.textContent = item.text;
      points.innerHTML = '';
      item.points.forEach(function (point) {
        points.appendChild(el('li', null, point));
      });
      demo.innerHTML = item.demo;
      demo.classList.remove('swap');
      void demo.offsetWidth;
      demo.classList.add('swap');
    };

    var schedule = function () {
      clearInterval(timer);
      if (reduceMotion || userTook) return;
      timer = setInterval(function () {
        var i = order.indexOf(current);
        show(order[(i + 1) % order.length]);
      }, 7000);
    };

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        userTook = true;
        if (hint) hint.textContent = 'Everything shown here runs locally in your workspace.';
        show(tab.dataset.tour);
        schedule();
      });
    });
    show(current);
    schedule();
  }

  /* --------------------------------------------------- Feature explorer */

  var FEATURES = [
    ['Write', 'LaTeX-aware editor', 'Syntax highlighting for commands, math, verbatim blocks and comments — tuned for LaTeX, not generic text.', ''],
    ['Write', 'Autocomplete everywhere', 'Commands, environments, labels, citation keys and file paths — plus bare math words like “alpha” that expand to \\alpha.', 'Ctrl+Space'],
    ['Write', 'BibTeX entry details', 'Citation completion reads the real fields of your .bib entries — author, year, title and journal — including nested braces and quoted values.', ''],
    ['Write', 'Snippets with placeholders', 'Tab through generated fields like ${1:Caption}. Typing \\begin{…} adds the matching \\end{…} automatically.', 'Tab'],
    ['Write', 'Comment and text commands', 'Toggle line comments with Ctrl+/ and wrap the selection in \\textbf, \\textit, \\emph, \\underline or inline math.', 'Ctrl+/'],
    ['Write', 'Insert wizards', 'Booktabs tables, captioned figures, aligned equations, lists and citations — generated step by step, no boilerplate memorized.', ''],
    ['Write', 'Symbol palette', 'Greek letters, operators, arrows, accents and brackets in categorized groups. Click to insert.', ''],
    ['Write', 'Multi-cursor and folding', 'Multiple cursors, code folding for environments and sections, bracket matching and full undo history.', 'Ctrl+D'],
    ['Preview', 'Live PDF preview', 'Zoom, fit-to-width or fit-to-page, page navigation and search inside the rendered PDF.', ''],
    ['Preview', 'Two-way SyncTeX', 'Ctrl+click the PDF to land on the source line — or jump from the cursor to the exact highlighted rectangle on the page.', 'Ctrl+Shift+G'],
    ['Preview', 'Four TeX engines', 'pdfLaTeX, XeLaTeX, LuaLaTeX and pLaTeX — switchable per project and remembered.', ''],
    ['Preview', 'Auto build', 'Recompiles after a pause while you type, with a configurable delay.', ''],
    ['Preview', 'Problems panel', 'Errors and warnings link straight back to file and line. Missing package? Install it and rebuild with one click.', ''],
    ['Preview', 'Full compiler log', 'A colored live console during the build and the raw .log whenever you need it.', 'Ctrl+J'],
    ['Preview', 'Package diagnostics', 'Detects used packages and document classes, shows availability and installs missing ones through TeX Live or MiKTeX.', ''],
    ['Navigate', 'Numbered table of contents', 'Sections numbered like the final document, grouped by file, with hierarchy guides, filter and collapse/expand.', 'Ctrl+Shift+O'],
    ['Navigate', 'Project search and replace', 'Regex, case sensitivity and whole-word matching across every file of the project.', 'Ctrl+Shift+F'],
    ['Navigate', 'Quick open and command palette', 'Jump to any file by name, or run any command from one searchable list.', 'Ctrl+P'],
    ['Navigate', 'Deep links', 'Open /studio?project=Paper&file=chapters/intro.tex&line=42 to land exactly where you want — the landing page uses the same links.', ''],
    ['Navigate', 'Go to line and breadcrumbs', 'Numeric jump with Ctrl+G, and clickable path breadcrumbs that reveal files in the tree.', 'Ctrl+G'],
    ['References', 'Bibliography manager', 'Every entry of the project’s .bib files with type, author and year, filterable by type and by “cited”, “never cited” or “missing”.', 'Alt+B'],
    ['References', 'Missing citation keys', 'Citations without a matching BibTeX entry are listed as warnings, so a broken reference never reaches the submission.', 'Alt+B'],
    ['References', 'One-click citation insertion', 'Insert \\cite{…} or the matching biblatex command for any entry, copy the raw BibTeX block, or jump to the entry in its file.', ''],
    ['References', 'Zotero library browser', 'Collections, tags, source details and attachment previews (PDF, images, HTML snapshots) in the sidebar.', ''],
    ['References', 'BibTeX merge', 'Import Better BibTeX exports with update detection for changed entries and citekey deduplication.', ''],
    ['Research', 'Word goals', 'A per-project target with a progress bar that counts every text file of the project.', ''],
    ['Research', 'Task tracker', 'TODO, FIXME, NOTE and HACK annotations scanned project-wide, filterable by kind, jump to any of them.', 'Alt+T'],
    ['Research', 'Project notes', 'A scratchpad per project for ideas, outlines and reviewer replies — stored in the browser.', ''],
    ['Research', 'Document statistics', 'Words, reading time, sections, floats, math blocks, citations and TODOs — including project totals.', ''],
    ['Data', 'Change history', 'Every saved version of a file stays local: compare with a line diff, restore with one click.', ''],
    ['Data', 'Snapshots, manual and automatic', 'Capture whole projects before a rewrite — automatically every 20 minutes and always before restoring.', ''],
    ['Data', 'ZIP export and import', 'Move or back up entire projects as archives.', ''],
    ['Data', 'GitHub import', 'Start from any public repository archive.', ''],
    ['Data', 'Document metadata', 'Edit title, author, date, PDF subject and keywords from a dialog — written back to the source.', ''],
    ['Data', 'Seven templates', 'Article, thesis, beamer, report, letter, mathematics and minimal — ready to compile.', ''],
    ['Collaborate', 'Presence', 'See who else is connected to the project — anonymous local names, shown in the status bar.', ''],
    ['Collaborate', 'Live file sync', 'Saves from other editors appear immediately in yours. Unsaved local changes are never overwritten.', ''],
    ['Interface', 'Focus mode', 'Alt+Z hides everything but the text.', 'Alt+Z'],
    ['Interface', 'Themes and layout', 'Dark, light or system theme; resizable sidebar, preview and console panels.', ''],
    ['Interface', 'Keyboard first', 'Every workflow has a shortcut — F1 lists them all inside the app.', 'F1'],
    ['Interface', 'Local first', 'Projects live in your filesystem (or your browser on the hosted build). No account, no required cloud.', ''],
  ];

  function initFeatures() {
    var grid = document.getElementById('feature-grid');
    var chipsBox = document.getElementById('feature-chips');
    var filter = document.getElementById('feature-filter');
    var count = document.getElementById('feature-count');
    if (!grid || !chipsBox) return;
    var categories = ['All'];
    FEATURES.forEach(function (f) { if (categories.indexOf(f[0]) < 0) categories.push(f[0]); });
    var active = 'All';
    var query = '';

    categories.forEach(function (category) {
      var chip = el('button', 'exp-chip' + (category === 'All' ? ' active' : ''), category === 'All' ? 'All features' : category);
      chip.addEventListener('click', function () {
        active = category;
        Array.prototype.forEach.call(chipsBox.children, function (node) { node.classList.toggle('active', node === chip); });
        render();
      });
      chipsBox.appendChild(chip);
    });

    var render = function () {
      grid.innerHTML = '';
      var shown = FEATURES.filter(function (f) {
        if (active !== 'All' && f[0] !== active) return false;
        if (!query) return true;
        return (f[0] + ' ' + f[1] + ' ' + f[2]).toLowerCase().indexOf(query) >= 0;
      });
      shown.forEach(function (f) {
        var card = el('article', 'feat-card');
        card.appendChild(el('div', 'feature-index', f[0]));
        card.appendChild(el('h3', null, f[1]));
        card.appendChild(el('p', null, f[2]));
        if (f[3]) card.appendChild(el('kbd', null, f[3]));
        grid.appendChild(card);
      });
      if (!shown.length) grid.appendChild(el('div', 'keys-empty', 'No feature matches “' + query + '”.'));
      if (count) count.textContent = shown.length + ' / ' + FEATURES.length + ' features';
    };

    if (filter) filter.addEventListener('input', function () {
      query = filter.value.trim().toLowerCase();
      render();
    });
    render();
  }

  /* ---------------------------------------------------------- Templates */

  var TEMPLATES = {
    article: {
      file: 'article · main.tex',
      code: '\\documentclass[11pt]{article}\n\\usepackage{amsmath, graphicx, hyperref}\n\n\\title{A Clear Argument}\n\\author{Author Name}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\\begin{abstract}\n  One paragraph on what this shows.\n\\end{abstract}\n\n\\section{Introduction}\\label{sec:intro}\nSee \\cref{fig:build} for the workflow.\n\n\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/build}\n  \\caption{Build cycle.}\\label{fig:build}\n\\end{figure}\n\\end{document}',
    },
    thesis: {
      file: 'thesis · main.tex',
      code: '\\documentclass[12pt]{book}\n\\usepackage{cleveref, biblatex, hyperref}\n\\addbibresource{references.bib}\n\n\\begin{document}\n\\frontmatter\n\\maketitle\n\\tableofcontents\n\n\\mainmatter\n\\chapter{Introduction}\\label{chap:intro}\n\\input{chapters/background}\n\n\\backmatter\n\\printbibliography\n\\end{document}',
    },
    beamer: {
      file: 'beamer · main.tex',
      code: '\\documentclass{beamer}\n\\usetheme{Madrid}\n\\title{From Source to PDF}\n\\author{Author Name}\n\n\\begin{document}\n\\begin{frame}\n  \\titlepage\n\\end{frame}\n\n\\begin{frame}{Overview}\n  \\begin{itemize}\n    \\item Local workflow\n    \\item Live preview\n    \\item SyncTeX jumps\n  \\end{itemize}\n\\end{frame}\n\\end{document}',
    },
    report: {
      file: 'report · main.tex',
      code: '\\documentclass[11pt]{report}\n\\usepackage{pgfplots, booktabs}\n\n\\begin{document}\n\\chapter{Results}\\label{chap:results}\n\n\\begin{table}[htbp]\n  \\centering\n  \\caption{Runtimes (s).}\\label{tab:times}\n  \\begin{tabular}{lrr}\n    \\toprule\n    Stage & Mean & Std \\\\\n    \\midrule\n    Compile & 58.7 & 3.1 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}\n\\end{document}',
    },
    letter: {
      file: 'letter · main.tex',
      code: '\\documentclass{scrlttr2}\n\\setkomavar{fromname}{Jane Doe}\n\\setkomavar{fromaddress}{Main Street 1\\\\12345 Town}\n\n\\begin{document}\n\\begin{letter}{Acme Corp\\\\Harbor Road 4\\\\12345 Town}\n  \\opening{Dear team,}\n  Please find our offer attached.\n  \\closing{Kind regards}\n\\end{letter}\n\\end{document}',
    },
    math: {
      file: 'math · main.tex',
      code: '\\documentclass{article}\n\\usepackage{amsmath, amsthm}\n\\newtheorem{theorem}{Theorem}\n\n\\begin{document}\n\\begin{theorem}[Stability]\n  Let $Q(w, s)$ be the weighted mean.\n  Small weight changes shift $Q$\n  at most linearly.\n\\end{theorem}\n\n\\begin{proof}\n  By the triangle inequality.\n\\end{proof}\n\\end{document}',
    },
  };

  function initTemplates() {
    var code = document.getElementById('template-preview-code');
    var name = document.getElementById('template-preview-name');
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-template]'));
    if (!code || !cards.length) return;
    var show = function (key) {
      var template = TEMPLATES[key];
      if (!template) return;
      cards.forEach(function (card) { card.classList.toggle('active', card.dataset.template === key); });
      code.textContent = template.code;
      if (name) name.textContent = template.file;
    };
    cards.forEach(function (card) {
      card.addEventListener('click', function () { show(card.dataset.template); });
    });
    show('article');
    var copy = document.getElementById('template-copy');
    if (copy) copy.addEventListener('click', function () { copyText(code.textContent, copy); });
  }

  /* ---------------------------------------------------------- Shortcuts */

  var KEYS = [
    ['Build project', 'Ctrl+B / F5'],
    ['Command palette', 'Ctrl+Shift+P'],
    ['Open file', 'Ctrl+P'],
    ['Project search', 'Ctrl+Shift+F'],
    ['Preview current line', 'Ctrl+Shift+G'],
    ['Bibliography manager', 'Alt+B'],
    ['Research panel', 'Alt+T'],
    ['Toggle comment', 'Ctrl+/'],
    ['Bold · italic · math', 'Alt+Shift+B / I / M'],
    ['Focus mode', 'Alt+Z'],
    ['Shortcuts & help', 'F1'],
  ];

  function initKeys() {
    var grid = document.getElementById('keys-grid');
    var filter = document.getElementById('keys-filter');
    var count = document.getElementById('keys-count');
    if (!grid) return;
    var render = function (value) {
      grid.innerHTML = '';
      var query = (value || '').trim().toLowerCase();
      var shown = KEYS.filter(function (row) {
        return !query || row[0].toLowerCase().indexOf(query) >= 0 || row[1].toLowerCase().indexOf(query) >= 0;
      });
      shown.forEach(function (row) {
        var node = el('div', 'key-row');
        node.appendChild(el('span', null, row[0]));
        node.appendChild(el('kbd', null, row[1]));
        grid.appendChild(node);
      });
      if (!shown.length) grid.appendChild(el('div', 'keys-empty', 'No shortcut matches “' + value + '”.'));
      if (count) count.textContent = shown.length + ' / ' + KEYS.length;
    };
    if (filter) filter.addEventListener('input', function () { render(filter.value); });
    render('');
  }

  /* -------------------------------------------------------- Quick start */

  var INSTALL = {
    local: {
      blocks: [
        ['Install', 'npm install'],
        ['Start', 'npm start'],
        ['Open', 'http://localhost:4180'],
      ],
      requirements: [
        'Node.js 18 or newer and npm.',
        'A TeX distribution for compilation: TeX Live or MiKTeX. The app starts without one, but building and package installation need it.',
        'Optional: Zotero with Better BibTeX for the reference workflow, and Git if you want version control in your project folder.',
        'The server binds to 0.0.0.0:4180 by default — set HOST=127.0.0.1 for local-only access.',
      ],
    },
    cloudflare: {
      blocks: [
        ['Install', 'npm ci'],
        ['Build', 'npm run build'],
        ['Deploy', 'npx wrangler deploy'],
      ],
      requirements: [
        'A Cloudflare account and the Wrangler CLI (npm run deploy:cloudflare does both steps).',
        'About 230 MB of downloads during deployment for the TeX Live WebAssembly runtime.',
        'Visitors compile pdfLaTeX and XeLaTeX in the browser; sources and PDFs stay in that browser.',
        'LuaLaTeX, SyncTeX, local TeX package tooling and GitHub import need the local Node.js server.',
      ],
    },
  };

  function initQuickstart() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.quickstart-tab'));
    var grid = document.getElementById('quickstart-grid');
    var requirements = document.getElementById('requirements');
    if (!tabs.length || !grid) return;
    var show = function (key) {
      var install = INSTALL[key];
      if (!install) return;
      tabs.forEach(function (tab) {
        var active = tab.dataset.install === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
      });
      grid.innerHTML = '';
      install.blocks.forEach(function (block) {
        var node = el('div', 'cmd-block');
        node.appendChild(el('span', 'cmd-label', block[0]));
        node.appendChild(el('code', null, block[1]));
        var button = el('button', 'mini-btn copy-btn', 'Copy');
        button.addEventListener('click', function () { copyText(block[1], button); });
        node.appendChild(button);
        grid.appendChild(node);
      });
      if (requirements) {
        requirements.innerHTML = '';
        install.requirements.forEach(function (text) { requirements.appendChild(el('li', null, text)); });
      }
    };
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { show(tab.dataset.install); });
    });
    show('local');
  }

  /* -------------------------------------------------------- Copy + FAQ */

  function copyText(text, button) {
    var done = function () {
      if (!button) return;
      var previous = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(function () { button.textContent = previous; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* clipboard unavailable */ }
      area.remove();
    }
  }

  function initCopyButtons() {
    document.querySelectorAll('.copy-btn').forEach(function (button) {
      if (button.closest('#quickstart-grid')) return;   // rendered per install tab
      button.addEventListener('click', function () { copyText(button.dataset.copy || '', button); });
    });
  }

  function initFaq() {
    var items = Array.prototype.slice.call(document.querySelectorAll('.faq-list details'));
    var expand = document.getElementById('faq-expand');
    var collapse = document.getElementById('faq-collapse');
    if (expand) expand.addEventListener('click', function () { items.forEach(function (d) { d.open = true; }); });
    if (collapse) collapse.addEventListener('click', function () { items.forEach(function (d) { d.open = false; }); });
  }

  function initSearchShortcut() {
    document.addEventListener('keydown', function (event) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var filter = document.getElementById('feature-filter');
      if (!filter) return;
      event.preventDefault();
      filter.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      filter.focus();
    });
  }

  onReady(function () {
    initTheme();
    initScroll();
    initReveal();
    initProjects();
    initDemo();
    initTour();
    initFeatures();
    initTemplates();
    initKeys();
    initQuickstart();
    initCopyButtons();
    initFaq();
    initSearchShortcut();
  });
})();
