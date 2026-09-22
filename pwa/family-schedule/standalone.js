// standalone（ホーム画面から起動）判定。<head> で同期に読み、パース中に data 属性を付ける。
// 後で付けるとブラウザ用の chrome が一瞬出る。インラインにしないのは CSP で 'unsafe-inline' を避けるため
if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  document.documentElement.dataset.standalone = "true";
}
