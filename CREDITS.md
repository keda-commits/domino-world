# 使用ライブラリ・参考資料・アセットの出典

## ライブラリ（npm）

| 名前 | バージョン | ライセンス | 用途 |
|---|---|---|---|
| three | 0.170.0 | MIT | 3D 描画（examples の OrbitControls / RoundedBoxGeometry / RoomEnvironment / EffectComposer / GTAOPass / UnrealBloomPass / BokehPass / BufferGeometryUtils を含む） |
| @dimforge/rapier3d-compat | 0.19.3 | Apache-2.0 | 剛体物理演算 |
| vite | 6.0.7 | MIT | 開発・ビルド |

## フォント

- M PLUS Rounded 1c（Google Fonts、SIL Open Font License 1.1）

## 参考にしたリポジトリ

- **Domino Topple**（https://github.com/ronpicard/domino-topple, MIT）
  ドミノの寸法比（間隔 ＝ 高さの約 60%）、角の丸い直方体コライダー、密度・摩擦・反発係数の目安、固定タイムステップ（1/120 秒）を参考にしました。**コードはコピーしていません**（設計・数値の参考のみ）。
- **Kinetic Lab**（https://github.com/Sahil-Arifi/kinetic-lab, MIT）：今回は調査のみで、コード・設計とも使用していません。
- **Domino Show**（https://github.com/Sam1983Aing/domino-show）：再利用許諾が確認できないため参照していません。

## 3D モデル・テクスチャ・音

- 3D モデル（家具・おもちゃ・小人・ストッパーズ・ルンバ・装置）はすべてコードでプロシージャル生成しています。外部の 3D アセットは使っていません。
- テクスチャ（木目・壁紙・ラグ・ドミノの目など）は Canvas で生成しています。
- 効果音・BGM はすべて WebAudio でその場で合成したオリジナルです（外部音源ファイルなし）。
- 既存ゲーム（Domino Simulator / Domino VR 等）の素材は一切使用していません。
