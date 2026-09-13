/**
 * SIMOPHI — Monitoring Pos Hujan Kerjasama
 * app.js — sinkron dengan output/latest.json
 */

const CONFIG = {
  DATA_URL: 'output/latest.json',
  SERIES_URL: 'output/series_harian.json',
  USE_DUMMY_ON_FAIL: false,
  MAP_CENTER: [-0.7399, 100.8000],
  MAP_ZOOM: 8,
};

let state = {
  dataRaw: null,
  posHujan: [],
  markers: {},
  map: null,
  chartKeaktifan: null,
  tabAktif: 'peta',
  series: null,        // { dates, stations, values } dari series_harian.json
  seriesLoading: null, // Promise, cegah fetch dobel
  chartKorLine: null,
  chartKorScatter: null,
};

const el      = id => document.getElementById(id);
const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
const esc     = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Kategori warna tetap selaras
function kategoriTampil(mm) {
  if (mm === null || mm === undefined || isNaN(mm)) return { kat: 'Tidak Ada Data', warna: '#e2e8f0' };
  if (mm === 0)   return { kat: 'Tidak Hujan',    warna: '#94a3b8' };
  if (mm < 5)     return { kat: 'Sangat Ringan',  warna: '#bae6fd' };
  if (mm < 20)    return { kat: 'Ringan',         warna: '#60a5fa' };
  if (mm < 50)    return { kat: 'Sedang',         warna: '#3b82f6' };
  if (mm < 100)   return { kat: 'Lebat',          warna: '#f59e0b' };
  if (mm <= 150)  return { kat: 'Sangat Lebat',   warna: '#ef4444' };
  return { kat: 'Ekstrem', warna: '#7f1d1d' };
}

function ganti(tab) {
  state.tabAktif = tab;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  el('panel-statistik')?.classList.toggle('aktif', tab === 'statistik');
  el('panel-suspect')?.classList.toggle('aktif', tab === 'suspect');
  el('panel-korelasi')?.classList.toggle('aktif', tab === 'korelasi');
  
  const petaAktif = tab === 'peta';
  el('mapSearch').style.display = petaAktif ? 'flex' : 'none';
  el('legenda').style.display   = petaAktif ? 'block' : 'none';
  if (!petaAktif) el('searchResults')?.classList.remove('aktif');

  if (tab === 'statistik' && state.posHujan.length) {
    renderChartKeaktifan(state.posHujan);
  }
  if (tab === 'korelasi') {
    initKorelasiTab();
  }
}

function initMap() {
  const mapContainer = el('map');
  if (!mapContainer || !window.L) return;
  state.map = L.map('map', { center: CONFIG.MAP_CENTER, zoom: CONFIG.MAP_ZOOM, zoomControl: false });
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 18,
  }).addTo(state.map);
}

// PERBAIKAN: Parser untuk format Python yang baru
function parseAlasanKorelasi(alasan) {
  const out = { aws: [], spatial: [] };
  if (!alasan) return out;
  
  alasan.split(' ; ').map(s => s.trim()).filter(Boolean).forEach(seg => {
    // Format baru: "Nama (REF BMKG) (jarak 7.12km, korelasi=0.14, selisih=22.4mm)"
    const match = seg.match(/^(.*?)\s*\(jarak\s*([\d.]+)km,\s*(.*?)\)$/);
    if (!match) return;
    
    let namaLengkap = match[1].trim();
    const jarak = parseFloat(match[2]);
    const reasons = match[3];

    let corrMatch = reasons.match(/korelasi=(-?[\d.]+)/);
    let selisihMatch = reasons.match(/selisih=([\d.]+)mm/);

    const entry = {
        nama: namaLengkap.replace(' (REF BMKG)', ''),
        jarak: jarak,
        corr: corrMatch ? parseFloat(corrMatch[1]) : null,
        selisih: selisihMatch ? parseFloat(selisihMatch[1]) : null
    };

    if (namaLengkap.includes('(REF BMKG)')) out.aws.push(entry);
    else out.spatial.push(entry);
  });
  return out;
}

function rataRata(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function warnaKorelasi(v) { return v === null ? '#94a3b8' : v < 0.2 ? '#ef4444' : v < 0.4 ? '#f59e0b' : '#22c55e'; }

function ringkasKorelasi(pos, jenis) {
  if (pos.alasan === 'Referensi Utama BMKG') return { teks: 'Referensi BMKG', warna: '#3b82f6' };
  const parsed = parseAlasanKorelasi(pos.alasan);
  const vals = (jenis === 'aws' ? parsed.aws : parsed.spatial).map(e => e.corr).filter(c => c !== null);
  
  if (vals.length) {
    const avg = rataRata(vals);
    return { teks: avg.toFixed(2), warna: warnaKorelasi(avg) };
  }
  return { teks: 'Konsisten', warna: '#22c55e' };
}

// Ganti fungsi renderMarkers
function renderMarkers(posHujanList) {
  if (!state.map) return;
  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    // Kriteria 1 = Suspect Keras, Kriteria 2 = Anomali
    const isSuspect = pos.status === 'SUSPECT';
    const isAnomali = !isSuspect && pos.status_ekstrem_30hari === 'SUSPECT'; 
    
    const { warna } = kategoriTampil(pos.curah_hujan_mm);
    const size = isSuspect || isAnomali ? 22 : (pos.curah_hujan_mm > 0 ? 18 : 13);

    // Styling marker: Suspect (berkedip & oranye tegas), Anomali (border kuning tenang, tidak berkedip)
    const borderColor = isSuspect ? '#f59e0b' : (isAnomali ? '#fbbf24' : 'rgba(255,255,255,0.65)');
    const shadowAnim = isSuspect ? 'box-shadow:0 0 0 2px #f59e0b;animation:pulse 2s infinite;' : '';

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-dot" style="
        width:${size}px;height:${size}px;
        background:${warna};
        border:2px solid ${borderColor};
        ${shadowAnim}
      "></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([pos.latitude, pos.longitude], { icon }).addTo(state.map);
    marker.bindPopup(popupHTML(pos), { closeButton: true, maxWidth: 300, minWidth: 270 });
    marker.bindTooltip(pos.nama_pos, { direction: 'top', offset: [0, -size / 2] });
    state.markers[pos.id_pos] = marker;
  });
}

// Folder foto pos di repo GitHub (Claude_V5-main). Nama file HARUS sama
// dengan id_pos, mis. assets/foto_pos/PH001.jpg -- kalau file belum ada,
// otomatis fallback ke avatar warna+inisial (lihat onerror di bawah).
const FOTO_POS_BASE = 'assets/foto_pos/';
const FOTO_POS_EXT = 'jpg'; // ganti ke 'png'/'webp' di sini kalau format fotonya beda

// Tampilkan daftar korelasi (dipakai popup peta & panel Suspect) --
// maxShow membatasi baris yang tampil sebelum "+N lainnya" (Infinity = tampil semua).
function renderKorelasiBaris(list, maxShow = Infinity) {
  if (!list.length) return `<div class="check-corr-empty">Tidak ada referensi terdekat</div>`;
  const shown = list.slice(0, maxShow);
  let html = shown.map(e => `
    <div class="check-corr-line">
      ${e.corr !== null ? `<span class="badge badge-corr">Corr: ${e.corr.toFixed(2)}</span>` : ''}
      ${e.selisih !== null ? `<span class="badge badge-diff">Beda: ${e.selisih}mm</span>` : ''}
      <b>${esc(e.nama)}</b> <small>(${e.jarak}km)</small>
    </div>`).join('');
  if (list.length > shown.length) html += `<div class="check-corr-more">+${list.length - shown.length} lainnya…</div>`;
  return html;
}

// Pindah ke tab Pos Suspect & scroll+sorot ke card/baris milik pos tsb.
function bukaPanelSuspect(idPos) {
  ganti('suspect');
  setTimeout(() => {
    const target = document.getElementById(`suspectcard-${idPos}`) || document.querySelector(`.diffpos-${idPos}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('highlight-flash');
    setTimeout(() => target.classList.remove('highlight-flash'), 1400);
  }, 250);
}

// Ganti fungsi popupHTML
function popupHTML(pos) {
  const { kat, warna } = kategoriTampil(pos.curah_hujan_mm);
  
  const isSuspect = pos.status === 'SUSPECT';
  const isAnomali = !isSuspect && pos.status_ekstrem_30hari === 'SUSPECT';
  
  let tagHtml = '';
  if (isSuspect) tagHtml = '<span class="pop-suspect-tag">Suspect</span>';
  else if (isAnomali) tagHtml = '<span class="pop-anomali-tag">Anomali</span>';

  const korAws = ringkasKorelasi(pos, 'aws');
  const pctColor = pos.persen_aktif >= 80 ? '#22c55e' : pos.persen_aktif >= 50 ? '#f59e0b' : '#ef4444';

  // Coba muat foto pos; kalau file tidak ada (404), otomatis tampilkan
  // avatar warna+inisial sebagai fallback -- tidak perlu cek satu-satu di server.
  const fotoUrl = `${FOTO_POS_BASE}${pos.id_pos}.${FOTO_POS_EXT}`;
  const fotoHtml = `
    <div class="pop-photo-wrap">
      <img src="${fotoUrl}" alt="${esc(pos.nama_pos)}" class="pop-photo-img" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <div class="pop-photo" style="background:${warna};display:none">${pos.nama_pos.charAt(0).toUpperCase()}</div>
      ${tagHtml}
    </div>`;

  // Detail korelasi (seperti card di tab Pos Suspect) hanya ditampilkan
  // untuk pos yang berstatus SUSPECT/Anomali -- pos NORMAL cukup ringkasan
  // di atas supaya popup tidak kepanjangan buat titik yang memang aman.
  let korelasiDetailHtml = '';
  if (isSuspect) {
    const parsed = parseAlasanKorelasi(pos.alasan);
    korelasiDetailHtml = `
      <div class="pop-korelasi-detail">
        <div class="pop-korelasi-group"><div class="pop-korelasi-label">Referensi BMKG</div>${renderKorelasiBaris(parsed.aws, 3)}</div>
        <div class="pop-korelasi-group"><div class="pop-korelasi-label">Referensi Spasial (Pos Sekitar)</div>${renderKorelasiBaris(parsed.spatial, 3)}</div>
      </div>`;
  }

  return `
    <div class="pop-card">
      ${fotoHtml}
      <div class="pop-nama">${esc(pos.nama_pos)}</div>
      <div class="pop-kab">📍 ${esc(pos.kabupaten || 'Sumatera Barat')}</div>
      <div class="pop-rows">
        <div class="pop-row"><span class="pr-lbl">Curah Hujan</span><span class="pr-val" style="color:${warna === '#bae6fd' ? '#0369a1' : warna}">${pos.curah_hujan_mm ?? '—'} mm · ${kat}</span></div>
        <div class="pop-row"><span class="pr-lbl">Terakhir Kirim</span><span class="pr-val" style="color:${pos.warna_kirim}">${pos.label_kirim}</span></div>
        <div class="pop-row"><span class="pr-lbl">Korelasi BMKG</span><span class="pr-val" style="color:${korAws.warna}">${korAws.teks}</span></div>
        <div class="pop-row"><span class="pr-lbl">Aktif 30 Hari</span><span class="pr-val" style="color:${pctColor}">${pos.jumlah_lapor_30hari ?? 0} hari (${pos.persen_aktif ?? 0}%)</span></div>
      </div>
      ${korelasiDetailHtml}
      <div class="pop-btn-row">
        ${(isSuspect || isAnomali) ? `<button class="pop-more pop-more-secondary" onclick="bukaPanelSuspect('${pos.id_pos}')">Detail Korelasi</button>` : ''}
        <button class="pop-more" onclick="ganti('statistik'); tampilkanDetailHistori('${pos.id_pos}')">Analisis Lengkap</button>
      </div>
    </div>`;
}


function bukaPopupPos(idPos) {
  const marker = state.markers[idPos];
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!marker || !pos || !state.map) return;
  ganti('peta');
  state.map.flyTo([pos.latitude, pos.longitude], 12);
  setTimeout(() => marker.openPopup(), 350);
}

function initSearch() {
  const input = el('searchInput'), box = el('searchResults');
  if (!input || !box) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('aktif'); box.innerHTML = ''; return; }
    const hasil = state.posHujan.filter(p => p.nama_pos.toLowerCase().includes(q) || (p.kabupaten || '').toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = !hasil.length ? '<div class="map-search-item" style="color:#94a3b8">Tidak ditemukan</div>' 
      : hasil.map(p => `<div class="map-search-item" onclick="bukaPopupPos('${p.id_pos}'); document.getElementById('searchResults').classList.remove('aktif');"><b>${esc(p.nama_pos)}</b><br><small>${esc(p.kabupaten)}</small></div>`).join('');
    box.classList.add('aktif');
  });
}

function updateStats(data) {
  if (data.metadata.tanggal_analisis) {
    const tgl = new Date(data.metadata.tanggal_analisis + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    setText('update-pill', `Data Terakhir: ${tgl}`);
  }
}

function renderStatistik(posHujan) {
  const aktifHariIni = posHujan.filter(p => p.hari_terakhir_kirim === 0).length;
  const terlambat    = posHujan.filter(p => p.hari_terakhir_kirim > 3 && p.hari_terakhir_kirim !== 999).length;
  const belumAda     = posHujan.filter(p => p.hari_terakhir_kirim === 999).length;

  setHTML('statGrid', `
    <div class="stat-card"><div class="stat-num" style="color:#16a34a">${aktifHariIni}</div><div class="stat-label">Lapor Hari Ini</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${posHujan.filter(p => p.hari_terakhir_kirim === 1).length}</div><div class="stat-label">Kirim Kemarin</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#ef4444">${terlambat}</div><div class="stat-label">Terlambat &gt; 3 Hari</div></div>
    <div class="stat-card"><div class="stat-num" style="color:#64748b">${belumAda}</div><div class="stat-label">Belum Ada Data</div></div>
  `);

  if (el('tbodyHistori')) {
    el('tbodyHistori').innerHTML = posHujan.map(p => {
      const pct = p.persen_aktif ?? 0;
      return `<tr class="tabel-row" onclick="tampilkanDetailHistori('${p.id_pos}')">
          <td>${esc(p.id_pos)}</td><td class="nama-col">${esc(p.nama_pos)}</td><td>${esc(p.kabupaten || '—')}</td>
          <td>${esc(p.tanggal_terakhir || '—')}</td><td style="color:${p.warna_kirim};font-weight:600">${esc(p.label_kirim)}</td>
          <td>
            <div class="bar-wrap">
              <div class="bar-fill" style="width:${pct}%;background:${pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'}"></div>
              <span class="bar-label">${pct}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  const topPos = posHujan.filter(p => p.status === 'NORMAL').sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0)).slice(0, 4);
  if (el('topPosCard')) {
    el('topPosCard').innerHTML = topPos.map((p, i) => `
      <div class="top-pos-item ${i === 0 ? 'rank-1' : ''}" onclick="bukaPopupPos('${p.id_pos}')">
        <span class="top-pos-rank">${i + 1}</span><span class="top-pos-name">${esc(p.nama_pos)}</span>
        <span class="top-pos-pct">${p.persen_aktif}% Aktif</span>
      </div>`).join('');
  }
}

function tampilkanDetailHistori(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;
  setText('detailJudul', `Detail: ${pos.nama_pos}`);
  
  if (el('kalenderGrid') && pos.kalender_30hari) {
    el('kalenderGrid').innerHTML = pos.kalender_30hari.map(k => `
      <div class="kal-cell-lg" style="background:${!k.ada ? '#e2e8f0' : k.status === 'SUSPECT' ? '#f59e0b' : k.ch > 0 ? '#3b82f6' : '#94a3b8'}" 
           title="${k.ada ? `${k.tanggal}:${k.ch}mm` : 'Tidak ada data'}"><span class="kal-tgl">${k.tanggal?.slice(8)}</span></div>
    `).join('');
  }

  if (el('tbodyRiwayat')) {
    el('tbodyRiwayat').innerHTML = pos.riwayat_7hari?.length ? pos.riwayat_7hari.map(r => `
      <tr><td>${r.tanggal}</td><td><b>${r.ch ?? '—'} mm</b></td><td>${r.kat ?? '—'}</td>
      <td><span class="status-badge ${(r.status || '').toLowerCase()}">${r.status || '—'}</span></td></tr>`).join('') 
      : '<tr><td colspan="4">Tidak ada data</td></tr>';
  }
  el('detailPos').style.display = 'block';
  el('detailPos').scrollIntoView({ behavior: 'smooth' });
}

function tutupDetail() { el('detailPos').style.display = 'none'; }

function renderChartKeaktifan(posHujan) {
  const canvas = el('chartKeaktifan');
  if (!canvas || !window.Chart) return;
  if (state.chartKeaktifan) state.chartKeaktifan.destroy();

  const sample = [...posHujan].sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0)).slice(0, 30);
  state.chartKeaktifan = new Chart(canvas, {
    type: 'bar',
    data: { 
      labels: sample.map(p => p.nama_pos.length > 10 ? p.nama_pos.slice(0, 10)+'…' : p.nama_pos), 
      datasets: [{ data: sample.map(p => p.persen_aktif), backgroundColor: sample.map(p => p.persen_aktif >= 80 ? '#22c55e' : '#f59e0b'), borderRadius: 4 }] 
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } }
  });
}

function renderSuspectPanel(posHujan) {
  const listEl = el('listKorelasi');
  const suspects1 = posHujan.filter(p => p.status === 'SUSPECT');
  
  if (!suspects1.length) {
    listEl.innerHTML = `<div class="suspect-empty">✅ Tidak ada pos dengan korelasi anomali.</div>`;
  } else {
    listEl.innerHTML = suspects1.map(p => {
      const parsed = parseAlasanKorelasi(p.alasan);
      return `
        <div class="check-card" id="suspectcard-${p.id_pos}" onclick="bukaPopupPos('${p.id_pos}')">
          <div class="check-card-head"><span class="check-nama">⚠️ ${esc(p.nama_pos)}</span><span class="check-kab">${esc(p.kabupaten)}</span></div>
          <div class="check-group"><div class="check-group-label">Referensi BMKG</div>${renderKorelasiBaris(parsed.aws)}</div>
          <div class="check-group"><div class="check-group-label">Referensi Spasial (Pos Sekitar)</div>${renderKorelasiBaris(parsed.spatial)}</div>
          ${konfirmasiFormHTML(p.id_pos, p.nama_pos, p.window_akhir)}
        </div>`;
    }).join('');
  }

// PERBAIKAN: Menggunakan array raw_ekstrem_events JSON dengan Tombol Aksi
  const rows = [];
  posHujan.forEach(p => {
    if (p.raw_ekstrem_events && p.raw_ekstrem_events.length > 0) {
      p.raw_ekstrem_events.forEach(ev => {
        rows.push({
          id: p.id_pos, nama: p.nama_pos, tanggal: ev.tanggal,
          teks: `<b>${ev.tanggal}</b>: Beda ${ev.selisih}mm dengan ${ev.tetangga} (Titik ini: <b>${ev.ch_target}mm</b> vs Tetangga: <b>${ev.ch_tetangga}mm</b>, Jarak: ${ev.jarak}km)`
        });
      });
    }
  });

  const tbody = el('tbodyDiff');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px">Tidak ada kejadian selisih ekstrem.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr class="tabel-row diffpos-${r.id}">
        <td class="dt-nama" onclick="bukaPopupPos('${r.id}')">${esc(r.nama)}</td>
        <td class="dt-alasan" onclick="bukaPopupPos('${r.id}')">${r.teks}</td>
        <td style="white-space: nowrap; vertical-align: middle;">
          <button onclick="kirimKonfirmasi(this, '${r.id}', '${esc(r.nama)}', '${r.tanggal}', 'Valid')" style="background:#10b981; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600; margin-bottom:6px; display:block; width:100%; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">✅ Valid</button>
          <button onclick="kirimKonfirmasi(this, '${r.id}', '${esc(r.nama)}', '${r.tanggal}', 'Salah Input')" style="background:#ef4444; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600; display:block; width:100%; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">❌ Salah Input</button>
        </td>
      </tr>`).join('');
  }
}


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

function initKorelasiTab() {
  const selA = el('korPosA'), selB = el('korPosB');
  if (!selA || selA.dataset.ready) return; // sudah pernah di-init

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

  setHTML('korStatGrid', `
    <div class="stat-card"><div class="stat-label">Korelasi ${satuanWaktu === 'Bulan' ? 'Bulanan' : 'Harian'}</div><div class="stat-num">${isNaN(corr) ? '-' : corr.toFixed(3)}</div></div>
    <div class="stat-card"><div class="stat-label">${satuanWaktu} Beririsan</div><div class="stat-num">${pairsA.length}</div></div>
    <div class="stat-card"><div class="stat-label">${esc(namaA)}</div><div class="stat-num" style="font-size:0.95rem">rata² ${(pairsA.reduce((a,b)=>a+b,0)/pairsA.length).toFixed(1)} mm${isBulanan ? '/bln' : ''}</div></div>
    <div class="stat-card"><div class="stat-label">${esc(namaB)}</div><div class="stat-num" style="font-size:0.95rem">rata² ${(pairsB.reduce((a,b)=>a+b,0)/pairsB.length).toFixed(1)} mm${isBulanan ? '/bln' : ''}</div></div>
  `);

  if (state.chartKorLine) state.chartKorLine.destroy();
  state.chartKorLine = new Chart(el('chartKorLine'), {
    type: 'line',
    data: {
      labels: labelSumbu,
      datasets: [
        { label: namaA, data: laTampil, borderColor: '#3b82f6', backgroundColor: 'transparent', spanGaps: true, tension: 0.15, pointRadius: 0 },
        { label: namaB, data: lbTampil, borderColor: '#f59e0b', backgroundColor: 'transparent', spanGaps: true, tension: 0.15, pointRadius: 0 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { title: { display: true, text: 'mm' } } } },
  });

  if (state.chartKorScatter) state.chartKorScatter.destroy();
  state.chartKorScatter = new Chart(el('chartKorScatter'), {
    type: 'scatter',
    data: { datasets: [{ label: `${namaA} vs ${namaB}`, data: pairsA.map((v, i) => ({ x: v, y: pairsB[i] })), backgroundColor: 'rgba(30,58,138,0.55)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: `${namaA} (mm)` } }, y: { title: { display: true, text: `${namaB} (mm)` } } } },
  });

  setText('korTitleChart', `Curah Hujan ${satuanWaktu === 'Bulan' ? 'Bulanan (total per bulan)' : 'Harian'} (mm)`);
  setText('korTitleAnomali', `${satuanWaktu} dengan Selisih > ${ambangAnomali}mm`);
  setText('korThTanggal', satuanWaktu);
  setText('korThA', namaA);
  setText('korThB', namaB);
  const tbody = el('tbodyKorAnomali');
  if (!anomali.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">Tidak ada ${satuanWaktu.toLowerCase()} dengan selisih &gt;${ambangAnomali}mm pada periode ini.</td></tr>`;
  } else {
    tbody.innerHTML = anomali.map(a => `<tr><td>${a.tanggal}</td><td>${a.a} mm</td><td>${a.b} mm</td><td><b>${a.beda} mm</b></td></tr>`).join('');
  }
}

['korPosA', 'korPosB', 'korTglAwal', 'korTglAkhir'].forEach(id => {
  document.addEventListener('change', e => { if (e.target && e.target.id === id) hitungKorelasi(); });
});
document.addEventListener('change', e => { if (e.target && e.target.name === 'korMode') hitungKorelasi(); });

async function loadData() {
  try {
    const res = await fetch(CONFIG.DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = JSON.parse((await res.text()).replace(/:\s*NaN\b/g, ': null'));
    state.dataRaw = data; state.posHujan = data.pos_hujan;
    updateStats(data); renderMarkers(state.posHujan); renderStatistik(state.posHujan); renderSuspectPanel(state.posHujan);
    el('loading-overlay')?.classList.add('hidden');
  } catch (err) {
    console.error('Data error:', err);
    el('loading-overlay').innerHTML = '<div style="color:#f87171">Gagal memuat output/latest.json</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => { initMap(); initSearch(); loadData(); });

// ===== FUNGSI KONFIRMASI ANOMALI KE GOOGLE SHEETS =====
// URL Web App Google Apps Script Anda (satu Apps Script dipakai bersama
// oleh tombol cepat di tabel "Kejadian Ekstrem" dan form di kartu pos suspect).
const KONFIRMASI_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw7QBHgTIdb81cH8RpE_90oYRSj7WapIzmuKLmp-8Mcpy7DmsrDwl1ZQGv0OVv7sjtb/exec';

function postKonfirmasi({ idPos, namaPos, tanggal, status, keterangan }) {
  // mode 'no-cors' + text/plain: request tetap "simple request" sehingga
  // tidak butuh preflight OPTIONS (yang tidak ditangani Apps Script Web App
  // secara default). Konsekuensinya: response selalu opaque, jadi sukses
  // diasumsikan jika fetch tidak melempar error jaringan.
  return fetch(KONFIRMASI_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ id_pos: idPos, nama_pos: namaPos, tanggal, status, keterangan }),
  });
}

function kirimKonfirmasi(btnEl, idPos, namaPos, tanggal, status) {
  let keterangan = prompt(`Konfirmasi Data: [${status}]\nMasukkan catatan atau keterangan untuk ${namaPos} (Opsional):`);
  if (keterangan === null) return; // Batal jika user menekan Cancel

  const originalText = btnEl.innerHTML;
  btnEl.innerHTML = '⏳ Menyimpan...';
  btnEl.disabled = true;

  postKonfirmasi({ idPos, namaPos, tanggal, status, keterangan: keterangan || '' })
    .then(() => {
      alert("✅ Konfirmasi berhasil disimpan ke Database!");
      const row = btnEl.closest('tr');
      if (row) {
        row.style.background = '#f1f5f9';
        row.style.opacity = '0.6';
        const actionCell = row.querySelector('td:last-child');
        if (actionCell) actionCell.innerHTML = `<span style="color:#059669; font-weight:700; font-size:0.8rem;">Terkonfirmasi:<br>${status}</span>`;
      }
    })
    .catch(() => {
      alert("❌ Gagal menyimpan konfirmasi. Periksa koneksi internet Anda.");
      btnEl.innerHTML = originalText;
      btnEl.disabled = false;
    });
}

// Form konfirmasi lengkap (dropdown status + keterangan bebas), dipakai di
// kartu pos suspect pada tab "Pos Suspect" -- mirip form di rainmonitor.
const KONFIRMASI_STATUS_OPSI = [
  'Belum dikonfirmasi',
  'Data benar (bukan kesalahan)',
  'Kesalahan alat ukur',
  'Kesalahan pencatatan/input',
  'Pos tidak aktif / berhenti melapor',
  'Lainnya',
];

function konfirmasiFormHTML(idPos, namaPos, tanggal) {
  const opsi = KONFIRMASI_STATUS_OPSI.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  return `
    <div class="konfirmasi-form" onclick="event.stopPropagation()">
      <select class="kf-status">${opsi}</select>
      <textarea class="kf-ket" placeholder="Keterangan tambahan (opsional)"></textarea>
      <button onclick="kirimKonfirmasiForm(this, '${idPos}', '${esc(namaPos)}', '${tanggal || ''}')">Simpan Konfirmasi</button>
      <div class="kf-status-msg"></div>
    </div>`;
}

function kirimKonfirmasiForm(btnEl, idPos, namaPos, tanggal) {
  const wrap = btnEl.closest('.konfirmasi-form');
  const status = wrap.querySelector('.kf-status').value;
  const keterangan = wrap.querySelector('.kf-ket').value;
  const msg = wrap.querySelector('.kf-status-msg');

  btnEl.disabled = true;
  const originalText = btnEl.textContent;
  btnEl.textContent = 'Menyimpan...';

  postKonfirmasi({ idPos, namaPos, tanggal, status, keterangan })
    .then(() => {
      msg.textContent = '✅ Tersimpan.';
      msg.className = 'konfirmasi-status ok';
      btnEl.textContent = originalText;
      btnEl.disabled = false;
    })
    .catch(() => {
      msg.textContent = '❌ Gagal menyimpan, periksa koneksi.';
      msg.className = 'konfirmasi-status err';
      btnEl.textContent = originalText;
      btnEl.disabled = false;
    });
}
