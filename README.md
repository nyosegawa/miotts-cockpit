# miotts-cockpit

Web-based control panel for self-hosting [MioTTS](https://github.com/Aratako/MioTTS-Inference) with vLLM.

Start/stop servers, switch models, manage reference audio presets, and synthesize speech — all from a single browser tab. Designed for personal GPU servers accessed remotely (e.g. via Tailscale).

## Features

- **Service Management** — Start/stop vLLM and MioTTS API with dependency-aware ordering
- **Live Status** — Health monitoring with color-coded indicators
- **Model Switching** — Change between MioTTS model sizes from the UI, auto-restarts services
- **Log Viewer** — Real-time logs with health-check filtering and client timezone conversion
- **Reference Audio Presets** — Upload audio files, auto-convert to speaker embeddings (.pt)
- **TTS Playground** — Synthesize speech with adjustable parameters and instant playback
- **Mobile Friendly** — Responsive dark UI, works on phone browsers

## GPU Requirements

| Model | Arch | VRAM | `gpu_memory_utilization` | Notes |
|-------|------|------|--------------------------|-------|
| MioTTS-0.1B | FalconMamba | ~2 GB | 0.3 | Fastest, lowest quality |
| MioTTS-0.4B | LFM2 | ~3 GB | 0.3 | Recommended for 8 GB GPUs |
| MioTTS-0.6B | Qwen3 | ~5 GB | 0.5 | Better quality, needs more VRAM |
| MioTTS-1.2B | LFM2 | ~8 GB+ | — | Does not fit on 8 GB GPUs |

### Inference Speed (RTX 2080, vLLM 0.15.1, float16)

```
0.1B (FalconMamba) : ████████████████████████████████▋  326 tok/s
0.4B (LFM2)       : █████████████████████████████     289 tok/s
0.6B (Qwen3)      : ███████████████████               190 tok/s
1.2B (LFM2)       : OOM
```

All models run comfortably in real-time. Codec decoding adds ~0.05s overhead regardless of model size. For comparison, vLLM is ~5.8x faster than transformers and ~4x faster than llama.cpp on the same GPU.

## Prerequisites

- Python 3.11+
- Node.js 20+ (for building the frontend)
- NVIDIA GPU with CUDA toolkit
- [MioTTS-Inference](https://github.com/Aratako/MioTTS-Inference) cloned and set up with `uv sync`

## Quick Start

```bash
git clone https://github.com/sakasegawa/miotts-cockpit.git
cd miotts-cockpit
make setup   # installs Python + frontend dependencies, copies example config

# Edit services.yaml — set the path to your MioTTS-Inference clone
vim services.yaml

make run     # starts the cockpit on http://localhost:8080
```

## Manual Setup

```bash
# Python dependencies
uv sync  # or: pip install -e .

# Frontend
cd frontend && npm install && npm run build && cd ..

# Configuration
cp services.yaml.example services.yaml
# Edit services.yaml — set cwd and presets_dir to your MioTTS-Inference path

# Run
uv run python server.py
```

## Configuration

Edit `services.yaml` to match your environment. The only required change is setting the paths:

```yaml
services:
  vllm:
    cwd: "/home/you/MioTTS-Inference"   # <-- your path
    ...
  miotts:
    cwd: "/home/you/MioTTS-Inference"   # <-- same path
    ...

miotts:
  presets_dir: "/home/you/MioTTS-Inference/presets"  # <-- same path + /presets
```

See [`services.yaml.example`](services.yaml.example) for all options with comments.

## Architecture

```
Browser (Mac / iPhone / etc.)
  |  http://<host>:8080
  v
miotts-cockpit (FastAPI, port 8080)
  |- React SPA (static files)
  |- Service manager API
  |- TTS proxy --> MioTTS API (port 8001)
  |
  |- [managed] vLLM server (port 8000)
  '- [managed] MioTTS API server (port 8001)
```

## Running as a Service

Install as a systemd user service to run in the background and auto-restart on failure:

```bash
make install    # builds, installs, and starts the service
```

After installation:

```bash
make status                                  # check if running
make logs                                    # follow logs
systemctl --user stop miotts-cockpit         # stop
systemctl --user restart miotts-cockpit      # restart
make uninstall                               # remove the service
```

The cockpit starts automatically when you log in. On WSL2, this means it's ready as soon as you open a terminal.

## Development

```bash
# Terminal 1: Backend
uv run python server.py

# Terminal 2: Frontend with hot reload
cd frontend && npm run dev
# http://localhost:5173 (proxies /api to :8080)
```

## License

MIT
