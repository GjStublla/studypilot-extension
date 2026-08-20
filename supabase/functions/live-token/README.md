# live-token edge function (Vertex AI)

Mints a short-lived Google OAuth2 access token from a service account and
returns a Vertex AI Live WebSocket URL to the authenticated extension client.
The service account key never leaves the server.

## Required Supabase secrets

| Secret | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full content of the GCP service account JSON key file |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (e.g. `studypilot-prod`) |
| `VERTEX_LOCATION` | Region (e.g. `us-central1`) — defaults to `us-central1` |

## Service account permissions

The service account needs the **Vertex AI User** role (`roles/aiplatform.user`)
on the GCP project.

## Deploy

```bash
# Deploy the function
npx supabase functions deploy live-token --project-ref rqszloxxegvxaedptcqj

# Set secrets (one-time — values never go in source control)
npx supabase secrets set \
  GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)" \
  GOOGLE_CLOUD_PROJECT=your-gcp-project-id \
  VERTEX_LOCATION=us-central1 \
  --project-ref rqszloxxegvxaedptcqj
```

## Response shape

```json
{
  "accessToken": "ya29.c...",
  "webSocketUrl": "wss://us-central1-aiplatform.googleapis.com/ws/...?Authorization=Bearer%20ya29...",
  "model": "projects/your-project/locations/us-central1/publishers/google/models/gemini-2.0-flash-live-001",
  "expiresAt": "2026-08-03T22:00:00.000Z"
}
```
