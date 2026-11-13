# 使用ライブラリ・参考資料・アセットの出典

## ライブラリ（npm）

| 名前 | バージョン | ライセンス | 用途 |
|---|---|---|---|
| three | 0.170.0 | MIT | 3D 描画（examples の OrbitControls / RoundedBoxGeometry / GLTFLoader / RGBELoader / EffectComposer / UnrealBloomPass / BokehPass / SMAAPass / OutputPass / BufferGeometryUtils を含む） |
| @dimforge/rapier3d-compat | 0.19.3 | Apache-2.0 | 剛体物理演算 |
| n8ao | 1.10.1 | ISC | アンビエントオクルージョン（接地の陰）。Ver.0.3 で追加 |
| postprocessing | 6.39.6 | Zlib | n8ao の依存パッケージ。Ver.0.3 で追加 |
| vite | 6.0.7 | MIT | 開発・ビルド |

## フォント

- M PLUS Rounded 1c（Google Fonts、SIL Open Font License 1.1）

## 外部アセット（Ver.0.3 で追加）

すべて **Poly Haven（https://polyhaven.com）** の素材で、ライセンスは **CC0 1.0（パブリックドメイン相当。商用利用可・クレジット表記不要）** です。感謝を込めて記載します。
1k 解像度版を `public/assets/` に同梱しています（合計約 15 MB）。

| 種類 | 素材名 | 使用箇所 |
|---|---|---|
| HDRI | empty_play_room | 室内の環境光・映り込み |
| 3D モデル | SchoolDesk_01 / SchoolChair_01 | ステージ1 の机・椅子 |
| 3D モデル | sofa_02 / modern_coffee_table_01 / wooden_bookshelf_worn / ArmChair_01 | ステージ2 のソファ・ローテーブル・本棚・アームチェア |
| テクスチャ | wood_floor | ステージ1 の床 |
| テクスチャ | herringbone_parquet | ステージ2 の床 |
| テクスチャ | beige_wall_001 / plastered_wall_02 | 壁 |
| テクスチャ | poly_wool_herringbone | ステージ2 のカーペット |
| テクスチャ | cotton_jersey（法線マップのみ） | ステージ1 のラグの布目 |

## 参考にしたリポジトリ

- **Domino Topple**（https://github.com/ronpicard/domino-topple, MIT）
  ドミノの寸法比（間隔 ＝ 高さの約 60%）、角の丸い直方体コライダー、密度・摩擦・反発係数の目安、固定タイムステップ（1/120 秒）を参考にしました。**コードはコピーしていません**（設計・数値の参考のみ）。
- **Kinetic Lab**（https://github.com/Sahil-Arifi/kinetic-lab, MIT）：調査のみで、コード・設計とも使用していません。
- **Domino Show**（https://github.com/Sam1983Aing/domino-show）：再利用許諾が確認できないため参照していません（コード・素材とも不使用）。

## プロシージャル生成・オリジナル

- 上記以外の 3D モデル（ベッド・おもちゃ・人・ストッパーズ・ルンバ・ガチャマシン・中間ゴール装置・ゴール装置など）はコードでプロシージャル生成しています。
- ラグの柄・パッケージの絵柄などは Canvas で生成しています。
- 効果音・BGM はすべて WebAudio でその場で合成したオリジナルです（外部音源ファイルなし）。
- 既存ゲーム（Domino Simulator / Domino VR 等）の素材は一切使用していません。
