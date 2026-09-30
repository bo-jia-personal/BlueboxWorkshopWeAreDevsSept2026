# Workshop Shop

A small, editable ecommerce application for workshops. It has a browser frontend, shop API, PostgreSQL database, PostgREST data gateway, and separate mock payment service. The application source is mounted into prebuilt Node containers, so there are no application image builds.

## Run locally

To start the app:

```bash
make up
```

Startup applies the additive Flash Sale database migration without removing existing data. A fresh database randomly selects two products for a 20% discount; the selection stays stable across restarts.

To stop the app:

```bash
make down
```

### OTel

If you want OTel, use:

```bash
# Paste your values — the endpoint can also be fetched by the CLI
export OTEL_EXPORTER_OTLP_ENDPOINT="https://<your-endpoint-from-bluebox-setup>"

# Paste the full header value from Bluebox Setup (do not include angle brackets)
export OTEL_EXPORTER_OTLP_HEADERS="<header value from Bluebox Setup>"

# Start the app (pulls images, waits for readiness)
make up
```
