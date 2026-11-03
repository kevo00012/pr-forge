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
  function where() {
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    return standalone ? 'the home-screen app' : 'the browser';
  }
  /** True when Google has just sent someone back (tokens or an error in the address). */
  function isReturn() { return /[?&](code|error)=/.test(location.search) || /(access_token|error)=/.test(location.hash); }
  function cleanUrl() {
    if (isReturn()) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    }
  }
  /** Google sent us back but no session came of it: stop waiting and say why. */
  function signInFailed(err) {
    if (session || !isReturn()) return;
    var started = null;
    try { started = JSON.parse(localStorage.getItem(STARTED_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (err && /fetch|network|load failed/i.test(String(err.message))) failure = 'Sign-in didn’t finish: couldn’t reach the sign-in server. Check your connection and try again.';
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
      if (isReturn()) {
        client.auth.initialize().then(function (r) {
          setTimeout(function () { signInFailed(r && r.error); }, 500);
        }, function (e) { signInFailed(e); });
        setTimeout(function () { signInFailed(new Error('it took too long. Check your connection')); }, 20000);
      }
      client.auth.onAuthStateChange(function (event, s) {
        // Supabase asks that no other Supabase calls run inside this callback.
        setTimeout(function () {
          if (s && (!session || s.user.id !== session.user.id || event === 'SIGNED_IN')) adoptSession(s);
          else if (s) session = s;
          else if (event === 'SIGNED_OUT' && !signingOut) { session = null; if (meta.userId) setStatus('signin'); }
          else if (!s && meta.userId && !session) setStatus(navigator.onLine ? 'signin' : 'offline');
        }, 0);
      });
      window.addEventListener('online', function () { schedule(300); });
      window.addEventListener('offline', function () { setStatus('offline'); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') schedule(300); });
    },
    /** Who this phone's data belongs to, or null if nobody has signed in. Works offline. */
    owner: function () { return meta.userId ? { userId: meta.userId, email: meta.email } : null; },
    /** True while a sign-in redirect is being finished. */
    returningFromSignIn: function () { return isReturn() && !/error/.test(location.search + location.hash); },
    /** True while the first download after signing in on this phone is running. */
    restoring: function () { return restoring; },
    signInError: function () {
      if (failure) return failure;
      var m = /[?&#]error_description=([^&]*)/.exec(location.search + location.hash);
      return m ? 'Sign-in didn’t work: ' + decodeURIComponent(m[1].replace(/\+/g, ' ')) + '. Try again.' : '';
    },
    signIn: function () {
      if (!client) return Promise.reject(new Error('Sign-in could not load. Check your connection and reload.'));
      failure = '';
      try { localStorage.setItem(STARTED_KEY, JSON.stringify({ at: new Date().toISOString(), where: where() })); } catch (e) { /* ignore */ }
      return client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname }
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
