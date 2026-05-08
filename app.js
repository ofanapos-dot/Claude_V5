/**
 * SIMOPHI — Sistem Monitoring Pos Hujan Sumatera Barat
 * app.js — Tersinkronisasi penuh dengan index.html & output Colab
 *
 * Struktur data latest.json (dari colab_script.py):
 *  metadata: { tanggal_analisis, waktu_generate, total_pos,
 *              pos_normal, pos_suspect, pos_aktif_hari_ini, pos_terlambat }
 *  pos_hujan[]: { id_pos, nama_pos, latitude, longitude, kabupaten,
 *                 curah_hujan_mm, kategori, warna, ch_aws_rata,
 *                 flag_aws, flag_spatial, status,
 *                 tanggal_terakhir, hari_terakhir_kirim, label_kirim, warna_kirim,
 *                 jumlah_lapor_30hari, persen_aktif,
 *                 kalender_30hari[], riwayat_7hari[] }
 */

// ===== KONFIGURASI =====
const CONFIG = {
  DATA_URL: './output/latest.json',
  USE_DUMMY_ON_FAIL: true,
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
};

// ===== HELPER: DOM SAFE =====
const el      = id => document.getElementById(id);
const setText = (id, txt) => { const e = el(id); if (e) e.textContent = txt; };
const show    = id => { const e = el(id); if (e) e.classList.remove('hidden'); };
const hide    = id => { const e = el(id); if (e) e.classList.add('hidden'); };
const setHTML = (id, html) => { const e = el(id); if (e) e.innerHTML = html; };

// ===== TAB NAVIGATION (dipanggil dari onclick di HTML) =====
function ganti(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('aktif'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const target = el(`tab-${tab}`);
  if (target) target.classList.add('aktif');

  // Aktifkan tombol yang sesuai
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.getAttribute('onclick')?.includes(`'${tab}'`)) b.classList.add('active');
  });

  // Render chart hanya saat tab histori aktif (menghindari width=0)
  if (tab === 'histori' && state.posHujan.length) renderChartKeaktifan(state.posHujan);
}

// ===== INISIALISASI PETA =====
function initMap() {
  const mapContainer = el('map');
  if (!mapContainer || !window.L) return;

  state.map = L.map('map', {
    center: CONFIG.MAP_CENTER,
    zoom: CONFIG.MAP_ZOOM,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(state.map);
}

// ===== RENDER MARKER PETA =====
function renderMarkers(posHujanList) {
  if (!state.map) return;

  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    const isSuspect = pos.status === 'SUSPECT';
    const size = pos.curah_hujan_mm > 0 ? 20 : 14;

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-dot" style="
        width:${size}px;height:${size}px;
        background:${pos.warna};
        border:2px solid ${isSuspect ? '#f59e0b' : 'rgba(255,255,255,0.5)'};
        ${isSuspect ? 'box-shadow:0 0 8px #f59e0b;animation:pulse 2s infinite;' : ''}
      "></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });

    const marker = L.marker([pos.latitude, pos.longitude], { icon })
      .addTo(state.map)
      .on('click', () => bukaMModal(pos.id_pos));

    marker.bindTooltip(`<b>${pos.nama_pos}</b><br>${pos.curah_hujan_mm} mm`, {
      permanent: false, direction: 'top',
    });

    state.markers[pos.id_pos] = marker;
  });
}

// ===== MODAL DETAIL PETA =====
function bukaMModal(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  setText('modalJudul', pos.nama_pos);

  const flagBadge = flag => {
    if (!flag) return '<span class="badge badge-abu">—</span>';
    if (flag.includes('SUSPECT')) return `<span class="badge badge-merah">${flag}</span>`;
    if (flag.includes('PERLU')) return `<span class="badge badge-kuning">${flag}</span>`;
    return `<span class="badge badge-hijau">${flag}</span>`;
  };

  setHTML('modalIsi', `
    <div class="modal-grid">
      <div class="modal-row"><span class="modal-label">ID Pos</span><span>${pos.id_pos}</span></div>
      <div class="modal-row"><span class="modal-label">Kabupaten</span><span>${pos.kabupaten || 'Sumatera Barat'}</span></div>
      <div class="modal-row"><span class="modal-label">Curah Hujan</span>
        <span class="ch-value">${pos.curah_hujan_mm} mm
          <span class="badge-kategori" style="background:${pos.warna}">${pos.kategori}</span>
        </span>
      </div>
      <div class="modal-row"><span class="modal-label">Status</span>
        <span class="status-badge ${pos.status.toLowerCase()}">${pos.status}</span>
      </div>
      <div class="modal-row"><span class="modal-label">Rata AWS</span>
        <span>${pos.ch_aws_rata !== null ? pos.ch_aws_rata + ' mm' : 'Tidak ada data'}</span>
      </div>
      <div class="modal-row"><span class="modal-label">Flag AWS</span>${flagBadge(pos.flag_aws)}</div>
      <div class="modal-row"><span class="modal-label">Flag Spasial</span>${flagBadge(pos.flag_spatial)}</div>
      <div class="modal-row"><span class="modal-label">Koordinat</span>
        <span>${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}</span>
      </div>
      <div class="modal-row"><span class="modal-label">Terakhir Kirim</span>
        <span style="color:${pos.warna_kirim}">${pos.label_kirim}</span>
      </div>
      <div class="modal-row"><span class="modal-label">Aktif 30 Hari</span>
        <span>${pos.jumlah_lapor_30hari} hari (${pos.persen_aktif}%)</span>
      </div>
    </div>
    <div class="modal-kalender-wrap">
      <div class="modal-kalender-judul">Kalender 30 Hari Terakhir</div>
      <div class="kalender-mini">${renderKalenderMini(pos.kalender_30hari)}</div>
    </div>
  `);

  el('modalOverlay').classList.add('aktif');
  el('modal').classList.add('aktif');

  if (state.map) state.map.flyTo([pos.latitude, pos.longitude], 11);
}

function tutupModal() {
  el('modalOverlay')?.classList.remove('aktif');
  el('modal')?.classList.remove('aktif');
}

// Tutup modal dengan tombol Escape
document.addEventListener('keydown', e => { if (e.key === 'Escape') tutupModal(); });

// ===== KALENDER MINI (untuk modal peta) =====
function renderKalenderMini(kalender) {
  if (!kalender?.length) return '<span style="opacity:.5;font-size:.8rem">Tidak ada data</span>';
  return kalender.map(k => {
    const tgl = k.tanggal?.slice(5);          // "MM-DD"
    const warna = k.ada ? (k.status === 'SUSPECT' ? '#f59e0b' : '#22c55e') : '#e2e8f0';
    const title = k.ada ? `${k.tanggal}: ${k.ch} mm (${k.kat})` : `${k.tanggal}: Tidak ada data`;
    return `<div class="kal-cell" style="background:${warna}" title="${title}"></div>`;
  }).join('');
}

// ===== UPDATE STATISTIK HEADER =====
function updateStats(data) {
  const m = data.metadata;
  setText('stat-total',   m.total_pos);
  setText('stat-normal',  m.pos_normal);
  setText('stat-suspect', m.pos_suspect);

  const jumlahHujan = data.pos_hujan.filter(p => p.curah_hujan_mm > 0).length;
  setText('stat-hujan', jumlahHujan);

  // Format tanggal Bahasa Indonesia
  if (m.tanggal_analisis) {
    const tgl = new Date(m.tanggal_analisis + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    setText('tanggal-display', tgl);
  }

  setText('update-time', `Update: ${m.waktu_generate || '—'}`);

  // Info header
  const tgl = new Date(m.tanggal_analisis + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
setText('metaInfo', `Update: ${tgl} | ${m.total_pos} Pos · ${m.pos_aktif_hari_ini || 0} Aktif`);
  
  // Bar suspect
  if (m.pos_suspect > 0) {
    show('suspect-bar');
    setText('suspect-bar-text', `⚠️ ${m.pos_suspect} pos suspect ditemukan — cek tab Suspect`);
  } else {
    hide('suspect-bar');
  }
}

// ===== RENDER TAB HISTORI =====
function renderHistori(posHujan) {
  // ── Kartu ringkasan ──
  const aktifHariIni  = posHujan.filter(p => p.hari_terakhir_kirim === 0).length;
  const aktifKemarin  = posHujan.filter(p => p.hari_terakhir_kirim === 1).length;
  const terlambat     = posHujan.filter(p => p.hari_terakhir_kirim > 3).length;
  const belumAda      = posHujan.filter(p => !p.tanggal_terakhir).length;

  setHTML('cardRingkasan', `
    <div class="card-stat card-hijau">
      <div class="cs-angka">${aktifHariIni}</div>
      <div class="cs-label">Lapor Hari Ini</div>
    </div>
    <div class="card-stat card-biru">
      <div class="cs-angka">${aktifKemarin}</div>
      <div class="cs-label">Lapor Kemarin</div>
    </div>
    <div class="card-stat card-oranye">
      <div class="cs-angka">${terlambat}</div>
      <div class="cs-label">Terlambat &gt;3 Hari</div>
    </div>
    <div class="card-stat card-abu">
      <div class="cs-angka">${belumAda}</div>
      <div class="cs-label">Belum Ada Data</div>
    </div>
  `);

  // ── Tabel histori ──
  const tbody = el('tbodyHistori');
  if (!tbody) return;

  tbody.innerHTML = posHujan.map(p => {
    const pct    = p.persen_aktif ?? 0;
    const barW   = Math.round(pct);
    const barClr = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    return `
      <tr class="tabel-row" onclick="tampilkanDetailHistori('${p.id_pos}')" title="Klik untuk detail">
        <td>${p.id_pos}</td>
        <td class="nama-col">${p.nama_pos}</td>
        <td>${p.kabupaten || '—'}</td>
        <td>${p.tanggal_terakhir || '—'}</td>
        <td style="color:${p.warna_kirim};font-weight:500">${p.label_kirim}</td>
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

// ===== DETAIL POS (kalender + riwayat 7 hari) =====
function tampilkanDetailHistori(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  const panel = el('detailPos');
  if (!panel) return;

  setText('detailJudul', `${pos.id_pos} — ${pos.nama_pos}`);

  // Kalender 30 hari
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

  // Riwayat 7 hari
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

  // Tampilkan max 30 pos agar chart tidak terlalu padat
  const sample = [...posHujan]
    .sort((a, b) => (b.persen_aktif ?? 0) - (a.persen_aktif ?? 0))
    .slice(0, 30);

  const labels  = sample.map(p => p.nama_pos.length > 12 ? p.nama_pos.slice(0, 12) + '…' : p.nama_pos);
  const data    = sample.map(p => p.persen_aktif ?? 0);
  const colors  = data.map(v => v >= 80 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444');

  state.chartKeaktifan = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Keaktifan (%)',
        data,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => sample[items[0].dataIndex]?.nama_pos,
            label: (item) => `Keaktifan: ${item.raw}% (${sample[item.dataIndex]?.jumlah_lapor_30hari}/30 hari)`,
          },
        },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxRotation: 45 },
          grid: { display: false },
        },
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + '%' },
          grid: { color: 'rgba(0,0,0,.06)' },
        },
      },
      onClick: (_, elements) => {
        if (elements.length) tampilkanDetailHistori(sample[elements[0].index]?.id_pos);
      },
    },
  });
}

// ===== RENDER TAB SUSPECT =====
function renderSuspect(posHujan) {
  const container = el('listSuspect');
  if (!container) return;

  const suspects = posHujan.filter(p => p.status === 'SUSPECT');

  if (!suspects.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div>Tidak ada pos suspect pada data terbaru.</div>
      </div>`;
    return;
  }

  container.innerHTML = suspects.map(p => {
    const flagAws = p.flag_aws || '—';
    const flagSpa = p.flag_spatial || '—';
    return `
      <div class="suspect-card" onclick="bukaMModal('${p.id_pos}')">
        <div class="sc-header">
          <span class="sc-id">${p.id_pos}</span>
          <span class="sc-nama">${p.nama_pos}</span>
          <span class="sc-kab">${p.kabupaten || 'Sumatera Barat'}</span>
          <span class="status-badge suspect">SUSPECT</span>
        </div>
        <div class="sc-body">
          <div class="sc-item">
            <span class="sc-lbl">Curah Hujan</span>
            <span class="sc-val">${p.curah_hujan_mm} mm
              <span class="badge-kategori" style="background:${p.warna}">${p.kategori}</span>
            </span>
          </div>
          <div class="sc-item">
            <span class="sc-lbl">Rata AWS</span>
            <span class="sc-val">${p.ch_aws_rata !== null ? p.ch_aws_rata + ' mm' : 'N/A'}</span>
          </div>
          <div class="sc-item sc-full">
            <span class="sc-lbl">Flag AWS</span>
            <span class="sc-val flag-suspect">${flagAws}</span>
          </div>
          <div class="sc-item sc-full">
            <span class="sc-lbl">Flag Spasial</span>
            <span class="sc-val flag-suspect">${flagSpa}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ===== DUMMY DATA (fallback jika fetch gagal) =====
function dummyData() {
  const posisi = [
    { id: 'PH001', nama: 'Padang Panjang', lat: -0.4643, lon: 100.4115, kab: 'Padang Panjang', ch: 45 },
    { id: 'PH002', nama: 'Bukittinggi',    lat: -0.3053, lon: 100.3693, kab: 'Agam',           ch: 0  },
    { id: 'PH003', nama: 'Solok',          lat: -0.7942, lon: 100.6559, kab: 'Solok',           ch: 12 },
    { id: 'PH004', nama: 'Payakumbuh',     lat: -0.2269, lon: 100.6282, kab: 'Lima Puluh Kota', ch: 0  },
    { id: 'PH005', nama: 'Sawahlunto',     lat: -0.6820, lon: 100.7778, kab: 'Sawahlunto',      ch: 88 },
  ];

  const katFn = mm => {
    if (mm === 0) return ['Tidak Hujan', '#94a3b8'];
    if (mm < 5)   return ['Sangat Ringan', '#bae6fd'];
    if (mm < 20)  return ['Ringan', '#60a5fa'];
    if (mm < 50)  return ['Sedang', '#3b82f6'];
    if (mm < 100) return ['Lebat', '#f59e0b'];
    return ['Sangat Lebat', '#ef4444'];
  };

  const posHujan = posisi.map(p => {
    const [kat, warna] = katFn(p.ch);
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
      status: isSuspect ? 'SUSPECT' : 'NORMAL',
      tanggal_terakhir: new Date().toISOString().slice(0, 10),
      hari_terakhir_kirim: 0, label_kirim: 'Hari ini', warna_kirim: '#22c55e',
      jumlah_lapor_30hari: kal.filter(k => k.ada).length,
      persen_aktif: +(kal.filter(k => k.ada).length / 30 * 100).toFixed(1),
      kalender_30hari: kal,
      riwayat_7hari: kal.slice(-7).reverse().map(k => ({
        tanggal: k.tanggal, ch: k.ch, kat: k.kat, status: k.status,
      })),
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
    data = await res.json();
    console.info('✅ Data loaded:', CONFIG.DATA_URL);
  } catch (err) {
    console.warn('⚠️ Fetch gagal:', err.message);
    if (!CONFIG.USE_DUMMY_ON_FAIL) {
      setHTML('tab-peta', '<div class="error-state">Gagal memuat data. Pastikan latest.json tersedia.</div>');
      return;
    }
    data = dummyData();
    console.info('ℹ️ Menggunakan data dummy.');
    show('dummy-notice');
  }

  state.dataRaw  = data;
  state.posHujan = data.pos_hujan;

  updateStats(data);
  renderMarkers(state.posHujan);
  renderHistori(state.posHujan);
  renderSuspect(state.posHujan);

  hide('loading-overlay');
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  show('loading-overlay');
  initMap();
  loadData();
});
