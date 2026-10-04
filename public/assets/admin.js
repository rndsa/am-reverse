    const $ = id => document.getElementById(id)
    let allKeys = [];
    let currentTab = 'keys';
    let logPollInterval = null;
    let adminToken = '';

    /* ---------- THEME (auto ikut device, bisa ganti manual) ---------- */
    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t)
      const l = document.getElementById('tmLight'), d = document.getElementById('tmDark')
      if (l && d) {
        l.className = t === 'light' ? 'on' : ''
        d.className = t === 'dark' ? 'on' : ''
      }
    }
    function systemTheme() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    function setTheme(t) {
      localStorage.setItem('am_theme', t)
      applyTheme(t)
    }
    const savedTheme = localStorage.getItem('am_theme')
    applyTheme(savedTheme || systemTheme())
    if (!savedTheme && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('am_theme')) applyTheme(e.matches ? 'dark' : 'light')
      })
    }

    // ══════════ HARD LOGIN GATE ══════════
    async function gateLogin(password) {
      let lastErr = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch('/api/keys/login?t=' + Date.now(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
          })
          return await r.json()
        } catch (e) {
          lastErr = e
          if (attempt < 2) await new Promise(res => setTimeout(res, 900))
        }
      }
      return { success: false, network: true, message: 'Koneksi ke server gagal (3x dicoba). Cek sinyal internet lalu coba lagi.' }
    }

    document.getElementById('gateForm').addEventListener('submit', async e => {
      e.preventDefault()
      const p = document.getElementById('gatePassInput').value.trim()
      const btn = document.getElementById('btnGateLogin')
      const err = document.getElementById('gateErr')
      if (!p) return

      btn.disabled = true; btn.textContent = 'CEKING...'
      try {
        const j = await gateLogin(p)
        if (j.network) {
          err.textContent = j.message
          err.style.display = 'block'
          btn.disabled = false; btn.textContent = 'COBA LAGI'
          return
        }
        if (j.success) {
          // [FIX R1] pakai token dari server (bertanda tangan, ada expiry)
          // SEBELUMNYA: adminToken = p (input password mentah) -> salah & bocorin password
          adminToken = j.token || p
          try { sessionStorage.setItem('am_admin_tok', adminToken) } catch {}
          document.getElementById('gate').style.display = 'none'
          document.getElementById('mainApp').style.display = 'block'
          loadAllData()
        } else {
          err.style.display = 'block'
          err.textContent = j.message || 'password salah!'
          document.getElementById('gatePassInput').value = ''
        }
      } catch (ex) {
        err.style.display = 'block'
        err.textContent = 'ada masalah di halaman — refresh terus coba lagi'
      }
      btn.disabled = false; btn.textContent = 'MASUK \u2192'
    })

    function logoutAdmin() {
      adminToken = ''
      try { sessionStorage.removeItem('am_admin_tok') } catch {}
      document.getElementById('mainApp').style.display = 'none'
      document.getElementById('gate').style.display = 'flex'
      document.getElementById('gatePassInput').value = ''
      document.getElementById('gateErr').style.display = 'none'
      if (logPollInterval) clearInterval(logPollInterval)
    }

    // auto-restore sesi dalam tab yang sama (tutup tab = login lagi)
    (function restore() {
      try {
        const t = sessionStorage.getItem('am_admin_tok')
        if (t) {
          // [FIX R1] verifikasi TOKEN ke endpoint yang memang cek token,
          // bukan kirim token ke /login (yg cuma terima password).
          fetch('/api/keys', { headers: { 'x-admin-password': t, 'Content-Type': 'application/json' } })
            .then(r => {
              if (r.ok) {
                adminToken = t
                document.getElementById('gate').style.display = 'none'
                document.getElementById('mainApp').style.display = 'block'
                loadAllData()
              } else {
                sessionStorage.removeItem('am_admin_tok')
              }
            }).catch(() => {})
        }
      } catch {}
    })()

    // ══════════ NAV ══════════
    function switchTab(tab) {
      currentTab = tab
      const map = ['keys', 'logs', 'settings', 'sessions']
      map.forEach(t => {
        document.getElementById('tab-' + t).style.display = (t === tab) ? 'block' : 'none'
        document.getElementById('tabBtn-' + t).className = 'tab' + (t === tab ? ' on' : '')
      })
      if (logPollInterval) { clearInterval(logPollInterval); logPollInterval = null }
      if (tab === 'logs') {
        loadLogs()
        logPollInterval = setInterval(loadLogs, 3500)
      } else if (tab === 'settings') {
        loadSettings()
      } else if (tab === 'sessions') {
        loadSessions()
      }
    }

    const H = () => ({ 'x-admin-password': adminToken, 'Content-Type': 'application/json' })

    async function loadAllData() { loadStats(); loadKeys() }

    async function loadStats() {
      try {
        const r = await fetch('/api/keys/stats-detailed', { headers: H() })
        if (r.status === 403 || r.status === 401) { logoutAdmin(); return }
        const j = await r.json()
        if (j.success && j.data) {
          const d = j.data
          $('statTotalKeys').textContent = d.total_keys
          $('statActiveKeys').textContent = d.active_keys
          $('statInactiveKeys').textContent = d.inactive_keys
          $('statTotalReqs').textContent = (d.total_requests || 0).toLocaleString('id-ID')
          $('statTotalActs').textContent = (d.total_activations || 0).toLocaleString('id-ID')
          $('statTodayActs').textContent = (d.today_activations || 0).toLocaleString('id-ID')
          $('statRam').textContent = d.memory_usage_mb
        }
      } catch (e) {}
    }

    async function loadKeys() {
      try {
        const r = await fetch('/api/keys', { headers: H() })
        const j = await r.json()
        if (j.success && j.keys) {
          allKeys = j.keys
          renderKeysTable(allKeys)
        }
      } catch (e) {
        document.getElementById('keysTableBody').innerHTML = '<tr><td colspan="6" class="empty">gagal memuat keys</td></tr>'
      }
    }

    function renderKeysTable(keys) {
      const tb = document.getElementById('keysTableBody')
      if (keys.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" class="empty">belum ada api key dibuat</td></tr>'
        return
      }
      tb.innerHTML = keys.map(k => `
        <tr>
          <td class="fw7">${ESC(k.name)}</td>
          <td>
            <div class="row-g8">
              <span class="mono fs12">${ESC(k.key_masked)}</span>
              <button class="pill" data-act="copy" data-key="${ESC(k.key)}" title="salin full key">COPY</button>
            </div>
          </td>
          <td class="mono fw7">${(k.total_requests || 0).toLocaleString('id-ID')}</td>
          <td class="mono fs12">${k.last_used_at ? new Date(k.last_used_at).toLocaleString('id-ID') : '<span class="ink-hot">belum pernah</span>'}</td>
          <td><button class="pill ${k.is_active ? 'on' : 'off'}" data-act="toggle" data-key="${ESC(k.key)}">${k.is_active ? 'AKTIF' : 'MATI'}</button></td>
          <td><button class="pill off" data-act="delete" data-key="${ESC(k.key)}">HAPUS</button></td>
        </tr>
      `).join('')
    }

    function filterKeys() {
      const q = document.getElementById('keySearchInput').value.toLowerCase().trim()
      if (!q) return renderKeysTable(allKeys)
      renderKeysTable(allKeys.filter(k => k.name.toLowerCase().includes(q) || k.key.toLowerCase().includes(q)))
    }

    async function toggleKey(key) {
      const r = await fetch('/api/keys/' + encodeURIComponent(key) + '/toggle', { method: 'PATCH', headers: H() })
      const j = await r.json()
      if (j.success) { loadKeys(); loadStats() } else alert(j.message || 'gagal')
    }

    async function deleteKey(key) {
      if (!confirm('Yakin hapus API key ini permanen?')) return
      const r = await fetch('/api/keys/' + encodeURIComponent(key), { method: 'DELETE', headers: H() })
      const j = await r.json()
      if (j.success) { loadKeys(); loadStats() } else alert(j.message || 'gagal')
    }

    // ══════════ CREATE KEY ══════════
    function openCreateModal() {
      document.getElementById('newKeyName').value = ''
      document.getElementById('newKeyPrefix').value = 'am-sk'
      document.getElementById('createModal').classList.add('open')
    }
    function closeCreateModal() { document.getElementById('createModal').classList.remove('open') }
    function closeSuccessModal() { document.getElementById('successModal').classList.remove('open') }

    async function handleCreateKey(e) {
      e.preventDefault()
      const name = document.getElementById('newKeyName').value.trim()
      const prefix = document.getElementById('newKeyPrefix').value.trim() || 'am-sk'
      const btn = document.getElementById('btnSubmitCreate')
      btn.disabled = true; btn.textContent = '...'
      try {
        const r = await fetch('/api/keys', { method: 'POST', headers: H(), body: JSON.stringify({ name, prefix }) })
        const j = await r.json()
        if (j.success && j.key) {
          closeCreateModal()
          document.getElementById('newKeyDisplay').textContent = j.key.key
          document.getElementById('successModal').classList.add('open')
          loadKeys(); loadStats()
        } else {
          alert(j.message || 'gagal bikin key')
        }
      } catch (ex) { alert('error: ' + ex.message) }
      btn.disabled = false; btn.textContent = 'Generate'
    }

    function copyGeneratedKey() {
      navigator.clipboard.writeText(document.getElementById('newKeyDisplay').textContent.trim())
      event.target.textContent = 'TERSALIN <svg class="i-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
      setTimeout(() => { event.target.textContent = 'Salin' }, 1800)
    }

    function copyKeyText(txt, el) {
      navigator.clipboard.writeText(txt)
      const old = el.textContent
      el.textContent = 'OK <svg class="i-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
      setTimeout(() => { el.textContent = old }, 1300)
    }

    // ══════════ LOGS ══════════
    async function loadLogs() {
      try {
        const q = document.getElementById('logSearchInput')?.value.trim() || ''
        const r = await fetch('/api/keys/logs?limit=100&q=' + encodeURIComponent(q), { headers: H() })
        const j = await r.json()
        const tb = document.getElementById('logsTableBody')
        if (j.success && j.logs) {
          document.getElementById('logCountBadge').textContent = j.logs.length + ' logs'
          if (j.logs.length === 0) {
            tb.innerHTML = '<tr><td colspan="7" class="empty">belum ada log request</td></tr>'
            return
          }
          tb.innerHTML = j.logs.map(l => {
            const sp = l.status >= 500 ? 'err' : (l.status >= 400 ? 'warn' : 'ok')
            const cls = l.method === 'POST' ? 'm-post' : 'm-other'  // [FIX CSP] kelas, bukan inline style
            const time = new Date(l.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            return `
              <tr>
                <td class="mono fs12 c555">${ESC(time)}</td>
                <td><span class="method ${cls}">${ESC(l.method)}</span> <span class="mono fs12">${ESC(l.path)}</span></td>
                <td><span class="pill ${sp}">${ESC(l.status)}</span></td>
                <td class="mono fs12">${ESC(l.duration_ms)}ms</td>
                <td class="mono fs12">${ESC(l.ip)}</td>
                <td class="fw7 fs12">${ESC(l.api_key_name)}</td>
                <td class="mono fs12 ellipsis" title="${ESC(l.details || '')}">${ESC(l.details || '-')}</td>
              </tr>
            `
          }).join('')
        }
      } catch (e) {}
    }

    async function clearAllLogs() {
      if (!confirm('Hapus SEMUA log HTTP?')) return
      const r = await fetch('/api/keys/logs', { method: 'DELETE', headers: H() })
      const j = await r.json()
      if (j.success) loadLogs()
    }

    // ══════════ SETTINGS ══════════
    async function loadSettings() {
      try {
        const r = await fetch('/api/keys/settings', { headers: H() })
        const j = await r.json()
        if (j.success && j.settings) {
          const s = j.settings
          // [FIX R1] server gak pernah kirim password lagi -> kosongkan + placeholder.
          document.getElementById('setAdminPass').value = ''
          document.getElementById('setAdminPass').placeholder = 'kosongkan kalau gak ganti'
          document.getElementById('setRequireKey').checked = !!s.require_api_key
          document.getElementById('setServiceActive').checked = !!s.service_active
          document.getElementById('setRpm').value = s.rate_limit_rpm || 60
          document.getElementById('setMaintMsg').value = s.maintenance_message || ''
        }
      } catch (e) {}
    }

    async function handleSaveSettings(e) {
      e.preventDefault()
      // [FIX R1] kirim admin_password HANYA kalau field diisi (biar gak keset kosong).
      const _pw = document.getElementById('setAdminPass').value.trim()
      const payload = {
        require_api_key: document.getElementById('setRequireKey').checked,
        service_active: document.getElementById('setServiceActive').checked,
        rate_limit_rpm: parseInt(document.getElementById('setRpm').value) || 60,
        maintenance_message: document.getElementById('setMaintMsg').value.trim()
      }
      if (_pw) payload.admin_password = _pw
      const btn = document.getElementById('btnSaveSettings')
      btn.disabled = true; btn.textContent = 'Menyimpan...'
      try {
        const r = await fetch('/api/keys/settings', { method: 'PUT', headers: H(), body: JSON.stringify(payload) })
        const j = await r.json()
        if (j.success) {
          // [FIX R1] ganti password TIDAK lagi bikin token (password ≠ token).
          // Server naikkan session_epoch saat password berubah -> token lama mati, wajib login ulang.
          if (j.relogin_required || payload.admin_password) {
            sessionStorage.removeItem('am_admin_tok')
            adminToken = ''
            alert('Password diganti. Silakan login ulang.')
            logoutAdmin()
            btn.textContent = 'TERSIMPAN'
            btn.disabled = false
            return
          }
          btn.textContent = 'TERSIMPAN <svg class="i-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
        } else {
          btn.textContent = 'GAGAL'
          alert(j.message || 'gagal simpan')
        }
      } catch (ex) { alert('error: ' + ex.message) }
      btn.disabled = false
      setTimeout(() => { btn.textContent = 'Simpan Pengaturan' }, 1600)
    }

    // ══════════ SESSIONS ══════════
    async function loadSessions() {
      try {
        const r = await fetch('/api/keys/sessions', { headers: H() })
        const j = await r.json()
        const tb = document.getElementById('sessionsTableBody')
        if (j.success && j.sessions) {
          if (j.sessions.length === 0) {
            tb.innerHTML = '<tr><td colspan="6" class="empty">belum ada riwayat aktivasi</td></tr>'
            return
          }
          tb.innerHTML = j.sessions.map(s => `
            <tr>
              <td class="mono fs12">${ESC(s.saved_at ? new Date(s.saved_at).toLocaleString('id-ID') : '-')}</td>
              <td class="fw7">${ESC(s.email)}</td>
              <td class="mono fs12">${ESC(s.uid || '-')}</td>
              <td class="mono fs12 fw7">${ESC(s.orderId || '-')}</td>
              <td class="fs12">${ESC(s.key_used || 'Master')}</td>
              <td><span class="pill ok">BERHASIL</span></td>
            </tr>
          `).join('')
        }
      } catch (e) {}
    }

    function ESC(str) {
      if (!str) return ''
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
    }

/* ================= [FIX CSP] EVENT BINDINGS =================
   Semua handler inline (onclick/oninput/onsubmit) dipindah ke sini
   supaya CSP bisa tanpa 'unsafe-inline'. */
(function bindEvents() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('tmLight', 'click', () => setTheme('light'));
  on('tmDark', 'click', () => setTheme('dark'));
  on('btnLogout', 'click', logoutAdmin);
  on('btnOpenCreate', 'click', openCreateModal);
  on('btnRefreshLogs', 'click', loadLogs);
  on('btnClearLogs', 'click', clearAllLogs);
  on('btnRefreshSessions', 'click', loadSessions);
  on('createForm', 'submit', handleCreateKey);
  on('settingsForm', 'submit', handleSaveSettings);
  on('btnCloseCreate', 'click', closeCreateModal);
  on('btnCopyGen', 'click', copyGeneratedKey);
  on('btnCloseSuccess', 'click', closeSuccessModal);
  on('keySearchInput', 'input', filterKeys);
  on('logSearchInput', 'input', loadLogs);
  ['keys','logs','settings','sessions'].forEach(t => on('tabBtn-' + t, 'click', () => switchTab(t)));

  // Tabel key di-render via innerHTML -> pakai event delegation (bukan onclick inline)
  const kb = document.getElementById('keysTableBody');
  if (kb) kb.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act'), key = btn.getAttribute('data-key');
    if (act === 'copy') copyKeyText(key, btn);
    else if (act === 'toggle') toggleKey(key);
    else if (act === 'delete') deleteKey(key);
  });
})();
