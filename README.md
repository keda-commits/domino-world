# 世界一長いドミノ倒し（Ver.0.1 モック）

おもちゃが生きている子ども部屋で、小人たちと一緒にドミノを並べて倒し続ける 3D ブラウザゲームの検証用モックです。
自動化インクリメンタル × ドミノ連鎖 × おもちゃ箱シミュレーション。

**プレイ:** https://keda-commits.github.io/domino-world/

## あそびかた

1. 画面をクリック（または Space 長押し）で、コースの最前線（▼）にドミノを置く
2. 「▶ 倒す！」（Enter）で連鎖スタート。倒れた数 × コンボ倍率でコイン
3. 倒れたドミノは近くをクリックで手回収、または回収小人が倉庫へ戻す
4. コインで小人・設備を買い、建設を自動化する
5. 建設小人3・運搬小人2・回収小人1 で「♾ 連続運転」が解放。だんだん加速する連鎖の波から建設隊が逃げ切れるか
6. ぜんまいが満タンなら「⚡ オーバードライブ」（O）：10秒間 建設・運搬・回収が3倍速

カメラ：左ドラッグ回転 / 右ドラッグ移動 / ホイールでズーム / WASD・矢印で移動 / F 追尾 / V 全体
その他：P 一時停止 / 1・2・4 ゲーム速度 / M 音 / H 操作説明

## 開発

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # dist/ に出力（base は /domino-world/）
```

main ブランチへ push すると GitHub Actions（`.github/workflows/deploy.yml`）でビルドされ GitHub Pages に公開されます。

開発サーバーではブラウザのコンソールから検証用の関数が使えます（本番ビルドには含まれません）：

- `__bot(秒数)` … 素朴なプレイヤーとして高速自動プレイし、ログを返す
- `__measureBuild({builder:3, carrier:2, machine:1})` … 設備構成ごとの建設速度（個/秒）
- `__contRun(構成, オーバードライブを使うか)` … 連続運転を1回実行して連鎖数を返す
- `__game.audit()` … ドミノ総数の整合チェック

## 構成

| ファイル | 役割 |
|---|---|
| `src/config.js` | バランス数値・寸法（調整はここ） |
| `src/upgrades.js` | アップグレード定義・価格・効果式 |
| `src/game.js` | ゲーム状態とルール（連鎖・建設・報酬・オーバードライブ・セーブ形式） |
| `src/field.js` | ルート上のドミノ状態と InstancedMesh 描画 |
| `src/route.js` | うねうね一周する建設ルートの生成 |
| `src/workers.js` | 小人 AI（建設・運搬・回収、転倒・うっかり・逃走） |
| `src/gnomeModel.js` | 小人のモデル（頭・胴・手足）|
| `src/facilities.js` | おもちゃ箱倉庫・前線資材置き場・自動設置機・製造機 |
| `src/room.js` | 子ども部屋とおもちゃ |
| `src/cameraRig.js` | カメラ操作・追尾 |
| `src/ui.js` / `index.html` / `src/style.css` | HUD・ショップ・操作 |
| `src/audio.js` | WebAudio 合成の効果音 |
| `src/fx.js` | 浮かぶ文字・紙吹雪 |
| `src/save.js` | localStorage セーブ |
| `src/devtools.js` | 開発時のみの自動プレイ・計測 |
