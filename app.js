/* JobPing app — single-user, local-first. All data stays in this browser. */
(function () {
  'use strict';
  var L = window.JobPingLogic;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- state ---------- */
  function load(k, fb) { try { var v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function defaultAnswers() {
    return [
      { id: 'a1', q: 'Why do you want this role?', a: '' },
      { id: 'a2', q: 'What are your strengths?', a: '' },
      { id: 'a3', q: 'Salary expectations?', a: '' },
      { id: 'a4', q: 'Work authorization?', a: '' }
    ];
  }
  function defaultAlerts() {
    var tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    return { frequency: '1h', days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18, timezone: tz,
             paused: false, minScore: 60, dailyLimit: 10, notifEnabled: false, emailKey: '', emailOn: true };
  }

  var S = {
    profile: load('jobping.profile', null),
    resume: load('jobping.resume', { text: '', fileName: '' }),
    details: load('jobping.details', { name: '', phone: '', linkedin: '', portfolio: '' }),
    answers: load('jobping.answers', defaultAnswers()),
    alerts: load('jobping.alerts', defaultAlerts()),
    matches: load('jobping.matches', []),
    history: load('jobping.history', []),
    seenUrls: load('jobping.seenUrls', []),
    lastCheck: load('jobping.lastCheck', null),
    alertLog: load('jobping.alertLog', []),
    applyMode: load('jobping.applyMode', 'alerts'),
    keys: load('jobping.keys', { adzunaAppId: '', adzunaAppKey: '', adzunaCountry: 'us', rapidapiKey: '' }),
    sourceToggles: load('jobping.sourceToggles', null), // null = all on
    sourceLast: load('jobping.sourceLast', {}),
    minScoreFilter: 60, newOnly: false,
    sourceStatus: {},
    selectMode: false, // in-memory only
    selected: load('jobping.selected', []) // job ids, max 5
  };
  function persist() {
    save('jobping.profile', S.profile); save('jobping.resume', S.resume);
    save('jobping.details', S.details); save('jobping.answers', S.answers);
    save('jobping.alerts', S.alerts); save('jobping.matches', S.matches);
    save('jobping.history', S.history); save('jobping.seenUrls', S.seenUrls);
    save('jobping.lastCheck', S.lastCheck); save('jobping.alertLog', S.alertLog);
    save('jobping.applyMode', S.applyMode);
    save('jobping.keys', S.keys); save('jobping.sourceToggles', S.sourceToggles);
    save('jobping.sourceLast', S.sourceLast); save('jobping.selected', S.selected);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function toast(msg, ms) {
    var t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = msg;
    $('#toast-region').appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }

  function relTime(iso) {
    if (!iso) return 'unknown time';
    var d = new Date(iso).getTime(), diff = Date.now() - d;
    if (isNaN(d)) return 'recently';
    if (diff < 0) diff = 0;
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var dd = Math.floor(h / 24);
    if (dd < 7) return dd + 'd ago';
    return new Date(iso).toLocaleDateString();
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function openModal(html) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-backdrop" id="mback"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    $('#mback').addEventListener('click', function (e) { if (e.target.id === 'mback') closeModal(); });
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }

  function downloadText(text, filename) {
    try {
      var blob = new Blob([String(text || '')], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'download.txt';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { toast('Download failed — copy the text instead.'); }
  }

  function copyText(txt, label) {
    function done() { toast((label || 'Copied') + ' ✓'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select the text manually.'); }
      ta.remove();
    }
  }

  /* ---------- router ---------- */
  var VIEWS = ['landing', 'home', 'onboarding', 'jobs', 'history', 'alerts', 'profile'];
  function route() {
    var h = location.hash || '#/';
    var name = h.replace('#/', '') || 'landing';
    if (VIEWS.indexOf(name) === -1) name = 'landing';
    if (!S.profile && (name === 'jobs' || name === 'history' || name === 'alerts' || name === 'profile' || name === 'home')) {
      location.hash = '#/'; return;
    }
    if (S.profile && name !== 'home' && (name === 'landing' || name === 'onboarding')) {
      // fresh open (no hash) -> home; explicit onboarding revisit -> jobs
      location.hash = (name === 'landing') ? '#/home' : '#/jobs';
      return;
    }
    var viewName = name === 'home' ? 'landing' : name;
    $$('.view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== viewName; });
    var tb = $('#tabbar');
    tb.hidden = !(S.profile && ['home', 'jobs', 'history', 'alerts', 'profile'].indexOf(name) !== -1);
    $$('#tabbar button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-nav') === '#/' + name);
    });
    // landing adapts: visitors see setup, users see shortcuts home
    var onboarded = !!S.profile;
    var cta = $('#landing-cta'), back = $('#landing-back'), edit = $('#landing-edit');
    if (cta) cta.hidden = onboarded;
    if (back) back.hidden = !onboarded;
    if (edit) edit.hidden = !onboarded;
    window.scrollTo(0, 0);
    if (name === 'jobs') renderJobs();
    if (name === 'history') renderHistory();
    if (name === 'alerts') renderAlerts();
    if (name === 'profile') renderProfile();
  }
  document.addEventListener('click', function (e) {
    var n = e.target.closest('[data-nav]');
    if (n) { location.hash = n.getAttribute('data-nav'); route(); }
  });

  /* ---------- onboarding ---------- */
  function pillGroup(el, current, cb) {
    $$('.pill', el).forEach(function (p) {
      p.setAttribute('aria-pressed', p.getAttribute('data-v') === current ? 'true' : 'false');
      p.onclick = function () { cb(p.getAttribute('data-v')); pillGroup(el, p.getAttribute('data-v'), cb); };
    });
  }
  var obLevel = 'mid';
  var obJobTypes = ['fulltime', 'contract', 'internship'];
  function pillGroupMulti(el, current, cb) {
    $$('.pill', el).forEach(function (p) {
      var v = p.getAttribute('data-v');
      p.setAttribute('aria-pressed', current.indexOf(v) !== -1 ? 'true' : 'false');
      p.onclick = function () {
        var i = current.indexOf(v);
        if (i === -1) current.push(v); else current.splice(i, 1);
        cb(current.slice());
        pillGroupMulti(el, current, cb);
      };
    });
  }
  function initOnboarding() {
    pillGroup($('#ob-level'), obLevel, function (v) { obLevel = v; });
    pillGroupMulti($('#ob-jobtype'), obJobTypes, function () {});
    $('#onboard-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var p = {
        email: $('#ob-email').value.trim(),
        titles: $('#ob-titles').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        level: obLevel,
        yearsExp: $('#ob-years').value.trim(),
        jobTypes: obJobTypes.slice(),
        locations: $('#ob-locations').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        remoteOK: $('#ob-remote').checked,
        keywords: $('#ob-keywords').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      };
      var errs = L.validateProfile(p);
      var box = $('#ob-errors');
      if (errs.length) { box.innerHTML = errs.map(esc).join('<br>'); box.hidden = false; return; }
      box.hidden = true;
      S.profile = p; persist();
      var obResume = $('#ob-resume').value.trim();
      if (obResume) { S.resume = { text: obResume, fileName: 'pasted during setup' }; persist(); }
      toast('Welcome aboard 🔔 — checking for jobs now…');
      location.hash = '#/jobs';
      checkJobs(true);
    });
  }

  /* ---------- job engine ---------- */
  function fetchTimeout(url, ms, headers) {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, ms || 15000);
    var opts = { signal: ctrl.signal };
    if (headers && Object.keys(headers).length) opts.headers = headers; // custom headers only when needed (avoids CORS preflight otherwise)
    return fetch(url, opts).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { clearTimeout(t); throw e; });
  }

  var NORM = null; // built lazily (needs L)
  function normFor(id) {
    if (!NORM) NORM = {
      arbeitnow: L.normalizeArbeitnow, remotive: L.normalizeRemotive,
      themuse: L.normalizeMuse, jobicy: L.normalizeJobicy,
      remoteok: function (raw) { return L.normalizeRemoteOK(raw); },
      adzuna: L.normalizeAdzuna, jsearch: L.normalizeJSearch
    };
    return NORM[id];
  }
  // Pull the job array out of each source's envelope, defensively.
  function rawJobs(id, v) {
    if (!v || typeof v !== 'object') return [];
    if (Array.isArray(v)) return v;
    var arr = v.results || v.jobs || v.data || [];
    return Array.isArray(arr) ? arr : [];
  }

  var checking = false, checkTimer = null;
  function freqMs() {
    return { '20m': 20 * 60000, '30m': 30 * 60000, '1h': 3600000, 'daily': 24 * 3600000 }[S.alerts.frequency] || 3600000;
  }
  function scheduleAutoCheck() {
    if (checkTimer) clearInterval(checkTimer);
    if (!S.profile || S.alerts.paused) return;
    checkTimer = setInterval(function () { checkJobs(false); }, freqMs());
  }

  function checkJobs(manual) {
    if (checking || !S.profile) return Promise.resolve();
    checking = true;
    var btn = $('#check-now');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
    S.sourceStatus = {};
    renderSrcStatus();

    var plan = L.planSources(S.profile, S.keys, S.sourceToggles, S.sourceLast, Date.now());
    var jobs = [];
    var throttled = [];

    plan.forEach(function (p) {
      if (p.state !== 'ready') {
        S.sourceStatus[p.id] = { state: p.state, detail: p.detail };
        if (p.state === 'throttled') throttled.push(p);
      }
    });

    var fetches = plan.filter(function (p) { return p.state === 'ready'; }).map(function (p) {
      S.sourceStatus[p.id] = { state: 'checking', detail: 'checking…' };
      var reqs = p.urls.map(function (u) { return fetchTimeout(u, 15000, p.headers); });
      return Promise.allSettled(reqs).then(function (ress) {
        var raws = [];
        ress.forEach(function (r) { if (r.status === 'fulfilled') raws = raws.concat(rawJobs(p.id, r.value)); });
        var norm = raws.map(normFor(p.id)).filter(function (j) { return j && j.url && j.title; });
        var anyOk = ress.some(function (r) { return r.status === 'fulfilled'; });
        if (norm.length) {
          jobs = jobs.concat(norm);
          S.sourceStatus[p.id] = { state: 'ok', detail: norm.length + ' jobs' };
        } else if (anyOk) {
          S.sourceStatus[p.id] = { state: 'ok', detail: 'no jobs found' };
        } else {
          S.sourceStatus[p.id] = { state: 'error', detail: 'unreachable — will retry next check' };
        }
        if (anyOk) { S.sourceLast[p.id] = new Date().toISOString(); }
        renderSrcStatus();
      });
    });
    renderSrcStatus();

    return Promise.all(fetches).then(function () {
      persist();
      jobs = L.dedupeJobs(jobs);
      var fresh = L.findNew(jobs, S.seenUrls);
      var resumeText = (S.resume && S.resume.text) || '';
      fresh.forEach(function (j) {
        var r = L.scoreJob(j, S.profile, resumeText);
        j.score = r.score; j.breakdown = r.breakdown; j.jobType = r.jobType; j.excluded = r.excluded;
        j.firstSeen = new Date().toISOString(); j.isNew = true;
      });
      // re-score existing matches in case profile changed
      S.matches.forEach(function (j) {
        var r = L.scoreJob(j, S.profile, resumeText);
        j.score = r.score; j.breakdown = r.breakdown; j.jobType = r.jobType; j.excluded = r.excluded; j.isNew = false;
      });
      var freshSorted = fresh.filter(function (j) { return !j.excluded; }).slice().sort(function (a, b) { return b.score - a.score; });
      S.matches = freshSorted.concat(S.matches.filter(function (j) { return !j.excluded; })).slice(0, 120);
      jobs.forEach(function (j) { S.seenUrls.push(j.url); });
      S.seenUrls = S.seenUrls.slice(-2000);
      S.lastCheck = new Date().toISOString();
      persist();

      var now = new Date();
      var tzNow = L.tzParts(now, S.alerts.timezone);
      var todayCount = (S.alertLog.filter(function (l) { return l.day === tzNow.dayKey; })[0] || { count: 0 }).count;
      var gate = L.alertsAllowed(now, S.alerts, todayCount);
      var eligible = freshSorted.filter(function (j) { return j.score >= (S.alerts.minScore || 0); });

      if (eligible.length && gate.ok && S.alerts.notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
        var top = eligible.slice(0, 3);
        top.forEach(function (j) {
          try { new Notification('🔔 ' + j.title, { body: j.company + ' • score ' + j.score }); } catch (e) {}
        });
        logAlerts(top.length, tzNow.dayKey);
      } else if (eligible.length && gate.ok && !S.alerts.notifEnabled) {
        logAlerts(eligible.length, tzNow.dayKey); // counted as delivered in-app
      }
      // email digest via the user's own free key (sends while the app is open)
      if (eligible.length && gate.ok && S.alerts.emailOn !== false && S.alerts.emailKey && (S.profile.email || '').indexOf('@') !== -1) {
        var digest = L.buildDigest(eligible.slice(0, 10), S.profile);
        L.sendDigestEmail(S.alerts.emailKey, digest.subject, digest.text).then(function () {
          toast('📧 Digest emailed.');
        }).catch(function () {
          if (manual) toast('Email failed — check your key.');
        });
      }

      renderSrcStatus();
      renderJobs();
      if (manual) {
        S.lastSummary = {
          total: S.matches.length,
          remote: S.matches.filter(function (j) { return j.remote; }).length,
          fresh: eligible.length
        };
        renderJobs();
        if (eligible.length) toast('✨ ' + eligible.length + ' new match' + (eligible.length > 1 ? 'es' : '') + ' above your bar.');
        else if (!gate.ok) toast('Checked — alerts ' + gate.reason + '.');
        else toast('Checked — nothing new above your match bar.');
        if (throttled.length) toast('⏳ ' + throttled.map(function (t) { return t.name; }).join(', ') + ' skipped this round — ' + throttled[0].detail + '.');
      }
    }).catch(function () {
      renderSrcStatus(); renderJobs();
      if (manual) toast('Check failed — are you online?');
    }).then(function () {
      checking = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Check now'; }
      scheduleAutoCheck();
    });
  }

  function logAlerts(n, dayKey) {
    var e = S.alertLog.filter(function (l) { return l.day === dayKey; })[0];
    if (e) e.count += n; else S.alertLog.push({ day: dayKey, count: n });
    S.alertLog = S.alertLog.slice(-30); persist();
  }

  // Sources status indicator: one chip per source, colored dot = state.
  function renderSrcStatus() {
    var el = $('#src-status');
    if (!el) return;
    el.setAttribute('role', 'status');
    el.innerHTML = L.SOURCES.map(function (s) {
      var st = (S.sourceStatus && S.sourceStatus[s.id]) || {};
      var dot = 'idle', extra = '';
      if (st.state === 'ok') dot = 'live';
      else if (st.state === 'error') dot = 'err';
      else if (st.state === 'checking') dot = 'idle';
      if (st.state === 'nokey') extra = ' · needs key';
      else if (st.state === 'off') extra = ' · off';
      else if (st.state === 'throttled') extra = ' · waiting';
      else if (st.detail) extra = ' · ' + st.detail;
      var title = s.name + (st.detail ? ' — ' + st.detail : extra ? ' — ' + extra.slice(3) : '');
      return '<span class="src-chip" title="' + esc(title) + '"><span class="dot ' + dot + '"></span>' + esc(s.name) + esc(extra) + '</span>';
    }).join('');
  }

  /* ---------- dashboard ---------- */
  function scoreClass(s) { return s >= 75 ? 'hi' : s >= 50 ? 'md' : 'lo'; }

  function scoreDetail(j) {
    var b = j.breakdown || {};
    var rows = [
      ['ATS resume match', b.ats || 0, 70],
      ['Job title match', b.title || 0, 15],
      ['Location match', b.location || 0, 10],
      ['Experience level', b.level || 0, 5]
    ];
    return '<div class="score-detail" hidden>' +
      rows.map(function (r) {
        return '<div class="sd-row"><span>' + r[0] + '</span><span><strong>' + r[1] + '</strong> / ' + r[2] + '</span></div>';
      }).join('') +
      (b.hasResume ? '' : '<div class="fine">No resume added yet — the ATS match uses your profile keywords only. Add your resume in Profile for a true ATS-style score.</div>') +
      '</div>';
  }
  function resumeLine(j) {
    var b = j.breakdown || {};
    var hits = b.atsHits || [], total = b.atsTotal || 0;
    if (!b.hasResume) return '<div class="fine">Add your resume in Profile for an ATS-style match against each description.</div>';
    if (!total) return '';
    if (!hits.length) return '<div class="fine">None of this job\u2019s key terms were found in your resume.</div>';
    return '<div class="resume-match">✓ <strong>' + hits.length + '</strong> of this job\u2019s ' + total + ' key terms are in your resume: ' +
      hits.slice(0, 6).map(esc).join(', ') + (hits.length > 6 ? '…' : '') + '</div>';
  }
  function jobCard(j) {
    var isNew = !!j.isNew;
    var selBox = S.selectMode ?
      '<label class="sel-check"><input type="checkbox" data-sel="' + esc(j.id) + '"' +
      (S.selected.indexOf(j.id) !== -1 ? ' checked' : '') + ' aria-label="Select this job"> <span>Select</span></label>' : '';
    return '<article class="job' + (isNew ? ' is-new' : '') + '" data-id="' + esc(j.id) + '">' + selBox +
      '<div class="job-top"><div class="score ' + scoreClass(j.score) + '" style="--p:' + j.score + '" data-act="score" role="button" tabindex="0" title="Tap to see how this score is built" aria-label="Match score ' + j.score + ' out of 100. Tap for breakdown."><div class="score-in">' + j.score + '</div></div>' +
      '<div><h3>' + esc(j.title) + '</h3><div class="co">' + esc(j.company) + '</div></div></div>' +
      '<div class="meta">' +
        (j.location ? '<span class="tag">' + esc(j.location) + '</span>' : '') +
        (j.remote ? '<span class="tag remote">Remote</span>' : '') +
        (function () { var w = L.workplaceSignal(j); return (!j.remote && w === 'hybrid') ? '<span class="tag hybrid">Hybrid</span>' : ''; })() +
        (function () { var s = jobSig(j); return s === 'yes' ? '<span class="tag sponsor-yes">✓ Sponsors</span>' : s === 'no' ? '<span class="tag sponsor-no">No sponsorship</span>' : ''; })() +
        '<span class="tag">' + relTime(j.postedAt) + '</span>' +
        (isNew ? '<span class="tag new">New</span>' : '') +
      '</div>' +
      '<div class="via">via ' + esc(j.source) + '</div>' +
      scoreDetail(j) +
      resumeLine(j) +
      '<div class="job-actions">' +
        '<a class="btn btn-primary" href="' + esc(j.url) + '" target="_blank" rel="noopener">Apply →</a>' +
        (S.applyMode === 'prep' ? '<button class="btn" data-act="packet">Packet</button>' : '') +
        '<button class="btn" data-act="save">Save</button>' +
      '</div></article>';
  }

  function renderSelBar() {
    var bar = $('#sel-bar');
    if (!bar) return;
    if (!S.selectMode) { bar.hidden = true; return; }
    var n = S.selected.length;
    bar.hidden = false;
    bar.innerHTML = '<strong>' + n + ' / 5 selected</strong>' +
      '<span class="sel-actions"><button class="btn btn-primary" id="batch-prep" ' + (n ? '' : 'disabled') + '>Prepare batch →</button> ' +
      '<button class="btn" id="sel-cancel">Done</button></span>';
    $('#batch-prep').onclick = openBatch;
    $('#sel-cancel').onclick = function () { S.selectMode = false; renderJobs(); };
  }
  function jobSig(j) {
    return j.sponsorship || L.sponsorshipSignal((j.title || '') + ' ' + (j.description || '') + ' ' + (j.tags || []).join(' '));
  }
  function renderJobs() {
    var list = $('#matches');
    if (!list) return;
    var minF = parseInt($('#min-score-filter').value, 10) || 0;
    var newOnly = $('#new-only').checked;
    var spF = $('#sponsorship-filter').value || 'any';
    var lvlF = $('#level-filter').value || 'all';
    var wpF = $('#workplace-filter').value || 'all';
    var strictT = $('#strict-titles').checked;
    var strictL = $('#strict-location').checked;
    var profLocs = (S.profile.locations || []).map(function (l) { return String(l).toLowerCase(); }).filter(Boolean);
    var items = S.matches.filter(function (j) {
      if (j.score < minF) return false;
      if (newOnly && !j.isNew) return false;
      if (strictT) {
        var to = (j.breakdown && j.breakdown.titleOverlap != null) ? j.breakdown.titleOverlap : 1;
        if (to < 0.6) return false; // e.g. "Data Analyst" for "Financial Analyst"
      }
      if (strictL && profLocs.length) {
        var jl = String(j.location || '').toLowerCase();
        var lm = profLocs.some(function (l) { return jl.indexOf(l) !== -1; });
        if (!lm && !(L.workplaceSignal(j) === 'remote' && S.profile.remoteOK)) return false;
      }
      if (spF === 'needed' && jobSig(j) === 'no') return false; // hide explicit "no sponsorship"
      if (lvlF !== 'all' && L.levelSignal((j.title || '') + ' ' + (j.description || '')) !== lvlF) return false;
      if (wpF !== 'all' && L.workplaceSignal(j) !== wpF) return false;
      return true;
    });
    var newCount = S.matches.filter(function (j) { return j.isNew; }).length;
    var banner = $('#new-banner');
    var sum = S.lastSummary;
    if (sum) {
      banner.hidden = false;
      banner.innerHTML = '✨ <strong>' + sum.total + '</strong> jobs found • ' + sum.remote + ' remote • ' + sum.fresh + ' new — tap to view ↓';
    } else if (newCount) { banner.hidden = false; banner.textContent = '🎉 ' + newCount + ' new match' + (newCount > 1 ? 'es' : '') + ' since your last visit.'; }
    else banner.hidden = true;
    $('#jobs-sub').textContent = S.lastCheck ? 'Last checked ' + relTime(S.lastCheck) + '.' : 'Not checked yet.';
    renderDashStats();
    renderSelBar();
    if (!items.length) {
      list.innerHTML = '<div class="empty"><p><strong>No matches yet.</strong></p><p>Hit “Check now”, or loosen your titles / match bar. New postings appear here automatically.</p></div>';
    } else {
      list.innerHTML = items.map(jobCard).join('');
    }
    renderModePills();
  }

  function renderDashStats() {
    var el = $('#dash-stats');
    if (!el) return;
    var ms = S.matches || [];
    var total = ms.length;
    var fresh = ms.filter(function (j) { return j.isNew; }).length;
    var avg = total ? Math.round(ms.reduce(function (a, j) { return a + (j.score || 0); }, 0) / total) : 0;
    var srcs = {};
    ms.forEach(function (j) { if (j.source) srcs[j.source] = 1; });
    el.innerHTML =
      stat(total, 'matches') + stat(fresh, 'new') + stat(avg ? avg : '–', 'avg score') + stat(Object.keys(srcs).length, 'sources');
    function stat(v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; }
  }
  function renderModePills() {
    var badge = $('#mode-badge');
    badge.textContent = S.applyMode === 'prep' ? 'Prep + approve' : 'Alerts only';
    pillGroup($('#apply-mode-pills'), S.applyMode === 'prep' ? 'prep' : 'alerts', function (v) {
      S.applyMode = v; persist(); renderJobs();
      toast(v === 'prep' ? '⚡ Prep mode on — open a Packet on any match.' : '🔔 Alerts-only mode.');
    });
  }

  function findJob(id) { return S.matches.filter(function (j) { return j.id === id; })[0]; }

  function openPacket(j) {
    var d = S.details;
    var letter = L.buildCoverLetter(j, S.profile, d, (j.breakdown || {}).atsHits);
    var ansHtml = S.answers.map(function (a, i) {
      return '<div class="packet-sec"><div class="copy-row"><strong>' + esc(a.q) + '</strong>' +
        '<button class="mini" data-copy-ans="' + i + '">Copy</button></div>' +
        '<textarea rows="3" data-ans="' + i + '">' + esc(a.a) + '</textarea></div>';
    }).join('');
    openModal(
      '<h2>Application packet</h2><p class="muted sm">' + esc(j.title) + ' @ ' + esc(j.company) + ' — match ' + j.score + '</p>' +
      '<div class="packet-sec"><a class="btn btn-primary btn-block" href="' + esc(j.url) + '" target="_blank" rel="noopener" style="text-align:center">Open application page →</a></div>' +
      '<div class="packet-sec"><div class="copy-row"><strong>Cover letter</strong><button class="mini" id="copy-letter">Copy</button></div>' +
      '<textarea rows="10" id="cover-letter">' + esc(letter) + '</textarea>' +
      '<p class="fine">Template built from your details — review and edit before sending.</p></div>' +
      '<div class="packet-sec"><div class="copy-row"><strong>Resume</strong><button class="mini" id="copy-resume">Copy</button></div>' +
      '<textarea rows="6" readonly>' + esc((S.resume && S.resume.text) || '') + '</textarea>' +
      (d.name || d.phone || d.linkedin || d.portfolio ?
        '<p class="fine">' + esc(d.name) + (d.phone ? ' • ' + esc(d.phone) : '') +
        (d.linkedin ? '<br><a href="' + esc(d.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') +
        (d.portfolio ? ' • <a href="' + esc(d.portfolio) + '" target="_blank" rel="noopener">Portfolio</a>' : '') + '</p>' : '') +
      '</div>' + ansHtml +
      '<button class="btn btn-block" id="packet-done">Done — mark as applied</button>'
    );
    $('#copy-resume').onclick = function () { copyText((S.resume && S.resume.text) || '', 'Resume copied'); };
    var cl = $('#cover-letter');
    $('#copy-letter').onclick = function () { copyText(cl.value, 'Cover letter copied'); };
    var dl = document.createElement('button');
    dl.className = 'mini'; dl.textContent = 'Download .txt'; dl.style.marginLeft = '.4rem';
    dl.onclick = function () { downloadText(cl.value, 'cover-letter.txt'); toast('Cover letter downloaded ✓'); };
    $('#copy-letter').parentNode.appendChild(dl);
    $$('[data-copy-ans]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.getAttribute('data-copy-ans');
        var ta = document.querySelector('[data-ans="' + i + '"]');
        copyText(ta.value, 'Answer copied');
      };
    });
    $('#packet-done').onclick = function () {
      upsertHistory(j, 'applied'); closeModal(); toast('Marked as applied — good luck 🍀');
    };
  }

  function openBatch() {
    var jobs = S.selected.map(findJob).filter(Boolean);
    if (!jobs.length) { toast('Select at least one job first.'); return; }
    var resumeText = (S.resume && S.resume.text) || '';
    var html = '<h2>Batch application prep</h2>' +
      '<p class="muted sm">' + jobs.length + ' job' + (jobs.length > 1 ? 's' : '') +
      ' — everything is pre-filled for your review. Open each application page, paste, and submit yourself. <strong>Nothing is sent automatically.</strong></p>';
    jobs.forEach(function (j, idx) {
      var letter = L.buildCoverLetter(j, S.profile, S.details, (j.breakdown || {}).atsHits);
      var ansHtml = S.answers.map(function (a, i) {
        return '<div class="copy-row"><strong class="sm">' + esc(a.q) + '</strong>' +
          '<button class="mini" data-bcopy-ans="' + idx + '-' + i + '">Copy</button></div>' +
          '<textarea rows="2" data-bans="' + idx + '-' + i + '">' + esc(a.a) + '</textarea>';
      }).join('');
      html += '<div class="batch-job"><h3>' + (idx + 1) + '. ' + esc(j.title) + '</h3>' +
        '<div class="co">' + esc(j.company || '') + ' • match ' + j.score + '</div>' +
        '<a class="btn btn-primary btn-block" href="' + esc(j.url) + '" target="_blank" rel="noopener">Open application page →</a>' +
        '<div class="copy-row"><strong>Cover letter</strong><span><button class="mini" data-bcopy-letter="' + idx + '">Copy</button> ' +
        '<button class="mini" data-bdl-letter="' + idx + '">Download</button></span></div>' +
        '<textarea rows="8" data-bletter="' + idx + '">' + esc(letter) + '</textarea>' +
        (ansHtml ? '<div class="copy-row"><strong>Your answers</strong></div>' + ansHtml : '') +
        '<button class="btn btn-block" data-batch-applied="' + esc(j.id) + '">Done — mark as applied</button></div>';
    });
    html += '<button class="btn btn-primary btn-block" id="batch-email">📧 Email me this batch</button>' +
      '<p class="fine">The email lists every job with its apply link and pre-filled answers, so you can verify each one.</p>';
    openModal(html);
    $$('[data-bcopy-letter]').forEach(function (b) {
      b.onclick = function () { copyText(document.querySelector('[data-bletter="' + b.getAttribute('data-bcopy-letter') + '"]').value, 'Cover letter copied'); };
    });
    $$('[data-bdl-letter]').forEach(function (b) {
      b.onclick = function () {
        var ta = document.querySelector('[data-bletter="' + b.getAttribute('data-bdl-letter') + '"]');
        downloadText(ta.value, 'cover-letter.txt'); toast('Cover letter downloaded ✓');
      };
    });
    $$('[data-bcopy-ans]').forEach(function (b) {
      b.onclick = function () { copyText(document.querySelector('[data-bans="' + b.getAttribute('data-bcopy-ans') + '"]').value, 'Answer copied'); };
    });
    $$('[data-batch-applied]').forEach(function (b) {
      b.onclick = function () {
        var j = findJob(b.getAttribute('data-batch-applied'));
        if (j) { upsertHistory(j, 'applied'); b.textContent = '✓ Marked as applied'; b.disabled = true; }
      };
    });
    $('#batch-email').onclick = function () {
      if (S.alerts.emailOn === false) { toast('Email digests are off — turn them on in Alerts.'); return; }
      if (!S.alerts.emailKey) { toast('Add your free email key in Alerts first.'); location.hash = '#/alerts'; closeModal(); return; }
      var text = jobs.map(function (j, idx) {
        var letter = document.querySelector('[data-bletter="' + idx + '"]');
        return (idx + 1) + '. ' + j.title + ' — ' + (j.company || '') + ' (match ' + j.score + ')\n   Apply: ' + j.url +
          '\n   Cover letter:\n' + (letter ? letter.value : '');
      }).join('\n\n');
      var btn = $('#batch-email');
      btn.disabled = true; btn.textContent = 'Sending…';
      L.sendDigestEmail(S.alerts.emailKey, '📝 JobPing: your pre-filled batch (' + jobs.length + ' jobs)', text)
        .then(function () { toast('📧 Batch emailed — verify each job before submitting.'); btn.textContent = '✓ Sent'; })
        .catch(function () { btn.disabled = false; btn.textContent = '📧 Email me this batch'; toast('Email failed — check your key in Alerts.'); });
    };
  }

  function upsertHistory(j, status) {
    var h = S.history.filter(function (x) { return x.jobId === j.id; })[0];
    if (h) { h.status = status || h.status; h.updatedAt = new Date().toISOString(); }
    else S.history.unshift({ jobId: j.id, title: j.title, company: j.company, url: j.url, status: status || 'saved', updatedAt: new Date().toISOString() });
    persist();
  }

  /* ---------- job sources settings ---------- */
  function renderSourceSettings() {
    var wrap = $('#source-settings');
    if (!wrap) return;
    var plan = L.planSources(S.profile, S.keys, S.sourceToggles, S.sourceLast, Date.now());
    function findPlan(id) { return plan.filter(function (x) { return x.id === id; })[0]; }
    wrap.innerHTML = L.SOURCES.map(function (s) {
      var p = findPlan(s.id);
      var on = !(S.sourceToggles && S.sourceToggles[s.id] === false);
      var html = '<div class="source-row' + (on ? '' : ' off') + (s.recommended ? ' rec' : '') + '">' +
        '<div class="source-head"><div><strong>' + esc(s.name) + '</strong> ' +
        (s.recommended ? '<span class="rec-badge">★ Recommended</span> ' : '') +
        (s.kind === 'byokey' ? '<span class="tag">key needed</span>' : '<span class="tag">free</span>') +
        '<p class="blurb">' + esc(s.blurb) + '</p></div>' +
        '<button class="switch" role="switch" aria-checked="' + on + '" data-stoggle="' + s.id + '" aria-label="Toggle ' + esc(s.name) + '"><span></span></button></div>';
      if (s.kind === 'byokey' && on) {
        html += '<div class="key-grid">' + s.keyFields.map(function (f) {
          return '<label class="field"><span>' + esc(f.label) + (f.hint ? ' <em>(' + esc(f.hint) + ')</em>' : '') + '</span>' +
            '<input type="' + (f.password ? 'password' : 'text') + '" data-skey="' + f.key + '" value="' + esc(S.keys[f.key] || '') + '"' +
            ' placeholder="' + esc(f.placeholder || '') + '" autocomplete="off" spellcheck="false"></label>';
        }).join('') + '</div>' +
          '<a class="setup-link" href="' + esc(s.setupUrl) + '" target="_blank" rel="noopener">' + esc(s.setupLabel) + '</a>' +
          (s.setupSteps ? '<ol class="steps">' + s.setupSteps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ol>' : '') +
          '<div class="budget-note">⏱ ' + esc(s.budgetNote) + ' Keys never leave this browser and are never included in the exported config.</div>';
      }
      if (p && p.state === 'throttled') html += '<div class="budget-note">⏳ ' + esc(p.detail) + '</div>';
      if (p && p.state === 'nokey') html += '<div class="budget-note">🔑 Add your key above to unlock this source.</div>';
      return html + '</div>';
    }).join('');
  }

  function initSourceSettings() {
    var wrap = $('#source-settings');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var t = e.target.closest('[data-stoggle]');
      if (!t) return;
      var id = t.getAttribute('data-stoggle');
      if (!S.sourceToggles) S.sourceToggles = {};
      S.sourceToggles[id] = !(S.sourceToggles[id] === false) ? false : true;
      if (S.sourceToggles[id] === true) delete S.sourceToggles[id];
      persist(); renderSourceSettings(); renderSrcStatus();
      var s = L.SOURCES.filter(function (x) { return x.id === id; })[0];
      toast(s.name + (S.sourceToggles[id] === false ? ' off.' : ' on.'));
    });
    wrap.addEventListener('change', function (e) {
      var inp = e.target.closest('[data-skey]');
      if (!inp) return;
      S.keys[inp.getAttribute('data-skey')] = inp.value.trim();
      persist(); renderSourceSettings();
      toast('Key saved in this browser ✓');
    });
  }

  /* ---------- history ---------- */
  var STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];
  function renderHistory() {
    var list = $('#history-list');
    if (!list) return;
    if (!S.history.length) {
      list.innerHTML = '<div class="empty"><p><strong>Nothing saved yet.</strong></p><p>Tap “Save” on any match and it lands here with a status you control.</p></div>';
      return;
    }
    list.innerHTML = S.history.map(function (h, i) {
      return '<div class="hist"><div class="row-between"><div><strong>' + esc(h.title) + '</strong><div class="co muted sm">' +
        esc(h.company) + ' • ' + relTime(h.updatedAt) + '</div></div>' +
        '<button class="mini" data-hdel="' + i + '">✕</button></div>' +
        '<div class="row-between" style="margin-top:.5rem"><select data-hstatus="' + i + '" aria-label="Status">' +
        STATUSES.map(function (s) { return '<option' + (s === h.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select><a class="btn" href="' + esc(h.url) + '" target="_blank" rel="noopener">Open →</a></div></div>';
    }).join('');
  }

  /* ---------- alerts ---------- */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function renderAlerts() {
    var a = S.alerts;
    var sw = $('#set-paused');
    sw.setAttribute('aria-checked', a.paused ? 'true' : 'false');
    var esw = $('#set-email-on');
    if (esw) esw.setAttribute('aria-checked', a.emailOn !== false ? 'true' : 'false');
    $('#set-frequency').value = a.frequency;
    var dg = $('#set-days');
    dg.innerHTML = DAYS.map(function (d, i) {
      return '<button type="button" class="pill" data-day="' + i + '" aria-pressed="' + (a.days.indexOf(i) !== -1) + '">' + d + '</button>';
    }).join('');
    $$('#set-days .pill').forEach(function (p) {
      p.onclick = function () {
        var d = +p.getAttribute('data-day');
        var ix = S.alerts.days.indexOf(d);
        if (ix === -1) S.alerts.days.push(d); else S.alerts.days.splice(ix, 1);
        persist(); renderAlerts();
      };
    });
    var sh = $('#set-start'), eh = $('#set-end');
    if (!sh.options.length) {
      for (var h = 0; h <= 24; h++) {
        var lbl = h === 24 ? 'Midnight' : (h % 12 === 0 ? 12 : h % 12) + (h < 12 || h === 24 ? ' AM' : ' PM');
        sh.add(new Option(lbl, h)); eh.add(new Option(lbl, h));
      }
    }
    sh.value = a.startHour; eh.value = a.endHour;
    $('#set-tz').value = a.timezone;
    $('#set-minscore').value = a.minScore;
    $('#set-dailylimit').value = a.dailyLimit;
    renderSourceSettings();
    var nb = $('#enable-notif');
    nb.textContent = !('Notification' in window) ? 'Not supported' :
      Notification.permission === 'granted' ? (a.notifEnabled ? 'On ✓' : 'Enable') : 'Enable';
    nb.disabled = !('Notification' in window) || (Notification.permission === 'granted' && a.notifEnabled);
  }

  function initAlerts() {
    $('#set-paused').onclick = function () {
      S.alerts.paused = !S.alerts.paused; persist(); renderAlerts(); scheduleAutoCheck();
      toast(S.alerts.paused ? '⏸ Paused — JobPing is quiet.' : '▶ Resumed — checking now.');
      if (!S.alerts.paused) checkJobs(true);
    };
    var emailSw = $('#set-email-on');
    if (emailSw) emailSw.onclick = function () {
      S.alerts.emailOn = !(S.alerts.emailOn !== false); persist(); renderAlerts();
      toast(S.alerts.emailOn ? '📧 Email digests on.' : '📧 Email digests off — you will not receive emails.');
    };
    $('#set-frequency').onchange = function (e) { S.alerts.frequency = e.target.value; persist(); scheduleAutoCheck(); toast('Frequency saved.'); };
    $('#set-start').onchange = function (e) { S.alerts.startHour = +e.target.value; persist(); };
    $('#set-end').onchange = function (e) { S.alerts.endHour = +e.target.value; persist(); };
    $('#set-tz').onchange = function (e) {
      var v = e.target.value.trim();
      try { new Intl.DateTimeFormat('en-US', { timeZone: v }); S.alerts.timezone = v; persist(); toast('Timezone saved.'); }
      catch (err) { toast('That timezone looks invalid — kept ' + S.alerts.timezone + '.'); e.target.value = S.alerts.timezone; }
    };
    $('#detect-tz').onclick = function () {
      try { var tz = Intl.DateTimeFormat().resolvedOptions().timeZone; $('#set-tz').value = tz; S.alerts.timezone = tz; persist(); toast('Detected ' + tz); }
      catch (e) { toast('Could not detect timezone.'); }
    };
    $('#set-minscore').onchange = function (e) { S.alerts.minScore = Math.max(0, Math.min(100, +e.target.value || 0)); persist(); };
    $('#set-dailylimit').onchange = function (e) { S.alerts.dailyLimit = Math.max(1, Math.min(50, +e.target.value || 10)); persist(); };
    $('#enable-notif').onclick = function () {
      if (!('Notification' in window)) { toast('Notifications not supported here.'); return; }
      Notification.requestPermission().then(function (perm) {
        S.alerts.notifEnabled = perm === 'granted'; persist(); renderAlerts();
        toast(perm === 'granted' ? '🔔 Notifications on.' : 'Notifications blocked — check browser settings.');
      });
    };
    $('#export-config').onclick = function () {
      download('jobping-alert-config.json', JSON.stringify(L.exportConfig({ profile: S.profile, alerts: S.alerts }), null, 2));
      toast('Config exported — hand it to your assistant\'s scheduler for email digests.');
    };
    var ek = $('#email-key'); if (ek && !ek.value) ek.value = S.alerts.emailKey || '';
    $('#save-email-key').onclick = function () {
      S.alerts.emailKey = $('#email-key').value.trim(); persist();
      $('#email-key-status').textContent = S.alerts.emailKey ? 'Key saved ✓ — digests will email you when checks run.' : 'Key cleared.';
    };
    $('#test-email').onclick = function () {
      var key = $('#email-key').value.trim();
      if (!key) { toast('Paste your Web3Forms key first.'); return; }
      if ((S.profile.email || '').indexOf('@') === -1) { toast('Add your email in onboarding first.'); return; }
      var d = L.buildDigest([{ title: 'Test role', company: 'JobPing', location: 'Remote', remote: true, url: 'https://example.com', score: 95 }], S.profile);
      toast('Sending test…');
      L.sendDigestEmail(key, '[TEST] ' + d.subject, d.text).then(function () {
        S.alerts.emailKey = key; persist();
        $('#email-key-status').textContent = 'Test sent ✓ — key saved.';
      }).catch(function () { $('#email-key-status').textContent = 'Send failed — double-check the key.'; });
    };
    $('#delete-data').onclick = function () {
      if (!confirm('Delete ALL JobPing data from this browser? This cannot be undone.')) return;
      Object.keys(localStorage).filter(function (k) { return k.indexOf('jobping.') === 0; }).forEach(function (k) { localStorage.removeItem(k); });
      location.hash = '#/'; location.reload();
    };
  }

  /* ---------- profile ---------- */
  function renderProfile() {
    if ($('#resume-text').value !== (S.resume.text || '') && document.activeElement !== $('#resume-text'))
      $('#resume-text').value = S.resume.text || '';
    $('#d-name').value = S.details.name || '';
    $('#d-phone').value = S.details.phone || '';
    $('#d-linkedin').value = S.details.linkedin || '';
    $('#d-portfolio').value = S.details.portfolio || '';
    $('#p-titles').value = (S.profile.titles || []).join(', ');
    pillGroup($('#p-level'), S.profile.level, function (v) { S.profile.level = v; });
    $('#p-years').value = S.profile.yearsExp || '';
    if (!S.profile.jobTypes) S.profile.jobTypes = ['fulltime', 'contract', 'internship'];
    pillGroupMulti($('#p-jobtype'), S.profile.jobTypes, function (v) { S.profile.jobTypes = v; });
    $('#p-locations').value = (S.profile.locations || []).join(', ');
    $('#p-remote').checked = !!S.profile.remoteOK;
    $('#p-keywords').value = (S.profile.keywords || []).join(', ');
    $('#p-email').value = S.profile.email || '';
    renderKwCloud(); renderAnswers();
  }

  function renderKwCloud() {
    var kws = L.topKeywords(S.resume.text, 18);
    $('#resume-keywords').innerHTML = kws.length
      ? '<span class="fine">Keywords we found:</span> ' + kws.map(function (k) { return '<span class="tag">' + esc(k) + '</span>'; }).join('')
      : '';
    renderResumeFile();
  }

  function renderResumeFile() {
    var el = $('#resume-file');
    if (!el) return;
    if (S.resume && S.resume.pdf && S.resume.fileName && S.resume.pdf.indexOf('data:') === 0) {
      el.innerHTML = '<div class="file-saved">📄 <strong>' + esc(S.resume.fileName) + '</strong> <span class="fine">— saved in this browser</span> ' +
        '<button class="mini" id="resume-file-view">View</button> ' +
        '<a class="mini" href="' + S.resume.pdf + '" download="' + esc(S.resume.fileName) + '">Download</a> ' +
        '<button class="mini" id="resume-file-remove">Remove</button></div>';
      var vw = $('#resume-file-view');
      if (vw) vw.onclick = openPdfPreview;
      var rm = $('#resume-file-remove');
      if (rm) rm.onclick = function () {
        S.resume.pdf = ''; S.resume.fileName = S.resume.text ? 'pasted text' : ''; persist(); renderResumeFile();
        $('#resume-status').textContent = 'PDF removed — resume text kept.';
      };
    } else el.innerHTML = '';
  }

  function openPdfPreview() {
    var pdf = S.resume && S.resume.pdf;
    if (!pdf || pdf.indexOf('data:') !== 0) { toast('No PDF saved to preview.'); return; }
    openModal('<h2>' + esc(S.resume.fileName || 'Resume') + '</h2>' +
      '<div id="pdf-preview"><p class="muted">Loading preview…</p></div>' +
      '<button class="btn btn-block" id="pdf-close" style="margin-top:.75rem">Close</button>');
    $('#pdf-close').onclick = closeModal;
    function dataUrlToU8(dataUrl) {
      var base64 = (dataUrl.split(',')[1] || '');
      var bin = atob(base64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    loadPdfJs().then(function () {
      return window.pdfjsLib.getDocument({ data: dataUrlToU8(pdf) }).promise;
    }).then(function (p) {
      var holder = $('#pdf-preview');
      if (!holder) return;
      holder.innerHTML = '';
      var chain = Promise.resolve();
      for (var i = 1; i <= p.numPages; i++) {
        (function (n) {
          chain = chain.then(function () {
            return p.getPage(n).then(function (page) {
              var vp = page.getViewport({ scale: 1.5 });
              var maxW = 340;
              if (vp.width > maxW) vp = page.getViewport({ scale: maxW / vp.width });
              var cv = document.createElement('canvas');
              cv.width = vp.width; cv.height = vp.height;
              cv.style.width = '100%'; cv.style.height = 'auto'; cv.style.marginBottom = '.5rem';
              holder.appendChild(cv);
              return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
            });
          });
        })(i);
      }
      return chain;
    }).catch(function () {
      var holder = $('#pdf-preview');
      if (holder) holder.innerHTML = '<p class="muted">Could not render this preview — use Download to open it instead.</p>';
    });
  }

  function renderAnswers() {
    $('#answers').innerHTML = S.answers.map(function (a, i) {
      return '<div class="answer"><input type="text" data-aq="' + i + '" value="' + esc(a.q) + '" aria-label="Question">' +
        '<textarea rows="2" data-aa="' + i + '" aria-label="Answer">' + esc(a.a) + '</textarea>' +
        '<div class="row"><button class="mini" data-adel="' + i + '">Remove</button></div></div>';
    }).join('');
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    function setupWorker() {
      try {
        if (window.JOBPING_PDF_WORKER_B64) {
          var bin = atob(window.JOBPING_PDF_WORKER_B64);
          var u8 = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            URL.createObjectURL(new Blob([u8], { type: 'text/javascript' }));
        } else {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
      } catch (e) {}
    }
    if (window.pdfjsLib) { setupWorker(); return Promise.resolve(); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = function () { setupWorker(); resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function initProfile() {
    $('#resume-text').addEventListener('input', function (e) {
      S.resume.text = e.target.value; S.resume.fileName = ''; S.resume.pdf = ''; persist(); renderKwCloud(); renderResumeFile();
    });
    $('#resume-txt').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        S.resume.text = String(r.result || ''); S.resume.fileName = f.name; S.resume.pdf = ''; persist();
        $('#resume-text').value = S.resume.text; renderKwCloud(); renderResumeFile();
        $('#resume-status').textContent = 'Loaded ' + f.name + ' ✓'; toast('Resume loaded ✓');
      };
      r.readAsText(f); e.target.value = '';
    });
    $('#resume-pdf').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      $('#resume-status').textContent = 'Reading PDF…';
      loadPdfJs().then(function () {
        return f.arrayBuffer().then(function (buf) { return window.pdfjsLib.getDocument({ data: buf }).promise; });
      }).then(function (pdf) {
        var texts = [];
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () {
              return pdf.getPage(n).then(function (page) {
                return page.getTextContent().then(function (tc) {
                  texts.push(tc.items.map(function (it) { return it.str; }).join(' '));
                });
              });
            });
          })(i);
        }
        return chain.then(function () { return texts.join('\n'); });
      }).then(function (text) {
        S.resume.text = text; S.resume.fileName = f.name; S.resume.pdf = '';
        $('#resume-text').value = text; renderKwCloud();
        // keep the PDF file itself in the browser too
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var test = S.resume; test.pdf = String(fr.result || '');
            persist(); // throws if over localStorage quota
            $('#resume-status').textContent = 'Saved ' + f.name + ' ✓ — PDF kept in this browser.';
          } catch (err) {
            S.resume.pdf = ''; persist();
            $('#resume-status').textContent = 'Loaded ' + f.name + ' ✓ — text saved (PDF too large to keep).';
          }
          renderResumeFile(); toast('Resume loaded ✓');
        };
        fr.onerror = function () {
          persist();
          $('#resume-status').textContent = 'Loaded ' + f.name + ' ✓ — text saved (PDF could not be kept).';
          renderResumeFile(); toast('Resume loaded ✓');
        };
        try { fr.readAsDataURL(f); } catch (err) { fr.onerror(); }
      }).catch(function () {
        $('#resume-status').textContent = "Couldn't read this PDF — paste the text instead.";
        toast('PDF read failed — paste the text instead.');
      });
      e.target.value = '';
    });

    ['d-name', 'd-phone', 'd-linkedin', 'd-portfolio'].forEach(function (id) {
      $('#' + id).addEventListener('change', function (e) {
        S.details[id.slice(2)] = e.target.value.trim(); persist();
      });
    });

    $('#answers').addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-aq') != null ? +e.target.getAttribute('data-aq') : +e.target.getAttribute('data-aa');
      if (isNaN(i)) return;
      if (e.target.hasAttribute('data-aq')) S.answers[i].q = e.target.value;
      else S.answers[i].a = e.target.value;
      persist();
    });
    $('#answers').addEventListener('click', function (e) {
      var b = e.target.closest('[data-adel]');
      if (!b) return;
      S.answers.splice(+b.getAttribute('data-adel'), 1); persist(); renderAnswers();
    });
    $('#add-answer').onclick = function () {
      S.answers.push({ id: 'a' + Date.now(), q: 'New question', a: '' }); persist(); renderAnswers();
    };

    $('#save-prefs').onclick = function () {
      var p = {
        email: $('#p-email').value.trim(),
        titles: $('#p-titles').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        level: S.profile.level,
        yearsExp: $('#p-years').value.trim(),
        jobTypes: (S.profile.jobTypes || []).slice(),
        locations: $('#p-locations').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        remoteOK: $('#p-remote').checked,
        keywords: $('#p-keywords').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      };
      var errs = L.validateProfile(p);
      if (errs.length) { toast(errs[0]); return; }
      S.profile = p; persist(); toast('Preferences saved ✓ — re-scoring matches.');
      checkJobs(true);
    };
  }

  /* ---------- jobs view events ---------- */
  function initJobs() {
    $('#check-now').onclick = function () { checkJobs(true); };
    $('#min-score-filter').onchange = renderJobs;
    $('#new-only').onchange = function (e) { S.newOnly = e.target.checked; renderJobs(); };
    $('#select-toggle').onclick = function () {
      S.selectMode = !S.selectMode;
      if (!S.selectMode) { S.selected = []; persist(); }
      renderJobs();
      if (S.selectMode) toast('Tap Select on up to 5 jobs, then Prepare batch.');
    };
    var spSel = $('#sponsorship-filter');
    if (S.profile) spSel.value = S.profile.sponsorshipNeeded ? 'needed' : 'any';
    spSel.onchange = function () {
      if (S.profile) { S.profile.sponsorshipNeeded = (spSel.value === 'needed'); persist(); }
      renderJobs();
      if (spSel.value === 'needed') toast('Showing sponsors + unmentioned — hiding “no sponsorship” postings.');
    };
    $('#level-filter').onchange = renderJobs;
    $('#workplace-filter').onchange = renderJobs;
    var stT = $('#strict-titles'), stL = $('#strict-location');
    if (S.profile) {
      stT.checked = S.profile.strictTitles !== false;
      stL.checked = S.profile.strictLocation !== false;
    }
    stT.onchange = function () { if (S.profile) { S.profile.strictTitles = stT.checked; persist(); } renderJobs(); };
    stL.onchange = function () { if (S.profile) { S.profile.strictLocation = stL.checked; persist(); } renderJobs(); };
    $('#matches').addEventListener('change', function (e) {
      var cb = e.target.closest('[data-sel]');
      if (!cb) return;
      var id = cb.getAttribute('data-sel');
      var ix = S.selected.indexOf(id);
      if (cb.checked && ix === -1) {
        if (S.selected.length >= 5) { cb.checked = false; toast('Max 5 jobs per batch — keeps review easy.'); return; }
        S.selected.push(id);
      } else if (!cb.checked && ix !== -1) S.selected.splice(ix, 1);
      persist(); renderSelBar();
    });
    var banner = $('#new-banner');
    if (banner) banner.addEventListener('click', function () {
      var m = $('#matches');
      if (m) { try { m.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { m.scrollIntoView(); } }
    });
    $('#matches').addEventListener('click', function (e) {
      var card = e.target.closest('.job'); if (!card) return;
      var j = findJob(card.getAttribute('data-id')); if (!j) return;
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') === 'score') {
        var d = card.querySelector('.score-detail');
        if (d) d.hidden = !d.hidden;
        return;
      }
      if (act.getAttribute('data-act') === 'save') { upsertHistory(j, 'saved'); toast('Saved to history ✓'); }
      if (act.getAttribute('data-act') === 'packet') openPacket(j);
    });
    document.addEventListener('click', function (e) {
      var hs = e.target.closest('[data-hstatus]');
      if (hs) return; // handled by change
      var del = e.target.closest('[data-hdel]');
      if (del) { S.history.splice(+del.getAttribute('data-hdel'), 1); persist(); renderHistory(); }
    });
    $('#history-list').addEventListener('change', function (e) {
      var s = e.target.closest('[data-hstatus]');
      if (!s) return;
      S.history[+s.getAttribute('data-hstatus')].status = s.value;
      S.history[+s.getAttribute('data-hstatus')].updatedAt = new Date().toISOString();
      persist(); toast('Status → ' + s.value);
    });
  }

  /* ---------- boot ---------- */
  function init() {
    initOnboarding(); initJobs(); initAlerts(); initProfile(); initSourceSettings();
    window.addEventListener('hashchange', route);
    // fresh session (tab/app was closed and reopened): land on home with fresh data
    var freshSession = false;
    try {
      freshSession = !sessionStorage.getItem('jobping.session');
      sessionStorage.setItem('jobping.session', '1');
    } catch (e) {}
    route();
    if (S.profile) {
      scheduleAutoCheck();
      // fresh open -> always go home and refresh matches; in-session reloads keep the 2-min gate
      var last = S.lastCheck ? new Date(S.lastCheck).getTime() : 0;
      if (freshSession) {
        if (location.hash !== '#/home') location.hash = '#/home';
        checkJobs(false);
      } else if (Date.now() - last > 120000) checkJobs(false);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
