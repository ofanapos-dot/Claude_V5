/**
 * SIMOPHI — Monitoring Pos Hujan Kerjasama
 * app.js — sinkron dengan output/latest.json hasil notebook (Untitled0.ipynb)
 *
 * Struktur data latest.json:
 *  metadata: { tanggal_analisis, waktu_generate, total_pos,
 *              pos_normal, pos_suspect, pos_aktif_hari_ini, pos_terlambat }
 *  pos_hujan[]: { id_pos, nama_pos, latitude, longitude, kabupaten,
 *                 curah_hujan_mm, kategori, warna, ch_aws_rata,
 *                 flag_aws, flag_spatial, alasan, status,
 *                 status_ekstrem_harian, alasan_ekstrem_harian,
 *                 tanggal_terakhir, hari_terakhir_kirim, label_kirim, warna_kirim,
 *                 jumlah_lapor_30hari, persen_aktif,
 *                 kalender_30hari[], riwayat_7hari[] }
 *
 * Catatan: field numerik "korelasi" tunggal per pos tidak tersedia langsung
 * dari notebook — nilai korelasi hanya tersimpan di dalam teks "alasan"
 * untuk pos yang SUSPECT (format "... corr=0.14 ..."). Untuk pos NORMAL,
 * tidak ada angka korelasi yang disimpan, sehingga ditampilkan status
 * kualitatif ("Konsisten") alih-alih angka.
 */

// ===== KONFIGURASI =====
const CONFIG = {
  DATA_URL: 'output/latest.json',
  USE_DUMMY_ON_FAIL: false,
  MAP_CENTER: [-0.7399, 100.8000],
  MAP_ZOOM: 8,
};

// ===== STATE GLOBAL =====
let state = {
  dataRaw: null,
  posHujan: [],
  markers: {},
  map: null,
  chartKeaktifan: null,
  tabAktif: 'peta',
};

// ===== HELPER: DOM SAFE =====
const el      = id => document.getElementById(id);
const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };
const esc     = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ===== KATEGORI TAMPILAN (7 tingkat, selaras dengan legenda) =====
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

// ===== NAVIGASI TAB (sidebar) =====
function ganti(tab) {
  state.tabAktif = tab;

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  el('panel-statistik')?.classList.toggle('aktif', tab === 'statistik');
  el('panel-suspect')?.classList.toggle('aktif', tab === 'suspect');

  const petaAktif = tab === 'peta';
  el('mapSearch').style.display   = petaAktif ? 'flex' : 'none';
  el('legenda').style.display     = petaAktif ? 'block' : 'none';
  if (!petaAktif) el('searchResults')?.classList.remove('aktif');

  // Render chart hanya saat panel statistik aktif (menghindari width=0)
  if (tab === 'statistik' && state.posHujan.length) {
    renderChartKeaktifan(state.posHujan);
  }
}

// ===== INISIALISASI PETA =====
function initMap() {
  const mapContainer = el('map');
  if (!mapContainer || !window.L) return;

  state.map = L.map('map', {
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    zoomControl: false,
  });

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(state.map);
}

// ===== PARSING TEKS "ALASAN" =====
// Contoh segmen: "Staklim Padang Pariaman (REF BMKG, jarak 7.12km, beda 0.0m, corr=0.14, diff=22.4)"
//                "X Koto Singkarak (Pos Kerjasama, jarak 1.11km, beda 0.0m, corr=0.08, diff=30.2)"
function parseAlasanKorelasi(alasan) {
  const out = { aws: [], spatial: [] };
  if (!alasan) return out;
  alasan.split(';').map(s => s.trim()).filter(Boolean).forEach(seg => {
    const m = seg.match(/^(.*?)\s*\((REF (?:BMKG|OTOMATIS)|Pos Kerjasama),\s*jarak\s*([\d.]+)km[^)]*?corr=(-?[\d.]+)/);
    if (!m) return;
    const [, nama, tipe, jarak, corr] = m;
    const entry = { nama: nama.trim(), jarak: parseFloat(jarak), corr: parseFloat(corr) };
    if (tipe.startsWith('REF')) out.aws.push(entry); else out.spatial.push(entry);
  });
  return out;
}

// Ambil hanya segmen "EKSTREM TUNGGAL" (selisih harian > 50mm) dari alasan_ekstrem_harian
function parseAlasanEkstrem(alasan) {
  if (!alasan) return [];
  return alasan.split(';').map(s => s.trim()).filter(s => s.includes('EKSTREM TUNGGAL'));
}

function rataRata(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function warnaKorelasi(v) {
  if (v === null) return '#94a3b8';
  if (v < 0.2) return '#ef4444';
  if (v < 0.4) return '#f59e0b';
  return '#22c55e';
}

// Nilai ringkas Korelasi AWS / Korelasi Spasial untuk popup peta
function ringkasKorelasi(pos, jenis) {
  if (pos.alasan === 'Referensi Utama BMKG') {
    return { teks: 'Referensi BMKG', warna: '#3b82f6' };
  }
  const parsed = parseAlasanKorelasi(pos.alasan);
  const vals = (jenis === 'aws' ? parsed.aws : parsed.spatial).map(e => e.corr);
  if (vals.length) {
    const avg = rataRata(vals);
    return { teks: avg.toFixed(2), warna: warnaKorelasi(avg) };
  }
  // Tidak ada nilai korelasi tersimpan (pos NORMAL) -> tampilkan status kualitatif
  const flag = jenis === 'aws' ? pos.flag_aws : pos.flag_spatial;
  if (flag && flag.toUpperCase().includes('SUSPECT')) {
    return { teks: 'Suspect', warna: '#f59e0b' };
  }
  return { teks: 'Konsisten', warna: '#22c55e' };
}

// ===== RENDER MARKER PETA =====
function renderMarkers(posHujanList) {
  if (!state.map) return;

  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    const isSuspect = pos.status === 'SUSPECT';
    const { warna } = kategoriTampil(pos.curah_hujan_mm);
    const size = isSuspect ? 22 : (pos.curah_hujan_mm > 0 ? 18 : 13);

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-dot" style="
        width:${size}px;height:${size}px;
        background:${warna};
        border:2px solid ${isSuspect ? '#f59e0b' : 'rgba(255,255,255,0.65)'};
        ${isSuspect ? 'box-shadow:0 0 0 2px #f59e0b;animation:pulse 2s infinite;' : ''}
      "></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([pos.latitude, pos.longitude], { icon }).addTo(state.map);
    marker.bindPopup(popupHTML(pos), { closeButton: true, maxWidth: 260, minWidth: 250 });
    marker.bindTooltip(pos.nama_pos, { direction: 'top', offset: [0, -size / 2] });

    state.markers[pos.id_pos] = marker;
  });
}

// ===== KARTU POPUP DETAIL POS (dipakai di peta) =====
function popupHTML(pos) {
  const { kat, warna } = kategoriTampil(pos.curah_hujan_mm);
  const isSuspect = pos.status === 'SUSPECT';
  const korAws = ringkasKorelasi(pos, 'aws');
  const korSp  = ringkasKorelasi(pos, 'spatial');
  const pctColor = pos.persen_aktif >= 80 ? '#22c55e' : pos.persen_aktif >= 50 ? '#f59e0b' : '#ef4444';
  const inisial = (pos.nama_pos || '?').trim().charAt(0).toUpperCase();

  return `
    <div class="pop-card">
      <div class="pop-photo" style="background:${warna}">
        ${inisial}
        ${isSuspect ? '<span class="pop-suspect-tag">Suspect</span>' : ''}
      </div>
      <div class="pop-nama">${esc(pos.nama_pos)}</div>
      <div class="pop-kab">${esc(pos.kabupaten || 'Sumatera Barat')}</div>
      <div class="pop-rows">
        <div class="pop-row">
          <span class="pr-lbl">Curah Hujan</span>
          <span class="pr-val" style="color:${warna === '#bae6fd' ? '#0369a1' : warna}">${pos.curah_hujan_mm ?? '—'} mm · ${kat}</span>
        </div>
        <div class="pop-row">
          <span class="pr-lbl">Terakhir Kirim</span>
          <span class="pr-val" style="color:${pos.warna_kirim}">${pos.label_kirim}</span>
        </div>
        <div class="pop-row">
          <span class="pr-lbl">Korelasi AWS</span>
          <span class="pr-val" style="color:${korAws.warna}">${korAws.teks}</span>
        </div>
        <div class="pop-row">
          <span class="pr-lbl">Korelasi Spasial</span>
          <span class="pr-val" style="color:${korSp.warna}">${korSp.teks}</span>
        </div>
        <div class="pop-row">
          <span class="pr-lbl">30 Hari Terakhir</span>
          <span class="pr-val" style="color:${pctColor}">${pos.jumlah_lapor_30hari ?? 0} hari (${pos.persen_aktif ?? 0}%)</span>
        </div>
      </div>
      <button class="pop-more" onclick="ganti('statistik'); tampilkanDetailHistori('${pos.id_pos}')">Lihat Detail Lengkap</button>
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

// ===== PENCARIAN POS DI PETA =====
function initSearch() {
  const input = el('searchInput');
  const box = el('searchResults');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.remove('aktif'); box.innerHTML = ''; return; }

    const hasil = state.posHujan
      .filter(p => p.nama_pos.toLowerCase().includes(q) || (p.kabupaten || '').toLowerCase().includes(q))
      .slice(0, 8);

    if (!hasil.length) {
      box.innerHTML = '<div class="map-search-item" style="cursor:default;color:#94a3b8">Tidak ditemukan</div>';
    } else {
      box.innerHTML = hasil.map(p => `
        <div class="map-search-item" onclick="pilihHasilCari('${p.id_pos}')">
          <div class="msi-nama">${esc(p.nama_pos)}</div>
          <div class="msi-kab">${esc(p.kabupaten || 'Sumatera Barat')}</div>
        </div>`).join('');
    }
    box.classList.add('aktif');
  });

  document.addEventListener('click', e => {
    if (!box.contains(e.target) && e.target !== input) box.classList.remove('aktif');
  });
}

function pilihHasilCari(idPos) {
  el('searchResults')?.classList.remove('aktif');
  el('searchInput').value = '';
  bukaPopupPos(idPos);
}

// ===== UPDATE PILL & STATISTIK ATAS =====
function updateStats(data) {
  const m = data.metadata;

  if (m.tanggal_analisis) {
    const tgl = new Date(m.tanggal_analisis + 'T00:00:00').toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    setText('update-pill', `Update : ${tgl}`);
  }
}

// ===== PANEL STATISTIK =====
function renderStatistik(posHujan) {
  const aktifHariIni = posHujan.filter(p => p.hari_terakhir_kirim === 0).length;
  const aktifKemarin = posHujan.filter(p => p.hari_terakhir_kirim === 1).length;
  const terlambat    = posHujan.filter(p => p.hari_terakhir_kirim > 3).length;
  const belumAda      = posHujan.filter(p => !p.tanggal_terakhir).length;

  setHTML('statGrid', `
    <div class="stat-card"><div class="stat-num">${aktifHariIni}</div><div class="stat-label">Lapor Hari Ini</div></div>
    <div class="stat-card"><div class="stat-num">${aktifKemarin}</div><div class="stat-label">Kirim Kemarin</div></div>
    <div class="stat-card"><div class="stat-num">${terlambat}</div><div class="stat-label">Terlambat &gt; 3 Hari</div></div>
    <div class="stat-card"><div class="stat-num">${belumAda}</div><div class="stat-label">Belum Ada Data</div></div>
  `);

  // Tabel status kiriman
  const tbody = el('tbodyHistori');
  if (tbody) {
    tbody.innerHTML = posHujan.map(p => {
      const pct    = p.persen_aktif ?? 0;
      const barW   = Math.round(pct);
      const barClr = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
      return `
        <tr class="tabel-row" onclick="tampilkanDetailHistori('${p.id_pos}')" title="Klik untuk detail">
          <td>${esc(p.id_pos)}</td>
          <td class="nama-col">${esc(p.nama_pos)}</td>
          <td>${esc(p.kabupaten || '—')}</td>
          <td>${esc(p.tanggal_terakhir || '—')}</td>
          <td style="color:${p.warna_kirim};font-weight:600">${esc(p.label_kirim)}</td>
          <td>${p.jumlah_lapor_30hari ?? 0} / 30</td>
          <td>
            <div class="bar-wrap">
              <div class="bar-fill" style="width:${barW}%;background:${barClr}"></div>
              <span class="bar-label">${pct}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Pos ter-aktif & korelasi tinggi (top 3 pos NORMAL dengan persen_aktif tertinggi)
  const topPos = posHujan
    .filter(p => p.status === 'NORMAL')
    .sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0))
    .slice(0, 3);

  const cardEl = el('topPosCard');
  if (cardEl) {
    if (!topPos.length) {
      cardEl.innerHTML = '<div class="top-pos-empty">Belum ada pos dengan data cukup.</div>';
    } else {
      cardEl.innerHTML = topPos.map((p, i) => `
        <div class="top-pos-item ${i === 0 ? 'rank-1' : ''}" onclick="bukaPopupPos('${p.id_pos}')">
          <span class="top-pos-rank">${i + 1}</span>
          <span class="top-pos-name">${esc(p.nama_pos)}</span>
          <span class="top-pos-pct">${p.persen_aktif ?? 0}%</span>
        </div>`).join('');
    }
  }
}

// ===== DETAIL POS (kalender + riwayat 7 hari) =====
function tampilkanDetailHistori(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  const panel = el('detailPos');
  if (!panel) return;

  setText('detailJudul', `${pos.id_pos} — ${pos.nama_pos}`);

  const kGrid = el('kalenderGrid');
  if (kGrid && pos.kalender_30hari?.length) {
    kGrid.innerHTML = pos.kalender_30hari.map(k => {
      const warna = !k.ada ? '#e2e8f0'
        : k.status === 'SUSPECT' ? '#f59e0b'
        : k.ch > 0 ? '#3b82f6'
        : '#94a3b8';
      const tip = k.ada ? `${k.tanggal}: ${k.ch} mm — ${k.kat} (${k.status})` : `${k.tanggal}: Tidak lapor`;
      return `<div class="kal-cell-lg" style="background:${warna}" title="${tip}">
                <span class="kal-tgl">${k.tanggal?.slice(8)}</span>
              </div>`;
    }).join('');
  }

  const tbody = el('tbodyRiwayat');
  if (tbody && pos.riwayat_7hari?.length) {
    tbody.innerHTML = pos.riwayat_7hari.map(r => `
      <tr>
        <td>${r.tanggal}</td>
        <td>${r.ch ?? '—'} mm</td>
        <td>${r.kat ?? '—'}</td>
        <td><span class="status-badge ${(r.status || '').toLowerCase()}">${r.status || '—'}</span></td>
      </tr>`).join('');
  } else if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;opacity:.5">Tidak ada data</td></tr>';
  }

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function tutupDetail() {
  const panel = el('detailPos');
  if (panel) panel.style.display = 'none';
}

// ===== CHART KEAKTIFAN (Bar Chart.js) =====
function renderChartKeaktifan(posHujan) {
  const canvas = el('chartKeaktifan');
  if (!canvas || !window.Chart) return;

  if (state.chartKeaktifan) {
    state.chartKeaktifan.destroy();
    state.chartKeaktifan = null;
  }

  const sample = [...posHujan]
    .sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0))
    .slice(0, 30);

  const labels = sample.map(p => p.nama_pos.length > 12 ? p.nama_pos.slice(0, 12) + '…' : p.nama_pos);
  const data   = sample.map(p => p.persen_aktif ?? 0);
  const colors = data.map(v => v >= 80 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444');

  state.chartKeaktifan = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Keaktifan (%)', data, backgroundColor: colors, borderRadius: 4, borderSkipped: false }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => sample[items[0].dataIndex]?.nama_pos,
            label: item => `Keaktifan: ${item.raw}% (${sample[item.dataIndex]?.jumlah_lapor_30hari}/30 hari)`,
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,.06)' } },
      },
      onClick: (_, elements) => { if (elements.length) tampilkanDetailHistori(sample[elements[0].index]?.id_pos); },
    },
  });
}

// ===== PANEL SUSPECT =====
function renderSuspectPanel(posHujan) {
  // Bagian 1: Korelasi dengan titik referensi rendah
  const suspects = posHujan.filter(p => p.status === 'SUSPECT');
  const listEl = el('listKorelasi');

  if (!suspects.length) {
    listEl.innerHTML = `<div class="suspect-empty"><div class="se-icon">✅</div>Tidak ada pos dengan korelasi rendah pada data terbaru.</div>`;
  } else {
    listEl.innerHTML = suspects.map(p => {
      const parsed = parseAlasanKorelasi(p.alasan);
      const baris = (list) => list.length
        ? list.map(e => `<div class="check-corr-line">${e.corr.toFixed(2)} — ${esc(e.nama)} <span style="color:#94a3b8">(${e.jarak}km)</span></div>`).join('')
        : `<div class="check-corr-empty">Tidak ada data pembanding</div>`;

      return `
        <div class="check-card" onclick="bukaPopupPos('${p.id_pos}')">
          <div class="check-card-head">
            <span class="check-nama">${esc(p.nama_pos)}</span>
            <span class="check-kab">${esc(p.kabupaten || 'Sumatera Barat')}</span>
          </div>
          <div class="check-group">
            <div class="check-group-label">Nilai Korelasi dengan AWS / Stasiun BMKG</div>
            ${baris(parsed.aws)}
          </div>
          <div class="check-group">
            <div class="check-group-label">Nilai Korelasi dengan Pos Hujan Sekitar</div>
            ${baris(parsed.spatial)}
          </div>
        </div>`;
    }).join('');
  }

  // Bagian 2: Pos dengan perbedaan curah hujan >50mm/hari (ekstrem tunggal)
  const rows = [];
  posHujan.forEach(p => {
    parseAlasanEkstrem(p.alasan_ekstrem_harian).forEach(seg => {
      rows.push({ nama: p.nama_pos, id: p.id_pos, alasan: seg });
    });
  });

  const tbody = el('tbodyDiff');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:24px">Tidak ada pos dengan perbedaan curah hujan &gt;50 mm/hari.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr class="tabel-row" onclick="bukaPopupPos('${r.id}')">
        <td class="dt-nama">${esc(r.nama)}</td>
        <td class="dt-alasan">${esc(r.alasan)}</td>
      </tr>`).join('');
  }
}

// ===== DUMMY DATA (fallback jika fetch gagal) =====
function dummyData() {
  const posisi = [
    { id: 'PH001', nama: 'Padang Panjang', lat: -0.4643, lon: 100.4115, kab: 'Padang Panjang', ch: 45 },
    { id: 'PH002', nama: 'Bukittinggi',    lat: -0.3053, lon: 100.3693, kab: 'Agam',            ch: 0  },
    { id: 'PH003', nama: 'Solok',          lat: -0.7942, lon: 100.6559, kab: 'Solok',            ch: 12 },
    { id: 'PH004', nama: 'Payakumbuh',     lat: -0.2269, lon: 100.6282, kab: 'Lima Puluh Kota',  ch: 0  },
    { id: 'PH005', nama: 'Sawahlunto',     lat: -0.6820, lon: 100.7778, kab: 'Sawahlunto',       ch: 88 },
  ];

  const posHujan = posisi.map(p => {
    const { kat, warna } = kategoriTampil(p.ch);
    const isSuspect = p.id === 'PH005';
    const kal = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - i));
      const ada = Math.random() > 0.3;
      return {
        tanggal: d.toISOString().slice(0, 10),
        ada, ch: ada ? +(Math.random() * 50).toFixed(1) : null,
        kat: ada ? 'Ringan' : null, status: ada ? 'NORMAL' : null,
      };
    });
    return {
      id_pos: p.id, nama_pos: p.nama, latitude: p.lat, longitude: p.lon,
      kabupaten: p.kab, curah_hujan_mm: p.ch, kategori: kat, warna,
      ch_aws_rata: p.ch > 0 ? +(p.ch * 0.9).toFixed(1) : null,
      flag_aws: isSuspect ? 'SUSPECT: PH ada hujan tapi AWS=0' : 'OK',
      flag_spatial: isSuspect ? 'SUSPECT: 80% pos sekitar ada hujan' : 'KONSISTEN',
      alasan: isSuspect ? 'Stasiun Contoh (Pos Kerjasama, jarak 3.2km, beda 10.0m, corr=0.09, diff=55.0)' : '',
      alasan_ekstrem_harian: isSuspect ? 'Stasiun Contoh (Pos Kerjasama, jarak 3.2km, beda 10.0m, EKSTREM TUNGGAL 2026-08-10 (selisih 58.0mm))' : '',
      status: isSuspect ? 'SUSPECT' : 'NORMAL',
      tanggal_terakhir: new Date().toISOString().slice(0, 10),
      hari_terakhir_kirim: 0, label_kirim: 'Hari ini', warna_kirim: '#22c55e',
      jumlah_lapor_30hari: kal.filter(k => k.ada).length,
      persen_aktif: +(kal.filter(k => k.ada).length / 30 * 100).toFixed(1),
      kalender_30hari: kal,
      riwayat_7hari: kal.slice(-7).reverse().map(k => ({ tanggal: k.tanggal, ch: k.ch, kat: k.kat, status: k.status })),
    };
  });

  return {
    metadata: {
      tanggal_analisis: new Date().toISOString().slice(0, 10),
      waktu_generate: new Date().toLocaleString('id-ID'),
      total_pos: posHujan.length,
      pos_normal: posHujan.filter(p => p.status === 'NORMAL').length,
      pos_suspect: posHujan.filter(p => p.status === 'SUSPECT').length,
      pos_aktif_hari_ini: posHujan.filter(p => p.hari_terakhir_kirim === 0).length,
      pos_terlambat: 0,
    },
    pos_hujan: posHujan,
  };
}

// ===== LOAD DATA =====
async function loadData() {
  let data;
  try {
    const res = await fetch(CONFIG.DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const textData = await res.text();
    const cleanText = textData.replace(/:\s*NaN\b/g, ': null'); // Ubah NaN jadi null
    data = JSON.parse(cleanText);
    console.info('✅ Data loaded:', CONFIG.DATA_URL);
  } catch (err) {
    console.warn('⚠️ Fetch gagal:', err.message);
    if (!CONFIG.USE_DUMMY_ON_FAIL) {
      setHTML('app', '<div class="error-state">Gagal memuat data. Pastikan output/latest.json tersedia.</div>');
      el('loading-overlay')?.classList.add('hidden');
      return;
    }
    data = dummyData();
    console.info('ℹ️ Menggunakan data dummy.');
    el('dummy-notice')?.classList.remove('hidden');
  }

  state.dataRaw  = data;
  state.posHujan = data.pos_hujan;

  updateStats(data);
  renderMarkers(state.posHujan);
  renderStatistik(state.posHujan);
  renderSuspectPanel(state.posHujan);

  el('loading-overlay')?.classList.add('hidden');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initSearch();
  loadData();
});
