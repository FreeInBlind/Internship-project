// GPX uploads and account-scoped history; the API is shared with Flutter.
(() => {
  const root = document.getElementById('team-transportTab');
  if (!root) return;
  root.insertAdjacentHTML('beforeend', `
    <section class="trip-history" aria-labelledby="tripHistoryTitle">
      <div class="trip-history-heading"><div><h3 id="tripHistoryTitle">Your recorded journeys</h3><p>Upload a walk or cycle to turn your journey into EcoPoints.</p></div><button type="button" class="outline-button" id="tripRefresh">Refresh</button></div>
      <div id="tripHistoryContent" aria-live="polite"></div>
      <div class="trip-pagination"><button type="button" class="outline-button" id="tripPrevious" hidden>Previous</button><span id="tripPageLabel"></span><button type="button" class="outline-button" id="tripNext" hidden>Next</button></div>
    </section>`);
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="tripDialog" class="trip-dialog" aria-labelledby="tripDialogTitle">
      <form id="tripUploadForm">
        <div class="trip-dialog-heading"><div><h2 id="tripDialogTitle">Log a Walk</h2><p>Upload the GPX track saved on your phone.</p></div><button type="button" class="trip-close" aria-label="Close upload">×</button></div>
        <label for="tripMode">Transport mode</label><select id="tripMode" name="mode"><option value="walking">Walking</option><option value="cycling">Cycling</option></select>
        <div class="trip-rule" id="tripRule"></div>
        <label class="trip-file-label" for="tripFile">Choose your GPX file<input id="tripFile" name="file" type="file" accept=".gpx,application/gpx+xml" required aria-describedby="tripFileHelp"></label>
        <p class="trip-help" id="tripFileHelp">Up to 5 MB, with coordinates and timestamps. Record at least once every 120 seconds. Your original file and precise route are not stored.</p>
        <p class="trip-help">Each qualifying journey earns points once. Re-uploading the same track will not add more points.</p>
        <div id="tripUploadResult" class="trip-result" role="status" hidden></div>
        <div class="trip-dialog-actions"><button type="button" class="outline-button trip-close">Close</button><button type="submit" class="btn-primary" id="tripSubmit">Verify & earn points</button></div>
      </form>
    </dialog>`);
  const el = id => document.getElementById(id);
  const dialog = el('tripDialog');
  let rules = null, offset = 0, historyRevision = 0, sessionRevision = 0, busy = false;
  const labels = { walking: 'Walking', cycling: 'Cycling' };
  function setBusy(value) {
    busy = value;
    ['tripMode', 'tripFile', 'tripSubmit'].forEach(id => { el(id).disabled = value; });
    el('tripSubmit').textContent = value ? 'Verifying journey…' : 'Verify & earn points';
  }
  function updateRule() {
    const mode = el('tripMode').value;
    el('tripDialogTitle').textContent = mode === 'walking' ? 'Log a Walk' : 'Log a Cycle';
    const rule = rules?.modes[mode];
    document.querySelectorAll('[data-transport-mode]').forEach(button => {
      const current = rules?.modes[button.dataset.transportMode];
      if (!current) return;
      button.closest('.team-transport-card').querySelector('.team-points-badge').textContent = current.enabled ? '+' + current.points + ' pts' : 'Points paused';
    });
    el('tripRule').textContent = rule ? `At least ${(rule.min_distance_m / 1000).toLocaleString()} km and ${rule.min_duration_s / 60} minutes · +${rule.points} EcoPoints` : 'Loading journey requirements…';
  }
  function pausedRule() {
    updateRule();
    if (rules && !rules.modes[el('tripMode').value].enabled) el('tripRule').textContent = 'Points for this activity are currently paused.';
  }
  function showResult(message, kind, trip) {
    const box = el('tripUploadResult');
    box.hidden = false; box.className = 'trip-result ' + kind;
    box.replaceChildren();
    const text = document.createElement('p'); text.textContent = message; box.append(text);
    if (trip) {
      const metrics = document.createElement('strong');
      metrics.textContent = `${(trip.distance_m / 1000).toFixed(2)} km · ${(trip.duration_s / 60).toFixed(1)} min`;
      box.append(metrics);
      for (const warning of trip.warnings) { const note = document.createElement('p'); note.textContent = warning; box.append(note); }
    }
  }
  async function loadRules() {
    try { rules = await api('/api/transport-trips/rules'); updateRule(); if (!rules.modes[el('tripMode').value].enabled) el('tripRule').textContent = 'Points for this activity are currently paused.'; }
    catch { el('tripRule').textContent = 'Requirements unavailable. Make sure the API server is running.'; }
  }
  async function loadHistory() {
    const token = getToken(), revision = ++historyRevision;
    const content = el('tripHistoryContent');
    content.textContent = 'Loading your journeys…';
    el('tripPrevious').hidden = el('tripNext').hidden = true; el('tripPageLabel').textContent = '';
    if (!token || currentSessionUser()?.role === 'admin') { content.textContent = ''; return; }
    try {
      const data = await api(`/api/transport-trips?limit=10&offset=${offset}`, { headers: { Authorization: 'Bearer ' + token } });
      if (token !== getToken() || revision !== historyRevision) return;
      content.replaceChildren();
      if (!data.items.length) { content.textContent = 'No journeys yet. Choose Log a Walk or Log a Cycle to upload your first track.'; return; }
      for (const trip of data.items) {
        const row = document.createElement('article'); row.className = 'trip-history-row';
        const info = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = labels[trip.mode];
        const date = document.createElement('span'); date.textContent = new Date(trip.started_at).toLocaleString();
        const stats = document.createElement('p'); stats.textContent = `${(trip.distance_m / 1000).toFixed(2)} km · ${(trip.duration_s / 60).toFixed(1)} min`;
        const reason = document.createElement('p'); reason.className = 'trip-history-reason'; reason.textContent = trip.validation_message;
        info.append(title, date, stats, reason);
        const outcome = document.createElement('span'); outcome.className = 'trip-outcome ' + trip.status;
        outcome.textContent = trip.status === 'accepted' ? `+${trip.points_awarded} pts` : 'Not qualified';
        row.append(info, outcome); content.append(row);
      }
      el('tripPrevious').hidden = offset === 0; el('tripNext').hidden = offset + data.items.length >= data.total;
      el('tripPageLabel').textContent = `${offset + 1}–${offset + data.items.length} of ${data.total}`;
    } catch (error) { if (token === getToken() && revision === historyRevision) content.textContent = error.message + '. Refresh to try again.'; }
  }
  document.querySelectorAll('[data-transport-mode]').forEach(button => button.addEventListener('click', () => {
    if (busy) return;
    el('tripUploadForm').reset(); el('tripMode').value = button.dataset.transportMode; el('tripUploadResult').hidden = true; updateRule();
    dialog.showModal(); loadRules();
  }));
  dialog.querySelectorAll('.trip-close').forEach(button => button.addEventListener('click', () => dialog.close()));
  el('tripMode').addEventListener('change', () => { pausedRule(); el('tripUploadResult').hidden = true; });
  el('tripFile').addEventListener('change', () => { el('tripUploadResult').hidden = true; });
  el('tripUploadForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const file = el('tripFile').files[0];
    if (!file || !file.name.toLowerCase().endsWith('.gpx')) return showResult('Choose a .gpx track file.', 'error');
    if (file.size > 5 * 1024 * 1024) return showResult('Choose a GPX file of 5 MB or smaller.', 'error');
    const token = getToken(), revision = sessionRevision;
    const form = new FormData(); form.append('mode', el('tripMode').value); form.append('file', file);
    setBusy(true); showResult('Checking the track and calculating your journey…', 'pending');
    try {
      const data = await api('/api/transport-trips/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
      if (token !== getToken() || revision !== sessionRevision) return;
      const message = data.duplicate ? data.message : data.trip.status === 'accepted' ? `Journey verified. You earned ${data.awarded_now} EcoPoints!` : `No points awarded. ${data.message}`;
      showResult(message, data.duplicate ? 'pending' : data.trip.status === 'accepted' ? 'success' : 'error', data.trip);
      offset = 0; await Promise.all([loadHistory(), loadTeamPoints()]);
    } catch (error) { if (token === getToken() && revision === sessionRevision) showResult(error.message, 'error'); }
    finally { setBusy(false); }
  });
  el('tripRefresh').addEventListener('click', () => { offset = 0; loadHistory(); });
  el('tripPrevious').addEventListener('click', () => { offset = Math.max(0, offset - 10); loadHistory(); });
  el('tripNext').addEventListener('click', () => { offset += 10; loadHistory(); });
  document.addEventListener('ecopoints:session', () => {
    sessionRevision++; historyRevision++; offset = 0; dialog.close();
    el('tripHistoryContent').replaceChildren(); el('tripUploadResult').hidden = true;
  });
  window.ecoTransport = { open: () => { loadHistory(); loadRules(); } };
  if (document.getElementById('ecoPointsPage').classList.contains('active')) loadHistory();
})();
