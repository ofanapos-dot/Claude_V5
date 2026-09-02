/**
 * SIMOPHI — Monitoring Pos Hujan Kerjasama
 * app.js — sinkron dengan output/latest.json
 */

const CONFIG = {
  DATA_URL: 'output/latest.json',
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
  
  const petaAktif = tab === 'peta';
  el('mapSearch').style.display = petaAktif ? 'flex' : 'none';
  el('legenda').style.display   = petaAktif ? 'block' : 'none';
  if (!petaAktif) el('searchResults')?.classList.remove('aktif');

  if (tab === 'statistik' && state.posHujan.length) {
    renderChartKeaktifan(state.posHujan);
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
    marker.bindPopup(popupHTML(pos), { closeButton: true, maxWidth: 260, minWidth: 250 });
    marker.bindTooltip(pos.nama_pos, { direction: 'top', offset: [0, -size / 2] });
    state.markers[pos.id_pos] = marker;
  });
}

// Ganti fungsi popupHTML
function popupHTML(pos) {
  const { kat, warna } = kategoriTampil(pos.curah_hujan_mm);
  
  const isSuspect = pos.status === 'SUSPECT';
  const isAnomali = pos.status_ekstrem_30hari === 'SUSPECT';
  
  let tagHtml = '';
  if (isSuspect) tagHtml = '<span class="pop-suspect-tag">Suspect</span>';
  else if (isAnomali) tagHtml = '<span class="pop-anomali-tag">Anomali</span>';

  const korAws = ringkasKorelasi(pos, 'aws');
  const pctColor = pos.persen_aktif >= 80 ? '#22c55e' : pos.persen_aktif >= 50 ? '#f59e0b' : '#ef4444';
  
  return `
    <div class="pop-card">
      <div class="pop-photo" style="background:${warna}">
        ${pos.nama_pos.charAt(0).toUpperCase()}
        ${tagHtml}
      </div>
      <div class="pop-nama">${esc(pos.nama_pos)}</div>
      <div class="pop-kab">📍 ${esc(pos.kabupaten || 'Sumatera Barat')}</div>
      <div class="pop-rows">
        <div class="pop-row"><span class="pr-lbl">Curah Hujan</span><span class="pr-val" style="color:${warna === '#bae6fd' ? '#0369a1' : warna}">${pos.curah_hujan_mm ?? '—'} mm · ${kat}</span></div>
        <div class="pop-row"><span class="pr-lbl">Terakhir Kirim</span><span class="pr-val" style="color:${pos.warna_kirim}">${pos.label_kirim}</span></div>
        <div class="pop-row"><span class="pr-lbl">Korelasi BMKG</span><span class="pr-val" style="color:${korAws.warna}">${korAws.teks}</span></div>
        <div class="pop-row"><span class="pr-lbl">Aktif 30 Hari</span><span class="pr-val" style="color:${pctColor}">${pos.jumlah_lapor_30hari ?? 0} hari (${pos.persen_aktif ?? 0}%)</span></div>
      </div>
      <button class="pop-more" onclick="ganti('statistik'); tampilkanDetailHistori('${pos.id_pos}')">Lihat Analisis Lengkap</button>
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
      const baris = (list) => list.length ? list.map(e => `
        <div class="check-corr-line">
          ${e.corr !== null ? `<span class="badge badge-corr">Corr: ${e.corr.toFixed(2)}</span>` : ''}
          ${e.selisih !== null ? `<span class="badge badge-diff">Beda: ${e.selisih}mm</span>` : ''}
          <b>${esc(e.nama)}</b> <small>(${e.jarak}km)</small>
        </div>`).join('') : `<div class="check-corr-empty">Tidak ada referensi terdekat</div>`;

      return `
        <div class="check-card" onclick="bukaPopupPos('${p.id_pos}')">
          <div class="check-card-head"><span class="check-nama">⚠️ ${esc(p.nama_pos)}</span><span class="check-kab">${esc(p.kabupaten)}</span></div>
          <div class="check-group"><div class="check-group-label">Referensi BMKG</div>${baris(parsed.aws)}</div>
          <div class="check-group"><div class="check-group-label">Referensi Spasial (Pos Sekitar)</div>${baris(parsed.spatial)}</div>
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
      <tr class="tabel-row">
        <td class="dt-nama" onclick="bukaPopupPos('${r.id}')">${esc(r.nama)}</td>
        <td class="dt-alasan" onclick="bukaPopupPos('${r.id}')">${r.teks}</td>
        <td style="white-space: nowrap; vertical-align: middle;">
          <button onclick="kirimKonfirmasi(this, '${r.id}', '${esc(r.nama)}', '${r.tanggal}', 'Valid')" style="background:#10b981; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600; margin-bottom:6px; display:block; width:100%; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">✅ Valid</button>
          <button onclick="kirimKonfirmasi(this, '${r.id}', '${esc(r.nama)}', '${r.tanggal}', 'Salah Input')" style="background:#ef4444; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.75rem; font-weight:600; display:block; width:100%; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">❌ Salah Input</button>
        </td>
      </tr>`).join('');
  }


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
function kirimKonfirmasi(btnEl, idPos, namaPos, tanggal, status) {
  let keterangan = prompt(`Konfirmasi Data: [${status}]\nMasukkan catatan atau keterangan untuk ${namaPos} (Opsional):`);
  if (keterangan === null) return; // Batal jika user menekan Cancel

  // Berikan efek loading pada tombol
  const originalText = btnEl.innerHTML;
  btnEl.innerHTML = '⏳ Menyimpan...';
  btnEl.disabled = true;

  // URL Web App Google Apps Script Anda
  const scriptURL = 'https://script.google.com/macros/s/AKfycbw7QBHgTIdb81cH8RpE_90oYRSj7WapIzmuKLmp-8Mcpy7DmsrDwl1ZQGv0OVv7sjtb/exec';
  
  fetch(scriptURL, {
    method: 'POST',
    mode: 'no-cors', // Penting untuk bypass blokir CORS browser
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_pos: idPos,
      nama_pos: namaPos,
      tanggal: tanggal,
      status: status,
      keterangan: keterangan
    })
  })
  .then(res => {
    // Karena mode no-cors, response akan selalu terlihat 'opaque', 
    // jadi kita asumsikan sukses jika fetch berhasil (tidak masuk catch).
    alert("✅ Konfirmasi berhasil disimpan ke Database!");
    
    // Ubah tampilan baris tabel agar terlihat sudah diproses
    const row = btnEl.closest('tr');
    if (row) {
      row.style.background = '#f1f5f9';
      row.style.opacity = '0.6';
      const actionCell = row.querySelector('td:last-child');
      if (actionCell) actionCell.innerHTML = `<span style="color:#059669; font-weight:700; font-size:0.8rem;">Terkonfirmasi:<br>${status}</span>`;
    }
  })
  .catch(err => {
    alert("❌ Gagal menyimpan konfirmasi. Periksa koneksi internet Anda.");
    btnEl.innerHTML = originalText;
    btnEl.disabled = false;
  });
}
