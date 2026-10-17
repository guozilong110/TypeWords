.DEFAULT_GOAL := start
.PHONY: start build stop check-tts

PYTHON := $(shell command -v python3)
PNPM := $(shell command -v pnpm)

# 修改代码后依次执行：make stop、make build、make start。
build:
	pnpm install
	pnpm generate

# macOS 后台运行，关闭终端后继续服务；日志分别写入 serve.log 和 tts.log。
start:
	@test -f .output/public/index.html || { echo "请先运行 make build"; exit 1; }
	@$(MAKE) check-tts
	@if lsof -nP -iTCP:5567 -sTCP:LISTEN >/dev/null; then echo "5567 端口已被占用，请先停止已有服务"; exit 1; fi
	@if lsof -nP -iTCP:5568 -sTCP:LISTEN >/dev/null; then echo "5568 端口已被占用，请先停止已有 TTS 服务"; exit 1; fi
	@launchctl submit -l local.typewords.tts -o "$(CURDIR)/tts.log" -e "$(CURDIR)/tts.log" -- /usr/bin/env "PATH=$(PATH)" "$(PYTHON)" -m uvicorn services.local_tts:app --app-dir "$(CURDIR)" --host 127.0.0.1 --port 5568
	@launchctl submit -l local.typewords -o "$(CURDIR)/serve.log" -e "$(CURDIR)/serve.log" -- /usr/bin/env "PATH=$(PATH)" "$(PNPM)" dlx serve "$(CURDIR)/.output/public" -l tcp://127.0.0.1:5567
	@echo "已启动 TypeWords：http://127.0.0.1:5567；本地 Kokoro TTS：http://127.0.0.1:5568"
	@echo "日志：serve.log、tts.log；停止：make stop"

check-tts:
	@$(PYTHON) -c "import fastapi, huggingface_hub, kokoro, numpy, soundfile, torch, uvicorn" || { echo "当前 Python 缺少 Kokoro TTS 依赖"; exit 1; }

stop:
	-@launchctl remove local.typewords
	-@launchctl remove local.typewords.tts
