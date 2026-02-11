# miotts-cockpit

[English](README.md) | **日本語**

[MioTTS](https://github.com/Aratako/MioTTS-Inference) + vLLM をセルフホストするための Web ベースのコントロールパネルです。

サーバーの起動・停止、モデル切り替え、リファレンス音声プリセットの管理、音声合成をブラウザひとつで完結できます。Tailscale 等で自宅 GPU サーバーにリモートアクセスする個人ユースを想定しています。

## 機能

- **サービス管理** — vLLM と MioTTS API を依存関係を考慮して起動・停止
- **ライブステータス** — ヘルスチェック付きのカラーインジケーター
- **モデル切り替え** — UI からモデルサイズを変更、サービスが自動で再起動
- **ログビューア** — リアルタイムログ表示、ヘルスチェックフィルタリング、クライアントタイムゾーン変換
- **リファレンス音声プリセット** — 音声ファイルをアップロードすると話者埋め込み (.pt) に自動変換
- **TTS Playground** — パラメータを調整しながら音声合成、即時再生
- **モバイル対応** — レスポンシブ UI、スマホブラウザで操作可能

## GPU 要件

| モデル | アーキテクチャ | VRAM | `gpu_memory_utilization` | 備考 |
|--------|----------------|------|--------------------------|------|
| MioTTS-0.1B | FalconMamba | ~2 GB | 0.3 | 最速、品質は低め |
| MioTTS-0.4B | LFM2 | ~3 GB | 0.3 | 8 GB GPU におすすめ |
| MioTTS-0.6B | Qwen3 | ~5 GB | 0.5 | 高品質、VRAM 多め |
| MioTTS-1.2B | LFM2 | ~8 GB+ | — | 8 GB GPU では動作不可 |

### 推論速度 (RTX 2080, vLLM 0.15.1, float16)

```
0.1B (FalconMamba) : ████████████████████████████████▋  326 tok/s
0.4B (LFM2)       : █████████████████████████████     289 tok/s
0.6B (Qwen3)      : ███████████████████               190 tok/s
1.2B (LFM2)       : OOM
```

全モデルともリアルタイム合成に十分な速度です。コーデックのデコードはモデルサイズに関係なく約 0.05 秒のオーバーヘッドです。参考: vLLM は同一 GPU で transformers の約 5.8 倍、llama.cpp の約 4 倍高速です。

## 前提条件

- Python 3.11+
- Node.js 20+ (フロントエンドのビルドに必要)
- CUDA 対応の NVIDIA GPU
- [MioTTS-Inference](https://github.com/Aratako/MioTTS-Inference) をクローンして `uv sync` 済み

## クイックスタート

```bash
git clone https://github.com/nyosegawa/miotts-cockpit.git
cd miotts-cockpit
make setup   # Python + フロントエンドの依存関係インストール、設定ファイルのコピー

# services.yaml を編集 — MioTTS-Inference のパスを設定
vim services.yaml

make run     # http://localhost:8080 でコックピット起動
```

## 手動セットアップ

```bash
# Python 依存関係
uv sync  # または: pip install -e .

# フロントエンド
cd frontend && npm install && npm run build && cd ..

# 設定
cp services.yaml.example services.yaml
# services.yaml を編集 — cwd と presets_dir に MioTTS-Inference のパスを設定

# 起動
uv run python server.py
```

## 設定

`services.yaml` を環境に合わせて編集します。必須の変更はパスの設定のみです:

```yaml
services:
  vllm:
    cwd: "/home/you/MioTTS-Inference"   # <-- あなたのパス
    ...
  miotts:
    cwd: "/home/you/MioTTS-Inference"   # <-- 同じパス
    ...

miotts:
  presets_dir: "/home/you/MioTTS-Inference/presets"  # <-- 同じパス + /presets
```

全オプションの詳細は [`services.yaml.example`](services.yaml.example) を参照してください。

## アーキテクチャ

```
ブラウザ (Mac / iPhone 等)
  |  http://<host>:8080
  v
miotts-cockpit (FastAPI, port 8080)
  |- React SPA (静的ファイル配信)
  |- サービス管理 API
  |- TTS プロキシ --> MioTTS API (port 8001)
  |
  |- [管理対象] vLLM サーバー (port 8000)
  '- [管理対象] MioTTS API サーバー (port 8001)
```

## サービスとして実行

systemd ユーザーサービスとしてインストールすると、バックグラウンドで実行され障害時に自動再起動します:

```bash
make install    # ビルド、インストール、サービス起動
```

インストール後:

```bash
make status                                  # 動作確認
make logs                                    # ログをフォロー
systemctl --user stop miotts-cockpit         # 停止
systemctl --user restart miotts-cockpit      # 再起動
make uninstall                               # サービス削除
```

ログイン時に自動起動します。WSL2 ではターミナルを開いた時点で準備完了です。

## 開発

```bash
# ターミナル 1: バックエンド
uv run python server.py

# ターミナル 2: フロントエンド (ホットリロード)
cd frontend && npm run dev
# http://localhost:5173 (/api は :8080 にプロキシ)
```

## ライセンス

MIT
