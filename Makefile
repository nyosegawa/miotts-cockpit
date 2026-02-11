.PHONY: setup build run dev install uninstall status logs clean

setup: build
	@if [ ! -f services.yaml ]; then \
		cp services.yaml.example services.yaml; \
		echo "Created services.yaml from example. Edit it to set your paths."; \
	fi

build:
	uv sync
	cd frontend && npm install && npm run build

run:
	uv run python server.py

dev:
	uv run python server.py &
	cd frontend && npm run dev

# --- systemd user service ---

install: build
	@mkdir -p ~/.config/systemd/user
	sed 's|__WORKDIR__|$(CURDIR)|g' miotts-cockpit.service > ~/.config/systemd/user/miotts-cockpit.service
	systemctl --user daemon-reload
	systemctl --user enable --now miotts-cockpit
	@echo ""
	@echo "miotts-cockpit is running on http://localhost:8080"
	@echo "  status:  make status"
	@echo "  logs:    make logs"
	@echo "  stop:    systemctl --user stop miotts-cockpit"
	@echo "  restart: systemctl --user restart miotts-cockpit"

uninstall:
	systemctl --user disable --now miotts-cockpit || true
	rm -f ~/.config/systemd/user/miotts-cockpit.service
	systemctl --user daemon-reload

status:
	systemctl --user status miotts-cockpit

logs:
	journalctl --user -u miotts-cockpit -f

clean:
	rm -rf frontend/node_modules frontend/dist logs/ state.json __pycache__/
