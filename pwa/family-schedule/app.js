// エントリ。ログイン状態を見て画面を出し分ける。予定表本体はまだ無い。
import { isUnlocked, mountLogin, logout } from "./login.js";

const $ = (sel) => document.querySelector(sel);
const panes = { boot: $("#boot"), login: $("#login"), home: $("#home") };

function show(name) {
  for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
}

// iOS の連打対策（touchstart の preventDefault）は日付マスなど連打する要素に付ける。
// document 全体に掛けると click が合成されずボタンが効かなくなる

async function main() {
  mountLogin(panes.login, {
    onUnlocked: () => show("home"),
  });
  $("#logout").addEventListener("click", async () => {
    await logout();
    show("login");
    $("#passphrase").focus();
  });

  try {
    show((await isUnlocked()) ? "home" : "login");
  } catch (e) {
    console.error(e);
    panes.boot.querySelector(".lead").textContent = "この端末では保存領域が使えません（プライベートブラウズ？）。";
  }
  if (!panes.login.hidden) $("#passphrase").focus();
}

main();
