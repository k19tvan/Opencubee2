# STEP 1. Install Miniconda and Npm 
```
./src/installation/install_miniconda.sh
```
```
./src/installation/install_npm.sh
```

# STEP 2. Install Packages
## Unified environment for backend, host_bge, host_metaclip2
```
conda create -n env python=3.10 
conda activate env
pip install -r requirements.txt
playwright install chromium
```

Agent research uses five isolated Chromium profiles by default under
`backend/api/gemini_sessions`. The profile count, profile paths, headless mode,
Gemini timeout, and Qwen endpoint can be configured with the `GEMINI_*` and
`AGENT_MODEL_*` variables documented in `.env_example`.

if your device requires the lower torch version, installed cu126 version:
```
pip uninstall -y torch torchvision torchaudio

pip install torch==2.13.0 torchvision==0.28.0 \
  --index-url https://download.pytorch.org/whl/cu126
```
## Specify environment for host_beit3
```
conda create -n beit3_env python=3.10
conda activate beit3_env
pip install -r requirements_beit3.txt
```

# STEP 3. Download Models, Databases, Storage 
```
./src/scripts/download_database.sh
```
```
./src/scripts/download_database.sh
```
```
./src/scripts/download_storage.sh
```

# STEP 4. Setup Database with Layerbase

```
src/scripts/setup_database.sh
```

# STEP 5. Host Backend
```
python -m backend.main
```
