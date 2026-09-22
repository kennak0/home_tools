# vendor/tesseract

端末内 OCR（段階 2b）用。CDN から読まず、自分のオリジンから配信する。
**precache の対象外**（合計 約 9.5MB。初めて「写真から読み取る」を押したときに取る）。

| ファイル | 出所 | バージョン |
|---|---|---|
| `tesseract.esm.min.js` `worker.min.js` | npm `tesseract.js` の `dist/` | 7.0.0 |
| `tesseract-core-simd-lstm.wasm.js` `tesseract-core-lstm.wasm.js` | npm `tesseract.js-core`（WASM を埋め込んだ単一ファイル版）。SIMD 対応なら前者、無ければ後者を `ocr.js` が選ぶ | 7.0.0 |
| `jpn.traineddata.gz` | https://github.com/tesseract-ocr/tessdata_fast/raw/main/jpn.traineddata を gzip -9 | tessdata_fast（2026-09-22 取得） |

ライセンス: tesseract.js / tesseract.js-core は Apache-2.0（`LICENSE.*`）、tessdata は Apache-2.0。

更新手順:

```bash
cd /tmp && npm pack tesseract.js tesseract.js-core   # tgz を展開して上の 4 ファイルを差し替える
curl -L -o jpn.traineddata https://github.com/tesseract-ocr/tessdata_fast/raw/main/jpn.traineddata
gzip -9 -c jpn.traineddata > pwa/family-schedule/vendor/tesseract/jpn.traineddata.gz
```
