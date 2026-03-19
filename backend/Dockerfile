FROM golang:1.24-alpine

WORKDIR /app

# Enable hot reload using air (optional, but good for dev) or just plain run
COPY go.mod ./

COPY . .
RUN go mod tidy
RUN go build -o /noap-api

EXPOSE 4000

CMD ["/noap-api"]
