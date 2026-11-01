# PenawarPlus

Extension Chrome / Brave (Manifest V3) yang menjadi *penawar* kepada anti-adblock: memalsukan bait yang
dikesan, melumpuhkan skrip pengesan, dan menyembunyikan dinding "sila matikan adblock".
Ia **melengkapkan** adblocker sedia ada (uBlock Origin, Brave Shields); ia tidak menyekat iklan.

## Pasang

```bash
git clone https://github.com/Zaqrul/penawarplus.git penawarplus
```

1. Buka `chrome://extensions` (Brave: `brave://extensions`) → hidupkan **Developer mode**.
2. **Load unpacked** → pilih folder `penawarplus`.
3. *(Pilihan, untuk butang git pull)* `node native-host/install.js` — lihat [Kemas kini](#kemas-kini).

Extension ID sentiasa `apdappnkjceohidhneafhcoglhffnamk` kerana `manifest.json` mengandungi `key`.

## Struktur

```
manifest.json            ← sumber tunggal untuk nama & versi
rules/rules.json         ← DATA rule per-site (ini yang paling kerap diubah)
src/
  scriptlets/            ← kod yang dijalankan dalam page; satu fail satu tugas
    index.js             ← pendaftaran: satu-satunya senarai kod yang rule boleh panggil
  background/            ← service worker (modul ES, tiada build step)
    rules.js             ← format, validasi, padanan host   (tulen, diuji)
    rules-store.js       ← bundled → remote → rule pengguna
    updater.js           ← semak versi, tarik rule, git pull
    injector.js          ← suntik scriptlet ikut site
    content-scripts.js   ← daftar skrip generic (boleh dimatikan ikut site)
    native.js, github.js, semver.js, settings.js, index.js
  content/
    generic-main.js      ← pertahanan sentiasa-aktif (dalam konteks page, document_start)
    overlay-remover.js   ← sembunyi dinding amaran, buka semula scroll
  popup/, options/       ← UI
native-host/             ← helper kecil (Node) yang menjalankan `git pull`
tests/                   ← `npm test`
```

Tiada bundler, tiada `npm install` — fail dalam repo ialah fail yang dimuatkan browser.

## Kemas kini

Ada **dua saluran**, kerana Manifest V3 melarang kod jauh dan extension tidak boleh mengubah failnya sendiri:

| Saluran | Apa | Perlu apa | Bila |
|---|---|---|---|
| **Rule** (data) | `rules/rules.json` dibaca dari repo, disahkan, disimpan | Helper git (repo private) atau rangkaian sahaja (repo awam) | Automatik (~6 jam) atau butang *Kemas kini rule* |
| **Kod** (extension) | `git pull --ff-only` dalam folder extension, kemudian reload | Helper native (sekali pasang) | **Hanya bila anda tekan** *Kemas kini sekarang* |

Aliran butang: popup → **Semak kemas kini** membandingkan `version` dalam `manifest.json` tempatan dengan
yang di branch repo → jika lebih baharu, butang **Kemas kini sekarang** muncul → helper menjalankan
`git pull --ff-only` → extension reload sendiri. Lencana `↑` pada ikon menandakan versi baharu tersedia.

### Pasang helper git (sekali, Windows)

Perlu Node.js dan git dalam PATH.

```bash
node native-host/install.js      # daftar untuk Chrome, Brave, Edge (pengguna semasa, tanpa admin)
node native-host/uninstall.js    # buang
```

Kemudian reload extension. *Tetapan* akan memaparkan "Dipasang". Helper:
- hanya faham `ping`, `info`, `pull`, `remote-file` (fail dalam senarai tetap sahaja); tiada arahan atau path sewenang-wenang;
- menjalankan `git -C <folder extension> ...` tanpa shell, `--ff-only` (tidak pernah merge atau menimpa kerja tempatan);
- hanya boleh dipanggil oleh extension ID di atas (`allowed_origins`).

macOS/Linux: pemasang belum ditulis; daftarkan `native-host/host.js` secara manual mengikut dokumentasi Chrome.

### Repo private atau awam?

| | Helper git dipasang | Tanpa helper |
|---|---|---|
| Semak versi & tarik rule | `git fetch` + baca `origin` (guna credential git anda) | `raw.githubusercontent.com`, tanpa login |
| Repo **private** | berfungsi | **tidak berfungsi** (404) |
| Repo **awam** | berfungsi | berfungsi (isi `owner/nama` dalam *Tetapan*) |
| Butang *Kemas kini sekarang* | berfungsi | tiada |

Dengan helper, tiada tetapan repo diperlukan: ia menggunakan `origin` bagi folder extension.
Semakan hanya membaca (`git fetch`); fail anda tidak berubah sehingga anda tekan *Kemas kini sekarang*.
Helper hanya boleh membaca `manifest.json` dan `rules/rules.json` (senarai tetap).

## Menambah rule untuk site yang degil

Edit `rules/rules.json` (atau tampal ke *Tetapan → Rule sendiri* untuk ujian tanpa commit):

```json
{
  "schema": 1,
  "version": "2026.11.02",
  "sites": [
    {
      "hosts": ["contoh.example"],
      "scriptlets": [
        ["set-constant", "adBlockDetected", "false"],
        ["no-fetch-if", "adsbygoogle"],
        ["spoof-css", ".ad-bait", "display", "block"]
      ],
      "remove": [".adblock-modal"],
      "unlock": true,
      "note": "kenapa rule ini wujud"
    }
  ]
}
```

- `hosts`: domain + semua subdomain; `"*"` = semua site.
- `scriptlets`: `["nama", arg…]`, semua arg ialah string.
- `remove`: selector CSS yang disembunyikan. `unlock`: pulihkan scroll.
- **Naikkan `version`** supaya pengguna lain menerima kemas kini rule.

| Scriptlet | Args | Kesan |
|---|---|---|
| `set-constant` | `rantai`, `nilai` | `window.rantai` sentiasa bernilai itu. Nilai: `true false null undefined noopFunc trueFunc falseFunc emptyObj emptyArr`, nombor, atau `""` |
| `abort-on-property-read` | `rantai` | Skrip yang *membaca* property itu berhenti (ReferenceError) |
| `abort-on-property-write` | `rantai` | Skrip yang *menulis* property itu berhenti |
| `no-fetch-if` | `teks` atau `/regex/` | `fetch()` ke URL itu dijawab 200 kosong |
| `prevent-setTimeout` / `prevent-setInterval` | `teks atau /regex/`, `delay` (pilihan) | Callback yang sepadan dijadikan no-op |
| `spoof-css` | `selector`, `prop`, `nilai`, … | `getComputedStyle` melaporkan nilai palsu untuk elemen itu |

Rule hanya boleh memilih dari senarai ini. Rule jauh yang tidak sah ditolak **sepenuhnya** (tidak separa-guna).

### Menambah scriptlet baharu

1. Tulis fungsi **self-contained** dalam `src/scriptlets/` (ia diserialisasi — tidak boleh merujuk apa-apa di luar badannya).
2. Daftar dalam `src/scriptlets/index.js` (`fn`, `minArgs`, `args`).
3. Tambah sampel dalam `tests/scriptlets.test.js` — ujian gagal jika anda lupa, dan ia menjalankan fungsi dalam sandbox untuk memastikan ia benar-benar self-contained.

## Release checklist

1. Ubah kod/rule; `npm test` mesti lulus.
2. Naikkan `version` dalam **`manifest.json`** (dan `package.json`). Tanpa ini, pengguna tidak akan nampak butang kemas kini.
3. Jika rule berubah, naikkan `version` dalam `rules/rules.json`.
4. `git commit` → `git push`.

## Had yang perlu diketahui

- **Tidak diuji dalam browser sebenar lagi.** Diuji: logik rule/scriptlet/host/`git pull`/`remote-file` (`npm test`, 29 ujian) dan `generic-main.js` dalam jsdom. Belum diuji: pemuatan extension, popup/options, `webNavigation` + `executeScript`, native messaging dalam Chrome/Brave sebenar.
- **Perlumbaan masa:** scriptlet per-site disuntik melalui `webNavigation.onCommitted`; ia sangat awal tetapi boleh kalah kepada skrip inline pertama sesetengah site. `generic-main.js` tidak ada masalah ini.
- **Skrip detector yang diisytiharkan sebagai `function FuckAdBlock(){}` global** boleh menimpa objek palsu; site begitu perlukan rule khusus.
- Site yang mengesan di sisi server, atau dengan kod unik, tidak akan lepas dengan pertahanan generic.
- Pertahanan generic sentiasa aktif kecuali anda matikan site itu di popup; ia tidak boleh dikecualikan di bawah tahap domain.
- Tiada rule untuk site sebenar disertakan: `rules/rules.json` bermula kosong sehingga ia diuji pada site yang berkenaan.

## Kredit & lesen

Teknik dikaji daripada dokumentasi dan kod terbuka [uBlock Origin](https://github.com/gorhill/uBlock/wiki/Resources-Library),
[AdGuard Scriptlets](https://github.com/AdguardTeam/Scriptlets) dan [EasyList Adblock Warning Removal List](https://github.com/easylist/antiadblockfilters).
Semua kod di sini ditulis semula secara bebas — **tiada kod GPL disalin**. Jika anda kelak menyalin kod atau rule daripada
projek GPL-3.0 (contohnya rule dari uAssets), projek ini mesti dilesenkan GPL-3.0 juga dan atribusi disertakan.
