(() => {
  const BUDAPEST = { lat: 47.4979, lng: 19.0402 };
  const EARTH = 6371000;
  const DIRS = ['észak', 'északkelet', 'kelet', 'délkelet', 'dél', 'délnyugat', 'nyugat', 'északnyugat'];

  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const profil = params.get('profil') || '';
  const prefix = profil ? `ketten:${profil}:` : 'ketten:';
  const useOffset = params.has('offset') || Boolean(profil);
  const urlCode = (params.get('code') || params.get('par') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const store = {
    get(key, fallback = '') {
      return localStorage.getItem(prefix + key) ?? fallback;
    },
    set(key, value) {
      localStorage.setItem(prefix + key, value);
    },
  };

  let deviceId = store.get('deviceId');
  if (!deviceId) {
    deviceId = 'ktt_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    store.set('deviceId', deviceId);
  }

  const state = {
    route: 'welcome',
    name: store.get('name'),
    pairCode: store.get('pairCode'),
    demo: store.get('demo') === '1',
    sharing: store.get('sharing') !== '0',
    joinCode: urlCode,
    busy: false,
    error: '',
    status: 'offline',
    you: null,
    partner: null,
    meFix: null,
    denied: false,
    settings: false,
    copied: false,
  };

  let ws = null;
  let map = null;
  let meMarker = null;
  let partnerMarker = null;
  let meCircle = null;
  let line = null;
  let watchId = null;
  let demoTimer = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let reconnectMs = 1000;
  let lastSentAt = 0;
  let didFit = false;
  let wasNear = false;
  let wakeLock = null;

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function offset(origin, meters, bearingDeg) {
    const ang = meters / EARTH;
    const br = toRad(bearingDeg);
    const lat1 = toRad(origin.lat);
    const lng1 = toRad(origin.lng);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
    const lng2 = lng1 + Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
    return { lat: toDeg(lat2), lng: toDeg(lng2) };
  }

  function offsetForDevice(origin) {
    let hash = 0;
    for (let i = 0; i < deviceId.length; i += 1) hash = (hash * 33 + deviceId.charCodeAt(i)) >>> 0;
    return offset(origin, 90 + (hash % 120), hash % 360);
  }

  function formatDistance(m) {
    if (!Number.isFinite(m)) return '—';
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
    return `${Math.round(m / 1000)} km`;
  }

  function formatAgo(ts) {
    if (!ts) return 'nincs adat';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 8) return 'épp most';
    if (s < 60) return `${s} mp`;
    const min = Math.round(s / 60);
    if (min < 60) return `${min} perce`;
    return `${Math.round(min / 60)} órája`;
  }

  function formatDir(deg) {
    if (!Number.isFinite(deg)) return '';
    return DIRS[Math.round(deg / 45) % 8];
  }

  function formatEta(meters) {
    if (!Number.isFinite(meters)) return '';
    const minutes = Math.max(1, Math.round(meters / 1.4 / 60));
    if (meters < 40) return 'már nagyon közel';
    if (minutes < 60) return `kb. ${minutes} perc gyalog`;
    return `kb. ${(minutes / 60).toFixed(1).replace('.', ',')} óra gyalog`;
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function inviteUrl() {
    const url = new URL(location.href);
    if (state.pairCode && state.pairCode !== 'PROBA') url.searchParams.set('code', state.pairCode);
    url.searchParams.delete('profil');
    url.searchParams.delete('offset');
    return url.toString();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Hiba (${res.status})`);
      return json;
    });
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/v1/ws`;
  }

  function livePartner() {
    return state.demo ? demoPartner() : state.partner;
  }

  function partnerLocation(partner) {
    return partner?.location || null;
  }

  function pinIcon(member, stale) {
    const heading = Number(member.location?.heading);
    const rotate = Number.isFinite(heading) ? heading : 0;
    return L.divIcon({
      className: 'ketten-pin',
      html: `<div class="ketten-pin-wrap${stale ? ' is-stale' : ''}" style="transform:rotate(${rotate}deg)">
        <div class="ketten-arrow"></div>
        <div class="ketten-pin-inner" style="background:${member.color};transform:rotate(${-rotate}deg)">${initials(member.name)}</div>
      </div>`,
      iconSize: [42, 54],
      iconAnchor: [21, 33],
    });
  }

  function publishedFix(fix) {
    if (!fix) return null;
    if (!useOffset) return fix;
    return { ...fix, ...offsetForDevice(fix) };
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock || state.route !== 'map') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    wakeLock.release().catch(() => undefined);
    wakeLock = null;
  }

  function connectWs() {
    disconnectWs();
    if (state.demo || !state.pairCode || state.route !== 'map') return;
    state.status = 'connecting';
    patchLive();
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      reconnectMs = 1000;
      state.status = 'online';
      state.error = '';
      ws.send(JSON.stringify({
        type: 'hello',
        pairCode: state.pairCode,
        deviceId,
        name: state.name,
      }));
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
      if (state.meFix) sendLocation(true);
      patchLive();
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'state') {
        const hadPartner = Boolean(state.partner);
        state.you = msg.you;
        state.partner = msg.partner;
        if (Boolean(state.partner) !== hadPartner) render();
        else {
          updateMap();
          patchLive();
          maybeFitFirst();
          maybeBuzz();
        }
      } else if (msg.type === 'error') {
        state.error = msg.message;
        patchLive();
      }
    };
    ws.onclose = () => {
      state.status = 'offline';
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      patchLive();
      if (state.route === 'map' && !state.demo) {
        reconnectTimer = setTimeout(connectWs, reconnectMs);
        reconnectMs = Math.min(reconnectMs * 2, 8000);
      }
    };
  }

  function disconnectWs() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  function sendLocation(force) {
    if (!ws || ws.readyState !== 1 || !state.meFix || !state.sharing || state.demo) return;
    const now = Date.now();
    if (!force && now - lastSentAt < 2000) return;
    lastSentAt = now;
    const fix = publishedFix(state.meFix);
    ws.send(JSON.stringify({
      type: 'location',
      lat: fix.lat,
      lng: fix.lng,
      heading: state.meFix.heading,
      accuracy: state.meFix.accuracy,
      sharing: true,
    }));
  }

  function startGps() {
    if (watchId != null) return;
    if (!navigator.geolocation) {
      state.denied = true;
      render();
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        state.denied = false;
        state.meFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy,
          updatedAt: Date.now(),
        };
        sendLocation(false);
        updateMap();
        patchLive();
        maybeFitFirst();
        maybeBuzz();
      },
      () => {
        state.denied = true;
        render();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }

  function stopGps() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function demoPartner() {
    const origin = publishedFix(state.meFix) || BUDAPEST;
    const br = ((Date.now() / 1000) * 18) % 360;
    const pos = offset(origin, 160, br);
    return {
      name: 'Próba',
      color: '#E85D75',
      sharing: true,
      online: true,
      location: { ...pos, heading: (br + 90) % 360, updatedAt: Date.now() },
    };
  }

  function meMember() {
    const loc = publishedFix(state.meFix);
    return {
      name: state.name || 'Én',
      color: state.you?.color || '#5B9CFF',
      sharing: state.sharing,
      location: loc,
    };
  }

  function ensureMap() {
    const el = document.getElementById('map');
    if (!el || map) return;
    map = L.map(el, { zoomControl: false, attributionControl: false })
      .setView([BUDAPEST.lat, BUDAPEST.lng], 13);
    const tiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    });
    tiles.on('tileerror', () => {
      if (map && !map._kettenOsm) {
        map._kettenOsm = true;
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      }
    });
    tiles.addTo(map);
    setTimeout(() => map && map.invalidateSize(), 80);
  }

  function updateMap() {
    if (!map) return;
    const me = meMember();
    const partner = livePartner();
    const partnerLoc = partnerLocation(partner);
    const stale = Boolean(partnerLoc && partner && !partner.sharing);

    if (me.location) {
      const ll = [me.location.lat, me.location.lng];
      if (!meMarker) meMarker = L.marker(ll, { icon: pinIcon(me, false) }).addTo(map);
      else {
        meMarker.setLatLng(ll);
        meMarker.setIcon(pinIcon(me, false));
      }
      const radius = Math.max(12, Number(state.meFix?.accuracy) || 20);
      if (!meCircle) {
        meCircle = L.circle(ll, {
          radius,
          color: '#5B9CFF',
          weight: 1,
          fillColor: '#5B9CFF',
          fillOpacity: 0.1,
        }).addTo(map);
      } else {
        meCircle.setLatLng(ll);
        meCircle.setRadius(radius);
      }
    }

    if (partnerLoc && partner) {
      const ll = [partnerLoc.lat, partnerLoc.lng];
      if (!partnerMarker) partnerMarker = L.marker(ll, { icon: pinIcon(partner, stale) }).addTo(map);
      else {
        partnerMarker.setLatLng(ll);
        partnerMarker.setIcon(pinIcon(partner, stale));
      }
    } else if (partnerMarker) {
      partnerMarker.remove();
      partnerMarker = null;
    }

    if (me.location && partnerLoc) {
      const latlngs = [[me.location.lat, me.location.lng], [partnerLoc.lat, partnerLoc.lng]];
      if (!line) line = L.polyline(latlngs, { color: '#F3BF35', weight: 2, dashArray: '6 8', opacity: 0.7 }).addTo(map);
      else line.setLatLngs(latlngs);
    } else if (line) {
      line.remove();
      line = null;
    }
  }

  function focusMe() {
    const loc = publishedFix(state.meFix);
    if (loc && map) map.panTo([loc.lat, loc.lng]);
  }

  function focusPartner() {
    const loc = partnerLocation(livePartner());
    if (loc && map) map.panTo([loc.lat, loc.lng]);
  }

  function focusBoth() {
    const me = publishedFix(state.meFix);
    const partner = partnerLocation(livePartner());
    if (me && partner && map) {
      map.fitBounds([[me.lat, me.lng], [partner.lat, partner.lng]], {
        padding: [90, 90],
        maxZoom: 16,
      });
    } else if (me && map) map.panTo([me.lat, me.lng]);
  }

  function maybeFitFirst() {
    if (didFit) return;
    const me = publishedFix(state.meFix);
    const partner = partnerLocation(livePartner());
    if (!me || !partner || !map) return;
    didFit = true;
    focusBoth();
  }

  function maybeBuzz() {
    const me = publishedFix(state.meFix);
    const partner = livePartner();
    const loc = partner?.sharing ? partnerLocation(partner) : null;
    if (!me || !loc) {
      wasNear = false;
      return;
    }
    const dist = haversine(me, loc);
    if (dist < 50) {
      if (!wasNear && navigator.vibrate) navigator.vibrate([40, 60, 40]);
      wasNear = true;
    } else {
      wasNear = false;
    }
  }

  function navigateToPartner() {
    const loc = partnerLocation(livePartner());
    if (!loc) return;
    const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
    const dest = `${loc.lat},${loc.lng}`;
    const href = apple
      ? `https://maps.apple.com/?daddr=${dest}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  function persist() {
    store.set('name', state.name);
    store.set('pairCode', state.pairCode || '');
    store.set('demo', state.demo ? '1' : '0');
    store.set('sharing', state.sharing ? '1' : '0');
  }

  async function createPair() {
    state.busy = true;
    state.error = '';
    render();
    try {
      const result = await api('/v1/pairs', { deviceId, name: state.name });
      enterMap(result.pairCode, false);
    } catch (err) {
      state.error = err.message || 'Nem sikerült. A relé nem elérhető.';
    } finally {
      state.busy = false;
      render();
    }
  }

  async function joinPair() {
    state.busy = true;
    state.error = '';
    render();
    try {
      const result = await api('/v1/pairs/join', {
        deviceId,
        name: state.name,
        code: state.joinCode,
      });
      enterMap(result.pairCode, false);
    } catch (err) {
      state.error = err.message || 'Nem sikerült csatlakozni.';
    } finally {
      state.busy = false;
      render();
    }
  }

  function enterMap(pairCode, demo) {
    state.pairCode = pairCode;
    state.demo = demo;
    state.route = 'map';
    state.settings = false;
    didFit = false;
    wasNear = false;
    persist();
    startGps();
    requestWakeLock();
    if (demo) {
      if (demoTimer) clearInterval(demoTimer);
      demoTimer = setInterval(() => {
        updateMap();
        patchLive();
      }, 2000);
    } else {
      connectWs();
    }
  }

  function startDemo() {
    enterMap('PROBA', true);
    render();
  }

  async function leavePair() {
    if (state.pairCode && !state.demo) {
      try { await api('/v1/pairs/leave', { deviceId, code: state.pairCode }); } catch { /* ignore */ }
    }
    disconnectWs();
    stopGps();
    releaseWakeLock();
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
    if (map) {
      map.remove();
      map = null;
    }
    meMarker = null;
    partnerMarker = null;
    meCircle = null;
    line = null;
    state.pairCode = '';
    state.demo = false;
    state.partner = null;
    state.you = null;
    state.settings = false;
    state.status = 'offline';
    state.route = 'pair';
    didFit = false;
    persist();
    render();
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function liveSnapshot() {
    const partner = livePartner();
    const partnerLoc = partnerLocation(partner);
    const me = publishedFix(state.meFix);
    const dist = me && partnerLoc ? haversine(me, partnerLoc) : null;
    const dir = me && partnerLoc ? formatDir(bearing(me, partnerLoc)) : '';
    return {
      partner,
      partnerLoc,
      dist,
      dir,
      eta: dist == null ? '' : formatEta(dist),
      distanceText: dist == null ? '—' : formatDistance(dist),
      statusLabel: state.demo
        ? 'Próba mód'
        : state.status === 'online'
          ? 'Élő kapcsolat'
          : state.status === 'connecting'
            ? 'Csatlakozás…'
            : 'Nincs kapcsolat',
      waiting: !state.demo && !partner,
      stale: Boolean(partner && partnerLoc && !partner.sharing),
    };
  }

  function patchLive() {
    if (state.route !== 'map') return;
    if (!document.getElementById('live-status')) {
      render();
      return;
    }
    const snap = liveSnapshot();
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('live-status', snap.statusLabel);
    set('live-distance', snap.distanceText);
    set('live-eta', snap.eta ? `${snap.dir ? snap.dir + ' · ' : ''}${snap.eta}` : 'köztetek');
    set('live-name', snap.partner?.name || 'A párod még nincs itt');
    const meta = snap.partnerLoc
      ? `${snap.stale ? 'Utolsó ismert: ' : 'Utoljára '}${formatAgo(snap.partnerLoc.updatedAt)}${snap.partner?.online ? ' · online' : snap.partner ? ' · nem élő' : ''}`
      : 'Még nincs helyzet';
    set('live-meta', meta);
    const avatar = document.getElementById('live-avatar');
    if (avatar) avatar.style.background = snap.partner?.color || '#E85D75';
    const wait = document.getElementById('wait-card');
    if (wait) wait.hidden = !snap.waiting;
    const warn = document.getElementById('gps-warn');
    if (warn) warn.hidden = !state.denied;
    const nav = document.getElementById('navigate');
    if (nav) nav.disabled = !snap.partnerLoc;
    const them = document.getElementById('them');
    if (them) them.disabled = !snap.partnerLoc;
    if (snap.waiting && state.pairCode) set('live-code', state.pairCode);
  }

  function bindMapControls() {
    document.getElementById('settings').onclick = () => { state.settings = true; render(); };
    const shareToggle = document.getElementById('sharing');
    if (shareToggle) {
      shareToggle.onchange = () => {
        state.sharing = shareToggle.checked;
        persist();
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sharing', sharing: state.sharing }));
        if (state.sharing) sendLocation(true);
        patchLive();
      };
    }
    document.getElementById('me').onclick = focusMe;
    document.getElementById('them').onclick = focusPartner;
    document.getElementById('both').onclick = focusBoth;
    const nav = document.getElementById('navigate');
    if (nav) nav.onclick = navigateToPartner;
    const copy = document.getElementById('copy');
    if (copy) {
      copy.onclick = async () => {
        const ok = await copyText(state.pairCode);
        state.copied = ok;
        render();
      };
    }
    const share = document.getElementById('share');
    if (share) {
      share.onclick = async () => {
        const text = `Csatlakozz a Kettenhez: ${inviteUrl()}`;
        try {
          if (navigator.share) await navigator.share({ title: 'Ketten', text, url: inviteUrl() });
          else await copyText(text);
        } catch { /* user cancelled */ }
      };
    }
    const leave = document.getElementById('leave');
    if (leave) leave.onclick = leavePair;
    const close = document.getElementById('close');
    if (close) close.onclick = () => { state.settings = false; render(); };
    const saveName = document.getElementById('save-name');
    if (saveName) {
      saveName.onclick = () => {
        const input = document.getElementById('settings-name');
        const next = (input?.value || '').trim();
        if (next.length >= 2) {
          state.name = next;
          persist();
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'hello',
              pairCode: state.pairCode,
              deviceId,
              name: state.name,
            }));
          }
        }
        state.settings = false;
        render();
      };
    }
  }

  function mapOverlaysHtml() {
    const snap = liveSnapshot();
    return `
      <div class="topbar">
        <div class="pill" id="live-status">${esc(snap.statusLabel)}</div>
        <button class="gear" id="settings" type="button">Beállítások</button>
      </div>
      <div class="wait" id="wait-card" ${snap.waiting ? '' : 'hidden'}>
        <div class="kicker">VÁROD A PÁRODAT</div>
        <div class="code" id="live-code">${esc(state.pairCode)}</div>
        <p class="sub" style="margin:0">Küldd el neki a kódot vagy a meghívó linket. Ugyanezt a címet nyissa meg.</p>
        <div class="row">
          <button class="btn btn-card" id="copy" type="button">${state.copied ? 'Másolva' : 'Kód másolása'}</button>
          <button class="btn btn-card" id="share" type="button">Meghívó küldése</button>
        </div>
      </div>
      <div class="warn" id="gps-warn" ${state.denied ? '' : 'hidden'}>A helyzethez engedély kell. Engedélyezd a helymeghatározást a böngészőben.</div>
      <div class="sheet">
        <div class="person">
          <div class="avatar" id="live-avatar" style="background:${esc(snap.partner?.color || '#E85D75')}"></div>
          <div>
            <strong id="live-name">${esc(snap.partner?.name || 'A párod még nincs itt')}</strong>
            <span id="live-meta">${snap.partnerLoc
              ? `${snap.stale ? 'Utolsó ismert: ' : 'Utoljára '}${formatAgo(snap.partnerLoc.updatedAt)}${snap.partner?.online ? ' · online' : snap.partner ? ' · nem élő' : ''}`
              : 'Még nincs helyzet'}</span>
          </div>
          <div class="dist">
            <b id="live-distance">${esc(snap.distanceText)}</b>
            <div class="eta" id="live-eta">${esc(snap.eta ? `${snap.dir ? snap.dir + ' · ' : ''}${snap.eta}` : 'köztetek')}</div>
          </div>
        </div>
        <div class="share">
          <div>
            <strong>${state.sharing ? 'A helyzeted látszik' : 'A helyzeted rejtve'}</strong>
            <p>${state.sharing ? 'A párod élőben követhet a térképen.' : 'Most csak te látod a párod.'}</p>
          </div>
          <input id="sharing" type="checkbox" ${state.sharing ? 'checked' : ''}/>
        </div>
        <div class="row">
          <button class="btn btn-card" id="me" type="button">Én</button>
          <button class="btn btn-card" id="them" type="button" ${snap.partnerLoc ? '' : 'disabled'}>Párod</button>
          <button class="btn btn-card" id="both" type="button">Mindkettő</button>
        </div>
        <button class="btn btn-gold" id="navigate" type="button" ${snap.partnerLoc ? '' : 'disabled'}>Navigáció a párodhoz</button>
      </div>
      ${state.settings ? `
        <div class="modal" id="modal">
          <div class="modal-card">
            <h1 style="font-size:1.5rem">Beállítások</h1>
            <label>A neved</label>
            <input id="settings-name" type="text" value="${esc(state.name)}" maxlength="32"/>
            <label>Párkód</label>
            <div class="code">${esc(state.pairCode || 'próba')}</div>
            <p class="sub">Meghívó: ${esc(state.demo ? location.href : inviteUrl())}</p>
            <button class="btn btn-gold" id="save-name" type="button">Mentés</button>
            <button class="btn leave" id="leave" type="button">Kilépés a párból</button>
            <button class="btn btn-card" id="close" type="button">Bezárás</button>
          </div>
        </div>` : ''}
    `;
  }

  function render() {
    if (state.route === 'welcome') {
      app.innerHTML = `
        <section class="screen">
          <div class="kicker">KÖLCSÖNÖS HELYZET</div>
          <h1>Ketten</h1>
          <p class="sub">Nyisd meg ezt a címet mindkét telefonon. Az egyik létrehoz egy párt, a másik a kóddal vagy a meghívó linkkel csatlakozik.</p>
          <label>Hogy hívnak?</label>
          <input id="name" type="text" value="${esc(state.name)}" placeholder="Például Anna" autocomplete="name"/>
          <button class="btn btn-gold" id="go" ${state.name.trim().length < 2 ? 'disabled' : ''}>Tovább</button>
        </section>`;
      const input = document.getElementById('name');
      input.focus();
      input.addEventListener('input', () => {
        state.name = input.value;
        document.getElementById('go').disabled = state.name.trim().length < 2;
      });
      document.getElementById('go').onclick = () => {
        state.name = state.name.trim();
        persist();
        state.route = 'pair';
        render();
      };
      return;
    }

    if (state.route === 'pair') {
      app.innerHTML = `
        <section class="screen">
          <h1>Párosítás</h1>
          <p class="sub">${urlCode
            ? 'Meghívó linkkel jöttél. Ellenőrizd a kódot, és csatlakozz.'
            : 'Az egyikőtök létrehoz egy párt, a másik begépeli a 6 karakteres kódot.'}</p>
          <button class="btn btn-gold" id="create" ${state.busy ? 'disabled' : ''}>Pár létrehozása</button>
          <div class="or">vagy csatlakozás kóddal</div>
          <input id="code" class="code-input" type="text" maxlength="8" placeholder="ABC123" value="${esc(state.joinCode)}" autocomplete="off"/>
          <button class="btn btn-card" id="join" ${state.busy || state.joinCode.trim().length < 6 ? 'disabled' : ''}>Csatlakozás</button>
          ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
          <div class="demo">
            <strong>Egyedül próbálnád?</strong>
            <p>A próba térkép egy sétáló partnert mutat, relé nélkül.</p>
            <button class="link" id="demo" type="button">Próba térkép</button>
          </div>
        </section>`;
      document.getElementById('create').onclick = createPair;
      const code = document.getElementById('code');
      code.addEventListener('input', () => {
        state.joinCode = code.value.toUpperCase();
        document.getElementById('join').disabled = state.busy || state.joinCode.trim().length < 6;
      });
      document.getElementById('join').onclick = joinPair;
      document.getElementById('demo').onclick = startDemo;
      return;
    }

    const mapEl = document.getElementById('map');
    if (!mapEl) {
      app.innerHTML = `<div class="map-wrap"><div id="map"></div><div id="overlays"></div></div>`;
      map = null;
      meMarker = null;
      partnerMarker = null;
      meCircle = null;
      line = null;
    }
    document.getElementById('overlays').innerHTML = mapOverlaysHtml();
    bindMapControls();
    ensureMap();
    updateMap();
    maybeFitFirst();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.route === 'map') {
      requestWakeLock();
      if (!state.demo && state.status !== 'online') connectWs();
    }
  });

  if (state.name && (state.pairCode || state.demo)) {
    enterMap(state.pairCode || 'PROBA', state.demo);
    render();
  } else if (state.name) {
    state.route = 'pair';
    if (urlCode.length === 6) {
      state.joinCode = urlCode;
      joinPair();
    } else {
      render();
    }
  } else {
    render();
  }
})();
