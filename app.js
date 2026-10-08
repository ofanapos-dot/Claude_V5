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

// Warna titik peta sekarang berdasarkan KEAKTIFAN (hari sejak lapor terakhir),
// bukan nilai curah hujan -- sesuai permintaan untuk tab Eksplorasi Peta.
function keaktifanInfo(hari) {
  const h = (hari === null || hari === undefined) ? 999 : hari;
  if (h <= 10) return { warna: '#22c55e', label: 'Aktif',        rentang: '0–10 hari' };
  if (h <= 20) return { warna: '#eab308', label: 'Kurang Aktif', rentang: '11–20 hari' };
  if (h <= 30) return { warna: '#f97316', label: 'Jarang Lapor', rentang: '21–30 hari' };
  return        { warna: '#ef4444', label: 'Tidak Aktif',  rentang: h >= 999 ? 'belum pernah lapor' : '>30 hari' };
}

function tampilanBesar() { return window.matchMedia('(min-width: 1024px)').matches; }

function toggleLegenda(force) {
  const leg = el('legenda'); if (!leg) return;
  const tampilkan = force !== undefined ? force : !leg.classList.contains('aktif');
  leg.classList.toggle('aktif', tampilkan);
}

function ganti(tab) {
  // Klik tab yang sedang aktif (selain peta) = tutup panel, kembali ke peta.
  const panelTab = ['statistik', 'suspect', 'korelasi'].includes(tab);
  if (panelTab && state.tabAktif === tab && el(`panel-${tab}`)?.classList.contains('aktif')) {
    tutupPanel();
    return;
  }

  state.tabAktif = tab;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['statistik', 'suspect', 'korelasi'].forEach(t => el(`panel-${t}`)?.classList.toggle('aktif', t === tab));
  el('panelScrim')?.classList.toggle('aktif', panelTab);
  document.body.classList.toggle('panel-terbuka', panelTab && !tampilanBesar());

  const petaAktif = tab === 'peta';
  el('mapSearch').style.display = petaAktif ? 'flex' : 'none';
  if (petaAktif) { if (tampilanBesar()) toggleLegenda(true); } else { toggleLegenda(false); }
  if (!petaAktif) el('searchResults')?.classList.remove('aktif');

  if (tab === 'statistik' && state.posHujan.length) {
    renderChartKeaktifan(state.posHujan);
  }
  if (tab === 'korelasi') {
    initKorelasiTab();
  }
}

function tutupPanel() {
  state.tabAktif = 'peta';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'peta'));
  ['statistik', 'suspect', 'korelasi'].forEach(t => el(`panel-${t}`)?.classList.remove('aktif'));
  el('panelScrim')?.classList.remove('aktif');
  document.body.classList.remove('panel-terbuka');
  el('mapSearch').style.display = 'flex';
  if (tampilanBesar()) toggleLegenda(true);
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

function rataRata(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function warnaKorelasi(v) { return v === null ? '#94a3b8' : v < 0.2 ? '#ef4444' : v < 0.4 ? '#f59e0b' : '#22c55e'; }

function ringkasKorelasi(pos, jenis) {
  if (pos.tipe_stasiun === 'bmkg' || pos.alasan === 'Referensi Utama BMKG') return { teks: 'Referensi BMKG', warna: '#3b82f6' };
  const list = (pos.k1_layer2_pembanding || []).filter(p => (jenis === 'aws') === (p.tipe === 'BMKG'));
  const vals = list.map(p => p.korelasi).filter(c => c !== null && c !== undefined);
  if (vals.length) {
    const avg = rataRata(vals);
    return { teks: avg.toFixed(2), warna: warnaKorelasi(avg) };
  }
  if (pos.k1_layer2_status === 'TIDAK_ADA_PEMBANDING') return { teks: 'Tanpa pembanding', warna: '#94a3b8' };
  return { teks: 'Tidak ada BMKG dekat', warna: '#94a3b8' };
}

// Ganti fungsi renderMarkers
function renderMarkers(posHujanList) {
  if (!state.map) return;
  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    // Perlu Konfirmasi = Kriteria 1 (kualitas data 100 hari) ATAU Kriteria 2 (kejadian selisih ekstrem)
    const isPK = pos.status === 'PERLU_KONFIRMASI' || pos.status_ekstrem_30hari === 'PERLU_KONFIRMASI';

    // Warna titik = KEAKTIFAN pos (hari sejak terakhir lapor), bukan nilai curah hujan
    const { warna } = keaktifanInfo(pos.hari_terakhir_kirim);
    const size = isPK ? 22 : 16;
    const border = isPK ? '3px solid #0f172a' : '2px solid rgba(255,255,255,0.8)';
    const pkClass = isPK ? 'marker-pk' : '';

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-dot ${pkClass}" style="
        width:${size}px;height:${size}px;
        background:${warna};
        border:${border};
      "></div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([pos.latitude, pos.longitude], { icon }).addTo(state.map);
    marker.bindPopup(popupHTML(pos), { closeButton: true, maxWidth: 320, minWidth: 270 });
    marker.bindTooltip(pos.nama_pos, { direction: 'top', offset: [0, -size / 2] });
    state.markers[pos.id_pos] = marker;
  });
}

// Folder foto pos di repo GitHub (Claude_V5-main). Nama file HARUS sama
// dengan id_pos, mis. assets/foto_pos/PH001.jpg -- kalau file belum ada,
// otomatis fallback ke avatar warna+inisial (lihat onerror di bawah).
const FOTO_POS_BASE = 'assets/foto_pos/';
const FOTO_POS_EXT = 'jpg'; // ganti ke 'png'/'webp' di sini kalau format fotonya beda

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

function popupHTML(pos) {
  const { kat, warna: warnaHujan } = kategoriTampil(pos.curah_hujan_mm);
  const keaktifan = keaktifanInfo(pos.hari_terakhir_kirim);

  const isK1 = pos.status === 'PERLU_KONFIRMASI';
  const isK2 = pos.status_ekstrem_30hari === 'PERLU_KONFIRMASI';
  const isPK = isK1 || isK2;

  let tagHtml = '';
  if (isK1 && isK2) tagHtml = '<span class="pop-suspect-tag">Perlu Konfirmasi · K1 &amp; K2</span>';
  else if (isK1)    tagHtml = '<span class="pop-suspect-tag">Perlu Konfirmasi · Kriteria 1</span>';
  else if (isK2)    tagHtml = '<span class="pop-anomali-tag">Perlu Konfirmasi · Kriteria 2</span>';

  // Coba muat foto pos; kalau file tidak ada (404), otomatis tampilkan
  // avatar warna+inisial sebagai fallback -- tidak perlu cek satu-satu di server.
  const fotoUrl = `${FOTO_POS_BASE}${pos.id_pos}.${FOTO_POS_EXT}`;
  const fotoHtml = `
    <div class="pop-photo-wrap">
      <img src="${fotoUrl}" alt="${esc(pos.nama_pos)}" class="pop-photo-img" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <div class="pop-photo" style="background:${keaktifan.warna}" >${pos.nama_pos.charAt(0).toUpperCase()}</div>
      ${tagHtml}
    </div>`;

  // Daftar lokasi pembanding -- SELALU ditampilkan utk pos kerjasama & alat otomatis
  // (bukan hanya saat Perlu Konfirmasi), lengkap dengan korelasi & selisih rata-rata harian.
  let pembandingHtml;
  if (pos.tipe_stasiun === 'bmkg') {
    pembandingHtml = `<div class="pop-pembanding"><div class="check-group-label">Peran Lokasi</div>
      <div class="k1-ringkasan">Stasiun BMKG — dianggap data standar, dipakai sebagai referensi utama oleh pos di sekitarnya.</div></div>`;
  } else {
    pembandingHtml = `<div class="pop-pembanding"><div class="check-group-label">Lokasi Pembanding (korelasi &amp; selisih rata-rata)</div>
      ${renderPembandingBaris(pos.k1_layer2_pembanding, 6)}</div>`;
  }

  return `
    <div class="pop-card">
      ${fotoHtml}
      <div class="pop-nama">${esc(pos.nama_pos)}</div>
      <div class="pop-kab">📍 ${esc(pos.kabupaten || 'Sumatera Barat')} · ${esc(TIPE_LABEL[pos.tipe_stasiun] || '')}</div>
      <div class="pop-rows">
        <div class="pop-row"><span class="pr-lbl">Keaktifan</span><span class="pr-val" style="color:${keaktifan.warna}">${keaktifan.label} · ${esc(pos.label_kirim)}</span></div>
        <div class="pop-row"><span class="pr-lbl">Curah Hujan Hari Ini</span><span class="pr-val">${pos.curah_hujan_mm ?? '—'} mm · ${kat}</span></div>
        <div class="pop-row"><span class="pr-lbl">Aktif 30 Hari</span><span class="pr-val">${pos.jumlah_lapor_30hari ?? 0} hari (${pos.persen_aktif ?? 0}%)</span></div>
      </div>
      ${pembandingHtml}
      <div class="pop-btn-row">
        ${isPK ? `<button class="pop-more pop-more-secondary" onclick="bukaPanelSuspect('${pos.id_pos}')">Konfirmasi Data</button>` : ''}
        <button class="pop-more" onclick="ganti('statistik'); tampilkanDetailHistori('${pos.id_pos}')">Riwayat Lengkap</button>
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
      <div class="kal-cell-lg" style="background:${!k.ada ? '#e2e8f0' : k.status === 'PERLU_KONFIRMASI' ? '#f59e0b' : k.ch > 0 ? '#3b82f6' : '#94a3b8'}" 
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

// ===== TAMPILAN KRITERIA 1 (Layer-1 & Layer-2) =====
const TIPE_LABEL = { pos_kerjasama: 'Pos Kerjasama', otomatis: 'Alat Otomatis', bmkg: 'BMKG' };

function renderPembandingBaris(list, maxShow = Infinity) {
  if (!list || !list.length) return `<div class="check-corr-empty">Tidak ada lokasi pembanding dalam radius</div>`;
  const shown = list.slice(0, maxShow);
  let html = shown.map(e => `
    <div class="check-corr-line ${e.bermasalah ? 'corr-bad' : ''} ${e.dipakai_evaluasi ? '' : 'corr-refonly'}">
      <span class="badge badge-corr ${e.masalah_korelasi ? 'badge-bad' : ''}">Korelasi: ${e.korelasi !== null && e.korelasi !== undefined ? e.korelasi.toFixed(2) : '—'}</span>
      <span class="badge badge-diff ${e.masalah_selisih ? 'badge-bad' : ''}">Selisih: ${e.selisih_rata2_mm} mm/hari</span>
      <b>${esc(e.nama)}</b> <small>(${esc(e.tipe)} · ${e.jarak_km} km)</small>
      ${e.dipakai_evaluasi ? '' : '<small class="corr-refonly-lbl">referensi saja</small>'}
    </div>`).join('');
  if (list.length > shown.length) html += `<div class="check-corr-more">+${list.length - shown.length} pembanding lainnya…</div>`;
  return html;
}

function ringkasK1HTML(pos, maxPembanding = Infinity) {
  let h = `<div class="k1-ringkasan">${esc(pos.k1_ringkasan || '')}</div>`;
  const t = pos.k1_layer1_temuan || [];
  if (t.length) {
    h += `<div class="check-group"><div class="check-group-label">Layer-1 · Data yang perlu dicek</div>` +
      t.map(x => `<div class="check-corr-line corr-bad"><span class="badge badge-bad">${esc(x.tanggal_label)}</span> Isian <b>${esc(x.nilai_mentah)}</b> — ${esc(x.keterangan)}</div>`).join('') + `</div>`;
  }
  if (pos.k1_layer2_status === 'PERLU_KONFIRMASI') {
    h += `<div class="check-group"><div class="check-group-label">Layer-2 · Dibandingkan dengan lokasi sekitar</div>${renderPembandingBaris(pos.k1_layer2_pembanding, maxPembanding)}</div>`;
  }
  return h;
}

function konfirmasiTerakhir(idPos, kriteria, tanggalIso) {
  const list = (state.konfirmasi || []).filter(k => String(k.id_pos) === String(idPos) && k.kriteria === kriteria && (!tanggalIso || k.tanggal_data === tanggalIso));
  if (!list.length) return null;
  return list.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
}

function chipKonfirmasiHTML(k) {
  if (!k) return '';
  const tgl = new Date(k.timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `<div class="chip-konfirmasi">✔ Sudah dikonfirmasi ${tgl}: ${esc(k.hasil_konfirmasi)}${k.observer ? ' · ' + esc(k.observer) : ''}</div>`;
}

function renderSuspectPanel(posHujan) {
  const P = state.paramQc || {};
  const win = P.k1_window_hari ?? 100, rc = P.k1_ambang_korelasi ?? 0.2, sel = P.k1_ambang_selisih_mm ?? 20;
  const rad = P.radius_km ?? 10, elev = P.beda_elevasi_maks_m ?? 200, mx = P.k1_batas_maks_mm_hari ?? 500;
  const k2w = P.k2_window_hari ?? 60, k2d = P.k2_ambang_selisih_mm ?? 100;

  setHTML('judulK1', `Kriteria 1 — Kualitas Data ${win} Hari Terakhir`);
  setHTML('infoK1', `
    <div><b>Layer-1 · Kesalahan input:</b> nilai negatif, lebih dari ${mx} mm/hari, atau isian yang bukan angka/kode.
    Kode <b>8888</b> / <b>-</b> berarti hujan tidak terukur dan <b>9999</b> / <b>x</b> berarti data tidak ada — keduanya <u>bukan</u> kesalahan.</div>
    <div><b>Layer-2 · Cek spasial:</b> pola hujan dibandingkan dengan lokasi sekitar (maks ${rad} km, beda elevasi maks ${elev} m).
    Perlu konfirmasi bila korelasi &lt; ${rc} atau selisih rata-rata harian &gt; ${sel} mm/hari.</div>
    <div>Stasiun BMKG dianggap data standar dan hanya dipakai sebagai pembanding. “Perlu Konfirmasi” bukan berarti data salah —
    hubungi petugas (WhatsApp/telepon) lalu catat hasilnya di kartu di bawah.</div>`);
  setHTML('judulK2', `Kriteria 2 — Selisih Ekstrem pada Tanggal Tertentu (&gt; ${k2d} mm dalam 1 hari, ${k2w} hari terakhir)`);

  const listEl = el('listKorelasi');
  const daftar = posHujan.filter(p => p.status === 'PERLU_KONFIRMASI');
  const bobot = p => (p.k1_layer1_status === 'PERLU_KONFIRMASI' ? 2 : 0) + (p.k1_layer2_status === 'PERLU_KONFIRMASI' ? 1 : 0);
  daftar.sort((a, b) => bobot(b) - bobot(a) || a.nama_pos.localeCompare(b.nama_pos));

  if (!daftar.length) {
    listEl.innerHTML = `<div class="suspect-empty">✅ Tidak ada lokasi yang perlu dikonfirmasi pada Kriteria 1.</div>`;
  } else {
    listEl.innerHTML = daftar.map(p => {
      const l1 = p.k1_layer1_status === 'PERLU_KONFIRMASI', l2 = p.k1_layer2_status === 'PERLU_KONFIRMASI';
      const layer = (l1 ? 'L1' : '') + (l1 && l2 ? '+' : '') + (l2 ? 'L2' : '');
      const tglOpsi = (p.k1_layer1_temuan || []).map(t => ({ iso: t.tanggal, label: `${t.tanggal_label} (isian: ${t.nilai_mentah})` }));
      return `
        <div class="check-card" id="suspectcard-${p.id_pos}">
          <div class="check-card-head" onclick="bukaPopupPos('${p.id_pos}')">
            <span class="check-nama">📞 ${esc(p.nama_pos)}</span>
            <span class="check-kab">${esc(TIPE_LABEL[p.tipe_stasiun] || '')} · ${esc(p.kabupaten)}</span>
          </div>
          <div class="k1-sumber">${esc(p.k1_sumber)}</div>
          ${ringkasK1HTML(p)}
          ${p.k1_tindak_lanjut ? `<div class="k1-saran">📞 ${esc(p.k1_tindak_lanjut)}</div>` : ''}
          ${chipKonfirmasiHTML(konfirmasiTerakhir(p.id_pos, 'K1'))}
          <details class="tl-details" onclick="event.stopPropagation()">
            <summary>Catat hasil konfirmasi &amp; tindak lanjut</summary>
            ${tindakLanjutFormHTML(p, 'K1', layer, tglOpsi, tglOpsi[0] ? tglOpsi[0].iso : '')}
          </details>
        </div>`;
    }).join('');
  }

  const tanpa = posHujan.filter(p => p.k1_layer2_status === 'TIDAK_ADA_PEMBANDING');
  if (tanpa.length) {
    listEl.innerHTML += `<div class="k1-info-kecil">ℹ️ ${tanpa.length} lokasi tidak punya pembanding dalam ${rad} km / ${elev} m sehingga cek spasial tidak bisa dilakukan: ${tanpa.map(p => esc(p.nama_pos)).join(', ')}.</div>`;
  }

  // ----- Kriteria 2: kejadian pada tanggal tertentu (logika tetap) -----
  const rows = [];
  posHujan.forEach(p => {
    (p.raw_ekstrem_events || []).forEach(ev => rows.push({ p, ev }));
  });

  const tbody = el('tbodyDiff');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:24px">Tidak ada kejadian selisih ekstrem.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(({ p, ev }) => {
      const iso = ev.tanggal_iso || '';
      const kf = konfirmasiTerakhir(p.id_pos, 'K2', iso || undefined);
      const opsi = iso ? [{ iso, label: `${ev.tanggal} (nilai ${ev.ch_target} mm)` }] : [];
      return `
      <tr class="tabel-row diffpos-${p.id_pos}">
        <td class="dt-nama" onclick="bukaPopupPos('${p.id_pos}')">${esc(p.nama_pos)}<br><small>${esc(TIPE_LABEL[p.tipe_stasiun] || '')}</small></td>
        <td class="dt-alasan" onclick="bukaPopupPos('${p.id_pos}')"><b>${esc(ev.tanggal)}</b>: selisih ${ev.selisih} mm dengan ${esc(ev.tetangga)} (lokasi ini <b>${ev.ch_target} mm</b> vs <b>${ev.ch_tetangga} mm</b>, jarak ${ev.jarak} km)</td>
        <td style="vertical-align: top;">
          ${chipKonfirmasiHTML(kf)}
          <details class="tl-details"><summary>Konfirmasi</summary>${tindakLanjutFormHTML(p, 'K2', '', opsi, iso)}</details>
        </td>
      </tr>`;
    }).join('');
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
    state.paramQc = (data.metadata && data.metadata.parameter_qc) || {};
    updateStats(data); renderMarkers(state.posHujan); renderStatistik(state.posHujan); renderSuspectPanel(state.posHujan);
    const jmlPK = state.posHujan.filter(p => p.status === 'PERLU_KONFIRMASI' || p.status_ekstrem_30hari === 'PERLU_KONFIRMASI').length;
    const badge = el('navBadgePK');
    if (badge) { badge.textContent = jmlPK; badge.hidden = jmlPK === 0; }
    muatKonfirmasi().then(() => renderSuspectPanel(state.posHujan)).catch(() => {});
    el('loading-overlay')?.classList.add('hidden');
  } catch (err) {
    console.error('Data error:', err);
    el('loading-overlay').innerHTML = '<div style="color:#f87171">Gagal memuat output/latest.json</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => { initMap(); initSearch(); loadData(); toggleLegenda(tampilanBesar()); });

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
