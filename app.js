/**
 * SIMOPHI - Sistem Monitoring Pos Hujan Sumatera Barat
 * app.js - Logic utama website
 * Stasiun Klimatologi BMKG Sumatera Barat
 */

// ===== KONFIGURASI =====
const CONFIG = {
  // URL file JSON output dari Google Colab / Google Apps Script
  // Setelah deploy ke GitHub Pages, ganti dengan URL raw GitHub Anda
  DATA_URL: './output/latest.json',
  
  // Fallback ke data dummy jika file tidak ditemukan
  USE_DUMMY_ON_FAIL: true,

  // Koordinat pusat Sumatera Barat
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

// ===== DATA DUMMY (fallback jika JSON belum ada) =====
const DUMMY_DATA = {
  "metadata": {
    "tanggal_analisis": "2026-04-01",
    "waktu_proses": "2026-05-05 09:18:47",
    "total_pos": 57,
    "pos_normal": 56,
    "pos_suspect": 1,
    "radius_aws_km": 25,
    "file_sumber": "01Apr26.csv"
  },
  "pos_hujan": [
    {
      "id_pos": "PH001",
      "nama_pos": "Air Pura",
      "latitude": -1.99,
      "longitude": 100.95,
      "kabupaten": "",
      "curah_hujan_mm": 11.5,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 21.6,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Linggo Sari Baganti",
          "tipe_alat": "ARG",
          "jarak_km": 11.9,
          "curah_hujan_mm": 21.6
        }
      ]
    },
    {
      "id_pos": "PH002",
      "nama_pos": "BPK Padang Laban",
      "latitude": -1.917,
      "longitude": 100.87,
      "kabupaten": "",
      "curah_hujan_mm": 1.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 21.6,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Linggo Sari Baganti",
          "tipe_alat": "ARG",
          "jarak_km": 1.8,
          "curah_hujan_mm": 21.6
        }
      ]
    },
    {
      "id_pos": "PH003",
      "nama_pos": "Lunang",
      "latitude": -2.26,
      "longitude": 101.1,
      "kabupaten": "",
      "curah_hujan_mm": 57.8,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH004",
      "nama_pos": "BBI Surian",
      "latitude": -1.24861,
      "longitude": 100.87,
      "kabupaten": "",
      "curah_hujan_mm": 5.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 4.8,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Alahan Panjang",
          "tipe_alat": "AWS",
          "jarak_km": 19.0,
          "curah_hujan_mm": 4.8
        }
      ]
    },
    {
      "id_pos": "PH005",
      "nama_pos": "BPK Lembah Gumanti",
      "latitude": -1.084,
      "longitude": 100.78,
      "kabupaten": "",
      "curah_hujan_mm": 6.8,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 4.8,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Alahan Panjang",
          "tipe_alat": "AWS",
          "jarak_km": 2.0,
          "curah_hujan_mm": 4.8
        }
      ]
    },
    {
      "id_pos": "PH006",
      "nama_pos": "UPTD Alahan Panjang",
      "latitude": -0.98,
      "longitude": 100.78,
      "kabupaten": "",
      "curah_hujan_mm": 4.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 4.2,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Alahan Panjang",
          "tipe_alat": "AWS",
          "jarak_km": 13.0,
          "curah_hujan_mm": 4.8
        },
        {
          "nama_alat": "ARG Solok",
          "tipe_alat": "ARG",
          "jarak_km": 20.4,
          "curah_hujan_mm": 3.6
        }
      ]
    },
    {
      "id_pos": "PH007",
      "nama_pos": "Balitbu Sumani",
      "latitude": -0.71964,
      "longitude": 100.59724,
      "kabupaten": "",
      "curah_hujan_mm": 1.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 21.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 0.3,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 19.5,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 24.6,
          "curah_hujan_mm": 54.2
        }
      ]
    },
    {
      "id_pos": "PH008",
      "nama_pos": "Balitbu Aripan",
      "latitude": -0.698,
      "longitude": 100.6,
      "kabupaten": "",
      "curah_hujan_mm": 0.5,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 21.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 2.7,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 17.7,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 22.2,
          "curah_hujan_mm": 54.2
        }
      ]
    },
    {
      "id_pos": "PH009",
      "nama_pos": "Tanjung Gadang",
      "latitude": -0.78,
      "longitude": 101.17,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sijunjung",
          "tipe_alat": "ARG",
          "jarak_km": 21.0,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH010",
      "nama_pos": "Tanjung Lolo",
      "latitude": -0.89462,
      "longitude": 101.19145,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH011",
      "nama_pos": "BPK Sijunjung",
      "latitude": -0.7,
      "longitude": 101.01,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sijunjung",
          "tipe_alat": "ARG",
          "jarak_km": 1.2,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH012",
      "nama_pos": "BPP 4 Nagari",
      "latitude": -0.67,
      "longitude": 100.88,
      "kabupaten": "",
      "curah_hujan_mm": 4.5,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 4.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sijunjung",
          "tipe_alat": "ARG",
          "jarak_km": 13.7,
          "curah_hujan_mm": 0.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 18.6,
          "curah_hujan_mm": 8.6
        }
      ]
    },
    {
      "id_pos": "PH013",
      "nama_pos": "Kumanis",
      "latitude": -0.53,
      "longitude": 100.88,
      "kabupaten": "",
      "curah_hujan_mm": 6.5,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 4.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 18.8,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG Sijunjung",
          "tipe_alat": "ARG",
          "jarak_km": 22.9,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH014",
      "nama_pos": "Sumpur Kudus",
      "latitude": -0.42,
      "longitude": 100.9,
      "kabupaten": "",
      "curah_hujan_mm": 3.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH015",
      "nama_pos": "Kupitan",
      "latitude": -0.7,
      "longitude": 100.84,
      "kabupaten": "",
      "curah_hujan_mm": 6.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 4.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 16.6,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG Sijunjung",
          "tipe_alat": "ARG",
          "jarak_km": 17.8,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH016",
      "nama_pos": "Ombilin weir",
      "latitude": -0.56,
      "longitude": 100.55,
      "kabupaten": "",
      "curah_hujan_mm": 26.5,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 29.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 6.9,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 16.5,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 18.8,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 20.2,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 24.0,
          "curah_hujan_mm": 29.0
        }
      ]
    },
    {
      "id_pos": "PH017",
      "nama_pos": "Galo Gandang",
      "latitude": -0.48541,
      "longitude": 100.55552,
      "kabupaten": "",
      "curah_hujan_mm": 45.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 34.7,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 2.2,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 8.2,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 18.8,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 21.7,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 23.1,
          "curah_hujan_mm": 8.6
        }
      ]
    },
    {
      "id_pos": "PH018",
      "nama_pos": "Rambatan",
      "latitude": -0.51,
      "longitude": 100.57,
      "kabupaten": "",
      "curah_hujan_mm": 54.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 29.1,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 1.1,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 10.8,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 20.2,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 21.7,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 23.8,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 24.9,
          "curah_hujan_mm": 29.8
        }
      ]
    },
    {
      "id_pos": "PH019",
      "nama_pos": "Diperta Tanah Datar",
      "latitude": -0.475,
      "longitude": 100.62,
      "kabupaten": "",
      "curah_hujan_mm": 42.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 36.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 6.4,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 9.0,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 18.5,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 24.7,
          "curah_hujan_mm": 29.0
        }
      ]
    },
    {
      "id_pos": "PH020",
      "nama_pos": "BPP Sungayang",
      "latitude": -0.38,
      "longitude": 100.63,
      "kabupaten": "",
      "curah_hujan_mm": 48.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 39.9,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 7.8,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 15.1,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 22.0,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 23.7,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 24.2,
          "curah_hujan_mm": 29.0
        }
      ]
    },
    {
      "id_pos": "PH021",
      "nama_pos": "Bpp Sei Tarab",
      "latitude": -0.37183,
      "longitude": 100.55294,
      "kabupaten": "",
      "curah_hujan_mm": 50.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 37.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 4.8,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 13.5,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 14.4,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 15.7,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 24.3,
          "curah_hujan_mm": 21.6
        }
      ]
    },
    {
      "id_pos": "PH022",
      "nama_pos": "Salimpaung",
      "latitude": -0.33,
      "longitude": 100.57,
      "kabupaten": "",
      "curah_hujan_mm": 42.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 36.8,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 9.2,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 14.5,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 18.8,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 19.0,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 19.8,
          "curah_hujan_mm": 21.6
        },
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 20.8,
          "curah_hujan_mm": 34.4
        }
      ]
    },
    {
      "id_pos": "PH023",
      "nama_pos": "Malalo",
      "latitude": -0.57,
      "longitude": 100.48,
      "kabupaten": "",
      "curah_hujan_mm": 55.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 42.4,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 12.5,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 20.1,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 20.4,
          "curah_hujan_mm": 76.0
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 21.0,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 21.4,
          "curah_hujan_mm": 1.0
        }
      ]
    },
    {
      "id_pos": "PH024",
      "nama_pos": "StaMet Minangkabau",
      "latitude": -0.79333,
      "longitude": 100.28889,
      "kabupaten": "",
      "curah_hujan_mm": 41.2,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 41.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 0.5,
          "curah_hujan_mm": 41.3
        }
      ]
    },
    {
      "id_pos": "PH025",
      "nama_pos": "Sunur",
      "latitude": -0.67,
      "longitude": 100.19,
      "kabupaten": "",
      "curah_hujan_mm": 39.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 52.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 17.1,
          "curah_hujan_mm": 41.3
        },
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 17.9,
          "curah_hujan_mm": 38.6
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 18.3,
          "curah_hujan_mm": 76.0
        }
      ]
    },
    {
      "id_pos": "PH026",
      "nama_pos": "Sei Geringging",
      "latitude": -0.41986,
      "longitude": 100.08845,
      "kabupaten": "",
      "curah_hujan_mm": 36.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 38.6,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 12.9,
          "curah_hujan_mm": 38.6
        }
      ]
    },
    {
      "id_pos": "PH027",
      "nama_pos": "Ulakan Tapakis",
      "latitude": -0.7,
      "longitude": 100.22,
      "kabupaten": "",
      "curah_hujan_mm": 46.5,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 52.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 12.4,
          "curah_hujan_mm": 41.3
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 19.2,
          "curah_hujan_mm": 76.0
        },
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 22.5,
          "curah_hujan_mm": 38.6
        }
      ]
    },
    {
      "id_pos": "PH028",
      "nama_pos": "BPP Sintuk",
      "latitude": -0.65,
      "longitude": 100.26,
      "kabupaten": "",
      "curah_hujan_mm": 69.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 52.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 12.3,
          "curah_hujan_mm": 76.0
        },
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 15.7,
          "curah_hujan_mm": 41.3
        },
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 21.7,
          "curah_hujan_mm": 38.6
        }
      ]
    },
    {
      "id_pos": "PH029",
      "nama_pos": "Limau Purut",
      "latitude": -0.53,
      "longitude": 100.17,
      "kabupaten": "",
      "curah_hujan_mm": 80.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 57.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 7.5,
          "curah_hujan_mm": 38.6
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 14.4,
          "curah_hujan_mm": 76.0
        }
      ]
    },
    {
      "id_pos": "PH030",
      "nama_pos": "Tandikat",
      "latitude": -0.5,
      "longitude": 100.25,
      "kabupaten": "",
      "curah_hujan_mm": 103.0,
      "kategori": "Sangat Lebat",
      "warna": "#ef4444",
      "ch_aws_rata": 47.9,
      "flag_aws": "PERLU CERMATI: Selisih 55 mm",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 7.4,
          "curah_hujan_mm": 76.0
        },
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 16.9,
          "curah_hujan_mm": 38.6
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 21.6,
          "curah_hujan_mm": 29.0
        }
      ]
    },
    {
      "id_pos": "PH031",
      "nama_pos": "Lubuk Basung",
      "latitude": -0.29,
      "longitude": 99.95,
      "kabupaten": "",
      "curah_hujan_mm": 43.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 16.4,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Ampek Nagari",
          "tipe_alat": "ARG",
          "jarak_km": 11.6,
          "curah_hujan_mm": 16.4
        }
      ]
    },
    {
      "id_pos": "PH032",
      "nama_pos": "Matur",
      "latitude": -0.305,
      "longitude": 100.2528,
      "kabupaten": "",
      "curah_hujan_mm": 16.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 26.1,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS GAW Bukittinggi",
          "tipe_alat": "AAWS",
          "jarak_km": 13.6,
          "curah_hujan_mm": 19.6
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 20.4,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 20.9,
          "curah_hujan_mm": 29.8
        }
      ]
    },
    {
      "id_pos": "PH033",
      "nama_pos": "Baso",
      "latitude": -0.3,
      "longitude": 100.48,
      "kabupaten": "",
      "curah_hujan_mm": 61.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 34.4,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 5.5,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 12.8,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 15.9,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 18.0,
          "curah_hujan_mm": 21.6
        },
        {
          "nama_alat": "AAWS GAW Bukittinggi",
          "tipe_alat": "AAWS",
          "jarak_km": 21.0,
          "curah_hujan_mm": 19.6
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 24.4,
          "curah_hujan_mm": 54.2
        }
      ]
    },
    {
      "id_pos": "PH034",
      "nama_pos": "Suliki",
      "latitude": -0.1,
      "longitude": 100.5,
      "kabupaten": "",
      "curah_hujan_mm": 49.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 25.2,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 7.9,
          "curah_hujan_mm": 21.6
        },
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 20.0,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "AAWS GAW Bukittinggi",
          "tipe_alat": "AAWS",
          "jarak_km": 23.2,
          "curah_hujan_mm": 19.6
        }
      ]
    },
    {
      "id_pos": "PH035",
      "nama_pos": "Luhak",
      "latitude": -0.28,
      "longitude": 100.68,
      "kabupaten": "",
      "curah_hujan_mm": 63.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 36.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 12.3,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 19.3,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 20.4,
          "curah_hujan_mm": 21.6
        }
      ]
    },
    {
      "id_pos": "PH036",
      "nama_pos": "Politani Tanjungpati",
      "latitude": -0.17,
      "longitude": 100.67,
      "kabupaten": "",
      "curah_hujan_mm": 42.2,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 28.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 0.4,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 13.7,
          "curah_hujan_mm": 21.6
        }
      ]
    },
    {
      "id_pos": "PH037",
      "nama_pos": "Akabiluru",
      "latitude": -0.24,
      "longitude": 100.55,
      "kabupaten": "",
      "curah_hujan_mm": 50.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 33.4,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 9.7,
          "curah_hujan_mm": 21.6
        },
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 15.1,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 15.7,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 19.3,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 22.9,
          "curah_hujan_mm": 29.0
        }
      ]
    },
    {
      "id_pos": "PH038",
      "nama_pos": "Bonjol",
      "latitude": 0.0,
      "longitude": 100.25,
      "kabupaten": "",
      "curah_hujan_mm": 30.8,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 19.6,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS GAW Bukittinggi",
          "tipe_alat": "AAWS",
          "jarak_km": 23.7,
          "curah_hujan_mm": 19.6
        }
      ]
    },
    {
      "id_pos": "PH039",
      "nama_pos": "Petok",
      "latitude": 0.29389,
      "longitude": 100.0975,
      "kabupaten": "",
      "curah_hujan_mm": 8.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH040",
      "nama_pos": "Rao",
      "latitude": 0.56,
      "longitude": 100.02,
      "kabupaten": "",
      "curah_hujan_mm": 52.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 54.8,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Rao Pasaman",
          "tipe_alat": "ARG",
          "jarak_km": 2.2,
          "curah_hujan_mm": 54.8
        }
      ]
    },
    {
      "id_pos": "PH041",
      "nama_pos": "Muara Siberut",
      "latitude": -1.59773,
      "longitude": 99.19568,
      "kabupaten": "",
      "curah_hujan_mm": 39.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "TIDAK ADA DATA SEKITAR",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH042",
      "nama_pos": "Sei Dareh",
      "latitude": -1.061,
      "longitude": 101.5,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Dareh",
          "tipe_alat": "ARG",
          "jarak_km": 8.7,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH043",
      "nama_pos": "Timpeh",
      "latitude": -0.92,
      "longitude": 101.58,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Dareh",
          "tipe_alat": "ARG",
          "jarak_km": 11.3,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH044",
      "nama_pos": "Lubuk Gadang Selatan",
      "latitude": -1.55,
      "longitude": 101.25,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Solok Selatan",
          "tipe_alat": "ARG",
          "jarak_km": 5.6,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH045",
      "nama_pos": "BPP Sangir Batanghari",
      "latitude": -1.27,
      "longitude": 101.39,
      "kabupaten": "",
      "curah_hujan_mm": 0.9,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": null,
      "flag_aws": null,
      "flag_spatial": "PERLU CERMATI: Hanya 0% pos sekitar ada hujan",
      "status": "NORMAL",
      "detail_aws": []
    },
    {
      "id_pos": "PH046",
      "nama_pos": "Pekonina",
      "latitude": -1.59054,
      "longitude": 101.14329,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 0.0,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Solok Selatan",
          "tipe_alat": "ARG",
          "jarak_km": 7.4,
          "curah_hujan_mm": 0.0
        }
      ]
    },
    {
      "id_pos": "PH047",
      "nama_pos": "Gunung Tuleh",
      "latitude": 0.2363,
      "longitude": 99.7166,
      "kabupaten": "",
      "curah_hujan_mm": 73.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 18.4,
      "flag_aws": "PERLU CERMATI: Selisih 55 mm",
      "flag_spatial": "TIDAK ADA DATA SEKITAR",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Pasaman Barat",
          "tipe_alat": "AWS",
          "jarak_km": 21.0,
          "curah_hujan_mm": 18.4
        }
      ]
    },
    {
      "id_pos": "PH048",
      "nama_pos": "Muara Palam - Parak Karakah",
      "latitude": -0.94,
      "longitude": 100.38,
      "kabupaten": "",
      "curah_hujan_mm": 2.5,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 16.9,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Maritim Bungus",
          "tipe_alat": "AWS",
          "jarak_km": 10.1,
          "curah_hujan_mm": 5.8
        },
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 19.7,
          "curah_hujan_mm": 41.3
        },
        {
          "nama_alat": "ARG Solok",
          "tipe_alat": "ARG",
          "jarak_km": 24.5,
          "curah_hujan_mm": 3.6
        }
      ]
    },
    {
      "id_pos": "PH049",
      "nama_pos": "Tambang Semen Padang",
      "latitude": -0.96,
      "longitude": 100.5,
      "kabupaten": "",
      "curah_hujan_mm": 1.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 4.7,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Solok",
          "tipe_alat": "ARG",
          "jarak_km": 11.2,
          "curah_hujan_mm": 3.6
        },
        {
          "nama_alat": "AWS Maritim Bungus",
          "tipe_alat": "AWS",
          "jarak_km": 13.9,
          "curah_hujan_mm": 5.8
        }
      ]
    },
    {
      "id_pos": "PH050",
      "nama_pos": "Limau Manih - UNAND",
      "latitude": -0.9164,
      "longitude": 100.4367,
      "kabupaten": "",
      "curah_hujan_mm": 0.0,
      "kategori": "Tidak Hujan",
      "warna": "#64748b",
      "ch_aws_rata": 16.9,
      "flag_aws": "SUSPECT: PH=0 mm tapi AWS=16.9 mm",
      "flag_spatial": "SUSPECT: 100% pos sekitar ada hujan",
      "status": "SUSPECT",
      "detail_aws": [
        {
          "nama_alat": "AWS Maritim Bungus",
          "tipe_alat": "AWS",
          "jarak_km": 13.4,
          "curah_hujan_mm": 5.8
        },
        {
          "nama_alat": "ARG Solok",
          "tipe_alat": "ARG",
          "jarak_km": 18.5,
          "curah_hujan_mm": 3.6
        },
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 21.8,
          "curah_hujan_mm": 41.3
        }
      ]
    },
    {
      "id_pos": "PH051",
      "nama_pos": "Nanggalo",
      "latitude": -0.91,
      "longitude": 100.36,
      "kabupaten": "",
      "curah_hujan_mm": 2.0,
      "kategori": "Sangat Ringan",
      "warna": "#bae6fd",
      "ch_aws_rata": 23.5,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Maritim Bungus",
          "tipe_alat": "AWS",
          "jarak_km": 13.9,
          "curah_hujan_mm": 5.8
        },
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 15.7,
          "curah_hujan_mm": 41.3
        }
      ]
    },
    {
      "id_pos": "PH052",
      "nama_pos": "Lubuk Minturun",
      "latitude": -0.85,
      "longitude": 100.38,
      "kabupaten": "",
      "curah_hujan_mm": 22.5,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 23.5,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Bandara Minangkabau",
          "tipe_alat": "AWS",
          "jarak_km": 12.3,
          "curah_hujan_mm": 41.3
        },
        {
          "nama_alat": "AWS Maritim Bungus",
          "tipe_alat": "AWS",
          "jarak_km": 20.0,
          "curah_hujan_mm": 5.8
        }
      ]
    },
    {
      "id_pos": "PH053",
      "nama_pos": "Lubuk Sikarah",
      "latitude": -0.77,
      "longitude": 100.61,
      "kabupaten": "",
      "curah_hujan_mm": 12.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 4.4,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 5.5,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "ARG Solok",
          "tipe_alat": "ARG",
          "jarak_km": 19.7,
          "curah_hujan_mm": 3.6
        },
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 22.7,
          "curah_hujan_mm": 8.6
        }
      ]
    },
    {
      "id_pos": "PH054",
      "nama_pos": "BPP Kolok",
      "latitude": -0.6,
      "longitude": 100.73,
      "kabupaten": "",
      "curah_hujan_mm": 9.0,
      "kategori": "Ringan",
      "warna": "#60a5fa",
      "ch_aws_rata": 21.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Berangin",
          "tipe_alat": "ARG",
          "jarak_km": 0.4,
          "curah_hujan_mm": 8.6
        },
        {
          "nama_alat": "AAWS Sumani",
          "tipe_alat": "AAWS",
          "jarak_km": 20.0,
          "curah_hujan_mm": 1.0
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 21.1,
          "curah_hujan_mm": 54.2
        }
      ]
    },
    {
      "id_pos": "PH055",
      "nama_pos": "PU Padang Panjang",
      "latitude": -0.45,
      "longitude": 100.44,
      "kabupaten": "",
      "curah_hujan_mm": 27.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 48.2,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG X Koto",
          "tipe_alat": "ARG",
          "jarak_km": 7.0,
          "curah_hujan_mm": 29.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 13.5,
          "curah_hujan_mm": 29.8
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 14.9,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "ARG SMPK Tanah Datar",
          "tipe_alat": "ARG",
          "jarak_km": 15.3,
          "curah_hujan_mm": 54.2
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 19.0,
          "curah_hujan_mm": 76.0
        }
      ]
    },
    {
      "id_pos": "PH056",
      "nama_pos": "Payakumbuh Selatan",
      "latitude": -0.25,
      "longitude": 100.63,
      "kabupaten": "",
      "curah_hujan_mm": 86.0,
      "kategori": "Lebat",
      "warna": "#f59e0b",
      "ch_aws_rata": 34.4,
      "flag_aws": "PERLU CERMATI: Selisih 52 mm",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "AWS Harau",
          "tipe_alat": "AWS",
          "jarak_km": 9.8,
          "curah_hujan_mm": 34.4
        },
        {
          "nama_alat": "ARG Guguak",
          "tipe_alat": "ARG",
          "jarak_km": 14.1,
          "curah_hujan_mm": 21.6
        },
        {
          "nama_alat": "ARG Sungai Tarab",
          "tipe_alat": "ARG",
          "jarak_km": 19.3,
          "curah_hujan_mm": 52.0
        },
        {
          "nama_alat": "AWS Canduang",
          "tipe_alat": "AWS",
          "jarak_km": 22.9,
          "curah_hujan_mm": 29.8
        }
      ]
    },
    {
      "id_pos": "PH057",
      "nama_pos": "Pariaman",
      "latitude": -0.6,
      "longitude": 100.13,
      "kabupaten": "",
      "curah_hujan_mm": 43.0,
      "kategori": "Sedang",
      "warna": "#3b82f6",
      "ch_aws_rata": 57.3,
      "flag_aws": "OK",
      "flag_spatial": "KONSISTEN",
      "status": "NORMAL",
      "detail_aws": [
        {
          "nama_alat": "ARG Sungai Limau",
          "tipe_alat": "ARG",
          "jarak_km": 7.9,
          "curah_hujan_mm": 38.6
        },
        {
          "nama_alat": "AAWS Staklim Padang Pariaman",
          "tipe_alat": "AAWS",
          "jarak_km": 19.7,
          "curah_hujan_mm": 76.0
        }
      ]
    }
  ]
};

// ===== INISIALISASI PETA =====
function initMap() {
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

// ===== BUAT MARKER CUSTOM =====
function buatMarker(pos) {
  const isSuspect = pos.status === 'SUSPECT';
  const size = pos.curah_hujan_mm > 0 ? 20 : 14;

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px; height:${size}px;
      border-radius:50%;
      background:${pos.warna};
      border: 2px solid ${isSuspect ? '#f59e0b' : 'rgba(255,255,255,0.4)'};
      box-shadow: ${isSuspect ? '0 0 10px rgba(245,158,11,0.8)' : '0 2px 6px rgba(0,0,0,0.4)'};
      ${isSuspect ? 'animation: pulse 2s infinite;' : ''}
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
  });

  const marker = L.marker([pos.latitude, pos.longitude], { icon })
    .addTo(state.map)
    .on('click', () => tampilkanDetail(pos.id_pos));

  const popupHTML = `
    <div style="font-family:'Space Grotesk',sans-serif; min-width:160px;">
      <div style="font-size:10px; color:#3fb950; font-family:monospace; letter-spacing:0.05em;">${pos.id_pos}</div>
      <div style="font-size:14px; font-weight:600; margin: 2px 0;">${pos.nama_pos}</div>
      <div style="font-size:12px; color:#7d8590;">${pos.kabupaten}</div>
      <div style="margin-top:8px; padding-top:8px; border-top:1px solid #30363d; display:flex; align-items:center; gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${pos.warna};flex-shrink:0;"></div>
        <span style="font-size:13px; font-weight:600;">${pos.curah_hujan_mm} mm</span>
        <span style="font-size:11px; color:#7d8590;">${pos.kategori}</span>
      </div>
      ${pos.status === 'SUSPECT' ? '<div style="margin-top:6px; font-size:11px; color:#d29922; background:#3a2a10; padding:4px 8px; border-radius:4px; border-left:3px solid #d29922;">⚠ Pos Suspect</div>' : ''}
    </div>
  `;

  marker.bindPopup(popupHTML, { maxWidth: 220 });
  return marker;
}

// ===== RENDER SEMUA MARKER =====
function renderMarkers(posHujanList) {
  // Hapus semua marker lama
  Object.values(state.markers).forEach(m => m.remove());
  state.markers = {};

  posHujanList.forEach(pos => {
    state.markers[pos.id_pos] = buatMarker(pos);
  });
}

// ===== RENDER DAFTAR POS DI SIDEBAR =====
function renderPosList(posHujanList) {
  const container = document.getElementById('pos-list');
  
  if (posHujanList.length === 0) {
    container.innerHTML = '<div class="loading-msg">Tidak ada pos ditemukan</div>';
    return;
  }

  // Urutkan: suspect dulu, lalu berdasarkan curah hujan
  const sorted = [...posHujanList].sort((a, b) => {
    if (a.status === 'SUSPECT' && b.status !== 'SUSPECT') return -1;
    if (b.status === 'SUSPECT' && a.status !== 'SUSPECT') return 1;
    return b.curah_hujan_mm - a.curah_hujan_mm;
  });

  container.innerHTML = sorted.map(pos => `
    <div class="pos-item ${pos.status === 'SUSPECT' ? 'suspect' : ''}"
         onclick="tampilkanDetail('${pos.id_pos}')"
         data-id="${pos.id_pos}">
      <div class="pos-dot" style="background:${pos.warna}; ${pos.status === 'SUSPECT' ? 'border:1.5px solid #f59e0b; box-shadow:0 0 5px rgba(245,158,11,0.6);' : ''}"></div>
      <div class="pos-name">${pos.nama_pos}</div>
      <div class="pos-ch">${pos.curah_hujan_mm} mm</div>
      ${pos.status === 'SUSPECT' ? '<div class="pos-suspect-tag">SUSPECT</div>' : ''}
    </div>
  `).join('');
}

// ===== UPDATE STATISTIK =====
function updateStats(data) {
  const posHujan = data.pos_hujan;
  const jumlahHujan = posHujan.filter(p => p.curah_hujan_mm > 0).length;

  document.getElementById('stat-total').textContent = data.metadata.total_pos;
  document.getElementById('stat-normal').textContent = data.metadata.pos_normal;
  document.getElementById('stat-suspect').textContent = data.metadata.pos_suspect;
  document.getElementById('stat-hujan').textContent = jumlahHujan;

  // Format tanggal
  const tgl = data.metadata.tanggal_analisis;
  const tglFormatted = tgl ? new Date(tgl).toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }) : '—';
  document.getElementById('tanggal-display').textContent = tglFormatted;
  document.getElementById('update-time').textContent = `Diproses: ${data.metadata.waktu_proses || '—'}`;

  // Suspect bar
  const suspectBar = document.getElementById('suspect-bar');
  const suspectText = document.getElementById('suspect-bar-text');
  if (data.metadata.pos_suspect > 0) {
    suspectText.textContent = `${data.metadata.pos_suspect} pos suspect terdeteksi — klik untuk lihat daftar`;
    suspectBar.classList.remove('hidden');
    suspectBar.onclick = () => {
      document.querySelector('[data-filter="SUSPECT"]').click();
    };
  } else {
    suspectBar.classList.add('hidden');
  }
}

// ===== TAMPILKAN DETAIL POS =====
function tampilkanDetail(idPos) {
  const pos = state.posHujan.find(p => p.id_pos === idPos);
  if (!pos) return;

  state.posSelected = idPos;

  document.getElementById('d-id').textContent = pos.id_pos;
  document.getElementById('d-nama').textContent = pos.nama_pos;
  document.getElementById('d-kab').textContent = pos.kabupaten;
  document.getElementById('d-ch').textContent = `${pos.curah_hujan_mm} mm`;
  document.getElementById('d-kategori').textContent = pos.kategori;
  document.getElementById('d-aws').textContent = pos.ch_aws_rata !== null ? `${pos.ch_aws_rata} mm` : 'Tidak ada alat';
  document.getElementById('d-coords').textContent = `${pos.latitude}, ${pos.longitude}`;

  const statusBadge = document.getElementById('d-status');
  statusBadge.textContent = pos.status;
  statusBadge.className = `status-badge ${pos.status === 'SUSPECT' ? 'suspect' : 'normal'}`;

  // Flag AWS
  const flagAwsEl = document.getElementById('d-flag-aws');
  if (pos.flag_aws) {
    const isOk = pos.flag_aws === 'OK';
    flagAwsEl.className = `flag-box ${isOk ? 'flag-ok' : 'flag-suspect'}`;
    flagAwsEl.textContent = `Komparasi AWS: ${pos.flag_aws}`;
    flagAwsEl.style.display = 'block';
  } else {
    flagAwsEl.style.display = 'none';
  }

  // Flag Spatial
  const flagSpatialEl = document.getElementById('d-flag-spatial');
  if (pos.flag_spatial) {
    const isOk = pos.flag_spatial === 'KONSISTEN';
    flagSpatialEl.className = `flag-box ${isOk ? 'flag-ok' : 'flag-suspect'}`;
    flagSpatialEl.textContent = `Analisis Spasial: ${pos.flag_spatial}`;
    flagSpatialEl.style.display = 'block';
  } else {
    flagSpatialEl.style.display = 'none';
  }

  // Detail alat terdekat
  const awsTitle = document.getElementById('d-aws-title');
  const awsList  = document.getElementById('d-aws-list');

  if (pos.detail_aws && pos.detail_aws.length > 0) {
    awsTitle.textContent = `Alat Otomatis Terdekat (${pos.detail_aws.length})`;
    awsList.innerHTML = pos.detail_aws.map(a => `
      <div class="aws-item">
        <div>
          <div class="aws-name">${a.nama_alat}</div>
          <div class="aws-jarak">${a.jarak_km} km</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <div class="aws-tipe">${a.tipe_alat}</div>
          <div class="aws-ch">${a.curah_hujan_mm} mm</div>
        </div>
      </div>
    `).join('');
  } else {
    awsTitle.textContent = '';
    awsList.innerHTML = '<div style="font-size:11px; color:#484f58; padding:6px 0;">Tidak ada alat otomatis dalam radius 30 km</div>';
  }

  document.getElementById('detail-panel').classList.remove('hidden');

  // Pan peta ke pos
  state.map.panTo([pos.latitude, pos.longitude]);
  if (state.markers[idPos]) {
    state.markers[idPos].openPopup();
  }

  // Highlight di sidebar
  document.querySelectorAll('.pos-item').forEach(el => el.style.background = '');
  const activeItem = document.querySelector(`[data-id="${idPos}"]`);
  if (activeItem) {
    activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    activeItem.style.background = 'rgba(63,185,80,0.1)';
  }
}

function tutupDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  state.posSelected = null;
}

// ===== FILTER =====
function applyFilter(filter) {
  state.filterAktif = filter;
  let filtered = [...state.posHujan];

  if (filter === 'SUSPECT') filtered = filtered.filter(p => p.status === 'SUSPECT');
  else if (filter === 'hujan') filtered = filtered.filter(p => p.curah_hujan_mm > 0);
  else if (filter === 'kering') filtered = filtered.filter(p => p.curah_hujan_mm === 0);

  renderMarkers(filtered);
  renderPosList(filtered);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
}

// ===== SEARCH =====
document.getElementById('search-pos').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  let filtered = [...state.posHujan];

  if (state.filterAktif !== 'semua') {
    if (state.filterAktif === 'SUSPECT') filtered = filtered.filter(p => p.status === 'SUSPECT');
    else if (state.filterAktif === 'hujan') filtered = filtered.filter(p => p.curah_hujan_mm > 0);
    else if (state.filterAktif === 'kering') filtered = filtered.filter(p => p.curah_hujan_mm === 0);
  }

  if (q) {
    filtered = filtered.filter(p =>
      p.nama_pos.toLowerCase().includes(q) ||
      p.kabupaten.toLowerCase().includes(q) ||
      p.id_pos.toLowerCase().includes(q)
    );
  }

  renderPosList(filtered);
});

// ===== LOAD DATA =====
async function loadData() {
  try {
    const response = await fetch(CONFIG.DATA_URL + '?t=' + Date.now());
    if (!response.ok) throw new Error('File tidak ditemukan');
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('Gagal load JSON, menggunakan data dummy:', err.message);
    if (CONFIG.USE_DUMMY_ON_FAIL) return DUMMY_DATA;
    throw err;
  }
}

// ===== INISIALISASI UTAMA =====
async function init() {
  initMap();

  // Setup filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });

  try {
    const data = await loadData();
    state.dataRaw = data;
    state.posHujan = data.pos_hujan;

    updateStats(data);
    renderMarkers(state.posHujan);
    renderPosList(state.posHujan);

  } catch (err) {
    document.getElementById('pos-list').innerHTML =
      '<div class="loading-msg" style="color:#f85149;">Gagal memuat data: ' + err.message + '</div>';
    console.error(err);
  }
}

// Jalankan saat DOM siap
document.addEventListener('DOMContentLoaded', init);
