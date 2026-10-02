/* JobPing pure logic — no DOM, no network. Shared by app.js and Node tests. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.JobPingLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = {};
  ('a,an,the,and,or,of,to,in,on,for,with,at,by,from,as,is,are,was,were,be,been,being,' +
   'will,would,can,could,should,shall,this,that,these,those,it,its,you,your,yours,we,our,ours,' +
   'they,their,them,he,she,his,her,hers,i,me,my,mine,not,no,yes,do,does,did,done,have,has,had,' +
   'having,than,then,so,such,into,over,after,before,between,up,out,about,who,whom,which,what,' +
   'when,where,why,how,all,any,both,each,few,more,most,other,some,only,own,same,too,very,just,' +
   'also,per,via,re,eg,ie,etc,including,include,includes,included,within,across,using,used,use,' +
   'based,please,well,many,much,every,without,under,while,during,may,might,must,need,needs,' +
   'new,like,get,got,make,made,take,work,working,works,team,join,help,looking,seeking,role,' +
   'job,jobs,company,position,opportunity,apply,application,candidate,experience,years,year,' +
   'strong,ability,skills,skill,including,etc').split(',').forEach(function (w) { STOP[w] = 1; });

  function tokenize(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9+#.\s\-]/g, ' ')
      .split(/[\s\-_\/,;:()\[\]{}'"|]+/)
      .filter(function (t) { return t && t.length > 1 && !STOP[t]; });
  }

  function topKeywords(text, n) {
    var freq = {};
    tokenize(text).forEach(function (t) { freq[t] = (freq[t] || 0) + 1; });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, n || 30);
  }

  /* ---------- normalization ---------- */

  function normUrl(u) {
    var s = String(u || '').trim();
    if (!s) return '';
    try {
      var x = new URL(s);
      x.hash = ''; x.search = '';
      return x.toString().replace(/\/$/, '').toLowerCase();
    } catch (e) { return s.toLowerCase(); }
  }

  function normalizeArbeitnow(raw) {
    raw = raw || {};
    return {
      id: 'an-' + (raw.slug || raw.url || Math.random().toString(36).slice(2)),
      title: raw.title || '',
      company: raw.company_name || '',
      location: raw.location || '',
      remote: !!raw.remote,
      url: raw.url || '',
      postedAt: raw.created_at || null,
      description: raw.description || '',
      tags: raw.tags || [],
      source: 'Arbeitnow'
    };
  }

  function normalizeRemotive(raw) {
    raw = raw || {};
    var desc = String(raw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      id: 'rem-' + raw.id,
      title: raw.title || '',
      company: raw.company_name || '',
      location: raw.candidate_required_location || '',
      remote: true,
      url: raw.url || '',
      postedAt: raw.publication_date || null,
      description: desc,
      tags: raw.tags || [],
      source: 'Remotive'
    };
  }

  function dedupeJobs(jobs) {
    var seen = {}, out = [];
    (jobs || []).forEach(function (j) {
      var k = normUrl(j.url);
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(j);
    });
    return out;
  }

  function findNew(jobs, seenUrls) {
    var seen = {};
    (seenUrls || []).forEach(function (u) { seen[normUrl(u)] = 1; });
    return (jobs || []).filter(function (j) { return !seen[normUrl(j.url)]; });
  }

  /* ---------- scoring ---------- */

  var SENIOR_SIG = ['senior', 'sr', 'lead', 'principal', 'staff', 'head', 'director', 'vp'];
  var JUNIOR_SIG = ['junior', 'jr', 'entry', 'intern', 'internship', 'associate', 'graduate', 'trainee'];

  var TYPE_SIG = {
    internship: ['intern', 'internship', 'co-op', 'coop'],
    contract: ['contract', 'contractor', 'freelance', 'temporary', 'temp-to-hire'],
    fulltime: ['full-time', 'full time', 'permanent', 'fulltime']
  };
  function typeSignal(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ') + ' ';
    var k, i, s;
    for (k in TYPE_SIG) {
      for (i = 0; i < TYPE_SIG[k].length; i++) {
        s = TYPE_SIG[k][i];
        if (t.indexOf(' ' + s + ' ') !== -1 || t.indexOf(' ' + s + '-') !== -1) return k;
      }
    }
    return 'unknown';
  }

  function levelSignal(text) {    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
    var i, s;
    for (i = 0; i < SENIOR_SIG.length; i++) { s = SENIOR_SIG[i]; if (t.indexOf(' ' + s + ' ') !== -1) return 'senior'; }
    for (i = 0; i < JUNIOR_SIG.length; i++) { s = JUNIOR_SIG[i]; if (t.indexOf(' ' + s + ' ') !== -1) return 'junior'; }
    return 'mid';
  }

  /* Sponsorship signal from the posting text.
     'yes' = explicitly sponsors; 'no' = explicitly does not; 'unknown' = no mention.
     Deliberately conservative: "must be authorized to work" alone => unknown. */
  function sponsorshipSignal(text) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
    var neg = /no (visa )?sponsorship|without sponsorship|do not sponsor|does not sponsor|cannot sponsor|can not sponsor|will not sponsor|sponsorship not (available|offered|provided)|not (currently )?(offering|providing|sponsoring)( [a-z]+){0,4} sponsorship|no h ?1 ?b /;
    if (neg.test(t)) return 'no';
    var pos = /visa sponsorship|sponsorship (available|offered|provided)|will sponsor|we sponsor|sponsors? (available|offered)|open to sponsor|h ?1 ?b (sponsorship|transfer)/;
    if (pos.test(t)) return 'yes';
    return 'unknown';
  }

  // score 0-100, ATS-style: resume↔JD keyword coverage (70) + title (15) + location (10) + level (5)
  function scoreJob(job, profile, resumeText) {
    profile = profile || {};
    var jt = tokenize(job.title || '');
    var jtSet = {};
    jt.forEach(function (t) { jtSet[t] = 1; });

    var titleScore = 0, titleOverlap = 0;
    (profile.titles || []).forEach(function (title) {
      title = String(title || '').trim();
      if (!title) return;
      var tt = tokenize(title);
      if (!tt.length) return;
      var overlap = tt.filter(function (t) { return jtSet[t]; }).length;
      var ratio = overlap / tt.length;
      if (ratio > titleOverlap) titleOverlap = ratio;
      var s = ratio * 50;
      if ((job.title || '').toLowerCase().indexOf(title.toLowerCase()) !== -1) s = Math.max(s, 45);
      if (s > titleScore) titleScore = s;
    });

    var locScore = 0;
    var locHay = String(job.location || '').toLowerCase();
    var locHit = (profile.locations || []).some(function (l) { return l && locHay.indexOf(String(l).toLowerCase()) !== -1; });
    if (job.remote && profile.remoteOK) locScore = 20;
    else if (locHit) locScore = 20;
    else if (job.remote && !profile.remoteOK) locScore = 5;

    /* ATS-style core: how much of the JOB's keywords appear in YOUR resume.
       Real applicant tracking systems score resumes against the job description —
       so the bulk of the score (70/100) comes from that keyword coverage. */
    var jdText = (job.title || '') + ' ' + (job.description || '') + ' ' + (job.tags || []).join(' ');
    var jdKws = topKeywords(jdText, 25);
    var resumeHay = String(resumeText || '').toLowerCase();
    var hasResume = resumeHay.replace(/\s+/g, ' ').trim().length > 50;
    var matchHay = hasResume ? resumeHay : (profile.keywords || []).join(' ').toLowerCase();
    var atsHits = [], seenA = {};
    jdKws.forEach(function (k) { if (k && !seenA[k] && matchHay.indexOf(k) !== -1) { seenA[k] = 1; atsHits.push(k); } });
    var atsScore = jdKws.length ? Math.round((atsHits.length / jdKws.length) * 70) : 0;

    var sig = levelSignal((job.title || '') + ' ' + (job.description || ''));
    var lvlScore = 10;
    if (profile.level === 'entry' && sig === 'senior') lvlScore = 2;
    else if (profile.level === 'senior' && sig === 'junior') lvlScore = 4;
    else if (profile.level === 'mid' && sig === 'senior') lvlScore = 7;
    // years of experience refines the level fit
    var yrs = parseFloat(profile.yearsExp);
    if (!isNaN(yrs)) {
      if (yrs <= 2 && sig === 'senior') lvlScore = Math.min(lvlScore, 3);
      else if (yrs >= 8 && sig === 'junior') lvlScore = Math.min(lvlScore, 5);
    }

    // job-type filter: exclude when the posting's detected type isn't wanted
    var excluded = false, jobType = typeSignal((job.title || '') + ' ' + (job.description || ''));
    var wanted = profile.jobTypes || [];
    if (wanted.length && jobType !== 'unknown' && wanted.indexOf(jobType) === -1) excluded = true;

    var total = Math.round(Math.min(100, atsScore + titleScore * 0.3 + locScore / 2 + lvlScore / 2));
    return { score: total, breakdown: {
      ats: atsScore, atsHits: atsHits, atsTotal: jdKws.length, hasResume: hasResume,
      title: Math.round(titleScore * 0.3), titleOverlap: Math.round(titleOverlap * 100) / 100,
      location: Math.round(locScore / 2), level: Math.round(lvlScore / 2)
    }, jobType: jobType, excluded: excluded, sponsorship: sponsorshipSignal(jdText) };
  }

  /* ---------- scheduling (timezone-aware) ---------- */

  function tzParts(date, timeZone) {
    var tz = timeZone || 'UTC';
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
      year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(date);
    function get(t) { var p = parts.filter(function (x) { return x.type === t; })[0]; return p ? p.value : ''; }
    var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')];
    var hour = parseInt(get('hour'), 10);
    if (hour === 24) hour = 0;
    var dayKey = get('year') + '-' + String(get('month')).padStart(2, '0') + '-' + String(get('day')).padStart(2, '0');
    return { weekday: wd, hour: hour, dayKey: dayKey };
  }

  function inActiveWindow(date, settings) {
    var p = tzParts(date, settings.timezone || 'UTC');
    if ((settings.days || []).indexOf(p.weekday) === -1) return false;
    var s = settings.startHour == null ? 0 : settings.startHour;
    var e = settings.endHour == null ? 24 : settings.endHour;
    if (s <= e) return p.hour >= s && p.hour < e;
    return p.hour >= s || p.hour < e; // overnight window
  }

  function alertsAllowed(date, settings, alertsToday) {
    if (!settings) return { ok: false, reason: 'no settings' };
    if (settings.paused) return { ok: false, reason: 'paused' };
    if (!inActiveWindow(date, settings)) return { ok: false, reason: 'outside active hours' };
    var limit = settings.dailyLimit == null ? 10 : settings.dailyLimit;
    if ((alertsToday || 0) >= limit) return { ok: false, reason: 'daily limit reached' };
    return { ok: true };
  }

  /* ---------- email digest (bring-your-own-key) ----------
     A static page cannot send email by itself. With a free Web3Forms
     access key (no signup, web3forms.com), the app can send the digest
     itself whenever it is open and a check runs. Honest scope: digests
     only send while JobPing is open in a tab. */
  /* Cover letter: template-based, strictly from the user's own data.
     No AI, no invented achievements — name, title, company, years, and the
     skills that actually matched (ATS hits). Always editable before use. */
  function buildCoverLetter(job, profile, details, atsHits) {
    job = job || {}; profile = profile || {}; details = details || {};
    var name = String(details.name || '').trim();
    var email = String(profile.email || '').trim();
    var phone = String(details.phone || '').trim();
    var linkedin = String(details.linkedin || '').trim();
    var title = String(job.title || 'this role').trim();
    var company = String(job.company || 'your company').trim();
    var yrs = parseFloat(profile.yearsExp);
    var yrsTxt = !isNaN(yrs) ? 'With ' + yrs + (yrs === 1 ? ' year' : ' years') + ' of experience' : 'As a professional';
    var firstTitle = (profile.titles || [])[0] || '';
    var roleTxt = firstTitle ? ' as a ' + firstTitle : '';
    var skills = (atsHits || []).filter(Boolean).slice(0, 5);
    if (!skills.length) skills = (profile.keywords || []).filter(Boolean).slice(0, 5);
    skills = skills.map(function (s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); });
    var skillTxt = skills.length ? skills.join(', ') : 'the requirements listed';
    var d = new Date();
    var dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var L = [];
    if (name) L.push(name);
    var contact = [phone, email, linkedin].filter(Boolean).join('  ·  ');
    if (contact) L.push(contact);
    L.push('', dateStr, '', 'Dear Hiring Manager,', '',
      'I am excited to apply for the ' + title + ' position at ' + company + '.',
      '',
      yrsTxt + roleTxt + ', I was drawn to this role because it centers on ' + skillTxt +
      ' — areas where my background is strongest. I would welcome the opportunity to discuss how I can contribute to ' + company + '.',
      '',
      'Thank you for your time and consideration.', '',
      'Sincerely,',
      name || '[Your Name]');
    return L.join('\n');
  }

  function buildDigest(jobs, profile) {
    jobs = jobs || [];
    var subject = '🔔 JobPing: ' + jobs.length + ' new match' + (jobs.length === 1 ? '' : 'es') + ' for you';
    var lines = jobs.slice(0, 10).map(function (j, i) {
      return (i + 1) + '. ' + j.title + ' — ' + (j.company || 'Unknown company') +
        '\n   ' + (j.location || (j.remote ? 'Remote' : '')) + ' • match ' + j.score + '/100' +
        '\n   ' + j.url;
    });
    var text = 'New roles matching "' + ((profile && profile.titles || []).join(', ') || 'your search') + '":\n\n' +
      lines.join('\n\n') +
      (jobs.length > 10 ? '\n\n…plus ' + (jobs.length - 10) + ' more in the app.' : '') +
      '\n\n— sent by JobPing (runs while the app is open)';
    return { subject: subject, text: text };
  }
  function sendDigestEmail(accessKey, subject, text) {
    return fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ access_key: accessKey, subject: subject, message: text, from_name: 'JobPing' })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success !== true) throw new Error((d && d.message) || 'send failed');
      return true;
    });
  }

  function validateProfile(p) {
    var errs = [];
    p = p || {};
    if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(p.email).trim())) errs.push('Enter a valid email address.');
    var titles = (p.titles || []).map(function (t) { return String(t).trim(); }).filter(Boolean);
    if (!titles.length) errs.push('Add at least one job title.');
    if (titles.length > 5) errs.push('Keep it to 5 job titles max.');
    if (['entry', 'mid', 'senior'].indexOf(p.level) === -1) errs.push('Pick an experience level.');
    if (p.yearsExp !== undefined && p.yearsExp !== '' && p.yearsExp !== null) {
      var y = parseFloat(p.yearsExp);
      if (isNaN(y) || y < 0 || y > 50) errs.push('Years of experience must be between 0 and 50.');
    }
    var jts = p.jobTypes || [];
    var okTypes = ['fulltime', 'contract', 'internship'];
    if (jts.length && !jts.every(function (t) { return okTypes.indexOf(t) !== -1; })) errs.push('Unknown job type selected.');
    return errs;
  }

  // The JSON a scheduler (e.g. an assistant-run cron) consumes to send email digests.
  function exportConfig(state) {
    state = state || {};
    var profile = state.profile || {}, alerts = state.alerts || {};
    return {
      version: 1,
      email: profile.email || '',
      titles: profile.titles || [],
      level: profile.level || 'mid',
      locations: profile.locations || [],
      remoteOK: !!profile.remoteOK,
      keywords: profile.keywords || [],
      minScore: alerts.minScore == null ? 60 : alerts.minScore,
      frequency: alerts.frequency || '1h',
      days: alerts.days || [1, 2, 3, 4, 5],
      activeHours: { start: alerts.startHour == null ? 9 : alerts.startHour, end: alerts.endHour == null ? 18 : alerts.endHour },
      timezone: alerts.timezone || 'UTC',
      paused: !!alerts.paused,
      dailyLimit: alerts.dailyLimit == null ? 10 : alerts.dailyLimit,
      exportedAt: new Date().toISOString()
    };
  }

  /* ---------- multi-source registry ---------- */

  // Every job source JobPing knows about. kind: 'free' (no key) or 'byokey' (bring your own key).
  // minIntervalMs: minimum time between checks for this source (protects free-tier call budgets).
  var SOURCES = [
    { id: 'arbeitnow', name: 'Arbeitnow', kind: 'free',
      blurb: 'EU + remote startup jobs, aggregated from many ATS boards.' },
    { id: 'remotive', name: 'Remotive', kind: 'free',
      blurb: 'Remote-only jobs. Note: their public feed is delayed ~24h.' },
    { id: 'themuse', name: 'The Muse', kind: 'free',
      blurb: 'US jobs with company profiles. No keyword search — filtered on-device.' },
    { id: 'jobicy', name: 'Jobicy', kind: 'free',
      blurb: 'Remote jobs board. Best-effort parsing.' },
    { id: 'remoteok', name: 'RemoteOK', kind: 'free',
      blurb: 'Large remote-first job board. No key needed.' },
    { id: 'adzuna', name: 'Adzuna', kind: 'byokey', minIntervalMs: 3600000,
      blurb: 'Aggregator across 19 countries with salary data on most listings.',
      keyFields: [
        { key: 'adzunaAppId', label: 'App ID', placeholder: 'e.g. a1b2c3d4' },
        { key: 'adzunaAppKey', label: 'App Key', placeholder: 'paste your app key', password: true },
        { key: 'adzunaCountry', label: 'Country', placeholder: 'us', hint: 'us, gb, ca, au, de, fr, nl, in…' }
      ],
      setupUrl: 'https://developer.adzuna.com/signup', setupLabel: 'Get a free Adzuna key →',
      setupSteps: ['Tap the link and sign up — they show you an App ID and an App Key.', 'Copy both and paste them here (country: us).', 'Done — Adzuna unlocks on the next check.'],
      budgetNote: 'Free tier: 250 calls/day. One check uses ~1 call per job title. Fine for personal use at hourly checks.' },
    { id: 'jsearch', name: 'JSearch', kind: 'byokey', minIntervalMs: 12 * 3600000,
      recommended: true,
      blurb: 'Aggregates Indeed, LinkedIn, Glassdoor & more via RapidAPI.',
      keyFields: [
        { key: 'rapidapiKey', label: 'RapidAPI Key', placeholder: 'paste your RapidAPI key', password: true }
      ],
      setupUrl: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch', setupLabel: 'Get a RapidAPI key →',
      setupSteps: ['Tap the link, sign up / log in to RapidAPI, and subscribe to the free plan.', 'Copy the key shown as X-RapidAPI-Key and paste it here.', 'Done — LinkedIn/Indeed/Glassdoor listings unlock on the next check (max every 12h on the free tier).'],
      budgetNote: 'Free tier ≈ 300 calls/month. JobPing checks JSearch at most every 12h to stay inside it.' }
  ];

  function normalizeAdzuna(raw) {
    raw = raw || {};
    var desc = String(raw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      id: 'adz-' + (raw.id || Math.random().toString(36).slice(2)),
      title: raw.title || '',
      company: (raw.company && raw.company.display_name) || '',
      location: (raw.location && raw.location.display_name) || '',
      remote: /remote/i.test(raw.title || '') || /remote/i.test((raw.location && raw.location.display_name) || ''),
      url: raw.redirect_url || '',
      postedAt: raw.created || null,
      description: desc,
      tags: raw.category ? [raw.category.label || raw.category.tag || ''] : [],
      source: 'Adzuna'
    };
  }

  function normalizeMuse(raw) {
    raw = raw || {};
    var desc = String(raw.contents || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      id: 'muse-' + (raw.id || Math.random().toString(36).slice(2)),
      title: raw.name || '',
      company: (raw.company && raw.company.name) || '',
      location: (raw.locations && raw.locations[0] && raw.locations[0].name) || '',
      remote: /remote/i.test((raw.locations && raw.locations[0] && raw.locations[0].name) || '') || /remote/i.test(raw.name || ''),
      url: (raw.refs && raw.refs.landing_page) || '',
      postedAt: raw.publication_date || null,
      description: desc,
      tags: (raw.categories || []).map(function (c) { return c.name; }),
      source: 'The Muse'
    };
  }

  // Best-effort: Jobicy's shape isn't contractual, so accept several shapes.
  function normalizeJobicy(raw) {
    raw = raw || {};
    function pick(o, keys) {
      for (var i = 0; i < keys.length; i++) {
        var v = o[keys[i]];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return '';
    }
    var company = raw.company;
    if (company && typeof company === 'object') company = company.name || company.display_name || '';
    return {
      id: 'jobicy-' + (raw.id || raw.slug || pick(raw, ['url', 'link']) || Math.random().toString(36).slice(2)),
      title: pick(raw, ['title', 'name', 'jobTitle']),
      company: company || '',
      location: pick(raw, ['location', 'candidate_required_location', 'region']),
      remote: true,
      url: pick(raw, ['url', 'link', 'applyUrl']),
      postedAt: pick(raw, ['pubDate', 'date', 'created', 'published', 'publication_date']) || null,
      description: String(pick(raw, ['description', 'content', 'excerpt'])).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      tags: raw.tags || raw.categories || [],
      source: 'Jobicy'
    };
  }

  function normalizeRemoteOK(raw) {
    raw = raw || {};
    if (!raw.position) return null; // first array item is a legal notice, not a job
    return {
      id: 'rok-' + (raw.id || raw.slug || Math.random().toString(36).slice(2)),
      title: raw.position || '',
      company: raw.company || '',
      location: raw.location || '',
      remote: true, // RemoteOK is remote-first
      url: raw.apply_url || raw.url || '',
      postedAt: raw.date || null,
      description: String(raw.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      tags: raw.tags || [],
      source: 'RemoteOK'
    };
  }

  /* Workplace: remote | hybrid | onsite, from flags + text. */
  function workplaceSignal(job) {
    job = job || {};
    var loc = String(job.location || '').toLowerCase();
    var t = ((job.title || '') + ' ' + (job.description || '')).toLowerCase();
    if (job.remote || /\bremote\b/.test(loc) || /remote[- ]?(first|friendly|only|ok)|work remotely|working remotely/.test(t)) return 'remote';
    if (/\bhybrid\b/.test(t) || /\bhybrid\b/.test(loc)) return 'hybrid';
    return 'onsite';
  }

  function normalizeJSearch(raw) {
    raw = raw || {};
    var loc = [raw.job_city, raw.job_state, raw.job_country].filter(Boolean).join(', ');
    return {
      id: 'js-' + (raw.job_id || Math.random().toString(36).slice(2)),
      title: raw.job_title || '',
      company: raw.employer_name || '',
      location: loc,
      remote: !!raw.job_is_remote,
      url: raw.job_apply_link || '',
      postedAt: raw.job_posted_at_datetime_utc || null,
      description: String(raw.job_description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      tags: [],
      source: 'JSearch'
    };
  }

  function adzunaUrls(profile, keys) {
    var country = (keys.adzunaCountry || 'us').toLowerCase().trim() || 'us';
    var where = (profile.locations && profile.locations[0]) || '';
    return (profile.titles || []).slice(0, 5).map(function (t) {
      var q = 'https://api.adzuna.com/v1/api/jobs/' + encodeURIComponent(country) + '/search/1' +
        '?app_id=' + encodeURIComponent(keys.adzunaAppId || '') +
        '&app_key=' + encodeURIComponent(keys.adzunaAppKey || '') +
        '&what=' + encodeURIComponent(t) +
        (where ? '&where=' + encodeURIComponent(where) : '') +
        '&results_per_page=50&sort_by=date&content-type=application/json';
      return q;
    });
  }

  function jsearchUrls(profile) {
    var loc = (profile.locations && profile.locations[0]) || '';
    return (profile.titles || []).slice(0, 5).map(function (t) {
      return 'https://jsearch.p.rapidapi.com/search?query=' + encodeURIComponent(t + (loc ? ' in ' + loc : '')) +
        '&page=1&num_pages=1&date_posted=week';
    });
  }

  function hasKeysFor(id, keys) {
    keys = keys || {};
    if (id === 'adzuna') return !!(keys.adzunaAppId && keys.adzunaAppKey);
    if (id === 'jsearch') return !!keys.rapidapiKey;
    return true;
  }

  // Pure fetch planner: decides what to fetch, what to skip, and what's throttled.
  // Returns [{ id, name, kind, state, urls, headers, detail }]
  // state: 'ready' | 'off' | 'nokey' | 'throttled'
  function planSources(profile, keys, toggles, sourceLast, nowMs) {
    nowMs = nowMs || Date.now();
    return SOURCES.map(function (s) {
      if (toggles && toggles[s.id] === false) return { id: s.id, name: s.name, kind: s.kind, state: 'off', urls: [], headers: {}, detail: 'turned off' };
      if (s.kind === 'byokey' && !hasKeysFor(s.id, keys)) return { id: s.id, name: s.name, kind: s.kind, state: 'nokey', urls: [], headers: {}, detail: 'needs API key' };
      var last = sourceLast && sourceLast[s.id] ? new Date(sourceLast[s.id]).getTime() : 0;
      if (s.minIntervalMs && nowMs - last < s.minIntervalMs) {
        var waitH = Math.ceil((s.minIntervalMs - (nowMs - last)) / 3600000);
        return { id: s.id, name: s.name, kind: s.kind, state: 'throttled', urls: [], headers: {}, detail: 'next check in ~' + waitH + 'h (free-tier budget)' };
      }
      var urls = [], headers = {};
      if (s.id === 'arbeitnow') urls = ['https://www.arbeitnow.com/api/job-board-api'];
      else if (s.id === 'remotive') urls = ['https://remotive.com/api/remote-jobs'];
      else if (s.id === 'themuse') urls = ['https://www.themuse.com/api/public/jobs?page=0', 'https://www.themuse.com/api/public/jobs?page=1'];
      else if (s.id === 'jobicy') urls = ['https://jobicy.com/api/v2/remote-jobs'];
      else if (s.id === 'remoteok') urls = ['https://remoteok.com/api'];
      else if (s.id === 'adzuna') urls = adzunaUrls(profile, keys || {});
      else if (s.id === 'jsearch') { urls = jsearchUrls(profile); headers = { 'X-RapidAPI-Key': keys.rapidapiKey, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' }; }
      return { id: s.id, name: s.name, kind: s.kind, state: 'ready', urls: urls, headers: headers, detail: '' };
    });
  }

  return {
    tokenize: tokenize,
    topKeywords: topKeywords,
    normUrl: normUrl,
    normalizeArbeitnow: normalizeArbeitnow,
    normalizeRemotive: normalizeRemotive,
    normalizeAdzuna: normalizeAdzuna,
    normalizeMuse: normalizeMuse,
    normalizeJobicy: normalizeJobicy,
    normalizeRemoteOK: normalizeRemoteOK,
    workplaceSignal: workplaceSignal,
    normalizeJSearch: normalizeJSearch,
    dedupeJobs: dedupeJobs,
    findNew: findNew,
    levelSignal: levelSignal,
    typeSignal: typeSignal,
    buildDigest: buildDigest,
    buildCoverLetter: buildCoverLetter,
    sendDigestEmail: sendDigestEmail,
    scoreJob: scoreJob,
    sponsorshipSignal: sponsorshipSignal,
    tzParts: tzParts,
    inActiveWindow: inActiveWindow,
    alertsAllowed: alertsAllowed,
    validateProfile: validateProfile,
    exportConfig: exportConfig,
    SOURCES: SOURCES,
    planSources: planSources,
    hasKeysFor: hasKeysFor,
    adzunaUrls: adzunaUrls,
    jsearchUrls: jsearchUrls
  };
});
