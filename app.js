/**
 * SIMOPHI - Sistem Monitoring Pos Hujan Sumatera Barat
 * Modifikasi: Penambahan proteksi DOM & Sinkronisasi ID
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
  filterAktif: 'semua',
  posSelected: null,
  map: null,
};

// ===== FUNGSI HELPER (Proteksi Error) =====
const setElText = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};

const toggleEl = (id, show) => {
  const el = document.getElementById(id);
  if (el) {
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
};

// ===== INISIALISASI PETA =====
function initMap() {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;

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

// ===== RENDER MARKER =====
function renderMarkers(posHujanList) {
  if (!state.map) return;
  
  // Bersihkan marker lama
  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    const isSuspect = pos.status === 'SUSPECT';
    const size = pos.curah_hujan_mm > 0 ? 20 : 14;

    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-dot" style="
        width:${size}px; height:${size}px;
        background:${pos.warna};
        border: 2px solid ${isSuspect ? '#f59e0b' : 'rgba(255,255,255,0.4)'};
        ${isSuspect ? 'box-shadow: 0 0 10px #f59e0b; animation: pulse 2s infinite;' : ''}
      "></div>`,
      iconSize: [size, size],
      iconAnchor: [size/2, size/2],
    });

    const marker = L.marker([pos.latitude, pos.longitude], { icon })
      .addTo(state.map)
      .on('click', () => tampilkanDetail(pos.id_pos));

    marker.bindPopup(`<b>${pos.nama_pos}</b><br>${pos.curah_hujan_mm} mm`);
    state.markers[pos.id_pos] = marker;
  });
}

// ===== UPDATE STATISTIK (Dukungan index_01.html) =====
function updateStats(data) {
  const posHujan = data.pos_hujan;
  const jumlahHujan = posHujan.filter(p => p.curah_hujan_mm > 0).length;

  setElText('stat-total', data.metadata.total_pos);
  setElText('stat-normal', data.metadata.pos_normal);
  setElText('stat-suspect', data.metadata.pos_suspect);
  setElText('stat-hujan', jumlahHujan);

  // Format Tanggal
  if (data.metadata.tanggal_analisis) {
    const tgl = new Date(data.metadata.tanggal_analisis).toLocaleDateString('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    setElText('tanggal-display', tgl);
  }
  setElText('update-time', `Update: ${data.metadata.waktu_proses || '—'}`);

  // Bar Suspect
  const hasSuspect = data.metadata.pos_suspect > 0;
  toggleEl('suspect-bar', hasSuspect);
  setElText('suspect-bar-text', `${data.metadata.pos_suspect} pos suspect ditemukan!`);
}

// ===== TAMPILKAN DETAIL (Panel Kanan) =====
function tampilkanDetail(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  state.posSelected = idPos;

  // Isi data ke elemen detail
  setElText('d-id', pos.id_pos);
  setElText('d-nama', pos.nama_pos);
  setElText('d-kab', pos.kabupaten || 'Sumatera Barat');
  setElText('d-ch', `${pos.curah_hujan_mm} mm`);
  setElText('d-kategori', pos.kategori);
  setElText('d-aws', pos.ch_aws_rata !== null ? `${pos.ch_aws_rata} mm` : 'Tidak ada data AWS');
  setElText('d-coords', `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`);

  const statusBadge = document.getElementById('d-status');
  if (statusBadge) {
    statusBadge.textContent = pos.status;
    statusBadge.className = `status-badge ${pos.status.toLowerCase()}`;
  }

  // Tampilkan panel
  toggleEl('detail-panel', true);

  // Efek Peta
  state.map.flyTo([pos.latitude, pos.longitude], 11);
}

// (Fungsi loadData, renderPosList, dan applyFilter tetap sama dengan sebelumnya)
// ... (Sisanya tetap sama agar logika filter tetap jalan)
