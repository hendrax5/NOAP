.PHONY: up down dev-api dev-web

up:
	docker-compose up -d

down:
	docker-compose down

dev-api:
	cd backend && go run main.go

dev-web:
	cd frontend && npm run dev
