(() => {
  const BUDAPEST = { lat: 47.4979, lng: 19.0402 };
  const EARTH = 6371000;

  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const profil = params.get('profil') || '';
  const prefix = profil ? `ketten:${profil}:` : 'ketten:';

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
    joinCode: '',
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
  let line = null;
  let watchId = null;
  let demoTimer = null;
  let pingTimer = null;

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
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

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
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

  function pinIcon(member) {
    return L.divIcon({
      className: 'ketten-pin',
      html: `<div class="ketten-pin-inner" style="background:${member.color}">${initials(member.name)}</div>`,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
  }

  function connectWs() {
    disconnectWs();
    if (state.demo || !state.pairCode) return;
    state.status = 'connecting';
    render();
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
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
      render();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        state.you = msg.you;
        state.partner = msg.partner;
        updateMap();
        render();
      } else if (msg.type === 'error') {
        state.error = msg.message;
        render();
      }
    };
    ws.onclose = () => {
      state.status = 'offline';
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      render();
      if (state.route === 'map' && !state.demo) {
        setTimeout(connectWs, 1500);
      }
    };
  }

  function disconnectWs() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  function sendLocation() {
    if (!ws || ws.readyState !== 1 || !state.meFix || !state.sharing || state.demo) return;
    ws.send(JSON.stringify({
      type: 'location',
      lat: state.meFix.lat,
      lng: state.meFix.lng,
      heading: state.meFix.heading,
      accuracy: state.meFix.accuracy,
      sharing: true,
    }));
  }

  function startGps() {
    if (!navigator.geolocation) {
      state.denied = true;
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
        sendLocation();
        updateMap();
        render();
      },
      () => {
        state.denied = true;
        render();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
  }

  function stopGps() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function demoPartner() {
    const origin = state.meFix || BUDAPEST;
    const bearing = ((Date.now() / 1000) * 18) % 360;
    const pos = offset(origin, 160, bearing);
    return {
      name: 'Próba',
      color: '#E85D75',
      sharing: true,
      online: true,
      location: { ...pos, updatedAt: Date.now() },
    };
  }

  function meMember() {
    return {
      name: state.name || 'Én',
      color: state.you?.color || '#5B9CFF',
      sharing: state.sharing,
      location: state.meFix,
    };
  }

  function ensureMap() {
    const el = document.getElementById('map');
    if (!el || map) return;
    map = L.map(el, { zoomControl: false, attributionControl: false })
      .setView([BUDAPEST.lat, BUDAPEST.lng], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
  }

  function updateMap() {
    if (!map) return;
    const me = meMember();
    const partner = state.demo ? demoPartner() : state.partner;
    const partnerLoc = partner?.sharing ? partner.location : null;

    if (me.location) {
      const ll = [me.location.lat, me.location.lng];
      if (!meMarker) meMarker = L.marker(ll, { icon: pinIcon(me) }).addTo(map);
      else {
        meMarker.setLatLng(ll);
        meMarker.setIcon(pinIcon(me));
      }
    }
    if (partnerLoc && partner) {
      const ll = [partnerLoc.lat, partnerLoc.lng];
      if (!partnerMarker) partnerMarker = L.marker(ll, { icon: pinIcon(partner) }).addTo(map);
      else {
        partnerMarker.setLatLng(ll);
        partnerMarker.setIcon(pinIcon(partner));
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

  function focusBoth() {
    const me = state.meFix;
    const partner = (state.demo ? demoPartner() : state.partner)?.location;
    if (me && partner && map) {
      map.fitBounds([[me.lat, me.lng], [partner.lat, partner.lng]], { padding: [80, 80] });
    } else if (me && map) map.panTo([me.lat, me.lng]);
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
      state.pairCode = result.pairCode;
      state.demo = false;
      state.route = 'map';
      persist();
      connectWs();
      startGps();
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
      state.pairCode = result.pairCode;
      state.demo = false;
      state.route = 'map';
      persist();
      connectWs();
      startGps();
    } catch (err) {
      state.error = err.message || 'Nem sikerült csatlakozni.';
    } finally {
      state.busy = false;
      render();
    }
  }

  function startDemo() {
    state.demo = true;
    state.pairCode = 'PROBA';
    state.route = 'map';
    persist();
    startGps();
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = setInterval(() => {
      updateMap();
      render();
    }, 2000);
    render();
  }

  async function leavePair() {
    if (state.pairCode && !state.demo) {
      try { await api('/v1/pairs/leave', { deviceId, code: state.pairCode }); } catch {}
    }
    disconnectWs();
    stopGps();
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
    map = null;
    meMarker = null;
    partnerMarker = null;
    line = null;
    state.pairCode = '';
    state.demo = false;
    state.partner = null;
    state.settings = false;
    state.route = 'pair';
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

  function bindMapControls() {
    document.getElementById('settings').onclick = () => { state.settings = true; render(); };
    const shareToggle = document.getElementById('sharing');
    if (shareToggle) {
      shareToggle.onchange = () => {
        state.sharing = shareToggle.checked;
        persist();
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sharing', sharing: state.sharing }));
        render();
      };
    }
    document.getElementById('me').onclick = () => {
      if (state.meFix && map) map.panTo([state.meFix.lat, state.meFix.lng]);
    };
    document.getElementById('them').onclick = () => {
      const loc = (state.demo ? demoPartner() : state.partner)?.location;
      if (loc && map) map.panTo([loc.lat, loc.lng]);
    };
    document.getElementById('both').onclick = focusBoth;
    const copy = document.getElementById('copy');
    if (copy) {
      copy.onclick = async () => {
        await navigator.clipboard.writeText(state.pairCode);
        state.copied = true;
        render();
      };
    }
    const share = document.getElementById('share');
    if (share) {
      share.onclick = async () => {
        const text = `Csatlakozz a Kettenhez. Nyisd meg: ${location.href} Kód: ${state.pairCode}`;
        try {
          if (navigator.share) await navigator.share({ text });
          else await navigator.clipboard.writeText(text);
        } catch {}
      };
    }
    const leave = document.getElementById('leave');
    if (leave) leave.onclick = leavePair;
    const close = document.getElementById('close');
    if (close) close.onclick = () => { state.settings = false; render(); };
  }

  function mapOverlaysHtml() {
    const partner = state.demo ? demoPartner() : state.partner;
    const partnerLoc = partner?.sharing ? partner.location : null;
    const distance = state.meFix && partnerLoc ? formatDistance(haversine(state.meFix, partnerLoc)) : '—';
    const statusLabel = state.demo ? 'Próba mód' : state.status === 'online' ? 'Élő kapcsolat' : state.status === 'connecting' ? 'Csatlakozás…' : 'Nincs kapcsolat';
    const waiting = !state.demo && !partner;
    return `
      <div class="topbar">
        <div class="pill">${esc(statusLabel)}</div>
        <button class="gear" id="settings">Beállítások</button>
      </div>
      ${waiting ? `
        <div class="wait">
          <div class="kicker">VÁROD A PÁRODAT</div>
          <div class="code">${esc(state.pairCode)}</div>
          <p class="sub" style="margin:0">Küldd el neki ezt a kódot. Ugyanezt a címet nyissa meg a telefonján.</p>
          <div class="row">
            <button class="btn btn-card" id="copy">${state.copied ? 'Másolva' : 'Kód másolása'}</button>
            <button class="btn btn-card" id="share">Küldés</button>
          </div>
        </div>` : ''}
      ${state.denied ? `<div class="warn">A helyzethez engedély kell. Engedélyezd a helymeghatározást a böngészőben.</div>` : ''}
      <div class="sheet">
        <div class="person">
          <div class="avatar" style="background:${esc(partner?.color || '#E85D75')}"></div>
          <div>
            <strong>${esc(partner?.name || 'A párod még nincs itt')}</strong>
            <span>${partnerLoc ? `Utoljára ${formatAgo(partnerLoc.updatedAt)}` : 'Még nincs helyzet'}${partner?.online ? ' · online' : partner ? ' · nem élő' : ''}</span>
          </div>
          <div class="dist"><b>${esc(distance)}</b><div class="kicker">köztetek</div></div>
        </div>
        <div class="share">
          <div>
            <strong>${state.sharing ? 'A helyzeted látszik' : 'A helyzeted rejtve'}</strong>
            <p>${state.sharing ? 'A párod élőben követhet a térképen.' : 'Most csak te látod a párod.'}</p>
          </div>
          <input id="sharing" type="checkbox" ${state.sharing ? 'checked' : ''}/>
        </div>
        <div class="row">
          <button class="btn btn-card" id="me">Én</button>
          <button class="btn btn-card" id="them">Párod</button>
          <button class="btn btn-card" id="both">Mindkettő</button>
        </div>
      </div>
      ${state.settings ? `
        <div class="modal" id="modal">
          <div class="modal-card">
            <h1 style="font-size:1.5rem">Beállítások</h1>
            <label>Párkód</label>
            <div class="code">${esc(state.pairCode || 'próba')}</div>
            <p class="sub">Nyissátok meg mindketten ezt a címet, és használjátok ugyanezt a kódot.</p>
            <button class="btn leave" id="leave">Kilépés a párból</button>
            <button class="btn btn-card" id="close">Bezárás</button>
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
          <p class="sub">Nyisd meg ezt a címet mindkét telefonon. Az egyik létrehoz egy párt, a másik a kóddal csatlakozik.</p>
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
          <p class="sub">Az egyikőtök létrehoz egy párt, a másik begépeli a 6 karakteres kódot.</p>
          <button class="btn btn-gold" id="create" ${state.busy ? 'disabled' : ''}>Pár létrehozása</button>
          <div class="or">vagy csatlakozás kóddal</div>
          <input id="code" class="code-input" type="text" maxlength="8" placeholder="ABC123" value="${esc(state.joinCode)}"/>
          <button class="btn btn-card" id="join" ${state.busy || state.joinCode.trim().length < 6 ? 'disabled' : ''}>Csatlakozás</button>
          ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}
          <div class="demo">
            <strong>Egyedül próbálnád?</strong>
            <p>A próba térkép egy sétáló partnert mutat, relé nélkül.</p>
            <button class="link" id="demo">Próba térkép</button>
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
      line = null;
    }
    document.getElementById('overlays').innerHTML = mapOverlaysHtml();
    bindMapControls();
    ensureMap();
    updateMap();
  }

  if (state.name && (state.pairCode || state.demo)) {
    state.route = 'map';
    render();
    if (state.demo) startDemo();
    else {
      startGps();
      connectWs();
    }
  } else if (state.name) {
    state.route = 'pair';
    render();
  } else {
    render();
  }
})();
