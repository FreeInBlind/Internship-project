/* Account-scoped ECharts workspace. All data access and entitlements are enforced by the API. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const html = value => escapeHtml(value);
  const typeLabels = { line: 'Line', bar: 'Bar', area: 'Area', stacked: 'Stacked bars', donut: 'Donut', scatter: 'Scatter', heatmap: 'Heatmap', treemap: 'Treemap', radar: 'Radar', boxplot: 'Box plot', histogram: 'Histogram' };
  const state = { summary: null, widgets: [], charts: new Map(), instances: new Map(), epoch: 0, owner: null, editorKey: null, dragging: null, observer: null, saveQueue: Promise.resolve(), saveRevision: 0 };
  const auth = () => ({ Authorization: 'Bearer ' + getToken() });
  document.addEventListener('ecopoints:session', () => {
    ++state.epoch; dispose(); state.summary = null; state.widgets = []; state.owner = null;
    if ($('dashBoard')) $('dashBoard').replaceChildren();
    if ($('dashMetrics')) $('dashMetrics').replaceChildren();
  });
  const plus = () => state.summary?.tier === 'plus';
  const organization = () => state.summary?.role === 'organization';

  function status(message, error = false) {
    const target = $('dashStatus');
    if (target) { target.textContent = message; target.classList.toggle('error', error); }
  }

  function mount() {
    const root = document.querySelector('#dashboardPage .dashboard-body');
    if (!root || $('dashBoard')) return;
    root.innerHTML = '<section class="dash-banner dashboard-heading"><div class="dash-banner-left"><span class="dash-tag"><i data-lucide="leaf"></i> Dashboard</span><h1 id="dashTitle">Your sustainability picture.</h1><p id="dashIntro">Your account activity, progress and rewards.</p></div><div class="dashboard-toolbar"><button type="button" class="outline-button" id="dashUploadToggle" hidden>Upload data</button><button type="button" class="outline-button" id="dashReset" hidden>Reset layout</button><button type="button" class="btn-primary compact-button" id="dashLibraryToggle" hidden>Chart library</button></div></section>' +
      '<section class="dash-controls"><label id="dashDatasetLabel" hidden>Dataset<select id="dashDataset"></select></label><form id="dashDateForm" hidden><label>From<input type="date" id="dashStart"></label><label>To<input type="date" id="dashEnd"></label><button class="outline-button" type="submit">Apply period</button><button class="outline-button" type="button" id="dashDateReset">Last 30 days</button></form><p id="dashStatus" role="status" aria-live="polite"></p></section><section id="dashMetrics" class="dash-metrics"></section>' +
      '<section class="dash-workspace"><div id="dashBoard" class="dash-board" aria-label="Dashboard charts"></div><aside id="dashLibrary" class="dash-library" hidden><div class="dash-panel-heading"><h2>Chart library</h2><button type="button" class="icon-button" id="dashLibraryClose" aria-label="Close chart library">×</button></div><p class="card-muted">Add modules, drag their handles, or use the move buttons to arrange them.</p><div id="dashModules"></div><div id="dashTypes"></div><section class="dash-analysis-info" id="dashAnalysisInfo" hidden><h3>Analyze your data</h3><p>Select fields, aggregation and filters in each module. Add period comparisons, a moving average, linear projections or anomaly markers to time series.</p><label><input type="checkbox" id="dashZoom" checked> Interactive chart zoom</label></section></aside></section>' +
      '<dialog id="dashUploadDialog" class="dash-dialog"><form method="dialog" class="dash-dialog-close"><button aria-label="Close upload" class="icon-button">×</button></form><h2>Upload organization data</h2><p class="card-muted">UTF-8 CSV · 10 MB maximum · Basic: 5,000 rows · Plus: 50,000 rows. Preview before importing.</p><form id="dashUploadForm"><label>Dataset name<input id="dashUploadName" required maxlength="180"></label><label>CSV file<input id="dashUploadFile" type="file" accept=".csv,text/csv" required></label><button type="button" class="outline-button" id="dashPreview">Preview CSV</button><div id="dashPreviewResult" class="dash-preview"></div><button type="submit" class="btn-primary" id="dashUploadSubmit" disabled>Confirm import</button><p id="dashUploadMessage" role="status"></p></form></dialog>' +
      '<dialog id="dashEditor" class="dash-dialog"><form method="dialog" class="dash-dialog-close"><button aria-label="Close chart configuration" class="icon-button">×</button></form><h2 id="dashEditorHeading">Configure chart</h2><form id="dashEditorForm"><label>Chart title<input id="dashChartTitle" maxlength="120" placeholder="Leave blank to use field names"></label><div class="dash-form-grid"><label>Dataset<select id="dashEditDataset"></select></label><label>Chart type<select id="dashChartType"></select></label><label>Dimension<select id="dashDimension"></select></label><label>Metric<select id="dashMetric"></select></label><label>Aggregation<select id="dashAggregation"><option value="sum">Sum</option><option value="mean">Average</option><option value="count">Record count</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label><label>Second numeric metric (scatter)<select id="dashSecondMetric"></select></label><label>Series / second dimension<select id="dashSplit"></select></label><label>Date field<select id="dashDateColumn"></select></label><label>Start date<input type="date" id="dashEditStart"></label><label>End date<input type="date" id="dashEditEnd"></label><label>Filter field<select id="dashFilterColumn"></select></label><label>Filter value (exact match)<input id="dashFilterValue" maxlength="2000"></label></div><label>Analysis<select id="dashAnalysis"><option value="none">None</option><option value="moving-average">3-period moving average</option><option value="comparison">Compare preceding period</option><option value="forecast">Three-period linear projection</option><option value="anomalies">Anomaly markers (2 standard deviations)</option></select></label><p class="card-muted">Trend tools use one numeric series with a date dimension. Scatter charts require two numeric metrics; heatmaps require two dimensions.</p><button type="submit" class="btn-primary">Apply chart</button><p id="dashEditorMessage" role="status"></p></form></dialog>';
    $('dashLibraryToggle').onclick = () => { $('dashLibrary').hidden = !$('dashLibrary').hidden; resize(); };
    $('dashLibraryClose').onclick = () => { $('dashLibrary').hidden = true; resize(); };
    $('dashUploadToggle').onclick = () => $('dashUploadDialog').showModal();
    $('dashReset').onclick = async () => { state.widgets = defaults(); await hydrate(); save(); };
    $('dashDataset').onchange = () => open();
    $('dashDateForm').onsubmit = event => { event.preventDefault(); open(); };
    $('dashDateReset').onclick = () => { $('dashStart').value = ''; $('dashEnd').value = ''; open(); };
    $('dashEditDataset').onchange = () => populateFields();
    $('dashPreview').onclick = previewUpload;
    $('dashUploadFile').onchange = () => { $('dashUploadSubmit').disabled = true; $('dashPreviewResult').textContent = ''; };
    $('dashUploadForm').onsubmit = upload;
    $('dashEditorForm').onsubmit = configure;
    $('dashZoom').onchange = redraw;
    $('dashBoard').addEventListener('dragover', event => event.preventDefault(), true);
    const filters = document.createElement('div'); filters.id = 'dashExtraFilters'; filters.className = 'dash-extra-filters';
    $('dashEditorForm').insertBefore(filters, $('dashAnalysis').closest('label'));
    const addFilter = document.createElement('button'); addFilter.type = 'button'; addFilter.className = 'outline-button'; addFilter.textContent = 'Add another filter'; addFilter.onclick = () => addFilterRow();
    $('dashEditorForm').insertBefore(addFilter, $('dashAnalysis').closest('label'));
    $('dashBoard').addEventListener('drop', event => {
      event.preventDefault();
      if (!state.dragging || !plus()) return;
      const target = event.target.closest('[data-widget-key]');
      const from = state.widgets.findIndex(widget => widget.key === state.dragging);
      const to = target ? state.widgets.findIndex(widget => widget.key === target.dataset.widgetKey) : state.widgets.length - 1;
      if (from < 0 || to < 0 || from === to) return;
      state.widgets.splice(to, 0, state.widgets.splice(from, 1)[0]);
      render(); save();
    }, true);
    document.addEventListener('ecopoints:appearance', redraw);
    window.addEventListener('resize', resize);
    state.observer = new ResizeObserver(resize);
    state.observer.observe($('dashBoard'));
    window.lucide?.createIcons();
  }

  function defaults() {
    return (state.summary?.charts || []).filter(chart => chart.tier === 'basic').map(chart => ({ key: chart.key, config: null, wide: false }));
  }

  async function open() {
    mount();
    if (!getToken()) { status('Sign in to view your dashboard.'); return; }
    const epoch = ++state.epoch;
    const user = currentSessionUser();
    const owner = user?.id;
    if (state.owner !== owner) {
      state.widgets = []; state.summary = null; state.owner = owner;
      $('dashDataset').value = ''; $('dashStart').value = ''; $('dashEnd').value = '';
      for (const id of ['dashEditor', 'dashUploadDialog']) if ($(id).open) $(id).close();
      $('dashUploadForm').reset(); $('dashUploadSubmit').disabled = true; $('dashPreviewResult').textContent = '';
      dispose(); $('dashBoard').replaceChildren();
    }
    status('Loading your account data…');
    try {
      const query = new URLSearchParams();
      if ($('dashDataset').value) query.set('dataset_id', $('dashDataset').value);
      if (!organization() && user?.subscription_tier === 'plus') {
        if ($('dashStart').value) query.set('start', $('dashStart').value);
        if ($('dashEnd').value) query.set('end', $('dashEnd').value);
      }
      const summary = await api('/api/dashboard/summary?' + query, { headers: auth() });
      if (epoch !== state.epoch || owner !== currentSessionUser()?.id) return;
      const first = state.summary === null;
      const entitlementChanged = state.summary && (state.summary.tier !== summary.tier || state.summary.role !== summary.role);
      state.summary = summary;
      $('dashTitle').textContent = organization() ? (summary.organization_name || 'Organization') + ' impact workspace' : 'Your sustainability picture.';
      $('dashIntro').textContent = organization() ? 'Explore your uploaded data. Each analysis stays inside your organization.' : 'A personal view of your EcoPoints, recorded activities and rewards.';
      $('dashLibraryToggle').hidden = !plus(); $('dashReset').hidden = !plus();
      $('dashUploadToggle').hidden = !organization(); $('dashDatasetLabel').hidden = !organization();
      $('dashDateForm').hidden = organization() || !plus(); $('dashAnalysisInfo').hidden = !organization();
      if (first) $('dashLibrary').hidden = !plus();
      if (!plus()) $('dashLibrary').hidden = true;
      const selected = $('dashDataset').value;
      $('dashDataset').innerHTML = summary.datasets.map(dataset => '<option value="' + dataset.id + '">' + html(dataset.name) + ' (' + dataset.rows.toLocaleString() + ' rows)</option>').join('') || '<option value="">No datasets yet</option>';
      if (summary.datasets.some(dataset => String(dataset.id) === selected)) $('dashDataset').value = selected;
      $('dashMetrics').innerHTML = summary.metrics.map(metric => '<article><span>' + html(metric.label) + '</span><strong>' + Number(metric.value).toLocaleString() + '</strong></article>').join('');
      if (first || entitlementChanged || !plus()) {
        state.widgets = plus() && summary.layout !== null ? summary.layout : defaults();
      }
      renderLibrary();
      await hydrate(epoch);
      if (epoch === state.epoch) status(plus() ? 'Drag chart handles or use move buttons. Your layout is saved to your account.' : 'Basic overview · fixed chart modules');
    } catch (error) {
      if (epoch === state.epoch) { dispose(); $('dashBoard').replaceChildren(); $('dashMetrics').replaceChildren(); status(error.message, true); }
    }
  }

  function renderLibrary() {
    const chartIcons = { line: 'trending-up', bar: 'bar-chart-3', area: 'mountain', stacked: 'layers-3', donut: 'circle-dashed', scatter: 'scatter-chart', heatmap: 'grid-2x2', treemap: 'layout-grid', radar: 'radar', boxplot: 'box', histogram: 'bar-chart-4', calendar: 'calendar-days', progress: 'gauge', table: 'table-2' };
    const iconFor = type => chartIcons[type] || 'chart-no-axes-combined';
    const modules = $('dashModules'); modules.innerHTML = '<h3>Account modules</h3>';
    for (const item of state.summary.charts) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dash-library-item';
      button.innerHTML = '<span class="dash-library-icon" aria-hidden="true"><i data-lucide="' + iconFor(item.chart_type) + '"></i></span><span class="dash-library-copy"><strong>' + html(item.title) + '</strong><span>' + html(item.description) + '</span></span>';
      button.onclick = () => {
        if (state.widgets.some(widget => widget.key === item.key)) { status('That module is already on your board.'); return; }
        if (state.widgets.length >= 24) { status('A dashboard supports up to 24 modules.', true); return; }
        state.widgets.push({ key: item.key, config: null, wide: false });
        state.charts.set(item.key, item); render(); save();
      };
      modules.appendChild(button);
    }
    $('dashTypes').innerHTML = organization() ? '<h3>Custom analysis charts</h3>' : '';
    if (organization()) for (const type of state.summary.chart_types) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'dash-library-item';
      button.innerHTML = '<span class="dash-library-icon" aria-hidden="true"><i data-lucide="' + iconFor(type) + '"></i></span><span class="dash-library-copy"><strong>' + html(typeLabels[type]) + '</strong><span>Build a ' + html(typeLabels[type].toLowerCase()) + ' view.</span></span>'; button.onclick = () => edit(null, type); $('dashTypes').appendChild(button);
    }
    window.lucide?.createIcons();
  }

  async function hydrate(epoch = state.epoch) {
    const catalogue = new Map(state.summary.charts.map(chart => [chart.key, chart]));
    const charts = new Map(catalogue);
    const widgets = [...state.widgets];
    await Promise.all(widgets.filter(widget => widget.config).map(async widget => {
      try { const data = await api('/api/dashboard/chart', { method: 'POST', headers: auth(), body: JSON.stringify(widget.config) }); charts.set(widget.key, data); }
      catch (error) { charts.set(widget.key, { title: widget.config.title || 'Custom analysis', description: error.message, data: { empty: true }, error: true }); }
    }));
    if (epoch !== state.epoch) return;
    state.charts = charts; render();
  }

  function dispose() { for (const instance of state.instances.values()) instance.dispose(); state.instances.clear(); }
  function resize() { requestAnimationFrame(() => { for (const instance of state.instances.values()) if (!instance.isDisposed()) instance.resize(); }); }
  function redraw() { if (state.summary && $('dashboardPage')?.classList.contains('active')) render(); }

  function render() {
    dispose(); const board = $('dashBoard'); board.replaceChildren();
    board.classList.toggle('dash-basic', !plus());
    if (!state.widgets.length) {
      board.innerHTML = '<div class="dash-empty"><h2>Your workspace is ready</h2><p>Choose an account module or a chart from the library to begin.</p></div>';
      return;
    }
    state.widgets.forEach((widget, index) => {
      const item = state.charts.get(widget.key);
      if (!item) return;
      const card = document.createElement('article'); card.className = 'dash-chart-card' + (widget.wide ? ' dash-wide' : ''); card.dataset.widgetKey = widget.key;
      const heading = document.createElement('header');
      heading.innerHTML = '<div><h2>' + html(item.title) + '</h2><p>' + html(item.description || '') + '</p></div>';
      const actions = document.createElement('div'); actions.className = 'dash-card-actions';
      if (plus()) {
        const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'dash-drag-handle'; handle.textContent = '⠿'; handle.title = 'Drag chart'; handle.setAttribute('aria-label', 'Drag chart');
        handle.onpointerdown = event => {
          if (event.button !== 0) return;
          event.preventDefault();
          const origin = { x: event.clientX, y: event.clientY };
          let targetKey = null, moved = false;
          handle.setPointerCapture(event.pointerId);
          const moving = e => {
            if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 5 && !moved) return;
            moved = true; card.classList.add('dragging');
            const hit = document.elementsFromPoint(e.clientX, e.clientY).map(element => element.closest('[data-widget-key]')).find(element => element && element !== card);
            document.querySelectorAll('.dash-drop-target').forEach(element => element.classList.remove('dash-drop-target'));
            targetKey = hit?.dataset.widgetKey || null;
            hit?.classList.add('dash-drop-target');
          };
          const ending = () => {
            handle.removeEventListener('pointermove', moving); handle.removeEventListener('pointerup', ending); handle.removeEventListener('pointercancel', cancel);
            card.classList.remove('dragging'); document.querySelectorAll('.dash-drop-target').forEach(element => element.classList.remove('dash-drop-target'));
            const from = state.widgets.findIndex(item => item.key === widget.key), to = state.widgets.findIndex(item => item.key === targetKey);
            if (moved && from >= 0 && to >= 0 && from !== to) { state.widgets.splice(to, 0, state.widgets.splice(from, 1)[0]); render(); save(); }
          };
          const cancel = () => { targetKey = null; ending(); };
          handle.addEventListener('pointermove', moving); handle.addEventListener('pointerup', ending); handle.addEventListener('pointercancel', cancel);
        };
        actions.appendChild(handle);
        action(actions, '↑', 'Move chart earlier', () => move(index, -1));
        action(actions, '↓', 'Move chart later', () => move(index, 1));
        action(actions, widget.wide ? '↙' : '↔', widget.wide ? 'Half width' : 'Full width', () => { widget.wide = !widget.wide; render(); save(); });
        if (widget.config) action(actions, '⚙', 'Configure chart', () => edit(widget));
        action(actions, 'PNG', 'Export chart as PNG', () => exportPNG(widget.key));
        if (widget.config) action(actions, 'CSV', 'Export filtered CSV', () => exportCSV(widget));
        action(actions, '×', 'Remove module', () => { state.widgets.splice(index, 1); render(); save(); });
      }
      heading.appendChild(actions); card.appendChild(heading);
      const plot = document.createElement('div'); plot.className = 'dash-plot'; plot.setAttribute('role', 'img'); plot.setAttribute('aria-label', item.title); card.appendChild(plot);
      board.appendChild(card);
      const data = item.data || {};
      const empty = data.empty || item.chart_type === 'progress' && !data.target || ['donut', 'treemap', 'radar'].includes(item.chart_type) && !(data.categories || []).some(value => value.value > 0);
      if (empty) { plot.innerHTML = '<div class="dash-empty-chart">' + html(item.chart_type === 'progress' ? 'No higher-cost reward is available. Your balance is ' + (data.balance || 0) + ' EcoPoints.' : item.error ? item.description : 'No matching data yet. Upload or record data to populate this chart.') + '</div>'; }
      else if (!window.echarts) plot.innerHTML = '<div class="dash-empty-chart">Chart library could not load. Refresh the page.</div>';
      else {
        const dark = document.body.classList.contains('dark-mode');
        const instance = window.echarts.init(plot, dark ? 'dark' : null, { renderer: 'canvas' });
        instance.setOption(options(item, dark)); state.instances.set(widget.key, instance);
      }
      if (data.notes?.length) { const notes = document.createElement('p'); notes.className = 'dash-chart-notes'; notes.textContent = data.notes.join(' '); card.appendChild(notes); }
    });
    resize();
  }

  function action(parent, text, label, onClick) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.title = label; button.setAttribute('aria-label', label); button.onclick = onClick; parent.appendChild(button); }
  function move(index, delta) { const to = index + delta; if (to < 0 || to >= state.widgets.length) return; state.widgets.splice(to, 0, state.widgets.splice(index, 1)[0]); render(); save(); }

  function options(item, dark) {
    const data = item.data || {}, type = item.chart_type;
    const palette = document.body.classList.contains('colorblind-protanopia') || document.body.classList.contains('colorblind-deuteranopia') ? ['#4389cb', '#edb947', '#ad74bf', '#70bcb3'] : ['#789477', '#bf7963', '#619fa4', '#a58caf', '#d6af60'];
    const text = dark ? '#e6eee8' : '#29352e', gridColor = dark ? '#34483d' : '#d8e2d9';
    const base = { backgroundColor: 'transparent', color: palette, textStyle: { fontFamily: 'Plus Jakarta Sans, sans-serif', color: text }, animation: !matchMedia('(prefers-reduced-motion: reduce)').matches, aria: { enabled: true, decal: { show: currentColorMode() !== 'none' } }, tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: dark ? '#203128' : '#fffefa', textStyle: { color: text }, borderColor: gridColor }, grid: { left: 48, right: 24, top: 42, bottom: 58, containLabel: true }, legend: { type: 'scroll', textStyle: { color: text } } };
    const axis = { axisLabel: { color: text, hideOverlap: true }, axisLine: { lineStyle: { color: gridColor } }, splitLine: { lineStyle: { color: gridColor } } };
    if (type === 'quality') return { ...base, tooltip: { show: false }, series: [{ type: 'gauge', progress: { show: true, width: 14 }, axisLine: { lineStyle: { width: 14, color: [[1, gridColor]] } }, pointer: { show: false }, axisLabel: { color: text }, detail: { formatter: '{value}%', color: text, fontSize: 24 }, title: { color: text }, data: [{ value: data.value, name: 'Complete cells' }] }] };
    if (type === 'progress') return { ...base, tooltip: { show: false }, series: [{ type: 'gauge', min: 0, max: 100, startAngle: 200, endAngle: -20, radius: '78%', progress: { show: true, width: 14 }, axisLine: { lineStyle: { width: 14, color: [[1, gridColor]] } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false }, anchor: { show: false }, detail: { formatter: Math.min(100, Math.round(data.balance / data.target * 100)) + '%', color: text, fontSize: 26 }, title: { color: text, fontSize: 11, offsetCenter: [0, '74%'] }, data: [{ value: Math.min(100, data.balance / data.target * 100), name: data.reward + '\n' + data.balance + ' / ' + data.target + ' pts' }] }] };
    if (type === 'donut') return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, legend: { bottom: 0, type: 'scroll', textStyle: { color: text } }, series: [{ type: 'pie', radius: ['40%', '67%'], center: ['50%', '45%'], data: data.categories || [], label: { color: text, formatter: '{b}: {d}%' }, labelLayout: { hideOverlap: true } }] };
    if (type === 'treemap') return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, series: [{ type: 'treemap', data: data.categories || [], label: { color: '#fff' }, breadcrumb: { show: false }, roam: false }] };
    if (type === 'radar') { const values = (data.categories || []).slice(0, 10); const max = Math.max(1, ...values.map(value => value.value)); return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, radar: { indicator: values.map(value => ({ name: value.name, max })), axisName: { color: text } }, series: [{ type: 'radar', data: [{ value: values.map(value => value.value), name: item.title }] }] }; }
    if (type === 'calendar') return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, visualMap: { min: 0, max: Math.max(1, ...(data.days || []).map(day => day[1])), orient: 'horizontal', left: 'center', bottom: 0, textStyle: { color: text }, inRange: { color: [dark ? '#273a2e' : '#e9efe6', '#789477'] } }, calendar: { top: 35, left: 48, right: 20, bottom: 50, range: data.range, cellSize: ['auto', 22], itemStyle: { color: dark ? '#24332a' : '#f6f8f3', borderColor: gridColor }, dayLabel: { color: text }, monthLabel: { color: text }, yearLabel: { show: false } }, series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: data.days || [] }] };
    if (type === 'heatmap') return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, xAxis: { type: 'category', data: data.x, ...axis }, yAxis: { type: 'category', data: data.y, ...axis }, visualMap: { min: Math.min(0, ...(data.cells || []).map(cell => cell[2])), max: Math.max(1, ...(data.cells || []).map(cell => cell[2])), orient: 'horizontal', bottom: 0, left: 'center', textStyle: { color: text }, inRange: { color: [dark ? '#273a2e' : '#e9efe6', '#789477'] } }, series: [{ type: 'heatmap', data: data.cells || [] }] };
    if (type === 'scatter') return { ...base, tooltip: { ...base.tooltip, trigger: 'item' }, xAxis: { type: 'value', name: data.x_name, ...axis }, yAxis: { type: 'value', name: data.y_name, ...axis }, series: [{ type: 'scatter', data: data.points || [], symbolSize: 8 }] };
    const series = type === 'boxplot' ? [{ type: 'boxplot', data: data.boxes || [] }] : (data.series || []).map(series => ({ name: series.name, data: series.data, type: ['bar', 'histogram', 'stacked'].includes(type) ? 'bar' : 'line', stack: type === 'stacked' ? 'total' : undefined, areaStyle: type === 'area' ? { opacity: .18 } : undefined, connectNulls: false, smooth: false, lineStyle: series.projected ? { type: 'dashed' } : undefined, symbolSize: 5, markPoint: data.anomalies ? { data: data.anomalies } : undefined }));
    return { ...base, xAxis: { type: 'category', data: data.x || [], ...axis }, yAxis: { type: 'value', ...axis }, dataZoom: plus() && $('dashZoom').checked ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 4, textStyle: { color: text }, borderColor: gridColor }] : [], series };
  }

  function save() {
    if (!plus()) return;
    const owner = state.owner;
    const widgets = JSON.parse(JSON.stringify(state.widgets));
    const headers = auth();
    const revision = ++state.saveRevision;
    status('Saving layout…');
    state.saveQueue = state.saveQueue.then(async () => {
      try { await api('/api/dashboard/layout', { method: 'PUT', headers, body: JSON.stringify({ widgets }) }); if (owner === state.owner && revision === state.saveRevision) status('Layout saved to your account.'); }
      catch (error) { if (owner === state.owner && revision === state.saveRevision) status('Layout could not be saved: ' + error.message, true); }
    });
  }

  function addFilterRow(key = '', value = '') {
    const dataset = state.summary.datasets.find(item => String(item.id) === $('dashEditDataset').value);
    const row = document.createElement('div'); row.className = 'dash-filter-row';
    row.innerHTML = '<label>Filter field<select>' + (dataset?.columns || []).map(column => '<option value="' + html(column.name) + '">' + html(column.name) + '</option>').join('') + '</select></label><label>Exact value<input maxlength="2000"></label>';
    if (key) row.querySelector('select').value = key;
    row.querySelector('input').value = value;
    action(row, '×', 'Remove filter', () => row.remove());
    $('dashExtraFilters').appendChild(row);
  }

  function populateFields(config = {}) {
    const dataset = state.summary.datasets.find(item => String(item.id) === $('dashEditDataset').value);
    const columns = dataset?.columns || [];
    const fill = (id, items, empty = false) => { $(id).innerHTML = (empty ? '<option value="">None</option>' : '') + items.map(column => '<option value="' + html(column.name) + '">' + html(column.name) + ' (' + column.type + ')</option>').join(''); };
    fill('dashDimension', columns); fill('dashMetric', columns); fill('dashSecondMetric', columns.filter(column => column.type === 'number'), true); fill('dashSplit', columns, true); fill('dashDateColumn', columns.filter(column => column.type === 'date'), true); fill('dashFilterColumn', columns, true);
    const choose = (id, value) => { if (value && [...$(id).options].some(option => option.value === value)) $(id).value = value; };
    choose('dashDimension', config.dimension || columns.find(column => column.type === 'date')?.name || columns.find(column => column.type === 'text')?.name);
    choose('dashMetric', config.metric || columns.find(column => column.type === 'number')?.name);
    choose('dashSecondMetric', config.second_metric || columns.filter(column => column.type === 'number')[1]?.name);
    choose('dashSplit', config.split); choose('dashDateColumn', config.date_column || columns.find(column => column.type === 'date')?.name);
    const entry = Object.entries(config.filters || {})[0]; choose('dashFilterColumn', entry?.[0]); $('dashFilterValue').value = entry?.[1] || '';
    $('dashExtraFilters').replaceChildren();
    Object.entries(config.filters || {}).slice(1).forEach(([key, value]) => addFilterRow(key, value));
  }

  function edit(widget = null, type = 'line') {
    if (!plus() || !organization()) return;
    if (!state.summary.datasets.length) { status('Upload a dataset before creating an analysis chart.'); $('dashUploadDialog').showModal(); return; }
    state.editorKey = widget?.key || null; const config = widget?.config || {};
    $('dashEditorForm').reset(); $('dashEditorMessage').textContent = '';
    $('dashEditDataset').innerHTML = state.summary.datasets.map(dataset => '<option value="' + dataset.id + '">' + html(dataset.name) + '</option>').join('');
    $('dashEditDataset').value = String(config.dataset_id || $('dashDataset').value || state.summary.datasets[0].id);
    $('dashChartType').innerHTML = Object.entries(typeLabels).map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('');
    $('dashChartType').value = config.chart_type || type; $('dashChartTitle').value = config.title || '';
    $('dashAggregation').value = config.aggregation || 'sum'; $('dashAnalysis').value = config.analysis || 'none';
    $('dashEditStart').value = config.start || ''; $('dashEditEnd').value = config.end || '';
    populateFields(config); $('dashEditor').showModal();
  }

  async function configure(event) {
    event.preventDefault(); const owner = state.owner;
    const config = { dataset_id: Number($('dashEditDataset').value), chart_type: $('dashChartType').value, title: $('dashChartTitle').value.trim(), dimension: $('dashDimension').value, metric: $('dashMetric').value, second_metric: $('dashSecondMetric').value || null, split: $('dashSplit').value || null, aggregation: $('dashAggregation').value, date_column: $('dashDateColumn').value || null, start: $('dashEditStart').value || null, end: $('dashEditEnd').value || null, analysis: $('dashAnalysis').value, filters: $('dashFilterColumn').value && $('dashFilterValue').value ? { [$('dashFilterColumn').value]: $('dashFilterValue').value } : {} };
    for (const row of $('dashExtraFilters').children) {
      const key = row.querySelector('select').value, value = row.querySelector('input').value;
      if (value) config.filters[key] = value;
    }
    $('dashEditorMessage').textContent = 'Analyzing…';
    try {
      const data = await api('/api/dashboard/chart', { method: 'POST', headers: auth(), body: JSON.stringify(config) });
      if (owner !== state.owner || owner !== currentSessionUser()?.id) return;
      if (!state.editorKey && state.widgets.length >= 24) throw Error('A dashboard supports up to 24 modules.');
      const key = state.editorKey || 'custom-' + crypto.randomUUID();
      const widget = state.widgets.find(item => item.key === key);
      if (widget) widget.config = config; else state.widgets.push({ key, config, wide: false });
      state.charts.set(key, data); $('dashEditor').close(); render(); save();
    } catch (error) { $('dashEditorMessage').textContent = error.message; }
  }

  async function previewUpload() {
    const file = $('dashUploadFile').files[0]; if (!file) { $('dashUploadMessage').textContent = 'Choose a CSV file.'; return; }
    if (file.size > 10 * 1024 * 1024) { $('dashUploadMessage').textContent = 'Maximum file size is 10 MB.'; return; }
    const form = new FormData(); form.append('file', file); $('dashUploadMessage').textContent = 'Checking CSV…';
    try {
      const data = await api('/api/organization/datasets/preview', { method: 'POST', headers: auth(), body: form });
      $('dashPreviewResult').innerHTML = '<p>' + data.rows.toLocaleString() + ' rows · ' + data.columns.length + ' columns · ' + data.duplicates + ' duplicate rows (retained)</p><div class="dash-table-scroll"><table><thead><tr>' + data.columns.map(column => '<th>' + html(column.name) + '<small>' + column.type + ' · ' + column.missing + ' missing</small></th>').join('') + '</tr></thead><tbody>' + data.sample.map(row => '<tr>' + data.columns.map(column => '<td>' + html(row[column.name] ?? '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
      $('dashUploadSubmit').disabled = false; $('dashUploadMessage').textContent = 'Review the columns and sample before confirming import.';
    } catch (error) { $('dashUploadMessage').textContent = error.message; }
  }

  async function upload(event) {
    event.preventDefault(); const form = new FormData(); form.append('name', $('dashUploadName').value.trim()); form.append('file', $('dashUploadFile').files[0]);
    $('dashUploadSubmit').disabled = true; $('dashUploadMessage').textContent = 'Importing…';
    try { await api('/api/organization/datasets', { method: 'POST', headers: auth(), body: form }); $('dashUploadDialog').close(); $('dashUploadForm').reset(); $('dashPreviewResult').textContent = ''; $('dashDataset').value = ''; await open(); }
    catch (error) { $('dashUploadMessage').textContent = error.message; $('dashUploadSubmit').disabled = false; }
  }

  function download(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function exportPNG(key) { const instance = state.instances.get(key); if (!instance) { status('There is no chart data to export.', true); return; } const link = document.createElement('a'); link.href = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: document.body.classList.contains('dark-mode') ? '#1b2821' : '#fffefa' }); link.download = 'ecopoints-chart.png'; link.click(); }
  async function exportCSV(widget) { try { const response = await fetch(API_BASE + '/api/dashboard/export', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(widget.config) }); if (!response.ok) { const error = await response.json(); throw Error(error.detail); } download(await response.blob(), 'analysis.csv'); } catch (error) { status(error.message, true); } }
  window.ecoDashboard = { open };
})();
