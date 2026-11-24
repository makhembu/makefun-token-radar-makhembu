// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, category filters, sortable columns, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is already in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var focusSearch = false;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // ---------------------------------------------------------------- small DOM helpers

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(node, c); });
      return;
    }
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  // ---------------------------------------------------------------- category and risk vocabulary

  function kindOf(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('restak') >= 0) return 'restaking';
    if (c.indexOf('staking') >= 0) return 'staking';
    if (c.indexOf('index') >= 0) return 'other';
    if (c.indexOf('dex') >= 0) return 'dex';
    if (c.indexOf('lending') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'derivatives';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    if (c.indexOf('cross chain') >= 0 || c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'curator';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    return 'other';
  }
  function categoryBadge(category) {
    return el('span', { class: 'badge cat-' + kindOf(category), text: category || 'Other' });
  }
  function riskClass(level) {
    return level === 'Low' ? 'low' : level === 'High' ? 'high' : 'medium';
  }
  function riskBadge(level, score) {
    return el('span', { class: 'badge risk-' + riskClass(level), text: level + (score === undefined ? '' : ' ' + Math.round(score)) });
  }
  function chainLine(r) {
    var chains = r.chains || [];
    if (chains.length === 0) return 'Unnamed chain';
    var shown = chains.slice(0, 3).join(' · ');
    return chains.length > 3 ? shown + ' +' + (chains.length - 3) : shown;
  }

  // ---------------------------------------------------------------- hash-backed state

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    if (state.tab === 'live') params.set('tab', 'live');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------------- filtering and sorting

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), r.risk_level, r.on_watchlist ? 'watchlist' : 'early'].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null || r.age_days === undefined ? Infinity : r.age_days;
    if (key === 'risk') return r.risk_score;
    if (key === 'rank') return r.rank;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, state.sort);
      var bv = sortValue(b, state.sort);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function categoryCounts() {
    var counts = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts).sort().map(function (name) { return { name: name, count: counts[name] }; });
  }

  // ---------------------------------------------------------------- header, hero and controls

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'TOKEN RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.model_version + ' model' }),
        el('span', { class: 'offline', text: 'Offline' })
      )
    );
  }

  function stat(label, value, hint) {
    return el('div', { class: 'stat', role: 'listitem' },
      el('span', { class: 'stat-label', text: label }),
      el('b', { class: 'stat-value', text: value }),
      hint ? el('span', { class: 'stat-hint', text: hint }) : null
    );
  }

  function hero() {
    var totalImplied = DATA.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('p', { class: 'eyebrow', text: 'Pre-token intelligence' }),
        el('h1', { text: DATA.board_size + ' pre-token protocols ranked by implied value' }),
        el('p', { class: 'lede', text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar fills the rest below that floor. Implied value weighs category, momentum, maturity and risk; it is a model, not a promise.' })
      ),
      el('div', { class: 'stats', role: 'list' },
        stat('Tracked', String(DATA.board_size), 'pre-token protocols'),
        stat('Watchlist', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'covered'),
        stat('Early radar', String(DATA.early_size), 'below the floor'),
        stat('Total implied', fmtUsd(totalImplied), 'modeled value')
      )
    );
  }

  function tabButton(tab, label) {
    return el('button', {
      type: 'button',
      'aria-pressed': state.tab === tab ? 'true' : 'false',
      text: label,
      onclick: function () { state.tab = tab; state.selected = null; writeHash(); render(); }
    });
  }

  function controls() {
    var list = rows();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      focusSearch = true;
      state.q = search.value;
      writeHash();
      render();
    });
    var count = state.tab === 'pre-token' ? list.length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols';
    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' });
    if (state.tab === 'pre-token') {
      chips.appendChild(el('button', {
        type: 'button',
        class: 'chip' + (state.category === 'all' ? ' active' : ''),
        'aria-pressed': state.category === 'all' ? 'true' : 'false',
        text: 'All ' + DATA.board_size,
        onclick: function () { state.category = 'all'; writeHash(); render(); }
      }));
      categoryCounts().forEach(function (c) {
        chips.appendChild(el('button', {
          type: 'button',
          class: 'chip' + (state.category === c.name ? ' active' : ''),
          'aria-pressed': state.category === c.name ? 'true' : 'false',
          text: c.name + ' ' + c.count,
          onclick: function () { state.category = c.name; writeHash(); render(); }
        }));
      });
    }
    return el('div', { class: 'controls-wrap' },
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'tabs' }, tabButton('pre-token', 'Pre-token'), tabButton('live', 'Live token')),
        el('span', { class: 'count', text: count })
      ),
      chips
    );
  }

  // ---------------------------------------------------------------- tables

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
      el('button', {
        type: 'button',
        class: active ? 'sorted' : null,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          render();
        }
      }, label, el('span', { class: 'arrow', 'aria-hidden': 'true', text: active ? (state.dir < 0 ? ' ↓' : ' ↑') : '' }))
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or choose another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto' },
          el('div', { class: 'proto-name' }, el('b', { text: r.name }), r.on_watchlist ? el('span', { class: 'tag watch', text: 'watchlist' }) : el('span', { class: 'tag early', text: 'early' })),
          el('div', { class: 'proto-meta' }, categoryBadge(r.category), el('span', { class: 'sub', text: chainLine(r) }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, riskBadge(r.risk_level, r.risk_score)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its valuation and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('risk', 'Risk'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { class: 'static' },
        el('td', null, el('span', { class: 'tag live', text: 'live' })),
        el('td', null, el('div', { class: 'proto' },
          el('div', { class: 'proto-name' }, el('b', { text: r.name })),
          el('div', { class: 'proto-meta' }, categoryBadge(r.category), el('span', { class: 'sub', text: chainLine(r) }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // ---------------------------------------------------------------- model panel

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by the same functions of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd × ' + m.base_multiple + ' × category_multiple × momentum × maturity × risk )'
      ),
      el('div', { class: 'formula-grid' },
        el('div', null, el('span', { text: 'Momentum' }), el('b', { text: '1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight })),
        el('div', null, el('span', { text: 'Maturity' }), el('b', { text: m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range })),
        el('div', null, el('span', { text: 'Risk' }), el('b', { text: '1 - risk_score / 100 × ' + m.risk_weight }))
      ),
      el('p', { class: 'sub', text: 'Category multiples range from ' + '0.22 for yield to 0.35 for derivatives. Risk rises for younger protocols and for protocols on fewer chains; an unlisted age uses ' + m.unknown_age_days + ' days. TVL and seven-day growth come from the snapshot.' })
    );
  }

  // ---------------------------------------------------------------- detail drawer

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    state.selected = null;
    writeHash();
    render();
  });

  function equationRow(label, value, cls) {
    return el('div', { class: 'equation-row' }, el('span', { text: label }), el('b', { class: 'num' + (cls ? ' ' + cls : ''), text: value }));
  }
  function renderStep(step) {
    var at = step.indexOf(' Cost: ');
    var action = at >= 0 ? step.slice(0, at) : step;
    var tail = at >= 0 ? step.slice(at + 1) : '';
    return el('li', { class: 'step' },
      el('span', { class: 'step-action', text: action }),
      tail ? el('span', { class: 'step-meta', text: tail }) : null
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', { class: 'detail-title-wrap' },
        el('span', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('div', { class: 'detail-badges' },
          categoryBadge(row.category),
          riskBadge(row.risk_level, row.risk_score),
          row.on_watchlist ? el('span', { class: 'tag watch', text: 'watchlist' }) : el('span', { class: 'tag early', text: 'early radar' })
        ),
        el('p', { class: 'sub', text: chainLine(row) })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Valuation' }),
      el('div', { class: 'equation' },
        equationRow('TVL', fmtUsd(row.tvl_usd)),
        equationRow('Seven-day change', fmtPct(row.change_7d)),
        equationRow('Age with no token', fmtAge(row.age_days)),
        equationRow('Category multiple', '×' + row.category_multiplier),
        equationRow('Momentum factor', '×' + row.momentum_factor),
        equationRow('Maturity multiplier', '×' + row.maturity_multiplier),
        equationRow('Risk multiplier', '×' + row.risk_multiplier + ' (' + row.risk_level + ' ' + Math.round(row.risk_score) + ')'),
        equationRow('Implied value', fmtUsd(row.implied_value_usd), 'accent')
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same functions score every protocol. This is an estimate, not a price.' })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(renderStep))
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---------------------------------------------------------------- render loop

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
    } else {
      shell.appendChild(liveTable());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    if (focusSearch) {
      var input = app.querySelector('#q');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
      focusSearch = false;
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
