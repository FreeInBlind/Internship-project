(() => {
  const queue = document.getElementById('adminQueue');
  if (!queue) return;
  queue.insertAdjacentHTML('beforebegin', '<section class="utility-card admin-rule-panel"><div class="utility-card-heading"><div><h2>Transport point rules</h2><p class="card-muted">Set the requirements and rewards for new walking and cycling uploads.</p></div><button type="button" class="outline-button" id="adminRuleReload">Reload rules</button></div><form id="adminRuleForm"><div class="admin-rule-grid" id="adminRuleFields"></div><p class="card-muted">Changes apply to new uploads. Previously submitted journeys keep their original results and cannot earn again.</p><p id="adminRuleMessage" role="status" class="shop-message"></p><button type="submit" class="btn-primary compact-button" id="adminRuleSave" disabled>Save point rules</button></form></section>');
  const el = id => document.getElementById(id);
  const fields = [['points', 'Reward points', 0, 10000, 1], ['min_distance_m', 'Minimum distance (m)', 1, 100000, 1], ['min_duration_s', 'Minimum duration (seconds)', 1, 86400, 1], ['max_speed_kmh', 'Maximum speed (km/h)', .1, 200, .1]];
  let generation = 0, busy = false;
  function render(modes) {
    el('adminRuleFields').replaceChildren();
    for (const mode of ['walking', 'cycling']) {
      const group = document.createElement('fieldset'); group.className = 'admin-rule-mode';
      const legend = document.createElement('legend'); legend.textContent = mode === 'walking' ? 'Walking' : 'Cycling'; group.append(legend);
      const toggle = document.createElement('label'); toggle.className = 'admin-rule-toggle';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = mode + '-enabled'; checkbox.checked = modes[mode].enabled;
      toggle.append(checkbox, document.createTextNode('Enable points for this activity')); group.append(toggle);
      for (const [key, title, min, max, step] of fields) {
        const label = document.createElement('label'); label.textContent = title;
        const input = document.createElement('input'); input.type = 'number'; input.id = mode + '-' + key;
        input.min = min; input.max = max; input.step = step; input.required = true; input.value = modes[mode][key];
        label.append(input); group.append(label);
      }
      el('adminRuleFields').append(group);
    }
  }
  function lock(value) {
    busy = value;
    el('adminRuleForm').querySelectorAll('input, button').forEach(input => { input.disabled = value; });
    el('adminRuleReload').disabled = value;
    if (!value) el('adminRuleSave').disabled = !el('adminRuleFields').children.length;
  }
  async function load() {
    if (currentSessionUser()?.role !== 'admin' || busy) return;
    const token = getToken(), revision = ++generation;
    lock(true); setMessage(el('adminRuleMessage'), 'Loading rules…', false);
    try {
      const data = await api('/api/transport-trips/admin/rules', { headers: { Authorization: 'Bearer ' + token } });
      if (token !== getToken() || revision !== generation) return;
      render(data.modes); setMessage(el('adminRuleMessage'), '', false);
    } catch (error) {
      if (token === getToken() && revision === generation) { el('adminRuleFields').replaceChildren(); setMessage(el('adminRuleMessage'), error.message + '. Reload to try again.'); }
    } finally { lock(false); }
  }
  el('adminRuleForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || currentSessionUser()?.role !== 'admin') return;
    const token = getToken(), revision = generation, body = {};
    for (const mode of ['walking', 'cycling']) {
      body[mode] = { enabled: el(mode + '-enabled').checked };
      for (const [key] of fields) body[mode][key] = Number(el(mode + '-' + key).value);
    }
    lock(true); setMessage(el('adminRuleMessage'), 'Saving rules…', false);
    try {
      const data = await api('/api/transport-trips/admin/rules', { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      if (token !== getToken() || revision !== generation) return;
      render(data.modes); setMessage(el('adminRuleMessage'), data.message, false);
    } catch (error) { if (token === getToken() && revision === generation) setMessage(el('adminRuleMessage'), error.message); }
    finally { lock(false); }
  });
  el('adminRuleReload').addEventListener('click', load);
  document.addEventListener('ecopoints:session', () => { generation++; el('adminRuleFields').replaceChildren(); el('adminRuleSave').disabled = true; setMessage(el('adminRuleMessage'), '', false); });
  window.ecoAdminRules = { open: load };
  if (document.getElementById('adminPage').classList.contains('active')) load();
})();
