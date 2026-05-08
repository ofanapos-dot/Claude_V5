/**
 * SIMOPHI - Sistem Monitoring Pos Hujan Sumatera Barat
 * Versi Gabungan: Dashboard Modern + Fitur Histori & Kalender
 */

const CONFIG = {
  DATA_URL: './output/latest.json',
  USE_DUMMY_ON_FAIL: true,
  MAP_CENTER: [-0.7399, 100.8000],
  MAP_ZOOM: 8,
};

let state = {
  dataRaw: null,
  posHujan: [],
  markers: {},
  filterAktif: 'semua',
  map: null,
};

// --- UTILITIES ---
const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
const setHtml = (id, html) => { const el = document.getElementById(id); if(el) el.innerHTML = html; };

// --- INISIALISASI ---
async function init() {
  initMap();
  setupEventListeners();
  
  try {
    const data = await loadData();
    state.dataRaw = data;
    state.posHujan = data.pos_hujan;
    
    updateStats(data);
    renderMarkers(state.posHujan);
    renderPosList(state.posHujan);
  } catch (err) {
    console.error("Initialization failed:", err);
  }
}

function initMap() {
  state.map = L.map('map').setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© BMKG Sumatera Barat'
  }).addTo(state.map);
}

// --- LOGIKA HISTORI & KALENDER ---
function generateKalender(history) {
  // history diasumsikan array berisi status harian (1 = kirim, 0 = bolong)
  // Jika data Anda belum menyediakan ini, kita buat placeholder 30 hari
  let html = '';
  const days = history || Array(30).fill(Math.random() > 0.2 ? 1 : 0); // Simulasi jika data belum ada
  
  days.slice(-30).forEach(active => {
    html += `<div class="k-box ${active ? 'active' : 'empty'}" title="${active ? 'Data Terkirim' : 'Tidak Ada Data'}"></div>`;
  });
  return html;
}

function renderTabelRiwayat(historyData) {
  if (!historyData || historyData.length === 0) return '<tr><td colspan="4">Data riwayat tidak tersedia</td></tr>';
  
  return historyData.map(h => `
    <tr>
      <td>${h.tanggal}</td>
      <td>${h.ch} mm</td>
      <td><span class="kat-badge">${h.kategori}</span></td>
      <td>${h.status === 'OK' ? '✅' : '⚠️'}</td>
    </tr>
  `).join('');
}

// --- TAMPILKAN DETAIL (Modifikasi Utama) ---
function tampilkanDetail(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  // 1. Data Dasar
  setText('d-id', pos.id_pos);
  setText('d-nama', pos.nama_pos);
  setText('d-kab', pos.kabupaten || 'Sumatera Barat');
  setText('d-ch', `${pos.curah_hujan_mm} mm`);
  setText('d-kategori', pos.kategori);
  setText('d-aws', pos.ch_aws_rata ? `${pos.ch_aws_rata} mm` : '—');

  // 2. Render Fitur Baru: Kalender Keaktifan (di bagian d-aws-list atau kontainer baru)
  const historiHtml = `
    <div class="histori-section">
      <div class="detail-section-title">Keaktifan 30 Hari Terakhir</div>
      <div class="kalender-grid-mini">
        ${generateKalender(pos.histori_30_hari)}
      </div>
      
      <div class="detail-section-title">Log 7 Hari Terakhir</div>
      <table class="tabel-mini">
        <thead>
          <tr><th>Tgl</th><th>CH</th><th>Stat</th></tr>
        </thead>
        <tbody>
          ${renderTabelRiwayat(pos.log_7_hari)}
        </tbody>
      </table>
    </div>
  `;
  setHtml('d-aws-list', historiHtml);

  // 3. UI Action
  document.getElementById('detail-panel').classList.remove('hidden');
  state.map.flyTo([pos.latitude, pos.longitude], 12);
}

// --- TAMBAHKAN CSS INI DI style.css ANDA ---
/*
.kalender-grid-mini { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; margin-bottom: 15px; }
.k-box { width: 12px; height: 12px; border-radius: 2px; background: #334155; }
.k-box.active { background: #22c55e; }
.k-box.empty { background: #ef4444; }
.tabel-mini { width: 100%; font-size: 0.75rem; border-collapse: collapse; }
.tabel-mini th { text-align: left; color: #94a3b8; padding-bottom: 5px; }
.tabel-mini td { padding: 4px 0; border-bottom: 1px solid #334155; }
*/

window.onload = init;
