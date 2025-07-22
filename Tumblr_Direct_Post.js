// ==UserScript==
// @name         Tumblr Direct Post
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  選択したテキストや画像を直接Tumblrに投稿（OAuth不要・ショートカットキー: Ctrl+Shift+P）
// @author       test_js
// @match        *://*/*
// @exclude      https://www.tumblr.com/oauth/*
// @grant        GM_addStyle
// @grant        window.open
// ==/UserScript==

(function () {
  "use strict";

  // スタイル定義
  GM_addStyle(`
        .tumblr-post-button {
            position: absolute;
            background-color: #001935;
            color: white;
            border: none;
            border-radius: 3px;
            padding: 5px 10px;
            font-size: 14px;
            cursor: pointer;
            z-index: 9999;
            display: none;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .tumblr-post-button:hover {
            background-color: #00243f;
        }
        .tumblr-post-button:active {
            transform: translateY(1px);
        }
        
        .tumblr-image-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.8);
            z-index: 10000;
            display: none;
            overflow-y: auto;
        }
        
        .tumblr-image-modal-content {
            background-color: white;
            margin: 50px auto;
            padding: 20px;
            border-radius: 8px;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            position: relative;
        }
        
        .tumblr-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }
        
        .tumblr-modal-title {
            font-size: 18px;
            font-weight: bold;
            color: #001935;
            margin: 0;
        }
        
        .tumblr-modal-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .tumblr-modal-close:hover {
            color: #000;
        }
        
        .tumblr-image-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .tumblr-image-item {
            border: 2px solid transparent;
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.3s ease;
            background-color: #f8f8f8;
        }
        
        .tumblr-image-item:hover {
            border-color: #001935;
            transform: scale(1.05);
        }
        
        .tumblr-image-item.selected {
            border-color: #001935;
            box-shadow: 0 0 10px rgba(0, 25, 53, 0.3);
        }
        
        .tumblr-image-item img {
            width: 100%;
            height: 120px;
            object-fit: cover;
            display: block;
        }
        
        .tumblr-image-info {
            padding: 8px;
            font-size: 12px;
            color: #666;
            text-align: center;
        }
        
        .tumblr-modal-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 15px;
            border-top: 1px solid #ddd;
        }
        
        .tumblr-selection-info {
            font-size: 14px;
            color: #666;
        }
        
        .tumblr-post-selected {
            background-color: #001935;
            color: white;
            border: none;
            border-radius: 5px;
            padding: 10px 20px;
            font-size: 14px;
            cursor: pointer;
            disabled: true;
        }
        
        .tumblr-post-selected:hover:not(:disabled) {
            background-color: #00243f;
        }
        
        .tumblr-post-selected:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
    `);

  // ボタン要素の作成
  const button = document.createElement("button");
  button.textContent = "Tumblrに投稿";
  button.className = "tumblr-post-button";
  document.body.appendChild(button);

  let selectedText = "";
  let selectedImages = [];

  // モーダルウィンドウの作成
  const modal = document.createElement("div");
  modal.className = "tumblr-image-modal";
  modal.innerHTML = `
        <div class="tumblr-image-modal-content">
            <div class="tumblr-modal-header">
                <h3 class="tumblr-modal-title">画像を選択してTumblrに投稿</h3>
                <button class="tumblr-modal-close">×</button>
            </div>
            <div class="tumblr-image-grid" id="tumblr-image-grid">
                <!-- 画像が動的に追加される -->
            </div>
            <div class="tumblr-modal-footer">
                <div class="tumblr-selection-info">
                    選択済み: <span id="tumblr-selection-count">0</span>個
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="tumblr-post-selected" id="tumblr-post-selected" disabled>
                        Tumblrに投稿
                    </button>
                    <button class="tumblr-post-selected" id="tumblr-download-selected" disabled style="background-color: #00cf35;">
                        Tumblr(ダウンロード)
                    </button>
                    <button class="tumblr-post-selected" id="twitter-post-selected" disabled style="background-color: #1da1f2;">
                        Twitterに投稿
                    </button>
                </div>
            </div>
        </div>
    `;
  document.body.appendChild(modal);

  // Tumblr Share Widgetでテキスト投稿
  function postTextToTumblr(content, sourceUrl, sourceTitle) {
    const shareUrl =
      "https://www.tumblr.com/widgets/share/tool?" +
      "posttype=quote&" +
      "title=" +
      encodeURIComponent(`出典: ${sourceTitle}`) +
      "&" +
      "content=" +
      encodeURIComponent(`"${content}"\n\n${sourceUrl}`) +
      "&" +
      "canonicalUrl=" +
      encodeURIComponent(sourceUrl) +
      "&" +
      "source=" +
      encodeURIComponent(sourceUrl) +
      "&" +
      "shareSource=tumblr_share_button";

    window.open(
      shareUrl,
      "_blank",
      "width=700,height=600,scrollbars=yes,resizable=yes"
    );
  }

  // Tumblr Share Widgetで画像投稿（単一画像または複数画像対応）
  function postImageToTumblr(imageUrls, sourceUrl, sourceTitle) {
    const captionText = `出典: ${sourceTitle}\n${sourceUrl}`;

    // 単一画像の場合は配列に変換
    const imageArray = Array.isArray(imageUrls) ? imageUrls : [imageUrls];

    // TwitterのURL最適化（高品質画像用）
    const optimizedUrls = imageArray.map((url) => {
      if (url.includes("twimg.com") || url.includes("twitter.com")) {
        // Twitter画像の場合は高品質版を使用
        const baseUrl = url.split("?")[0];
        return baseUrl + "?format=jpg&name=4096x4096";
      }
      return url;
    });

    // 複数画像の場合はカンマ区切りで結合（photoset作成）
    const contentParam = optimizedUrls.join(",");

    const shareUrl =
      "https://www.tumblr.com/widgets/share/tool?" +
      "posttype=photo&" +
      "content=" +
      encodeURIComponent(contentParam) +
      "&" +
      "caption=" +
      encodeURIComponent(captionText) +
      "&" +
      "canonicalUrl=" +
      encodeURIComponent(sourceUrl) +
      "&" +
      "source=" +
      encodeURIComponent(sourceUrl) +
      "&" +
      "shareSource=tumblr_share_button";

    console.log(`${optimizedUrls.length}個の画像を投稿:`, optimizedUrls);
    window.open(
      shareUrl,
      "_blank",
      "width=700,height=600,scrollbars=yes,resizable=yes"
    );
  }

  // Tumblr Share Widgetで動画投稿
  function postVideoToTumblr(videoUrl, sourceUrl, sourceTitle) {
    const captionText = `出典: ${sourceTitle}\n${sourceUrl}`;

    const shareUrl =
      "https://www.tumblr.com/widgets/share/tool?" +
      "posttype=video&" +
      "embed=" +
      encodeURIComponent(videoUrl) +
      "&" +
      "caption=" +
      encodeURIComponent(captionText) +
      "&" +
      "canonicalUrl=" +
      encodeURIComponent(sourceUrl) +
      "&" +
      "shareSource=tumblr_share_button";

    console.log("動画を投稿:", videoUrl);
    window.open(
      shareUrl,
      "_blank",
      "width=700,height=600,scrollbars=yes,resizable=yes"
    );
  }

  // ページ内の動画を取得
  function getPageVideos() {
    const videos = [];

    // video要素を検索（実際に再生可能なものだけ）
    const videoElements = document.querySelectorAll("video");
    videoElements.forEach((video, index) => {
      if ((video.src || video.currentSrc) && video.duration > 0) {
        videos.push({
          src: video.src || video.currentSrc,
          type: "video",
          title: video.title || `動画 ${index + 1}`,
          element: video,
        });
      }
    });

    // iframe内の動画（YouTube、Vimeo等）を検索 - より厳密にチェック
    const iframeElements = document.querySelectorAll("iframe");
    iframeElements.forEach((iframe, index) => {
      const src = iframe.src;
      if (
        src &&
        iframe.offsetWidth > 200 &&
        iframe.offsetHeight > 150 &&
        (src.includes("youtube.com/embed") ||
          src.includes("youtu.be") ||
          src.includes("vimeo.com/video") ||
          src.includes("dailymotion.com/embed") ||
          src.includes("twitch.tv") ||
          src.includes("tiktok.com"))
      ) {
        videos.push({
          src: src,
          type: "iframe",
          title: `埋め込み動画 ${index + 1}`,
          element: iframe,
        });
      }
    });

    console.log("動画検出詳細:", {
      videoElements: videoElements.length,
      iframeElements: iframeElements.length,
      detectedVideos: videos.length,
      videos: videos,
    });

    return videos;
  }

  // ページ内の画像を取得
  function getPageImages() {
    const images = [];
    const imgElements = document.querySelectorAll("img");

    imgElements.forEach((img, index) => {
      // 小さすぎる画像やアイコンを除外
      if (
        img.width > 50 &&
        img.height > 50 &&
        img.src &&
        !img.src.startsWith("data:")
      ) {
        images.push({
          src: img.src,
          alt: img.alt || `画像 ${index + 1}`,
          width: img.width,
          height: img.height,
          element: img,
        });
      }
    });

    return images;
  }

  // Webストレージに画像を保存
  async function saveImageToStorage(imageUrl, filename) {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();

      // FileReaderを使用してBase64に変換
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64Data = reader.result;
          localStorage.setItem(`tumblr_image_${filename}`, base64Data);
          localStorage.setItem(`tumblr_image_${filename}_type`, blob.type);
          resolve(filename);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error("画像の保存に失敗:", error);
      throw error;
    }
  }

  // Tumblr投稿用の画像ダウンロード機能
  async function postImagesToTumblrWithDownload(
    imageUrls,
    sourceUrl,
    sourceTitle
  ) {
    try {
      const captionText = `出典: ${sourceTitle}\n${sourceUrl}`;

      // 画像をWebストレージに保存
      const savedImages = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const filename = `tumblr_download_${Date.now()}_${i}`;
        console.log(`画像 ${i + 1}/${imageUrls.length} を保存中...`);
        await saveImageToStorage(imageUrls[i], filename);
        savedImages.push(filename);
      }

      // 保存された画像のリストをストレージに保存
      localStorage.setItem(
        "tumblr_download_saved_images",
        JSON.stringify(savedImages)
      );
      localStorage.setItem("tumblr_download_caption", captionText);

      // 画像ファイルをダウンロード（手動アップロード用 - 無効化）
      // await downloadImagesAsFiles(savedImages);

      // Tumblr投稿画面を開く（Share Widget API使用）
      const tumblrUrl = `https://www.tumblr.com/widgets/share/tool?posttype=photo&caption=${encodeURIComponent(
        captionText
      )}&canonicalUrl=${encodeURIComponent(
        sourceUrl
      )}&source=${encodeURIComponent(
        sourceUrl
      )}&shareSource=tumblr_share_button`;
      const tumblrWindow = window.open(
        tumblrUrl,
        "_blank",
        "width=800,height=700,scrollbars=yes,resizable=yes"
      );

      // 自動アップロード機能を初期化
      initTumblrAutoUpload(tumblrWindow, savedImages);

      // ユーザーに手動アップロードの手順を説明（無効化）
      // showTumblrUploadInstructions(savedImages.length);

      // 5分後にストレージをクリア
      setTimeout(() => {
        clearTumblrDownloadImageStorage(savedImages);
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error("Tumblr投稿の準備に失敗:", error);
      alert("Tumblr投稿の準備に失敗しました。もう一度お試しください。");
    }
  }

  // Tumblr自動アップロード機能を初期化
  function initTumblrAutoUpload(tumblrWindow, savedImages) {
    if (!tumblrWindow || tumblrWindow.closed) {
      console.error("Tumblr投稿画面が開けませんでした");
      return;
    }

    console.log(`${savedImages.length}個の画像を自動アップロード開始`);

    // 少し待ってからアップロード処理を開始
    setTimeout(() => {
      performTumblrAutoUpload(tumblrWindow, savedImages);
    }, 3000);
  }

  // 実際のTumblr自動アップロード処理
  async function performTumblrAutoUpload(tumblrWindow, savedImages) {
    try {
      // Tumblrウィンドウがまだ開いているかチェック
      if (tumblrWindow.closed) {
        console.error("Tumblr投稿画面が閉じられました");
        return;
      }

      let tumblrDoc;
      try {
        tumblrDoc = tumblrWindow.document;
      } catch (error) {
        console.error(
          "Tumblrウィンドウへのアクセス権限がありません（クロスオリジンエラー）"
        );
        // フォールバック: 手動アップロード手順を表示
        showTumblrUploadInstructions(savedImages.length);
        return;
      }

      // ファイルアップロード要素を検索（Tumblrの実際の構造に合わせて）
      const fileInput =
        tumblrDoc.querySelector('.media-upload input[type="file"]') ||
        tumblrDoc.querySelector('input[name="photo"]') ||
        tumblrDoc.querySelector('input[accept*="image"]') ||
        tumblrDoc.querySelector('input[data-subview="upload"]') ||
        tumblrDoc.querySelector('input[type="file"][multiple]');

      if (!fileInput) {
        console.error(
          "ファイルアップロード要素が見つかりません - 再試行します"
        );
        // 再試行
        setTimeout(
          () => performTumblrAutoUpload(tumblrWindow, savedImages),
          2000
        );
        return;
      }

      console.log("ファイルアップロード要素を発見:", fileInput);

      // ドロップゾーンエリアも検索
      const dropzoneArea =
        tumblrDoc.querySelector(".dropzone-icon") ||
        tumblrDoc.querySelector(".split-cell-inner") ||
        tumblrDoc.querySelector("[data-js-mediauploadtext]");

      // 複数の画像ファイルを準備
      const files = [];
      for (const filename of savedImages) {
        const file = getStoredImageAsFile(filename);
        if (file) {
          files.push(file);
        }
      }

      if (files.length === 0) {
        console.error("有効な画像ファイルがありません");
        return;
      }

      // FileListオブジェクトを作成
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));

      // ドロップゾーンエリアがある場合はクリックしてからファイルを設定
      if (dropzoneArea) {
        console.log(
          "ドロップゾーンエリアを発見、クリックします:",
          dropzoneArea
        );
        dropzoneArea.click();
        // 少し待ってからファイルを設定
        setTimeout(() => {
          setFileInputFiles(fileInput, dataTransfer.files);
        }, 500);
      } else {
        setFileInputFiles(fileInput, dataTransfer.files);
      }

      function setFileInputFiles(input, files) {
        // ファイルを設定
        input.files = files;

        // イベントを発火
        const changeEvent = new Event("change", { bubbles: true });
        input.dispatchEvent(changeEvent);

        const inputEvent = new Event("input", { bubbles: true });
        input.dispatchEvent(inputEvent);

        // さらに詳細なイベントを発火
        const focusEvent = new Event("focus", { bubbles: true });
        input.dispatchEvent(focusEvent);

        const blurEvent = new Event("blur", { bubbles: true });
        input.dispatchEvent(blurEvent);
      }

      console.log(`${files.length}個の画像を自動アップロードしました`);

      // ストレージをクリア
      setTimeout(() => {
        clearTumblrDownloadImageStorage(savedImages);
      }, 2000);
    } catch (error) {
      console.error("自動アップロード処理エラー:", error);
      // エラー時は手動アップロード手順を表示
      showTumblrUploadInstructions(savedImages.length);
    }
  }

  // 画像をファイルとしてダウンロード
  async function downloadImagesAsFiles(savedImages) {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < savedImages.length; i++) {
      const filename = savedImages[i];
      const file = getStoredImageAsFile(filename);

      if (file) {
        // ファイルをダウンロード
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(
          `画像 ${i + 1}/${savedImages.length} をダウンロードしました: ${
            file.name
          }`
        );

        // 500ms待機（ダウンロード間隔）
        await delay(500);
      }
    }
  }

  // Tumblrダウンロード用のアップロード手順を表示
  function showTumblrUploadInstructions(imageCount) {
    const instructions = `
📸 Tumblr画像投稿の手順:

1. ${imageCount}個の画像ファイルがダウンロードされました
2. Tumblr投稿画面が開きます
3. 「写真を追加」ボタンをクリック
4. ダウンロードされた画像ファイルを選択してアップロード
5. 投稿ボタンをクリックして完了

💡 ヒント: 複数ファイルを一度に選択できます（Ctrl+クリック）
        `;

    alert(instructions);
  }

  // Twitter投稿用の画像ダウンロード機能
  async function postImagesToTwitter(imageUrls, sourceUrl, sourceTitle) {
    try {
      const captionText = `出典: ${sourceTitle}\n${sourceUrl}`;

      // 画像をWebストレージに保存
      const savedImages = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const filename = `twitter_${Date.now()}_${i}`;
        console.log(`画像 ${i + 1}/${imageUrls.length} を保存中...`);
        await saveImageToStorage(imageUrls[i], filename);
        savedImages.push(filename);
      }

      // 保存された画像のリストをストレージに保存
      localStorage.setItem("twitter_saved_images", JSON.stringify(savedImages));
      localStorage.setItem("twitter_caption", captionText);

      // 画像ファイルをダウンロード
      await downloadImagesAsFiles(savedImages);

      // Twitter投稿画面を開く
      const twitterUrl = `https://twitter.com/compose/tweet?text=${encodeURIComponent(
        captionText
      )}`;
      window.open(
        twitterUrl,
        "_blank",
        "width=800,height=700,scrollbars=yes,resizable=yes"
      );

      // ユーザーに手動アップロードの手順を説明
      showTwitterUploadInstructions(savedImages.length);

      // 5分後にストレージをクリア
      setTimeout(() => {
        clearTwitterImageStorage(savedImages);
      }, 5 * 60 * 1000);
    } catch (error) {
      console.error("Twitter投稿の準備に失敗:", error);
      alert("Twitter投稿の準備に失敗しました。もう一度お試しください。");
    }
  }

  // Twitter用のアップロード手順を表示
  function showTwitterUploadInstructions(imageCount) {
    const instructions = `
📸 Twitter画像投稿の手順:

1. ${imageCount}個の画像ファイルがダウンロードされました
2. Twitter投稿画面が開きます
3. 「メディアを追加」ボタンをクリック
4. ダウンロードされた画像ファイルを選択してアップロード
5. ツイートボタンをクリックして完了

💡 ヒント: 複数ファイルを一度に選択できます（Ctrl+クリック）
        `;

    alert(instructions);
  }

  // Tumblrダウンロード用のストレージをクリア
  function clearTumblrDownloadImageStorage(savedImages) {
    try {
      savedImages.forEach((filename) => {
        localStorage.removeItem(`tumblr_image_${filename}`);
        localStorage.removeItem(`tumblr_image_${filename}_type`);
      });
      localStorage.removeItem("tumblr_download_saved_images");
      localStorage.removeItem("tumblr_download_caption");
      console.log("Tumblrダウンロードストレージをクリアしました");
    } catch (error) {
      console.error("Tumblrダウンロードストレージクリアエラー:", error);
    }
  }

  // Twitter用のストレージをクリア
  function clearTwitterImageStorage(savedImages) {
    try {
      savedImages.forEach((filename) => {
        localStorage.removeItem(`tumblr_image_${filename}`);
        localStorage.removeItem(`tumblr_image_${filename}_type`);
      });
      localStorage.removeItem("twitter_saved_images");
      localStorage.removeItem("twitter_caption");
      console.log("Twitterストレージをクリアしました");
    } catch (error) {
      console.error("Twitterストレージクリアエラー:", error);
    }
  }

  // Webストレージから画像を取得してFileオブジェクトに変換
  function getStoredImageAsFile(filename) {
    const base64Data = localStorage.getItem(`tumblr_image_${filename}`);
    const mimeType =
      localStorage.getItem(`tumblr_image_${filename}_type`) || "image/jpeg";

    if (!base64Data) {
      console.error(`画像が見つかりません: ${filename}`);
      return null;
    }

    try {
      // Base64をBlobに変換
      const byteCharacters = atob(base64Data.split(",")[1]);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // BlobをFileオブジェクトに変換
      const fileExtension = mimeType.split("/")[1];
      const file = new File([blob], `image_${filename}.${fileExtension}`, {
        type: mimeType,
      });

      return file;
    } catch (error) {
      console.error("ファイル変換エラー:", error);
      return null;
    }
  }

  // 自動アップロード処理の初期化（無効化）
  /*
    function initAutoUpload(tumblrWindow) {
        if (!tumblrWindow || tumblrWindow.closed) {
            console.error('Tumblr投稿画面が開けませんでした');
            return;
        }

        // 保存された画像を取得
        const savedImagesJson = localStorage.getItem('tumblr_saved_images');
        if (!savedImagesJson) {
            console.error('保存された画像が見つかりません');
            return;
        }

        const savedImages = JSON.parse(savedImagesJson);
        console.log(`${savedImages.length}個の画像を自動アップロード開始`);

        // 少し待ってからアップロード処理を開始
        setTimeout(() => {
            performAutoUpload(tumblrWindow, savedImages);
        }, 2000);
    }

    // 実際のアップロード処理（無効化）
    async function performAutoUpload(tumblrWindow, savedImages) {
        try {
            const tumblrDoc = tumblrWindow.document;
            
            // ファイルアップロード要素を検索
            const fileInput = tumblrDoc.querySelector('input[type="file"]') || 
                            tumblrDoc.querySelector('input[accept*="image"]') ||
                            tumblrDoc.querySelector('[data-testid="file-input"]') ||
                            tumblrDoc.querySelector('.file-input');
            
            if (!fileInput) {
                console.error('ファイルアップロード要素が見つかりません');
                // 再試行
                setTimeout(() => performAutoUpload(tumblrWindow, savedImages), 1000);
                return;
            }

            console.log('ファイルアップロード要素を発見:', fileInput);

            // 複数の画像ファイルを準備
            const files = [];
            for (const filename of savedImages) {
                const file = getStoredImageAsFile(filename);
                if (file) {
                    files.push(file);
                }
            }

            if (files.length === 0) {
                console.error('有効な画像ファイルがありません');
                return;
            }

            // FileListオブジェクトを作成
            const dataTransfer = new DataTransfer();
            files.forEach(file => dataTransfer.items.add(file));

            // ファイルを設定
            fileInput.files = dataTransfer.files;

            // changeイベントを発火
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);

            // inputイベントも発火（念のため）
            const inputEvent = new Event('input', { bubbles: true });
            fileInput.dispatchEvent(inputEvent);

            console.log(`${files.length}個の画像を自動アップロードしました`);

            // ストレージをクリア
            setTimeout(() => {
                savedImages.forEach(filename => {
                    localStorage.removeItem(`tumblr_image_${filename}`);
                    localStorage.removeItem(`tumblr_image_${filename}_type`);
                });
                localStorage.removeItem('tumblr_saved_images');
                localStorage.removeItem('tumblr_caption');
                console.log('ストレージをクリアしました');
            }, 1000);

        } catch (error) {
            console.error('自動アップロード処理エラー:', error);
            // 再試行
            setTimeout(() => performAutoUpload(tumblrWindow, savedImages), 2000);
        }
    }
    */

  // 画像選択モーダルを表示
  function showImageModal() {
    const images = getPageImages();
    const videos = getPageVideos();
    const grid = document.getElementById("tumblr-image-grid");
    const selectionCount = document.getElementById("tumblr-selection-count");
    const postButton = document.getElementById("tumblr-post-selected");
    const tumblrDownloadButton = document.getElementById(
      "tumblr-download-selected"
    );
    const twitterPostButton = document.getElementById("twitter-post-selected");
    const modalTitle = document.querySelector(".tumblr-modal-title");

    // Twitterサイトでは特定のボタンを非表示にする
    const isTwitterSite =
      window.location.hostname.includes("twitter.com") ||
      window.location.hostname.includes("x.com");
    if (isTwitterSite) {
      if (postButton) postButton.style.display = "none";
      if (twitterPostButton) twitterPostButton.style.display = "none";
    } else {
      if (postButton) postButton.style.display = "inline-block";
      if (twitterPostButton) twitterPostButton.style.display = "inline-block";
    }

    // 動画が優先される場合のメッセージ
    if (videos.length > 0) {
      modalTitle.textContent = `動画またはメディアをTumblrに投稿 (動画: ${videos.length}個, 画像: ${images.length}個)`;
    } else {
      modalTitle.textContent = `画像を選択してTumblrに投稿 (${images.length}個)`;
    }

    // 画像が見つからない場合
    if (images.length === 0) {
      if (videos.length > 0) {
        grid.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <p>このページには${videos.length}個の動画があります。</p>
                        <p>動画は自動的に投稿されます。</p>
                    </div>
                `;
      } else {
        grid.innerHTML =
          '<div style="text-align: center; padding: 40px; color: #666;">このページには投稿可能な画像が見つかりませんでした。</div>';
      }
      if (postButton && postButton.style.display !== "none") {
        postButton.disabled = true;
      }
      tumblrDownloadButton.disabled = true;
      if (twitterPostButton && twitterPostButton.style.display !== "none") {
        twitterPostButton.disabled = true;
      }
      modal.style.display = "block";
      return;
    }

    // 選択状態をリセット
    selectedImages = [];
    selectionCount.textContent = "0";
    if (postButton && postButton.style.display !== "none") {
      postButton.disabled = true;
    }
    tumblrDownloadButton.disabled = true;
    if (twitterPostButton && twitterPostButton.style.display !== "none") {
      twitterPostButton.disabled = true;
    }

    // 画像グリッドを作成
    grid.innerHTML = "";
    images.forEach((image) => {
      const item = document.createElement("div");
      item.className = "tumblr-image-item";
      item.innerHTML = `
                <img src="${image.src}" alt="${image.alt}" loading="lazy">
                <div class="tumblr-image-info">
                    ${image.width}×${image.height}
                </div>
            `;

      // 画像クリック時の処理
      item.addEventListener("click", () => {
        const isSelected = selectedImages.includes(image.src);

        if (isSelected) {
          // 選択解除
          selectedImages = selectedImages.filter((src) => src !== image.src);
          item.classList.remove("selected");
        } else {
          // 選択
          selectedImages.push(image.src);
          item.classList.add("selected");
        }

        // UI更新
        selectionCount.textContent = selectedImages.length;
        if (postButton && postButton.style.display !== "none") {
          postButton.disabled = selectedImages.length === 0;
        }
        tumblrDownloadButton.disabled = selectedImages.length === 0;
        if (twitterPostButton && twitterPostButton.style.display !== "none") {
          twitterPostButton.disabled = selectedImages.length === 0;
        }
      });

      grid.appendChild(item);
    });

    modal.style.display = "block";
  }

  // テキスト選択時の処理
  document.addEventListener("mouseup", function (e) {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text.length > 0) {
      selectedText = text;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      button.style.display = "block";
      button.style.left = rect.left + window.scrollX + "px";
      button.style.top = rect.bottom + window.scrollY + 5 + "px";
    } else {
      if (!button.contains(e.target)) {
        button.style.display = "none";
      }
    }
  });

  // ボタンクリック時の処理
  button.addEventListener("click", function (e) {
    e.stopPropagation();

    if (selectedText) {
      postTextToTumblr(selectedText, window.location.href, document.title);
      button.style.display = "none";
      window.getSelection().removeAllRanges();
    }
  });

  // モーダルのイベントリスナー
  const closeButton = modal.querySelector(".tumblr-modal-close");
  const postSelectedButton = document.getElementById("tumblr-post-selected");
  const tumblrDownloadButton = document.getElementById(
    "tumblr-download-selected"
  );
  const twitterPostButton = document.getElementById("twitter-post-selected");

  // モーダルを閉じる
  closeButton.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // モーダル背景クリックで閉じる
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // 選択した画像を投稿（URL方式でTumblrへ）
  postSelectedButton.addEventListener("click", async () => {
    if (selectedImages.length > 0) {
      postSelectedButton.disabled = true;
      postSelectedButton.textContent = "処理中...";

      try {
        // Tumblrに画像URLで投稿
        postImageToTumblr(selectedImages, window.location.href, document.title);
        modal.style.display = "none";
      } catch (error) {
        console.error("投稿処理エラー:", error);
      } finally {
        postSelectedButton.disabled = false;
        postSelectedButton.textContent = "Tumblrに投稿";
      }
    }
  });

  // Tumblrダウンロード投稿ボタンのイベントリスナー
  tumblrDownloadButton.addEventListener("click", async () => {
    if (selectedImages.length > 0) {
      tumblrDownloadButton.disabled = true;
      tumblrDownloadButton.textContent = "処理中...";

      try {
        // Tumblrに画像ダウンロード方式で投稿
        await postImagesToTumblrWithDownload(
          selectedImages,
          window.location.href,
          document.title
        );
        modal.style.display = "none";
      } catch (error) {
        console.error("Tumblrダウンロード投稿処理エラー:", error);
      } finally {
        tumblrDownloadButton.disabled = false;
        tumblrDownloadButton.textContent = "Tumblr(ダウンロード)";
      }
    }
  });

  // Twitter投稿ボタンのイベントリスナー
  twitterPostButton.addEventListener("click", async () => {
    if (selectedImages.length > 0) {
      twitterPostButton.disabled = true;
      twitterPostButton.textContent = "処理中...";

      try {
        // Twitterに画像ダウンロード方式で投稿
        await postImagesToTwitter(
          selectedImages,
          window.location.href,
          document.title
        );
        modal.style.display = "none";
      } catch (error) {
        console.error("Twitter投稿処理エラー:", error);
      } finally {
        twitterPostButton.disabled = false;
        twitterPostButton.textContent = "Twitterに投稿";
      }
    }
  });

  // Tumblrサイトでの自動アップロード処理
  function initTumblrSiteAutoUpload() {
    if (!window.location.hostname.includes("tumblr.com")) {
      return;
    }

    // 保存された画像があるかチェック
    const savedImagesJson = localStorage.getItem(
      "tumblr_download_saved_images"
    );
    if (!savedImagesJson) {
      return;
    }

    const savedImages = JSON.parse(savedImagesJson);
    console.log(
      `Tumblrサイトで${savedImages.length}個の画像を自動アップロード開始`
    );

    // 少し待ってからアップロード処理を開始
    setTimeout(() => {
      performTumblrSiteAutoUpload(savedImages);
    }, 2000);
  }

  // Tumblrサイトでの実際の自動アップロード処理
  async function performTumblrSiteAutoUpload(savedImages) {
    try {
      // ファイルアップロード要素を検索（Tumblrの実際の構造に合わせて）
      const fileInput =
        document.querySelector('.media-upload input[type="file"]') ||
        document.querySelector('input[name="photo"]') ||
        document.querySelector('input[accept*="image"]') ||
        document.querySelector('input[data-subview="upload"]') ||
        document.querySelector('input[type="file"][multiple]');

      if (!fileInput) {
        console.error(
          "ファイルアップロード要素が見つかりません - 再試行します"
        );
        // 再試行
        setTimeout(() => performTumblrSiteAutoUpload(savedImages), 2000);
        return;
      }

      console.log("ファイルアップロード要素を発見:", fileInput);

      // ドロップゾーンエリアも検索
      const dropzoneArea =
        document.querySelector(".dropzone-icon") ||
        document.querySelector(".split-cell-inner") ||
        document.querySelector("[data-js-mediauploadtext]");

      // 複数の画像ファイルを準備
      const files = [];
      for (const filename of savedImages) {
        const file = getStoredImageAsFile(filename);
        if (file) {
          files.push(file);
        }
      }

      if (files.length === 0) {
        console.error("有効な画像ファイルがありません");
        return;
      }

      // FileListオブジェクトを作成
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));

      // ドロップゾーンエリアがある場合はクリックしてからファイルを設定
      if (dropzoneArea) {
        console.log(
          "ドロップゾーンエリアを発見、クリックします:",
          dropzoneArea
        );
        dropzoneArea.click();
        // 少し待ってからファイルを設定
        setTimeout(() => {
          setFileInputFiles(fileInput, dataTransfer.files);
        }, 500);
      } else {
        setFileInputFiles(fileInput, dataTransfer.files);
      }

      function setFileInputFiles(input, files) {
        // ファイルを設定
        input.files = files;

        // イベントを発火
        const changeEvent = new Event("change", { bubbles: true });
        input.dispatchEvent(changeEvent);

        const inputEvent = new Event("input", { bubbles: true });
        input.dispatchEvent(inputEvent);

        // さらに詳細なイベントを発火
        const focusEvent = new Event("focus", { bubbles: true });
        input.dispatchEvent(focusEvent);

        const blurEvent = new Event("blur", { bubbles: true });
        input.dispatchEvent(blurEvent);
      }

      console.log(`${files.length}個の画像を自動アップロードしました`);

      // ストレージをクリア
      setTimeout(() => {
        clearTumblrDownloadImageStorage(savedImages);
      }, 1000);
    } catch (error) {
      console.error("Tumblrサイト自動アップロード処理エラー:", error);
    }
  }

  // ショートカットキー (Ctrl+Shift+P) の処理
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === "P") {
      e.preventDefault();

      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text.length > 0) {
        postTextToTumblr(text, window.location.href, document.title);
        window.getSelection().removeAllRanges();
      } else {
        // テキストが選択されていない場合
        const videos = getPageVideos();
        console.log("動画検出結果:", videos);

        // 動画優先機能を一時的に無効化し、常に画像選択モーダルを表示
        console.log("画像選択モーダルを表示");
        showImageModal();

        // 動画がある場合の処理（現在は無効化）
        /*
                if (videos.length > 0) {
                    // 動画が存在する場合は動画投稿を優先
                    console.log('動画投稿を実行:', videos[0].src);
                    postVideoToTumblr(videos[0].src, window.location.href, document.title);
                } else {
                    // 動画がない場合は画像選択モーダルを表示
                    console.log('画像選択モーダルを表示');
                    showImageModal();
                }
                */
      }
    }
  });

  // スクロール時にボタンを非表示
  window.addEventListener("scroll", function () {
    button.style.display = "none";
  });

  // クリック時に選択以外の場所ならボタンを非表示
  document.addEventListener("click", function (e) {
    if (!button.contains(e.target)) {
      button.style.display = "none";
    }
  });

  // 初期化処理
  document.addEventListener("DOMContentLoaded", function () {
    // Tumblrサイトでの自動アップロード機能を初期化
    initTumblrSiteAutoUpload();
  });

  // DOMContentLoadedが既に発火している場合の対策
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTumblrSiteAutoUpload);
  } else {
    initTumblrSiteAutoUpload();
  }
})();
