/* PR Forge — Google sign-in and cloud backup through Supabase.
 * The sync rules are in js/sync.js; this file does the network calls, sign-in and timing.
 *
 * The URL and publishable key below are meant to be public: the database only lets a
 * signed-in person read and write their own rows (see supabase/schema.sql).
 */
(function (root) {
  'use strict';

  var SUPABASE_URL = 'https://pvtcqdtqycihlontmirl.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_00yYlGDJceDwbjp_B25oLg_FOEW6ZwE';
  // Google sign-in direct (2.3.0): the app asks Google itself, so Google's page names this site instead of the
  // Supabase server, then hands Google's ID token to Supabase (signInWithIdToken). The "PR Forge web" OAuth client ID
  // is public (it's in the sign-in address). Empty = the older Supabase redirect sign-in, which still works and stays
  // available as a fallback on the sign-in screen. Needs this site's address in the client's Authorized redirect URIs.
  var GOOGLE_CLIENT_ID = '';

  var ST = root.PRF.store, SY = root.PRF.sync;
  var META_KEY = ST.KEY + ':sync';

  var client = null;
  var session = null;
  var hooks = { getState: null, setState: null, onData: null, onStatus: null };
  var status = { state: 'idle', message: '' }; // idle | syncing | synced | offline | signin | error
  var running = false, again = false, timer = null, signingOut = false;
  var restoring = false; // first download after signing in on this phone
  var failure = '';      // why the last sign-in couldn't finish, shown on the sign-in screen
  var STARTED_KEY = ST.KEY + ':signin-started';
  // Handover: on iPhone, Google sign-in from the home-screen app can finish in a browser sheet that has its own
  // storage. The app makes a one-time secret (nonce) and passes it in the return address; the sheet hands the
  // sign-in to the app through the database under that secret, and the app collects it when you come back.
  // A direct Google sign-in comes back as #id_token=…&state=g.<handover code>.<raw nonce> (or #error=…&state=…).
  var HASH = {};
  location.hash.slice(1).split('&').forEach(function (kv) {
    var i = kv.indexOf('=');
    if (i > 0) { try { HASH[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* ignore */ } }
  });
  var GSTATE = /^g\.([0-9a-f]{32,128})\.([0-9a-f]{32,128})$/.exec(HASH.state || '');
  var GOOGLE_RETURN = !!GSTATE && !!(HASH.id_token || HASH.error);
  var RETURN_NONCE = (/[?&]h=([0-9a-f]{32,128})(?:&|$)/.exec(location.search) || [])[1] || (GSTATE ? GSTATE[1] : '');
  // Remembered at load: supabase-js clears the tokens from the address before our listener runs.
  var WAS_RETURN = /[?&](code|error|h)=/.test(location.search) || /(access_token|error)=/.test(location.hash) || GOOGLE_RETURN;
  // The address as it arrived, with values hidden (keys only), e.g. "/pr-forge/?h=… #access_token,expires_in,…".
  var ARRIVED = location.pathname + (location.search ? '?' + location.search.slice(1).split('&').map(function (kv) {
    var k = kv.split('=')[0]; return k === 'h' ? 'h=' + (kv.split('=')[1] || '').slice(0, 6) + '…' : k;
  }).join('&') : '') + (location.hash ? ' #' + location.hash.slice(1).split('&').map(function (kv) { return kv.split('=')[0]; }).join(',') : '');
  var handingOff = false, handedOff = false, claimTimer = null, claiming = false;
  // Diagnostics (shown small on the sign-in screen): when this copy's storage began, and how the last sign-in went.
  var BORN_KEY = ST.KEY + ':born', LAST_KEY = ST.KEY + ':last-signin';
  var born = null;
  try {
    born = JSON.parse(localStorage.getItem(BORN_KEY) || 'null');
    if (!born) { born = { at: new Date().toISOString(), where: where() }; localStorage.setItem(BORN_KEY, JSON.stringify(born)); }
  } catch (e) { born = null; }
  function noteSignIn(how) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: new Date().toISOString(), where: where(), how: how, code: !!RETURN_NONCE, arrived: ARRIVED, ref: String(document.referrer || '').replace(/[?#].*$/, '').slice(0, 80) })); } catch (e) { /* ignore */ }
  }
  function started() { try { return JSON.parse(localStorage.getItem(STARTED_KEY) || 'null'); } catch (e) { return null; } }
  function newNonce() {
    var b = new Uint8Array(24);
    (root.crypto || root.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function where() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    return standalone ? 'the home-screen app' : 'the browser';
  }
  /** True when Google has just sent someone back (tokens or an error in the address). */
  function isReturn() { return /[?&](code|error|h)=/.test(location.search) || /(access_token|error|id_token)=/.test(location.hash); }
  function sha256hex(text) {
    return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  /** This page's own address as registered with Google (no query, no "index.html"). */
  function returnAddress() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function cleanUrl() {
    if (isReturn()) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    }
  }
  /** Google sent us back but no session came of it: stop waiting and say why. */
  function signInFailed(err) {
    if (session || handingOff || handedOff || !isReturn()) return;
    var started = null;
    try { started = JSON.parse(localStorage.getItem(STARTED_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (failure) { /* already explained, e.g. cancelled at Google */ }
    else if (err && /fetch|network|load failed/i.test(String(err.message))) failure = 'Sign-in didn’t finish: couldn’t reach the sign-in server. Check your connection and try again.';
    else if (err && err.message) failure = 'Sign-in didn’t finish: ' + err.message + '.';
    else if (!started) failure = 'Sign-in started somewhere else, so it can’t finish in ' + where() + '. Tap Continue with Google again from here.';
    else failure = 'Sign-in started in ' + started.where + ' and came back to ' + where() + ', but it couldn’t finish. Tap Continue with Google to try again.';
    try { localStorage.removeItem(STARTED_KEY); } catch (e) { /* ignore */ }
    cleanUrl();
    if (hooks.onData) hooks.onData();
  }
  function doneRestoring() { if (restoring) { restoring = false; if (hooks.onData) hooks.onData(); } }
  var meta = loadMeta();

  function loadMeta() {
    try {
      var m = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      if (m && typeof m === 'object') {
        var e = SY.emptyMeta();
        Object.keys(e).forEach(function (k) { if (k in m) e[k] = m[k]; });
        if (!e.shadow || typeof e.shadow !== 'object') e.shadow = {};
        return e;
      }
    } catch (err) { /* fall through */ }
    return SY.emptyMeta();
  }
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ } }

  function setStatus(state, message) {
    status = { state: state, message: message || '' };
    if (hooks.onStatus) hooks.onStatus();
  }

  function check(res) {
    if (res.error) {
      var e = new Error(res.error.message || 'Request failed');
      e.code = res.error.code; e.status = res.status;
      throw e;
    }
    return res.data;
  }

  var remote = {
    pullWorkouts: function (since) {
      var all = [], PAGE = 500;
      function page(from) {
        var q = client.from('workouts').select('id,data,deleted,updated_at').eq('user_id', session.user.id);
        if (since) q = q.gt('updated_at', since);
        return q.order('updated_at').order('id').range(from, from + PAGE - 1).then(check).then(function (rows) {
          all = all.concat(rows || []);
          return rows && rows.length === PAGE ? page(from + PAGE) : all;
        });
      }
      return page(0);
    },
    pushWorkouts: function (rows) {
      var uid = session.user.id, chunks = [];
      for (var i = 0; i < rows.length; i += 200) chunks.push(rows.slice(i, i + 200));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return client.from('workouts').upsert(chunk.map(function (r) {
            return { user_id: uid, id: r.id, data: r.data, deleted: r.deleted };
          }), { onConflict: 'user_id,id' }).then(check);
        });
      }, Promise.resolve());
    },
    getProfile: function () {
      return client.from('profiles').select('data,updated_at').eq('user_id', session.user.id).maybeSingle().then(check);
    },
    putProfile: function (data) {
      return client.from('profiles').upsert({ user_id: session.user.id, data: data }, { onConflict: 'user_id' })
        .select('updated_at').single().then(check);
    }
  };

  function isNetworkError(e) {
    return !navigator.onLine || (e && (e.name === 'TypeError' || /fetch|network|load failed/i.test(String(e.message))));
  }

  function sync() {
    if (!client || !meta.userId || signingOut) return Promise.resolve();
    if (running) { again = true; return Promise.resolve(); }
    if (!navigator.onLine) { setStatus('offline'); doneRestoring(); return Promise.resolve(); }
    if (!session) {
      // e.g. the sign-in expired while offline: try to refresh it now that we're online.
      return client.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) adoptSession(r.data.session);
        else setStatus('signin');
      }, function () { setStatus('offline'); });
    }
    running = true;
    setStatus('syncing');
    var state = hooks.getState();
    return SY.run(state, meta, remote).then(function (res) {
      meta.lastSyncAt = new Date().toISOString();
      saveMeta();
      if (res.changed && hooks.onData) hooks.onData();
      setStatus('synced');
    }, function (err) {
      saveMeta();
      if (err && err.changed && hooks.onData) hooks.onData();
      if (isNetworkError(err)) setStatus('offline');
      else if (err && (err.status === 401 || /jwt/i.test(String(err.message)))) setStatus('signin');
      else setStatus('error', err && err.message);
    }).then(function () {
      running = false;
      doneRestoring();
      if (again) { again = false; schedule(500); }
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(sync, ms == null ? 1500 : ms);
  }

  /** In the sheet: give the sign-in to the app under its secret, then forget it here. */
  function handOff(s) {
    handingOff = true;
    client.rpc('prf_handoff_put', { p_nonce: RETURN_NONCE, p_refresh: s.refresh_token }).then(function (res) {
      if (res.error) throw res.error;
      // Forget the sign-in here without telling the server: a server sign-out would end the very session the
      // app is about to collect. Stop refreshing it too, so this copy never uses its token again.
      try { client.auth.stopAutoRefresh(); } catch (e) { /* ignore */ }
      try {
        Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); });
      } catch (e) { /* ignore */ }
    }).then(function () {
      handingOff = false; handedOff = true;
      noteSignIn('handed to the app');
      cleanUrl();
      if (hooks.onData) hooks.onData();
    }, function (e) {
      // The handover table isn't there (or the network failed): sign in right here, as before, and say why.
      handingOff = false;
      noteSignIn('handover failed (' + String((e && (e.message || e.code)) || 'unknown error').slice(0, 120) + '), so it signed in here instead');
      adoptSession(s);
    });
  }
  /** In the app: collect a sign-in the sheet handed over. Runs on return to the app and every 2 s while waiting. */
  function tryClaim() {
    var st = started();
    if (!client || session || claiming || !st || !st.nonce || !navigator.onLine) return;
    if (Date.now() - new Date(st.at).getTime() > 10 * 60000) { try { localStorage.removeItem(STARTED_KEY); } catch (e) { /* ignore */ } return; }
    claiming = true;
    client.rpc('prf_handoff_take', { p_nonce: st.nonce }).then(function (res) {
      var token = res && !res.error ? res.data : null;
      if (!token) return;
      return client.auth.refreshSession({ refresh_token: token }).then(function (r) {
        if (r && r.data && r.data.session) { adoptSession(r.data.session); noteSignIn('collected from the browser sheet'); }
      });
    }).then(function () { claiming = false; }, function () { claiming = false; });
  }
  function startClaiming() {
    clearInterval(claimTimer);
    claimTimer = setInterval(function () {
      var st = started();
      if (session || !st || !st.nonce) { clearInterval(claimTimer); return; }
      if (document.visibilityState === 'visible') tryClaim();
    }, 2000);
  }

  function adoptSession(s) {
    session = s;
    if (!s) return;
    var uid = s.user.id;
    if (meta.userId && meta.userId !== uid) {
      // This phone's data belongs to someone else's account: keep a copy aside and start clean.
      try { localStorage.setItem(ST.KEY + ':other-account:' + meta.userId, JSON.stringify(hooks.getState())); } catch (e) { /* ignore */ }
      hooks.setState(ST.defaults());
      meta = SY.emptyMeta();
    }
    var first = !meta.userId;
    meta.userId = uid;
    meta.email = s.user.email || '';
    saveMeta();
    failure = '';
    try { localStorage.removeItem(STARTED_KEY); } catch (e) { /* ignore */ }
    cleanUrl();
    if (first) {
      restoring = true;
      setTimeout(doneRestoring, 20000); // never leave someone on the loading screen
      if (hooks.onData) hooks.onData();
    }
    schedule(0);
  }

  var api = {
    /** Call once at start-up. */
    init: function (h) {
      hooks = h;
      if (!root.supabase || !root.supabase.createClient) { setStatus('error', 'Sign-in could not load.'); return; }
      client = root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          // Implicit flow (Supabase's default): Google's reply carries the session itself, so it doesn't
          // depend on a key saved before leaving, which iPhone Safari and home-screen apps can lose.
          flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true
        }
      });
      if (GOOGLE_RETURN) {
        // Back from Google with an ID token: exchange it for a Supabase session. The session then arrives through
        // onAuthStateChange below, exactly like the older sign-in (including the iPhone sheet handover).
        if (HASH.error) {
          failure = HASH.error === 'access_denied' ? 'Sign-in was cancelled. Tap Continue with Google to try again.' : 'Google couldn’t sign you in (' + HASH.error + '). Try again.';
          setTimeout(function () { signInFailed(new Error('cancelled')); }, 0);
        } else {
          client.auth.signInWithIdToken({ provider: 'google', token: HASH.id_token, nonce: GSTATE[2] }).then(function (r) {
            if (r && r.error) signInFailed(r.error);
          }, function (e) { signInFailed(e); });
          setTimeout(function () { signInFailed(new Error('it took too long. Check your connection')); }, 20000);
        }
      } else if (isReturn()) {
        client.auth.initialize().then(function (r) {
          setTimeout(function () { signInFailed(r && r.error); }, 500);
        }, function (e) { signInFailed(e); });
        setTimeout(function () { signInFailed(new Error('it took too long. Check your connection')); }, 20000);
      }
      client.auth.onAuthStateChange(function (event, s) {
        // Supabase asks that no other Supabase calls run inside this callback.
        setTimeout(function () {
          var st = started();
          // Coming back with a handover code that this storage didn't make: we're in the sheet, so pass it on.
          if (s && RETURN_NONCE && !session && !handingOff && !handedOff && !(st && st.nonce === RETURN_NONCE)) handOff(s);
          else if (handingOff || handedOff) { /* the sheet is passing this sign-in to the app */ }
          else if (s && (!session || s.user.id !== session.user.id || event === 'SIGNED_IN')) {
            if (WAS_RETURN) noteSignIn(RETURN_NONCE ? 'finished here (same window)' : 'finished here, with no handover code in the address');
            adoptSession(s);
          }
          else if (s) session = s;
          else if (event === 'SIGNED_OUT' && !signingOut) { session = null; if (meta.userId) setStatus('signin'); }
          else if (!s && meta.userId && !session) setStatus(navigator.onLine ? 'signin' : 'offline');
        }, 0);
      });
      window.addEventListener('online', function () { schedule(300); });
      window.addEventListener('offline', function () { setStatus('offline'); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { schedule(300); tryClaim(); } });
      window.addEventListener('focus', tryClaim);
      window.addEventListener('pageshow', tryClaim);
      if (!meta.userId && started() && started().nonce && !isReturn()) { tryClaim(); startClaiming(); }
    },
    /** Who this phone's data belongs to, or null if nobody has signed in. Works offline. */
    owner: function () { return meta.userId ? { userId: meta.userId, email: meta.email } : null; },
    /** True while a sign-in redirect is being finished. */
    returningFromSignIn: function () { return (isReturn() && !/error/.test(location.search + location.hash)) || handingOff; },
    /** One line for the sign-in screen: which copy this is, how old its storage is, how the last sign-in went. */
    diagnostics: function () {
      var t = function (iso) { var d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
      var last = null; try { last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { /* ignore */ }
      var hasToken = false; try { hasToken = Object.keys(localStorage).some(function (k) { return /^sb-.*-auth-token$/.test(k); }); } catch (e) { /* ignore */ }
      var st = started();
      return 'Shown as ' + where() + '. Saved data here since ' + (born ? t(born.at) : 'unknown (storage blocked)') + '. ' +
        (st && st.nonce ? 'A sign-in was started here at ' + t(st.at) + ' with code ' + st.nonce.slice(0, 6) + '…' + (st.to ? ', return address ' + st.to : '') + '. ' : '') +
        (last ? 'Last sign-in here: ' + t(last.at) + ', ' + last.how + '. Address it came back to: ' + (last.arrived || '?') + (last.ref ? ' (from ' + last.ref + ')' : '') + '.' : 'No sign-in has finished here.') +
        ' Google session stored: ' + (hasToken ? 'yes' : 'no') + '. Owner: ' + (meta.userId ? 'yes' : 'no') + '.';
    },
    /** True in the browser sheet after it has handed the sign-in to the app. */
    handedOff: function () { return handedOff; },
    /** True in the app while it waits for a sign-in to come back from the sheet. */
    waitingForSignIn: function () { var st = started(); return !session && !meta.userId && !!(st && st.nonce) && Date.now() - new Date(st.at).getTime() < 10 * 60000; },
    /** True while the first download after signing in on this phone is running. */
    restoring: function () { return restoring; },
    signInError: function () {
      if (failure) return failure;
      var m = /[?&#]error_description=([^&]*)/.exec(location.search + location.hash);
      return m ? 'Sign-in didn’t work: ' + decodeURIComponent(m[1].replace(/\+/g, ' ')) + '. Try again.' : '';
    },
    /** True when Continue with Google goes to Google directly (the older way is then offered as a fallback). */
    directSignIn: function () { return !!GOOGLE_CLIENT_ID; },
    signIn: function (opts) {
      if (!client) return Promise.reject(new Error('Sign-in could not load. Check your connection and reload.'));
      failure = '';
      if (GOOGLE_CLIENT_ID && !(opts && opts.classic) && root.crypto && root.crypto.subtle) {
        var code = newNonce(), raw = newNonce();
        try { localStorage.setItem(STARTED_KEY, JSON.stringify({ at: new Date().toISOString(), where: where(), nonce: code, to: location.pathname + ' (Google direct)' })); } catch (e) { /* ignore */ }
        startClaiming();
        // Google puts the SHA-256 of the nonce in the ID token; Supabase checks it against the raw nonce we pass back.
        // The raw nonce rides in "state", so a browser sheet with its own storage (iPhone) can still finish.
        return sha256hex(raw).then(function (hashed) {
          var q = { client_id: GOOGLE_CLIENT_ID, redirect_uri: returnAddress(), response_type: 'id_token', scope: 'openid email profile', nonce: hashed, state: 'g.' + code + '.' + raw };
          location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&'));
        });
      }
      var nonce = newNonce();
      var back = location.origin + location.pathname + '?h=' + nonce;
      try { localStorage.setItem(STARTED_KEY, JSON.stringify({ at: new Date().toISOString(), where: where(), nonce: nonce, to: location.pathname + '?h=…' })); } catch (e) { /* ignore */ }
      startClaiming();
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: back }
      }).then(function (res) { if (res.error) throw res.error; });
    },
    /** Signs out and removes this phone's copy (the cloud copy stays). */
    signOut: function () {
      signingOut = true;
      clearTimeout(timer);
      try { localStorage.removeItem(META_KEY); } catch (e) { /* ignore */ }
      meta = SY.emptyMeta();
      hooks.setState(ST.defaults());
      var done = function () { session = null; signingOut = false; setStatus('idle'); };
      return (client ? client.auth.signOut({ scope: 'local' }) : Promise.resolve()).then(done, done);
    },
    /** Call after every local save. */
    changed: function () { if (meta.userId) schedule(); },
    syncNow: function () { clearTimeout(timer); return sync(); },
    status: function () { return status; },
    pending: function () { return meta.userId ? SY.pendingCount(hooks.getState(), meta) : 0; },
    lastSyncAt: function () { return meta.lastSyncAt; },
    hasSession: function () { return !!session; }
  };

  root.PRF.cloud = api;
})(window);
