"""
MioTTS Cockpit — web-based control panel for self-hosting MioTTS.

Manages vLLM + MioTTS API processes, reference audio presets, model switching,
and proxies the TTS playground. Reads service definitions from services.yaml.
"""

import asyncio
import json
import logging
import os
import signal
import subprocess
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import uvicorn
import yaml
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

logger = logging.getLogger("miotts-cockpit")

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
CONFIG_PATH = BASE_DIR / "services.yaml"
STATE_PATH = BASE_DIR / "state.json"
FRONTEND_DIR = BASE_DIR / "frontend" / "dist"

HEALTH_CHECK_PATTERNS = [
    '"GET /health HTTP',
    '"GET /v1/models HTTP',
    '"GET /v1/health HTTP',
]


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def expand_path(p: str) -> Path:
    return Path(p).expanduser().resolve()


# ---------------------------------------------------------------------------
# Service Manager
# ---------------------------------------------------------------------------

class ManagedService:
    def __init__(self, service_id: str, config: dict):
        self.id = service_id
        self.name = config.get("name", service_id)
        self.command = config["command"]
        self.cwd = expand_path(config.get("cwd", "."))
        self.env_overrides = config.get("env", {})
        self.health_url = config.get("health_url")
        self.port = config.get("port")
        self.depends_on: list[str] = config.get("depends_on", [])
        self.startup_timeout = config.get("startup_timeout", 120)
        self.startup_poll_interval = config.get("startup_poll_interval", 5)
        self.process: asyncio.subprocess.Process | None = None
        self.log_path = LOG_DIR / f"{service_id}.log"
        self._log_file = None
        self._state = "stopped"  # stopped, starting, running, error

    @property
    def state(self) -> str:
        if self._state in ("starting",):
            return self._state
        if self.process is None or self.process.returncode is not None:
            self._state = "stopped"
        return self._state

    @state.setter
    def state(self, value: str):
        self._state = value

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        for key, val in self.env_overrides.items():
            env[key] = os.path.expandvars(val)
        return env

    async def start(self):
        if self.process and self.process.returncode is None:
            raise RuntimeError(f"{self.name} is already running")

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._log_file = open(self.log_path, "a")
        self.state = "starting"

        self.process = await asyncio.create_subprocess_exec(
            *self.command,
            cwd=str(self.cwd),
            env=self._build_env(),
            stdout=self._log_file,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
        )
        logger.info("Started %s (PID %d)", self.name, self.process.pid)

    async def wait_healthy(self) -> bool:
        if not self.health_url:
            await asyncio.sleep(2)
            self.state = "running"
            return True

        elapsed = 0
        async with httpx.AsyncClient(timeout=3.0) as client:
            while elapsed < self.startup_timeout:
                if self.process and self.process.returncode is not None:
                    self.state = "error"
                    return False
                try:
                    resp = await client.get(self.health_url)
                    if resp.status_code == 200:
                        self.state = "running"
                        logger.info("%s is healthy", self.name)
                        return True
                except Exception:
                    pass
                await asyncio.sleep(self.startup_poll_interval)
                elapsed += self.startup_poll_interval

        self.state = "error"
        return False

    async def stop(self):
        if self.process is None or self.process.returncode is not None:
            self.state = "stopped"
            return

        try:
            os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass

        try:
            await asyncio.wait_for(self.process.wait(), timeout=10)
        except asyncio.TimeoutError:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass

        self.state = "stopped"
        if self._log_file:
            self._log_file.close()
            self._log_file = None
        logger.info("Stopped %s", self.name)

    async def check_health(self) -> str:
        """Quick health check without waiting."""
        if self.process is None or self.process.returncode is not None:
            return "stopped"
        if self._state == "starting":
            return "starting"
        if not self.health_url:
            return "running"
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(self.health_url)
                if resp.status_code == 200:
                    return "running"
                return "unhealthy"
        except Exception:
            return "unhealthy"

    def get_logs(
        self, lines: int = 100, filter_patterns: list[str] | None = None
    ) -> str:
        if not self.log_path.exists():
            return ""
        with open(self.log_path, "r", errors="replace") as f:
            if filter_patterns:
                all_lines = list(deque(f, maxlen=lines * 3))
                filtered = [
                    l for l in all_lines
                    if not any(p in l for p in filter_patterns)
                ]
                return "".join(filtered[-lines:])
            return "".join(deque(f, maxlen=lines))

    def get_info(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "state": self.state,
            "pid": self.process.pid if self.process and self.process.returncode is None else None,
            "port": self.port,
            "health_url": self.health_url,
            "depends_on": self.depends_on,
        }


class ServiceManager:
    def __init__(self, config: dict):
        self.services: dict[str, ManagedService] = {}
        self._starting = False
        for sid, sconf in config.get("services", {}).items():
            self.services[sid] = ManagedService(sid, sconf)

    def _start_order(self) -> list[str]:
        """Topological sort based on depends_on."""
        visited = set()
        order = []

        def visit(sid: str):
            if sid in visited:
                return
            visited.add(sid)
            svc = self.services.get(sid)
            if svc:
                for dep in svc.depends_on:
                    visit(dep)
            order.append(sid)

        for sid in self.services:
            visit(sid)
        return order

    async def start_all(self):
        if self._starting:
            raise RuntimeError("Already starting")
        self._starting = True
        try:
            for sid in self._start_order():
                svc = self.services[sid]
                if svc.state == "running":
                    continue
                await svc.start()
                healthy = await svc.wait_healthy()
                if not healthy:
                    raise RuntimeError(
                        f"{svc.name} failed to become healthy within {svc.startup_timeout}s"
                    )
        finally:
            self._starting = False

    async def stop_all(self):
        for sid in reversed(self._start_order()):
            svc = self.services[sid]
            await svc.stop()

    async def start_service(self, service_id: str):
        svc = self.services.get(service_id)
        if not svc:
            raise KeyError(f"Unknown service: {service_id}")
        # Start dependencies first
        for dep_id in svc.depends_on:
            dep = self.services.get(dep_id)
            if dep and dep.state != "running":
                await dep.start()
                await dep.wait_healthy()
        await svc.start()
        await svc.wait_healthy()

    async def stop_service(self, service_id: str):
        svc = self.services.get(service_id)
        if not svc:
            raise KeyError(f"Unknown service: {service_id}")
        # Stop dependents first
        for other in self.services.values():
            if service_id in other.depends_on and other.state != "stopped":
                await other.stop()
        await svc.stop()

    async def get_status(self) -> list[dict]:
        results = []
        for sid in self._start_order():
            svc = self.services[sid]
            info = svc.get_info()
            info["health"] = await svc.check_health()
            results.append(info)
        return results


# ---------------------------------------------------------------------------
# Reference Audio Manager (MioTTS-specific)
# ---------------------------------------------------------------------------

class ReferenceAudioManager:
    ALLOWED_EXTENSIONS = {".wav", ".flac", ".ogg"}

    def __init__(self, presets_dir: Path, miotts_cwd: Path):
        self.presets_dir = presets_dir
        self.miotts_cwd = miotts_cwd
        self.presets_dir.mkdir(parents=True, exist_ok=True)

    def list_presets(self) -> list[dict]:
        presets = []
        for p in sorted(self.presets_dir.iterdir()):
            if p.suffix in (".pt", ".npz") or p.suffix in self.ALLOWED_EXTENSIONS:
                presets.append({
                    "id": p.stem,
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                    "type": "embedding" if p.suffix in (".pt", ".npz") else "audio",
                })
        return presets

    async def upload_and_convert(self, file: UploadFile) -> dict:
        """Upload audio file and convert to embedding (.pt) via generate_preset.py."""
        if not file.filename:
            raise ValueError("No filename")
        ext = Path(file.filename).suffix.lower()
        if ext not in self.ALLOWED_EXTENSIONS:
            raise ValueError(f"Unsupported extension: {ext}. Allowed: {self.ALLOWED_EXTENSIONS}")

        stem = Path(file.filename).stem
        # Save audio temporarily
        tmp_audio = self.presets_dir / f"_tmp_{file.filename}"
        content = await file.read()
        tmp_audio.write_bytes(content)

        # Determine preset_id (avoid overwriting)
        preset_id = stem
        counter = 1
        while (self.presets_dir / f"{preset_id}.pt").exists():
            preset_id = f"{stem}_{counter}"
            counter += 1

        try:
            # Run generate_preset.py to convert audio -> embedding
            proc = await asyncio.create_subprocess_exec(
                "uv", "run", "python", "scripts/generate_preset.py",
                "--audio", str(tmp_audio),
                "--preset-id", preset_id,
                "--output-dir", str(self.presets_dir),
                "--device", "cuda",
                cwd=str(self.miotts_cwd),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
            if proc.returncode != 0:
                raise RuntimeError(
                    f"generate_preset.py failed (exit {proc.returncode}): {stdout.decode()}"
                )
            logger.info("Created preset embedding: %s.pt", preset_id)
        finally:
            tmp_audio.unlink(missing_ok=True)

        pt_path = self.presets_dir / f"{preset_id}.pt"
        return {
            "id": preset_id,
            "filename": pt_path.name,
            "size_bytes": pt_path.stat().st_size,
            "type": "embedding",
        }

    def delete(self, preset_id: str) -> bool:
        deleted = False
        for p in self.presets_dir.iterdir():
            if p.stem == preset_id:
                p.unlink()
                deleted = True
        return deleted


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

manager: ServiceManager | None = None
audio_manager: ReferenceAudioManager | None = None
_config: dict = {}


def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {}


def _save_state(state: dict):
    STATE_PATH.write_text(json.dumps(state, indent=2))


def _apply_model_to_services(mgr: ServiceManager, model_id: str, gpu_mem_util: str):
    """Update vLLM and MioTTS service commands for a given model."""
    vllm_svc = mgr.services.get("vllm")
    if vllm_svc:
        cmd = list(vllm_svc.command)
        try:
            idx = cmd.index("--model")
            cmd[idx + 1] = model_id
        except ValueError:
            pass
        try:
            idx = cmd.index("--gpu-memory-utilization")
            cmd[idx + 1] = gpu_mem_util
        except ValueError:
            pass
        vllm_svc.command = cmd
        short_name = model_id.split("/")[-1]
        vllm_svc.name = f"vLLM ({short_name})"

    miotts_svc = mgr.services.get("miotts")
    if miotts_svc:
        cmd = list(miotts_svc.command)
        try:
            idx = cmd.index("--llm-model")
            cmd[idx + 1] = model_id
        except ValueError:
            pass
        miotts_svc.command = cmd


@asynccontextmanager
async def lifespan(app: FastAPI):
    global manager, audio_manager, _config
    _config = load_config()
    manager = ServiceManager(_config)
    miotts_config = _config.get("miotts", {})
    presets_dir = expand_path(miotts_config.get("presets_dir", "presets"))
    miotts_cwd = expand_path(
        _config.get("services", {}).get("miotts", {}).get("cwd", ".")
    )
    audio_manager = ReferenceAudioManager(presets_dir, miotts_cwd)

    # Apply persisted model selection
    state = _load_state()
    saved_model = state.get("current_model")
    if saved_model:
        models = miotts_config.get("models", [])
        model = next((m for m in models if m["id"] == saved_model), None)
        if model:
            _apply_model_to_services(manager, saved_model, model["gpu_memory_utilization"])
            logger.info("Restored model selection: %s", saved_model)

    logger.info("Control panel ready. Managing %d services.", len(manager.services))
    yield
    if manager:
        await manager.stop_all()


app = FastAPI(title="MioTTS Cockpit", lifespan=lifespan)


# --- Service management endpoints ---

@app.get("/api/status")
async def get_status():
    return await manager.get_status()


@app.post("/api/start")
async def start_all():
    try:
        await manager.start_all()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stop")
async def stop_all():
    await manager.stop_all()
    return {"status": "ok"}


@app.post("/api/services/{service_id}/start")
async def start_service(service_id: str):
    try:
        await manager.start_service(service_id)
        return {"status": "ok"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/services/{service_id}/stop")
async def stop_service(service_id: str):
    try:
        await manager.stop_service(service_id)
        return {"status": "ok"}
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs/{service_id}")
async def get_logs(service_id: str, lines: int = 200, filter_health: bool = True):
    svc = manager.services.get(service_id)
    if not svc:
        raise HTTPException(status_code=404, detail=f"Unknown service: {service_id}")
    patterns = HEALTH_CHECK_PATTERNS if filter_health else None
    now = datetime.now(timezone.utc).astimezone()
    return {
        "service": service_id,
        "logs": svc.get_logs(lines, filter_patterns=patterns),
        "utc_offset_minutes": int(now.utcoffset().total_seconds() / 60),
    }


# --- GPU metrics ---

@app.get("/api/gpu")
async def get_gpu_info():
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            parts = [p.strip() for p in result.stdout.strip().split(",")]
            if len(parts) >= 4:
                return {
                    "name": parts[0],
                    "memory_used_mb": int(parts[1]),
                    "memory_total_mb": int(parts[2]),
                    "utilization_percent": int(parts[3]),
                }
    except FileNotFoundError:
        pass
    except Exception:
        pass

    # Fallback: try PyTorch
    try:
        import torch
        if torch.cuda.is_available():
            mem_used = torch.cuda.memory_reserved(0) // (1024 * 1024)
            props = torch.cuda.get_device_properties(0)
            mem_total = props.total_mem // (1024 * 1024)
            return {
                "name": props.name,
                "memory_used_mb": mem_used,
                "memory_total_mb": mem_total,
                "utilization_percent": None,
            }
    except Exception:
        pass

    return {"name": None, "memory_used_mb": None, "memory_total_mb": None, "utilization_percent": None}


# --- Model configuration (MioTTS-specific) ---

class ModelChangeRequest(BaseModel):
    model_id: str


@app.get("/api/config")
async def get_config():
    models = _config.get("miotts", {}).get("models", [])
    vllm_svc = manager.services.get("vllm")
    current_model = None
    if vllm_svc:
        try:
            idx = vllm_svc.command.index("--model")
            current_model = vllm_svc.command[idx + 1]
        except (ValueError, IndexError):
            pass
    return {"current_model": current_model, "models": models}


@app.post("/api/config/model")
async def change_model(req: ModelChangeRequest):
    models = _config.get("miotts", {}).get("models", [])
    model = next((m for m in models if m["id"] == req.model_id), None)
    if not model:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model_id}")

    was_running = any(
        s.state in ("running", "starting") for s in manager.services.values()
    )
    if was_running:
        await manager.stop_all()

    _apply_model_to_services(manager, req.model_id, model["gpu_memory_utilization"])
    _save_state({"current_model": req.model_id})
    logger.info("Model changed to %s", req.model_id)

    if was_running:
        await manager.start_all()

    return {"status": "ok", "model": req.model_id}


# --- TTS proxy (forwards to MioTTS API) ---

@app.post("/api/tts")
async def proxy_tts(request: Request):
    miotts_url = _config.get("miotts", {}).get("api_url", "http://localhost:8001")
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{miotts_url}/v1/tts", json=body)
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="MioTTS API is not running")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS generation timed out")


# --- Reference audio management (MioTTS-specific) ---

@app.get("/api/presets")
async def list_presets():
    return audio_manager.list_presets()


@app.post("/api/presets/upload")
async def upload_preset(file: UploadFile = File(...)):
    try:
        result = await audio_manager.upload_and_convert(file)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/presets/{preset_id}")
async def delete_preset(preset_id: str):
    if audio_manager.delete(preset_id):
        return {"status": "deleted", "id": preset_id}
    raise HTTPException(status_code=404, detail=f"Preset not found: {preset_id}")


# --- Static file serving (React SPA) ---
# Mount /assets separately, then catch-all GET for SPA index.html.
# Avoids StaticFiles("/") intercepting POST requests with 405.

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(
            FRONTEND_DIR / "index.html",
            headers={"Cache-Control": "no-cache"},
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")


if __name__ == "__main__":
    main()
