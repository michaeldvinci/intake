WEB_IMAGE  := michaeldvinci/intake-web:latest
API_IMAGE  := michaeldvinci/intake-api:latest

.PHONY: web api all

web:
	docker build -t $(WEB_IMAGE) ./web
	docker compose up -d

api:
	docker build -t $(API_IMAGE) ./api
	docker compose up -d

all:
	docker build -t $(WEB_IMAGE) ./web
	docker build -t $(API_IMAGE) ./api
	docker compose up -d
