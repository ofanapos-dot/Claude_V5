/**
 * SIMOPHI — Monitoring Pos Hujan (antarmuka v3)
 * app.js — sinkron dengan output/latest.json & output/series_harian.json
 *
 * Alur kerja:
 *  Peta + daftar pos (satu tampilan) -> klik pos -> panel detail (riwayat, pembanding, konfirmasi)
 *  Keaktifan Pos = tabel/ringkasan | Perlu Konfirmasi = antrean kerja | Korelasi = bandingkan 2 pos
 */

const CONFIG = {
  DATA_URL: 'output/latest.json',
  SERIES_URL: 'output/series_harian.json',
  MAP_CENTER: [-0.7399, 100.8000],
  MAP_ZOOM: 8,
  TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTR: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

const state = {
  dataRaw: null, posHujan: [], paramQc: {},
  map: null, markerLayer: null, markers: {},
  selected: null,
  filter: new Set(),       // kunci: aktif | kurang | jarang | tidak | pk
  q: '', sort: 'perhatian',
  tabAktif: 'peta',
  pkFilter: 'semua',
  tbl: { sort: 'hari', dir: -1, q: '', kab: '', tipe: '' },
  konfirmasi: [],
  series: null, seriesLoading: null, korPref: null,
  chartKeaktifan: null, chartKorLine: null, chartKorScatter: null,
};

const el      = id => document.getElementById(id);
const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
const esc     = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
const lebarSedang = () => window.matchMedia('(min-width: 768px) and (max-width: 1179px)').matches;
const TIPE_LABEL = { pos_kerjasama: 'Pos Kerjasama', otomatis: 'Alat Otomatis', bmkg: 'BMKG' };

let toastTimer;
function toast(msg) {
  const t = el('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- klasifikasi ----------
const KEL = [
  { key: 'aktif',  label: 'Aktif',        rentang: '0–10 hari',  warna: '#22c55e', tx: 'var(--ok-tx)',     maks: 10 },
  { key: 'kurang', label: 'Kurang aktif', rentang: '11–20 hari', warna: '#eab308', tx: 'var(--kuning-tx)', maks: 20 },
  { key: 'jarang', label: 'Jarang lapor', rentang: '21–30 hari', warna: '#f97316', tx: 'var(--jingga-tx)', maks: 30 },
  { key: 'tidak',  label: 'Tidak aktif',  rentang: '>30 hari',   warna: '#ef4444', tx: 'var(--merah-tx)',  maks: Infinity },
];
function keaktifanInfo(hari) {
  const h = (hari === null || hari === undefined) ? 999 : hari;
  const k = KEL.find(x => h <= x.maks);
  return { ...k, rentang: h >= 999 ? 'belum pernah lapor' : k.rentang };
}
const isK1 = p => p.status === 'PERLU_KONFIRMASI';
const isK2 = p => p.status_ekstrem_30hari === 'PERLU_KONFIRMASI';
const isPK = p => isK1(p) || isK2(p);

function kategoriTampil(mm) {
  if (mm === null || mm === undefined || isNaN(mm)) return 'Tidak ada data';
  if (mm === 0) return 'Tidak hujan';
  if (mm < 5) return 'Sangat ringan';
  if (mm < 20) return 'Ringan';
  if (mm < 50) return 'Sedang';
  if (mm < 100) return 'Lebat';
  if (mm <= 150) return 'Sangat lebat';
  return 'Ekstrem';
}
const fmtTgl = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const dotHTML = p => isPK(p) ? `<span class="dot pk" title="Perlu konfirmasi" style="background:${keaktifanInfo(p.hari_terakhir_kirim).warna}"></span>` : `<span class="dot" style="background:${keaktifanInfo(p.hari_terakhir_kirim).warna}"></span>`;
const hariTeks = h => (h === null || h === undefined || h >= 999) ? 'Belum pernah' : h === 0 ? 'Hari ini' : `${h} hari lalu`;

// ---------- navigasi ----------
const VIEWS = ['statistik', 'suspect', 'korelasi'];

function ganti(tab) {
  const view = VIEWS.includes(tab);
  if (view && state.tabAktif === tab && el(`panel-${tab}`)?.classList.contains('aktif')) { tutupPanel(); return; }
  state.tabAktif = tab;
  document.querySelectorAll('.nav-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  VIEWS.forEach(t => el(`panel-${t}`)?.classList.toggle('aktif', t === tab));
  if (view && isMobile()) tutupDetail();
  if (tab === 'statistik' && state.posHujan.length) { renderChartKeaktifan(state.posHujan); }
  if (tab === 'korelasi') initKorelasiTab();
  if (tab === 'peta' && state.map) setTimeout(() => state.map.invalidateSize(), 50);
  setHash();
}
function tutupPanel() { ganti('peta'); }

function setHash() {
  const parts = [];
  if (state.tabAktif !== 'peta') parts.push('tab=' + state.tabAktif);
  if (state.selected) parts.push('pos=' + state.selected);
  try { history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search); } catch (e) {}
}
function bacaHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const pos = h.get('pos'), tab = h.get('tab');
  if (tab && VIEWS.includes(tab)) ganti(tab);
  if (pos && state.posHujan.some(p => p.id_pos === pos)) selectPos(pos, { zoom: false });
}

// ---------- peta ----------
function initMap() {
  if (!el('map') || !window.L) return;
  state.map = L.map('map', { center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM, zoomControl: false, attributionControl: true });
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  L.tileLayer(CONFIG.TILE_URL, { attribution: CONFIG.TILE_ATTR, maxZoom: 19, className: 'tile-redup' }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  state.map.on('click', () => { if (state.selected) tutupDetail(); });
}

function buatMarker(pos) {
  const pk = isPK(pos);
  const size = pk ? 22 : 16;
  const { warna } = keaktifanInfo(pos.hari_terakhir_kirim);
  const border = pk ? '3px solid #0f172a' : '2px solid rgba(255,255,255,.9)';
  const icon = L.divIcon({
    className: 'mk',
    html: `<div class="marker-dot ${pk ? 'marker-pk' : ''}" style="width:${size}px;height:${size}px;background:${warna};border:${border}"></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
  const m = L.marker([pos.latitude, pos.longitude], { icon, keyboard: true, title: pos.nama_pos, riseOnHover: true });
  m.bindTooltip(esc(pos.nama_pos), { direction: 'top', offset: [0, -size / 2] });
  m.on('click', ev => { if (ev.originalEvent) L.DomEvent.stopPropagation(ev); selectPos(pos.id_pos, { zoom: false, dari: 'peta' }); });
  return m;
}

function renderMarkers() {
  if (!state.map) return;
  state.markerLayer.clearLayers();
  state.markers = {};
  state.posHujan.forEach(p => { state.markers[p.id_pos] = buatMarker(p); });
  terapkanFilter();
}

function tandaiTerpilih() {
  Object.entries(state.markers).forEach(([id, m]) => m.getElement()?.classList.toggle('sel', id === state.selected));
}

function posTampil() {
  const q = state.q.trim().toLowerCase();
  return state.posHujan.filter(p => {
    if (q && !(p.nama_pos.toLowerCase().includes(q) || (p.kabupaten || '').toLowerCase().includes(q) || p.id_pos.toLowerCase().includes(q))) return false;
    if (state.filter.size) {
      const k = keaktifanInfo(p.hari_terakhir_kirim).key;
      const cocok = state.filter.has(k) || (state.filter.has('pk') && isPK(p));
      if (!cocok) return false;
    }
    return true;
  });
}

function terapkanFilter() {
  const tampil = new Set(posTampil().map(p => p.id_pos));
  if (state.markerLayer) {
    state.posHujan.forEach(p => {
      const m = state.markers[p.id_pos];
      if (!m) return;
      const ada = state.markerLayer.hasLayer(m);
      if (tampil.has(p.id_pos) && !ada) state.markerLayer.addLayer(m);
      if (!tampil.has(p.id_pos) && ada) state.markerLayer.removeLayer(m);
    });
  }
  renderFilterbar(); renderList(); tandaiTerpilih();
}

function fitSemua() {
  if (!state.map) return;
  const pts = posTampil().filter(p => p.latitude && p.longitude).map(p => [p.latitude, p.longitude]);
  if (!pts.length) return;
  const sb = (!isMobile() && !lebarSedang()) ? 360 : 20;
  state.map.fitBounds(pts, { paddingTopLeft: [sb, 70], paddingBottomRight: [30, isMobile() ? 150 : 30], maxZoom: 12 });
}

// Pusatkan peta pada pos, memperhitungkan panel yang menutupi sebagian peta
function pusatkanPada(pos, zoom) {
  if (!state.map) return;
  const z = zoom ? Math.max(state.map.getZoom(), 12) : state.map.getZoom();
  const stage = el('stage').getBoundingClientRect();
  const dpl = 360 / (256 * Math.pow(2, z));          // derajat bujur per piksel
  const dpt = dpl * Math.cos(pos.latitude * Math.PI / 180);
  let dx = 0, dy = 0;
  if (isMobile()) dy = -(stage.height * 0.62) / 2 + 30;
  else if (lebarSedang()) dx = -420 / 2;
  else dx = (360 - 420) / 2;
  state.map.flyTo([pos.latitude + dy * dpt, pos.longitude - dx * dpl], z, { duration: .6 });
}

// ---------- filter, ringkasan, daftar ----------
function hitungKelompok() {
  const c = { aktif: 0, kurang: 0, jarang: 0, tidak: 0, pk: 0 };
  state.posHujan.forEach(p => { c[keaktifanInfo(p.hari_terakhir_kirim).key]++; if (isPK(p)) c.pk++; });
  return c;
}

function renderFilterbar() {
  const c = hitungKelompok();
  const bar = el('filterbar'); if (!bar) return;
  bar.classList.toggle('ada-filter', state.filter.size > 0);
  bar.innerHTML = KEL.map(k => `
    <button class="chip" data-f="${k.key}" aria-pressed="${state.filter.has(k.key)}" title="${k.label} (${k.rentang})">
      <span class="dot" style="background:${k.warna}"></span>${k.label}<b>${c[k.key]}</b><small>${k.rentang}</small>
    </button>`).join('') + `
    <button class="chip" data-f="pk" aria-pressed="${state.filter.has('pk')}" title="Border hitam berkedip di peta">
      <span class="dot pk"></span>Perlu konfirmasi<b>${c.pk}</b>
    </button>`;
  const mix = el('mixbar');
  if (mix) mix.innerHTML = KEL.map(k => `<i style="flex:${c[k.key] || 0.0001};background:${k.warna}" title="${k.label}: ${c[k.key]}"></i>`).join('');
}

function urutkan(list) {
  const s = state.sort;
  const L = [...list];
  if (s === 'nama') return L.sort((a, b) => a.nama_pos.localeCompare(b.nama_pos));
  if (s === 'hari') return L.sort((a, b) => (b.hari_terakhir_kirim ?? 999) - (a.hari_terakhir_kirim ?? 999));
  if (s === 'aktif') return L.sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0));
  const bobot = p => (isPK(p) ? 1000 : 0) + Math.min(p.hari_terakhir_kirim ?? 999, 999);
  return L.sort((a, b) => bobot(b) - bobot(a) || a.nama_pos.localeCompare(b.nama_pos));
}

function renderList() {
  const box = el('posList'); if (!box) return;
  const list = urutkan(posTampil());
  setText('listCount', `${list.length} dari ${state.posHujan.length} pos`);
  if (!list.length) {
    box.innerHTML = `<li class="list-kosong">Tidak ada pos yang cocok.<br><button onclick="resetFilter()">Hapus pencarian dan filter</button></li>`;
    return;
  }
  box.innerHTML = list.map(p => {
    const k = keaktifanInfo(p.hari_terakhir_kirim);
    return `<li><button class="pos-item ${p.id_pos === state.selected ? 'sel' : ''}" data-id="${esc(p.id_pos)}">
      ${dotHTML(p)}
      <span class="pi-body"><span class="pi-nama">${esc(p.nama_pos)}</span><span class="pi-sub">${esc(p.kabupaten || '—')} · ${esc(TIPE_LABEL[p.tipe_stasiun] || '')}</span></span>
      <span class="pi-hari" style="color:${k.tx}">${p.hari_terakhir_kirim === 0 ? 'Hari ini' : p.hari_terakhir_kirim >= 999 ? 'Belum' : p.hari_terakhir_kirim + ' hr'}</span>
    </button></li>`;
  }).join('');
}

function resetFilter() {
  state.filter.clear(); state.q = ''; el('searchInput').value = '';
  terapkanFilter();
}

function initSidebar() {
  el('filterbar').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    const k = b.dataset.f;
    state.filter.has(k) ? state.filter.delete(k) : state.filter.add(k);
    terapkanFilter();
    if (state.map) fitSemua();
  });
  el('posList').addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (b) selectPos(b.dataset.id, { zoom: true, dari: 'daftar' });
  });
  const input = el('searchInput');
  input.addEventListener('input', () => { state.q = input.value; terapkanFilter(); });
  input.addEventListener('focus', () => { if (isMobile()) setSheet('full'); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = urutkan(posTampil())[0]; if (f) selectPos(f.id_pos, { zoom: true, dari: 'daftar' }); input.blur(); } });
  el('sortSel').addEventListener('change', e => { state.sort = e.target.value; renderList(); });

  // lembar bawah (HP): ketuk atau geser
  const urut = ['peek', 'half', 'full'];
  const sb = el('sidebar');
  const geser = delta => {
    const i = urut.indexOf(sb.dataset.sheet);
    setSheet(urut[Math.max(0, Math.min(2, i + delta))]);
  };
  let y0 = null;
  [el('sheetHandle'), sb.querySelector('.sb-head')].forEach(h => {
    h.addEventListener('pointerdown', e => { y0 = e.clientY; });
    h.addEventListener('pointerup', e => {
      if (y0 === null) return;
      const dy = e.clientY - y0; y0 = null;
      if (Math.abs(dy) > 28) geser(dy < 0 ? 1 : -1);
      else if (h.id === 'sheetHandle') geser(sb.dataset.sheet === 'full' ? -2 : 1);
    });
  });
}
function setSheet(s) { el('sidebar').dataset.sheet = s; }

// ---------- pilih pos & panel detail ----------
function selectPos(id, opt = {}) {
  const pos = state.posHujan.find(p => p.id_pos === id);
  if (!pos) return;
  state.selected = id;
  if (opt.dari === 'daftar' && isMobile()) setSheet('peek');
  // pos yang terfilter keluar tetap perlu terlihat
  if (state.markers[id] && state.markerLayer && !state.markerLayer.hasLayer(state.markers[id])) state.markerLayer.addLayer(state.markers[id]);
  if (state.tabAktif !== 'peta' && opt.dari === 'daftar') ganti('peta');
  renderDetail(pos);
  bukaDetail();
  tandaiTerpilih(); renderList();
  if (opt.zoom !== false || opt.dari === 'peta') pusatkanPada(pos, opt.zoom);
  setHash();
}
// buka detail dari halaman lain (tabel, antrean) tanpa pindah ke peta
function bukaPos(id) { selectPos(id, { zoom: true, dari: 'halaman' }); }

function bukaDetail() {
  const d = el('detail');
  d.classList.add('aktif'); d.setAttribute('aria-hidden', 'false');
  el('stage').classList.add('ada-detail'); document.body.classList.add('ada-detail');
  d.scrollTop = 0;
}
function tutupDetail() {
  state.selected = null;
  const d = el('detail');
  d.classList.remove('aktif', 'luas'); d.setAttribute('aria-hidden', 'true');
  el('stage').classList.remove('ada-detail'); document.body.classList.remove('ada-detail');
  tandaiTerpilih(); renderList(); setHash();
}

function kalenderHTML(pos) {
  const k = pos.kalender_30hari || [];
  if (!k.length) return '<div class="pb-kosong">Belum ada kalender laporan.</div>';
  const cells = k.map(c => {
    const kls = !c.ada ? '' : c.status === 'PERLU_KONFIRMASI' ? 'pk' : c.ch >= 50 ? 'deras' : c.ch > 0 ? 'hujan' : 'ada';
    const tip = c.ada ? `${fmtTgl(c.tanggal)}: ${c.ch} mm` : `${fmtTgl(c.tanggal)}: tidak ada data`;
    return `<div class="kal-cell ${kls ? 'ada ' + kls : ''}" title="${esc(tip)}" aria-label="${esc(tip)}"></div>`;
  }).join('');
  return `<div class="kal-grid">${cells}</div>
    <div class="kal-legend"><span><i style="background:var(--garis)"></i>Tidak lapor</span><span><i style="background:#94a3b8"></i>Tanpa hujan</span><span><i style="background:#3b82f6"></i>Hujan</span><span><i style="background:#1d4ed8"></i>≥ 50 mm</span><span><i style="background:var(--clr-warn)"></i>Perlu konfirmasi</span></div>`;
}

function bars7HTML(pos) {
  const r = pos.riwayat_7hari || [];
  if (!r.length) return '<div class="pb-kosong">Tidak ada data 7 hari terakhir.</div>';
  const maks = Math.max(10, ...r.map(x => x.ch || 0));
  return `<div class="bars7">${r.map(x => {
    const h = x.ch ? Math.max(4, (x.ch / maks) * 62) : 3;
    return `<div title="${esc(fmtTgl(x.tanggal))}: ${x.ch ?? '—'} mm"><b>${x.ch ?? '—'}</b><div class="bar ${x.ch ? '' : 'nol'}" style="height:${h}px"></div><span>${(x.tanggal || '').slice(8)}</span></div>`;
  }).join('')}</div>`;
}

function renderDetail(pos) {
  const k = keaktifanInfo(pos.hari_terakhir_kirim);
  const items = pkItemsDari(pos);
  const foto = `assets/foto_pos/${encodeURIComponent(pos.id_pos)}.jpg`;
  const pills = `<span class="pill"><span class="dot" style="background:${k.warna}"></span>${k.label} · ${esc(hariTeks(pos.hari_terakhir_kirim))}</span>` +
    (isK1(pos) ? '<span class="pill pk">Perlu konfirmasi · Kriteria 1</span>' : '') +
    (isK2(pos) ? '<span class="pill pk">Perlu konfirmasi · Kriteria 2</span>' : '');

  let pembanding;
  if (pos.tipe_stasiun === 'bmkg') {
    pembanding = '<div class="pb-kosong">Stasiun BMKG dianggap data standar dan menjadi referensi utama bagi pos di sekitarnya.</div>';
  } else {
    pembanding = renderPembandingBaris(pos.k1_layer2_pembanding, 8);
  }

  el('detail').innerHTML = `
    <div class="dt-head">
      <div class="dt-avatar" style="background:${k.warna}">${esc(pos.nama_pos.charAt(0).toUpperCase())}<img src="${foto}" alt="" loading="lazy" onerror="this.remove()"></div>
      <div class="dt-title"><h1>${esc(pos.nama_pos)}</h1><p>${esc(pos.kabupaten || 'Sumatera Barat')} · ${esc(TIPE_LABEL[pos.tipe_stasiun] || '')} · ${esc(pos.id_pos)}</p></div>
      <button class="icon-btn" onclick="tutupDetail()" aria-label="Tutup detail"><svg><use href="#i-tutup"/></svg></button>
    </div>
    <div class="dt-body">
      <div class="pills">${pills}</div>
      <div class="facts">
        <div class="fact"><b>${pos.curah_hujan_mm ?? '—'}<em>${pos.curah_hujan_mm != null ? 'mm' : ''}</em></b><span>${pos.curah_hujan_mm != null ? esc(kategoriTampil(pos.curah_hujan_mm)) : 'Hujan hari ini'}</span></div>
        <div class="fact"><b>${pos.jumlah_lapor_30hari ?? 0}<em>/30</em></b><span>Hari lapor (${pos.persen_aktif ?? 0}%)</span></div>
        <div class="fact"><b style="font-size:15px;line-height:1.5">${esc(fmtTgl(pos.tanggal_terakhir))}</b><span>Lapor terakhir</span></div>
      </div>

      ${items.length ? `<section class="dt-sec"><h3>Perlu konfirmasi</h3><div class="queue">${items.map(it => pkItemHTML(pos, it, true)).join('')}</div></section>` : ''}

      ${(isK1(pos) && pos.k1_layer2_status === 'PERLU_KONFIRMASI') ? '' : `<section class="dt-sec"><h3>Pos pembanding <small>korelasi &amp; selisih rata-rata</small></h3>${pembanding}</section>`}
      <section class="dt-sec"><h3>Kalender laporan <small>30 hari</small></h3>${kalenderHTML(pos)}</section>
      <section class="dt-sec"><h3>Curah hujan <small>7 hari terakhir, mm</small></h3>${bars7HTML(pos)}</section>

      <div class="dt-actions">
        <button class="btn ghost" onclick="openKorelasi('${esc(pos.id_pos)}')">Bandingkan korelasi</button>
        ${isPK(pos) ? `<button class="btn" onclick="bukaPanelSuspect('${esc(pos.id_pos)}')">Lihat di antrean</button>` : ''}
      </div>
    </div>`;
  if (isMobile()) el('detail').classList.remove('luas');
}

function renderPembandingBaris(list, maxShow = Infinity) {
  if (!list || !list.length) return `<div class="check-corr-empty">Tidak ada lokasi pembanding dalam radius</div>`;
  const shown = list.slice(0, maxShow);
  const kor = e => (e.korelasi !== null && e.korelasi !== undefined) ? e.korelasi.toFixed(2) : '—';
  let html = shown.map(e => `
    <div class="pb-row ${e.dipakai_evaluasi ? '' : 'ref'}">
      <span class="pb-nama">${esc(e.nama)}<small>${esc(e.tipe)} · ${e.jarak_km} km</small></span>
      <span class="pb-chip ${e.masalah_korelasi ? 'bad' : ''}" title="Korelasi">r ${kor(e)}</span>
      <span class="pb-chip ${e.masalah_selisih ? 'bad' : ''}" title="Selisih rata-rata harian">Δ ${e.selisih_rata2_mm} mm</span>
    </div>`).join('');
  if (list.length > shown.length) html += `<div class="pb-more">+${list.length - shown.length} pembanding lainnya</div>`;
  return html;
}

// ---------- tabel keaktifan ----------
function renderStatistik(posHujan) {
  const hari0 = posHujan.filter(p => p.hari_terakhir_kirim === 0).length;
  const kemarin = posHujan.filter(p => p.hari_terakhir_kirim === 1).length;
  const terlambat = posHujan.filter(p => p.hari_terakhir_kirim > 3 && p.hari_terakhir_kirim !== 999).length;
  const belum = posHujan.filter(p => p.hari_terakhir_kirim === 999).length;
  const tot = posHujan.length;
  setHTML('statGrid', `
    <div class="kpi"><b style="color:var(--ok-tx)">${hari0}</b><span>Lapor hari ini</span><small>dari ${tot} pos</small></div>
    <div class="kpi"><b>${kemarin}</b><span>Kirim kemarin</span></div>
    <div class="kpi"><b style="color:var(--jingga-tx)">${terlambat}</b><span>Terlambat &gt; 3 hari</span></div>
    <div class="kpi"><b style="color:var(--tinta-3)">${belum}</b><span>Belum pernah lapor</span></div>`);

  const kab = [...new Set(posHujan.map(p => p.kabupaten).filter(Boolean))].sort();
  el('tblKab').innerHTML = '<option value="">Semua kabupaten</option>' + kab.map(k => `<option>${esc(k)}</option>`).join('');

  const top = posHujan.filter(p => !isPK(p) && p.hari_terakhir_kirim <= 10).sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0)).slice(0, 5);
  setHTML('topPosCard', top.map((p, i) => `<button onclick="bukaPos('${esc(p.id_pos)}')"><span class="rk">${i + 1}</span><span class="nm">${esc(p.nama_pos)}</span><span class="pc">${p.persen_aktif}%</span></button>`).join(''));
  renderTabel();
}

function renderTabel() {
  const t = state.tbl, q = t.q.trim().toLowerCase();
  let rows = state.posHujan.filter(p =>
    (!q || p.nama_pos.toLowerCase().includes(q) || p.id_pos.toLowerCase().includes(q)) &&
    (!t.kab || p.kabupaten === t.kab) && (!t.tipe || p.tipe_stasiun === t.tipe));
  const val = { nama: p => p.nama_pos, kab: p => p.kabupaten || '', tgl: p => p.tanggal_terakhir || '', hari: p => p.hari_terakhir_kirim ?? 999, persen: p => p.persen_aktif ?? 0 }[t.sort];
  rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * t.dir || a.nama_pos.localeCompare(b.nama_pos); });
  document.querySelectorAll('#tabelHistori th button').forEach(b => { b.dataset.dir = b.dataset.sort === t.sort ? t.dir : ''; });
  el('tbodyHistori').innerHTML = rows.length ? rows.map(p => {
    const k = keaktifanInfo(p.hari_terakhir_kirim), pct = p.persen_aktif ?? 0;
    const c = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : '#ef4444';
    return `<tr onclick="bukaPos('${esc(p.id_pos)}')" tabindex="0" onkeydown="if(event.key==='Enter')bukaPos('${esc(p.id_pos)}')">
      <td class="nama">${esc(p.nama_pos)}<span class="sub">${esc(TIPE_LABEL[p.tipe_stasiun] || '')} · ${esc(p.id_pos)}</span></td>
      <td>${esc(p.kabupaten || '—')}</td>
      <td class="num">${esc(fmtTgl(p.tanggal_terakhir))}</td>
      <td><span class="st">${dotHTML(p)}<span style="color:${k.tx}">${k.label}</span><span class="sub" style="display:inline;font-weight:500">· ${esc(hariTeks(p.hari_terakhir_kirim))}</span></span></td>
      <td><div class="meter" style="--w:${pct}%;--c:${c}"><i></i><b>${pct}%</b></div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--tinta-3);padding:28px">Tidak ada pos yang cocok.</td></tr>';
}

function initTabel() {
  document.querySelectorAll('#tabelHistori th button').forEach(b => b.addEventListener('click', () => {
    const s = b.dataset.sort;
    state.tbl.dir = state.tbl.sort === s ? -state.tbl.dir : (s === 'nama' || s === 'kab' ? 1 : -1);
    state.tbl.sort = s; renderTabel();
  }));
  el('tblSearch').addEventListener('input', e => { state.tbl.q = e.target.value; renderTabel(); });
  el('tblKab').addEventListener('change', e => { state.tbl.kab = e.target.value; renderTabel(); });
  el('tblTipe').addEventListener('change', e => { state.tbl.tipe = e.target.value; renderTabel(); });
}

function renderChartKeaktifan(posHujan) {
  const canvas = el('chartKeaktifan');
  if (!canvas || !window.Chart) return;
  if (state.chartKeaktifan) state.chartKeaktifan.destroy();
  const sample = [...posHujan].sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0));
  // sebaran: berapa pos pada tiap rentang kehadiran data 30 hari
  const rentang = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];
  const label = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
  const data = rentang.map(([a, b]) => sample.filter(p => (p.persen_aktif ?? 0) >= a && (p.persen_aktif ?? 0) < b).length);
  state.chartKeaktifan = new Chart(canvas, {
    type: 'bar',
    data: { labels: label, datasets: [{ data, backgroundColor: ['#ef4444', '#f97316', '#eab308', '#86efac', '#22c55e'], borderRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} pos` } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Jumlah pos' } }, x: { title: { display: true, text: 'Hari lapor dalam 30 hari terakhir' }, grid: { display: false } } },
    },
  });
}

// ---------- antrean perlu konfirmasi ----------
function pkItemsDari(p) {
  const out = [];
  if (isK1(p)) out.push({ kriteria: 'K1' });
  (p.raw_ekstrem_events || []).forEach(ev => out.push({ kriteria: 'K2', ev }));
  return out;
}
function semuaPkItems() {
  const bobot = p => (p.k1_layer1_status === 'PERLU_KONFIRMASI' ? 2 : 0) + (p.k1_layer2_status === 'PERLU_KONFIRMASI' ? 1 : 0);
  const k1 = state.posHujan.filter(isK1).sort((a, b) => bobot(b) - bobot(a) || a.nama_pos.localeCompare(b.nama_pos)).map(p => ({ p, it: { kriteria: 'K1' } }));
  const k2 = [];
  state.posHujan.forEach(p => (p.raw_ekstrem_events || []).forEach(ev => k2.push({ p, it: { kriteria: 'K2', ev } })));
  return k1.concat(k2);
}

function konfirmasiTerakhir(idPos, kriteria, tanggalIso) {
  const list = (state.konfirmasi || []).filter(k => String(k.id_pos) === String(idPos) && k.kriteria === kriteria && (!tanggalIso || k.tanggal_data === tanggalIso));
  if (!list.length) return null;
  return list.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
}
function chipKonfirmasiHTML(k) {
  if (!k) return '';
  const tgl = new Date(k.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `<div class="chip-konfirmasi">Sudah dikonfirmasi ${tgl}: ${esc(k.hasil_konfirmasi)}${k.observer ? ' · ' + esc(k.observer) : ''}</div>`;
}

function ringkasK1HTML(pos) {
  let h = `<div class="k1-ringkasan">${esc(pos.k1_ringkasan || '')}</div>`;
  const t = pos.k1_layer1_temuan || [];
  if (t.length) {
    h += `<div class="check-group"><div class="check-group-label">Layer-1 · Isian yang perlu dicek</div>` +
      t.map(x => `<div class="check-corr-line"><span class="badge badge-bad">${esc(x.tanggal_label)}</span> Isian <b>${esc(x.nilai_mentah)}</b> — ${esc(x.keterangan)}</div>`).join('') + `</div>`;
  }
  if (pos.k1_layer2_status === 'PERLU_KONFIRMASI') {
    h += `<div class="check-group"><div class="check-group-label">Layer-2 · Dibandingkan dengan lokasi sekitar</div>${renderPembandingBaris(pos.k1_layer2_pembanding, 6)}</div>`;
  }
  return h;
}

function pkItemHTML(p, it, kompak) {
  const k1 = it.kriteria === 'K1';
  const iso = k1 ? '' : (it.ev.tanggal_iso || '');
  const kf = konfirmasiTerakhir(p.id_pos, it.kriteria, iso || undefined);
  const layer = k1 ? ((p.k1_layer1_status === 'PERLU_KONFIRMASI' ? 'L1' : '') + (p.k1_layer1_status === 'PERLU_KONFIRMASI' && p.k1_layer2_status === 'PERLU_KONFIRMASI' ? '+' : '') + (p.k1_layer2_status === 'PERLU_KONFIRMASI' ? 'L2' : '')) : '';
  const tglOpsi = k1 ? (p.k1_layer1_temuan || []).map(t => ({ iso: t.tanggal, label: `${t.tanggal_label} (isian: ${t.nilai_mentah})` }))
                     : (iso ? [{ iso, label: `${it.ev.tanggal} (nilai ${it.ev.ch_target} mm)` }] : []);
  const isi = k1
    ? `${ringkasK1HTML(p)}${p.k1_tindak_lanjut ? `<div class="k1-saran">${esc(p.k1_tindak_lanjut)}</div>` : ''}`
    : `<div class="k1-ringkasan"><b>${esc(it.ev.tanggal)}</b>: selisih <b>${it.ev.selisih} mm</b> dengan ${esc(it.ev.tetangga)} — lokasi ini <b>${it.ev.ch_target} mm</b>, tetangga <b>${it.ev.ch_tetangga} mm</b> (jarak ${it.ev.jarak} km).</div>`;
  return `<article class="q-item ${kf ? 'done' : ''}" data-pk-id="${esc(p.id_pos)}" data-kf="${kf ? 1 : 0}" data-k="${it.kriteria}">
    ${kompak ? '' : `<div class="q-head"><button onclick="bukaPos('${esc(p.id_pos)}')"><span class="q-nama">${esc(p.nama_pos)}</span><span class="q-sub">${esc(TIPE_LABEL[p.tipe_stasiun] || '')} · ${esc(p.kabupaten || '')}</span></button><span class="q-tag ${k1 ? '' : 'k2'}">${k1 ? 'Kriteria 1' : 'Kriteria 2'}</span></div>`}
    ${isi}
    ${chipKonfirmasiHTML(kf)}
    <details class="tl-details"><summary>${kf ? 'Catat konfirmasi lagi' : 'Catat hasil konfirmasi'}</summary>${tindakLanjutFormHTML(p, it.kriteria, layer, tglOpsi, tglOpsi[0] ? tglOpsi[0].iso : '')}</details>
  </article>`;
}

function renderSuspectPanel() {
  const P = state.paramQc || {};
  const win = P.k1_window_hari ?? 100, rc = P.k1_ambang_korelasi ?? 0.2, sel = P.k1_ambang_selisih_mm ?? 20;
  const rad = P.radius_km ?? 10, elev = P.beda_elevasi_maks_m ?? 200, mx = P.k1_batas_maks_mm_hari ?? 500;
  const k2w = P.k2_window_hari ?? 60, k2d = P.k2_ambang_selisih_mm ?? 100;
  setHTML('infoK1', `
    <div><b>Kriteria 1 — kualitas data ${win} hari.</b> Layer-1: nilai negatif, lebih dari ${mx} mm/hari, atau isian yang bukan angka/kode. Kode 8888 / “-” berarti hujan tidak terukur dan 9999 / “x” berarti data tidak ada; keduanya bukan kesalahan.</div>
    <div>Layer-2: pola hujan dibandingkan dengan lokasi sekitar (maks ${rad} km, beda elevasi maks ${elev} m). Perlu konfirmasi bila korelasi &lt; ${rc} atau selisih rata-rata harian &gt; ${sel} mm/hari.</div>
    <div><b>Kriteria 2 — selisih ekstrem.</b> Selisih lebih dari ${k2d} mm dalam satu hari dengan pos tetangga, dalam ${k2w} hari terakhir.</div>
    <div>Stasiun BMKG dianggap data standar dan hanya menjadi pembanding. Hubungi petugas lewat WhatsApp atau telepon, lalu catat hasilnya di kartu.</div>`);

  const semua = semuaPkItems();
  const belum = it => !konfirmasiTerakhir(it.p.id_pos, it.it.kriteria, it.it.ev?.tanggal_iso);
  const n = { semua: semua.length, K1: semua.filter(x => x.it.kriteria === 'K1').length, K2: semua.filter(x => x.it.kriteria === 'K2').length, belum: semua.filter(belum).length };
  const tabs = [['semua', 'Semua'], ['belum', 'Belum dikonfirmasi'], ['K1', 'Kriteria 1'], ['K2', 'Kriteria 2']];
  setHTML('pkFilter', tabs.map(([k, l]) => `<button role="tab" data-pkf="${k}" aria-selected="${state.pkFilter === k}">${l}<b>${n[k]}</b></button>`).join(''));

  const tampil = semua.filter(x => state.pkFilter === 'semua' || (state.pkFilter === 'belum' ? belum(x) : x.it.kriteria === state.pkFilter));
  setHTML('pkQueue', tampil.length
    ? tampil.map(x => pkItemHTML(x.p, x.it, false)).join('')
    : `<div class="suspect-empty">${state.pkFilter === 'belum' ? 'Semua sudah dikonfirmasi.' : 'Tidak ada lokasi yang perlu dikonfirmasi.'}</div>`);

  const tanpa = state.posHujan.filter(p => p.k1_layer2_status === 'TIDAK_ADA_PEMBANDING');
  setHTML('pkNote', tanpa.length ? `<div class="k1-info-kecil">${tanpa.length} lokasi tidak punya pembanding dalam ${rad} km / ${elev} m, sehingga cek spasial tidak bisa dilakukan: ${tanpa.map(p => esc(p.nama_pos)).join(', ')}.</div>` : '');
}

function bukaPanelSuspect(idPos) {
  state.pkFilter = 'semua';
  tutupDetail();
  ganti('suspect');
  renderSuspectPanel();
  setTimeout(() => {
    const t = document.querySelector(`#pkQueue [data-pk-id="${CSS.escape(idPos)}"]`);
    if (!t) return;
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    t.classList.add('highlight-flash'); setTimeout(() => t.classList.remove('highlight-flash'), 1400);
  }, 250);
}

function initPk() {
  el('pkFilter').addEventListener('click', e => {
    const b = e.target.closest('[data-pkf]'); if (!b) return;
    state.pkFilter = b.dataset.pkf; renderSuspectPanel();
  });
}

function updateBadge() {
  const jml = state.posHujan.filter(isPK).length;
  const badge = el('navBadgePK');
  if (badge) { badge.textContent = jml; badge.hidden = jml === 0; }
}

function openKorelasi(idA) { state.korPref = idA; if (isMobile()) tutupDetail(); ganti('korelasi'); }

// ---------- pintasan papan ketik ----------
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (el('detail').classList.contains('aktif')) tutupDetail();
  else if (state.tabAktif !== 'peta') tutupPanel();
});


// ===== TAB KORELASI (bebas pilih 2 pos + rentang tanggal, dihitung di browser) =====
function loadSeries() {
  if (state.series) return Promise.resolve(state.series);
  if (state.seriesLoading) return state.seriesLoading;
  state.seriesLoading = fetch(CONFIG.SERIES_URL + '?t=' + Date.now())
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => { state.series = data; return data; })
    .catch(err => {
      console.error('Gagal memuat series_harian.json:', err);
      state.seriesLoading = null;
      throw err;
    });
  return state.seriesLoading;
}

function terapkanKorPref() {
  const id = state.korPref; state.korPref = null;
  const selA = el('korPosA'), selB = el('korPosB');
  if (!id || ![...selA.options].some(o => o.value === id)) return false;
  selA.value = id;
  if (selB.value === id && selB.options.length > 1) selB.selectedIndex = selA.selectedIndex === 0 ? 1 : 0;
  return true;
}

function initKorelasiTab() {
  const selA = el('korPosA'), selB = el('korPosB');
  if (!selA) return;
  if (selA.dataset.ready) { if (terapkanKorPref()) hitungKorelasi(); return; }

  el('korelasiHasil').style.display = 'none';
  el('korelasiKosong').style.display = 'none';
  selA.innerHTML = '<option>Memuat daftar pos...</option>';
  selB.innerHTML = '<option>Memuat daftar pos...</option>';

  loadSeries().then(data => {
    const stasiun = [...data.stations].sort((a, b) => a.nama_pos.localeCompare(b.nama_pos));
    const opts = stasiun.map(s => `<option value="${s.id_pos}">${esc(s.nama_pos)}</option>`).join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (stasiun.length > 1) selB.selectedIndex = 1;

    const tglAwal = el('korTglAwal'), tglAkhir = el('korTglAkhir');
    const dMin = data.dates[0], dMax = data.dates[data.dates.length - 1];
    tglAwal.min = dMin; tglAwal.max = dMax;
    tglAkhir.min = dMin; tglAkhir.max = dMax;
    tglAkhir.value = dMax;
    // Default: 90 hari terakhir (samakan dengan default rainmonitor)
    const awalIdx = Math.max(0, data.dates.length - 90);
    tglAwal.value = data.dates[awalIdx];

    selA.dataset.ready = '1';
    terapkanKorPref();
    hitungKorelasi();
  }).catch(() => {
    selA.innerHTML = '<option>Gagal memuat data</option>';
    selB.innerHTML = '<option>Gagal memuat data</option>';
  });
}

function pearsonCorr(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? NaN : num / denom;
}

// Ambang selisih "anomali" (mm) yang dianggap layak masuk tabel -- beda
// nilainya untuk harian vs bulanan karena skala totalnya juga beda jauh.
const DAILY_ANOMALI_MM = 25;
const MONTHLY_ANOMALI_MM = 100;

// Minimal jumlah hari data (non-null) dalam satu bulan kalender agar total
// bulan itu dianggap valid & dipakai untuk korelasi bulanan. Kalau kurang
// dari ini (mis. bulan pertama/terakhir cuma kepotong beberapa hari sesuai
// filter tanggal, atau memang banyak yang bolong), bulan tsb dilewati
// supaya tidak mendistorsi hasil korelasi.
const MIN_HARI_PER_BULAN = 20;

// Agregasi deret harian (tanggal/la/lb, sudah difilter rentang tanggal)
// menjadi total per bulan kalender untuk masing-masing pos, lalu hitung
// pasangan bulan yang datanya sama-sama valid untuk korelasi bulanan.
function agregasiBulanan(tanggal, la, lb) {
  const bucket = {}; // "YYYY-MM" -> { sumA, nA, sumB, nB }
  for (let i = 0; i < tanggal.length; i++) {
    const bulanKey = tanggal[i].slice(0, 7);
    if (!bucket[bulanKey]) bucket[bulanKey] = { sumA: 0, nA: 0, sumB: 0, nB: 0 };
    const b = bucket[bulanKey];
    if (la[i] !== null && la[i] !== undefined) { b.sumA += la[i]; b.nA += 1; }
    if (lb[i] !== null && lb[i] !== undefined) { b.sumB += lb[i]; b.nB += 1; }
  }

  const bulanList = Object.keys(bucket).sort();
  const bulan = [], laB = [], lbB = [], pairsA = [], pairsB = [], anomali = [];

  bulanList.forEach(key => {
    const b = bucket[key];
    const validA = b.nA >= MIN_HARI_PER_BULAN;
    const validB = b.nB >= MIN_HARI_PER_BULAN;
    const totA = validA ? Math.round(b.sumA * 10) / 10 : null;
    const totB = validB ? Math.round(b.sumB * 10) / 10 : null;

    bulan.push(key);
    laB.push(totA);
    lbB.push(totB);

    if (totA !== null && totB !== null) {
      pairsA.push(totA); pairsB.push(totB);
      const beda = Math.abs(totA - totB);
      if (beda > MONTHLY_ANOMALI_MM) anomali.push({ tanggal: key, a: totA, b: totB, beda: Math.round(beda * 10) / 10 });
    }
  });

  return { bulan, la: laB, lb: lbB, pairsA, pairsB, anomali };
}

function hitungKorelasi() {
  const data = state.series;
  if (!data) return;

  const mode = document.querySelector('input[name="korMode"]:checked')?.value || 'harian';
  const isBulanan = mode === 'bulanan';

  const idA = el('korPosA').value, idB = el('korPosB').value;
  const tglAwal = el('korTglAwal').value, tglAkhir = el('korTglAkhir').value;
  const namaA = data.stations.find(s => s.id_pos === idA)?.nama_pos || idA;
  const namaB = data.stations.find(s => s.id_pos === idB)?.nama_pos || idB;

  const idxMulai = data.dates.findIndex(d => d >= tglAwal);
  let idxAkhir = data.dates.length - 1;
  for (let i = data.dates.length - 1; i >= 0; i--) { if (data.dates[i] <= tglAkhir) { idxAkhir = i; break; } }

  const valA = data.values[idA] || [], valB = data.values[idB] || [];
  const tanggal = [], la = [], lb = [], pairsAHarian = [], pairsBHarian = [], anomaliHarian = [];

  for (let i = Math.max(0, idxMulai); i <= idxAkhir; i++) {
    tanggal.push(data.dates[i]);
    la.push(valA[i] ?? null);
    lb.push(valB[i] ?? null);
    if (valA[i] !== null && valA[i] !== undefined && valB[i] !== null && valB[i] !== undefined) {
      pairsAHarian.push(valA[i]); pairsBHarian.push(valB[i]);
      const beda = Math.abs(valA[i] - valB[i]);
      if (beda > DAILY_ANOMALI_MM) anomaliHarian.push({ tanggal: data.dates[i], a: valA[i], b: valB[i], beda: Math.round(beda * 10) / 10 });
    }
  }

  // Pilih sumbu waktu, deret nilai, pasangan korelasi, & tabel anomali
  // sesuai mode -- harian dipakai apa adanya, bulanan diagregasi dulu.
  let labelSumbu, laTampil, lbTampil, pairsA, pairsB, anomali;
  if (isBulanan) {
    const agg = agregasiBulanan(tanggal, la, lb);
    labelSumbu = agg.bulan; laTampil = agg.la; lbTampil = agg.lb;
    pairsA = agg.pairsA; pairsB = agg.pairsB; anomali = agg.anomali;
  } else {
    labelSumbu = tanggal; laTampil = la; lbTampil = lb;
    pairsA = pairsAHarian; pairsB = pairsBHarian; anomali = anomaliHarian;
  }

  const satuanWaktu = isBulanan ? 'Bulan' : 'Hari';
  const ambangAnomali = isBulanan ? MONTHLY_ANOMALI_MM : DAILY_ANOMALI_MM;

  if (pairsA.length < 3) {
    el('korelasiHasil').style.display = 'none';
    el('korelasiKosong').style.display = 'block';
    setText('korelasiKosongTeks', `Data tidak cukup pada periode ini untuk menghitung korelasi (minimal 3 ${satuanWaktu.toLowerCase()} beririsan).`);
    return;
  }
  el('korelasiHasil').style.display = 'block';
  el('korelasiKosong').style.display = 'none';

  const corr = pearsonCorr(pairsA, pairsB);

  const rata = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const kekuatan = isNaN(corr) ? '' : Math.abs(corr) >= 0.7 ? 'kuat' : Math.abs(corr) >= 0.4 ? 'sedang' : Math.abs(corr) >= 0.2 ? 'lemah' : 'sangat lemah';
  setHTML('korStatGrid', `
    <div class="kpi"><b class="kor-r" style="color:${isNaN(corr) ? 'inherit' : corr < 0.2 ? 'var(--merah-tx)' : corr < 0.5 ? 'var(--jingga-tx)' : 'var(--ok-tx)'}">${isNaN(corr) ? '—' : corr.toFixed(2)}</b><span>Korelasi ${isBulanan ? 'bulanan' : 'harian'}</span><small>${kekuatan}</small></div>
    <div class="kpi"><b>${pairsA.length}</b><span>${satuanWaktu} beririsan</span></div>
    <div class="kpi"><b>${rata(pairsA)}<small style="display:inline;font-size:13px"> mm${isBulanan ? '/bln' : ''}</small></b><span>Rata-rata ${esc(namaA)}</span></div>
    <div class="kpi"><b>${rata(pairsB)}<small style="display:inline;font-size:13px"> mm${isBulanan ? '/bln' : ''}</small></b><span>Rata-rata ${esc(namaB)}</span></div>
  `);

  if (state.chartKorLine) state.chartKorLine.destroy();
  state.chartKorLine = new Chart(el('chartKorLine'), {
    type: 'line',
    data: {
      labels: labelSumbu,
      datasets: [
        { label: namaA, data: laTampil, borderColor: '#0B6E8A', backgroundColor: 'transparent', spanGaps: true, tension: 0.15, pointRadius: 0 },
        { label: namaB, data: lbTampil, borderColor: '#f97316', backgroundColor: 'transparent', spanGaps: true, tension: 0.15, pointRadius: 0 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: 'mm' } } } },
  });

  if (state.chartKorScatter) state.chartKorScatter.destroy();
  state.chartKorScatter = new Chart(el('chartKorScatter'), {
    type: 'scatter',
    data: { datasets: [{ label: `${namaA} vs ${namaB}`, data: pairsA.map((v, i) => ({ x: v, y: pairsB[i] })), backgroundColor: 'rgba(11,110,138,0.55)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: `${namaA} (mm)` } }, y: { title: { display: true, text: `${namaB} (mm)` } } } },
  });

  setText('korTitleChart', `Curah Hujan ${satuanWaktu === 'Bulan' ? 'Bulanan (total per bulan)' : 'Harian'} (mm)`);
  setText('korTitleAnomali', `${satuanWaktu} dengan Selisih > ${ambangAnomali}mm`);
  setText('korThTanggal', satuanWaktu);
  setText('korThA', namaA);
  setText('korThB', namaB);
  const tbody = el('tbodyKorAnomali');
  if (!anomali.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--tinta-3);padding:20px">Tidak ada ${satuanWaktu.toLowerCase()} dengan selisih &gt;${ambangAnomali}mm pada periode ini.</td></tr>`;
  } else {
    tbody.innerHTML = anomali.map(a => `<tr><td>${a.tanggal}</td><td>${a.a} mm</td><td>${a.b} mm</td><td><b>${a.beda} mm</b></td></tr>`).join('');
  }
}

['korPosA', 'korPosB', 'korTglAwal', 'korTglAkhir'].forEach(id => {
  document.addEventListener('change', e => { if (e.target && e.target.id === id) hitungKorelasi(); });
});
document.addEventListener('change', e => { if (e.target && e.target.name === 'korMode') hitungKorelasi(); });


// ===== MEMUAT DATA =====
async function loadData() {
  try {
    const res = await fetch(CONFIG.DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse((await res.text()).replace(/:\s*NaN\b/g, ': null'));
    state.dataRaw = data; state.posHujan = data.pos_hujan || [];
    state.paramQc = (data.metadata && data.metadata.parameter_qc) || {};
    const tgl = data.metadata && data.metadata.tanggal_analisis;
    if (tgl) setText('update-pill', 'Data per ' + new Date(tgl + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }));
    renderMarkers(); renderFilterbar(); renderList(); renderStatistik(state.posHujan); renderSuspectPanel(); updateBadge();
    if (state.map) fitSemua();
    bacaHash();
    el('loading-overlay')?.classList.add('hidden');
    muatKonfirmasi().then(() => { renderSuspectPanel(); if (state.selected) { const p = state.posHujan.find(x => x.id_pos === state.selected); if (p && !el('detail').querySelector('.tl-details[open]')) renderDetail(p); } }).catch(() => {});
  } catch (err) {
    console.error('Data error:', err);
    el('loading-overlay').innerHTML = '<div>Gagal memuat output/latest.json. Muat ulang halaman, atau jalankan notebook QC agar file data terbentuk.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => { initMap(); initSidebar(); initTabel(); initPk(); loadData(); });
window.addEventListener('resize', () => { if (state.map) state.map.invalidateSize(); });

// ===== KONFIRMASI & TINDAK LANJUT -> GOOGLE SHEETS (DataBase) =====
// URL Web App Google Apps Script (lihat apps_script_konfirmasi.gs). Setelah deploy ulang,
// pastikan URL di bawah adalah URL /exec dari deployment terbaru.
const KONFIRMASI_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw7QBHgTIdb81cH8RpE_90oYRSj7WapIzmuKLmp-8Mcpy7DmsrDwl1ZQGv0OVv7sjtb/exec';

const HASIL_KONFIRMASI_OPSI = [
  'Data benar (sesuai kondisi lapangan)',
  'Data salah — perlu dikoreksi',
  'Alat / penakar bermasalah',
  'Pos tidak aktif / berhenti melapor',
  'Petugas belum bisa dihubungi',
];

async function postKonfirmasi(payload) {
  // text/plain => "simple request" (tanpa preflight), respons JSON tetap terbaca
  let res;
  try {
    res = await fetch(KONFIRMASI_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('Tidak dapat menghubungi server konfirmasi. Periksa koneksi internet / URL Apps Script.');
  }
  const j = await res.json().catch(() => null);
  if (!j) throw new Error('Respons server tidak terbaca. Cek sheet "konfirmasi_log" untuk memastikan data tersimpan.');
  if (!j.ok) throw new Error(j.pesan || 'Gagal menyimpan.');
  return j;
}

async function muatKonfirmasi() {
  const res = await fetch(KONFIRMASI_SCRIPT_URL + '?aksi=log&hari=45&t=' + Date.now());
  const j = await res.json();
  state.konfirmasi = (j && j.ok && j.data) ? j.data : [];
}

// Form konfirmasi: hasil pembicaraan dengan petugas + (opsional) koreksi data langsung ke DataBase.
function tindakLanjutFormHTML(pos, kriteria, layer, tanggalOpsi, tanggalDefault) {
  const hasil = HASIL_KONFIRMASI_OPSI.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  const tanggalInput = tanggalOpsi.length
    ? `<select class="tl-tanggal">${tanggalOpsi.map(t => `<option value="${esc(t.iso)}" ${t.iso === tanggalDefault ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`
    : `<input type="date" class="tl-tanggal">`;
  const observer = esc(localStorage.getItem('simophi_observer') || '');
  const pin = esc(sessionStorage.getItem('simophi_pin') || '');
  return `
    <div class="konfirmasi-form tl-form" onclick="event.stopPropagation()"
         data-id="${esc(pos.id_pos)}" data-nama="${esc(pos.nama_pos)}" data-sheet="${esc(pos.sheet_data || '')}"
         data-kolom="${esc(pos.kolom_data || '')}" data-kriteria="${kriteria}" data-layer="${layer}" data-tanggal="${esc(tanggalDefault || '')}">
      <label>Hasil konfirmasi dengan petugas</label>
      <select class="tl-hasil" onchange="tlToggle(this)">${hasil}</select>
      <div class="tl-koreksi" style="display:none">
        <label>Tanggal data yang dikoreksi</label>
        ${tanggalInput}
        <label>Tindakan pada data di DataBase</label>
        <select class="tl-tindakan" onchange="tlToggle(this)">
          <option value="ganti">Ganti dengan nilai koreksi</option>
          <option value="tidak_terukur">Tandai hujan tidak terukur (-)</option>
          <option value="hilang">Tandai data tidak ada (x)</option>
          <option value="tidak_ubah">Jangan ubah data (catat saja)</option>
        </select>
        <input type="number" class="tl-nilai" min="0" max="500" step="0.1" placeholder="Nilai koreksi (mm)">
      </div>
      <label>Dikonfirmasi lewat</label>
      <select class="tl-kanal"><option>WhatsApp</option><option>Telepon</option><option>Lainnya</option></select>
      <input type="text" class="tl-observer" placeholder="Nama observer / forecaster" value="${observer}">
      <input type="password" class="tl-pin" placeholder="PIN petugas" value="${pin}" autocomplete="off">
      <textarea class="kf-ket tl-ket" placeholder="Catatan (opsional)"></textarea>
      <button onclick="kirimTindakLanjut(this)">Simpan Konfirmasi</button>
      <div class="kf-status-msg"></div>
    </div>`;
}

function tlToggle(selEl) {
  const w = selEl.closest('.tl-form');
  const salah = w.querySelector('.tl-hasil').value.startsWith('Data salah');
  w.querySelector('.tl-koreksi').style.display = salah ? 'flex' : 'none';
  const ganti = w.querySelector('.tl-tindakan').value === 'ganti';
  w.querySelector('.tl-nilai').style.display = (salah && ganti) ? 'block' : 'none';
}

async function kirimTindakLanjut(btn) {
  const w = btn.closest('.tl-form');
  const q = s => w.querySelector(s);
  const msg = q('.kf-status-msg');
  const setMsg = (t, ok) => { msg.textContent = t; msg.className = 'kf-status-msg konfirmasi-status ' + (ok ? 'ok' : 'err'); };

  const hasil = q('.tl-hasil').value;
  const salah = hasil.startsWith('Data salah');
  const tindakan = salah ? q('.tl-tindakan').value : 'tidak_ubah';
  const payload = {
    id_pos: w.dataset.id, nama_pos: w.dataset.nama, sheet_data: w.dataset.sheet, kolom_data: w.dataset.kolom,
    kriteria: w.dataset.kriteria, layer: w.dataset.layer, hasil, tindakan,
    tanggal: salah ? (q('.tl-tanggal') ? q('.tl-tanggal').value : '') : (w.dataset.tanggal || ''),
    nilai_baru: (salah && tindakan === 'ganti') ? q('.tl-nilai').value : '',
    kanal: q('.tl-kanal').value, observer: q('.tl-observer').value.trim(),
    catatan: q('.tl-ket').value.trim(), pin: q('.tl-pin').value,
  };

  if (!payload.observer) return setMsg('Isi nama observer/forecaster.', false);
  if (!payload.pin) return setMsg('Isi PIN petugas.', false);
  if (tindakan !== 'tidak_ubah') {
    if (!payload.tanggal) return setMsg('Pilih tanggal data yang dikoreksi.', false);
    if (!payload.sheet_data || !payload.kolom_data) return setMsg('Lokasi kolom di DataBase tidak diketahui — jalankan ulang notebook QC v3.', false);
    if (tindakan === 'ganti') {
      const n = Number(payload.nilai_baru);
      if (payload.nilai_baru === '' || isNaN(n) || n < 0 || n > 500) return setMsg('Nilai koreksi harus angka 0–500 mm.', false);
    }
    if (!confirm(`Data ${payload.nama_pos} tanggal ${payload.tanggal} akan diubah langsung di DataBase. Lanjutkan?`)) return;
  }

  btn.disabled = true;
  const teks = btn.textContent; btn.textContent = 'Menyimpan...';
  try {
    localStorage.setItem('simophi_observer', payload.observer);
    sessionStorage.setItem('simophi_pin', payload.pin);
    const j = await postKonfirmasi(payload);
    setMsg('✅ ' + j.pesan + (tindakan !== 'tidak_ubah' ? ' Perubahan data terlihat di website setelah notebook QC dijalankan lagi.' : ''), true);
    state.konfirmasi = (state.konfirmasi || []).concat([{
      timestamp: new Date().toISOString(), id_pos: payload.id_pos, kriteria: payload.kriteria,
      tanggal_data: payload.tanggal, hasil_konfirmasi: hasil, tindakan_data: tindakan, observer: payload.observer,
    }]);
  } catch (err) {
    setMsg('❌ ' + err.message, false);
  } finally {
    btn.disabled = false; btn.textContent = teks;
  }
}