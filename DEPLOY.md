# Deploying Anamnesis to Cloud Run

Start to finish, from a browser. Nothing needs installing on your machine.

> **The app cannot be redeployed from Google AI Studio.** AI Studio holds its
> own copy of the code from when the project was first built there. The current
> application lives in this repository and differs from it substantially, so a
> redeploy from AI Studio would republish the old version. Deploy from here.

---

## Before you start

You need:

- A Google account with billing enabled (Cloud Run has a free tier, but the
  project must still have a billing account attached).
- A Gemini API key.
- A shared secret you invent now — any long random string. **Write it down.**
  It is used twice, in step 7 and step 8, and the two must match exactly.

Open **[Google Cloud Shell](https://shell.cloud.google.com)**. It is a browser
terminal with `gcloud`, `docker` and `git` already installed. Every command
below runs there.

---

## 1. Get the code

```bash
git clone https://github.com/deepindersinghbti/ANAMNESIS.git && cd ANAMNESIS
```

## 2. Create a project

```bash
gcloud projects create anamnesis-$(date +%s) --name="Anamnesis" --set-as-default
```

Record the ID it prints — every later step uses it:

```bash
export PROJECT_ID=$(gcloud config get-value project) && echo "$PROJECT_ID"
```

## 3. Attach billing

Cloud Run will not deploy without it. Easiest in the console:
**console.cloud.google.com/billing** → select your new project → link a billing
account.

Confirm it worked:

```bash
gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingEnabled)'
```

You want `True`.

## 4. Enable the services

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

## 5. Create the image repository

```bash
gcloud artifacts repositories create anamnesis --repository-format=docker --location=asia-southeast1
```

## 6. Store the Gemini key, and let Cloud Run read it

The key is never an environment variable. It goes in Secret Manager.

```bash
printf '%s' 'PASTE_YOUR_GEMINI_KEY_HERE' | gcloud secrets create gemini-api-key --data-file=-
```

**This next command is not optional.** Referencing a secret from Cloud Run does
not grant permission to read it, and the deploy fails with a permission error
if you skip it:

```bash
gcloud secrets add-iam-policy-binding gemini-api-key --member="serviceAccount:$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

## 6b. Store the Hugging Face token

The manipulation verdict comes from detectors, not from the language model.
Detector B — signal forensics: ELA block statistics, sensor-noise residual and
the JPEG ghost curve — runs in the browser and needs no configuration. Detector
A is a pretrained synthetic-image classifier reached through the Hugging Face
Inference API, and it needs a token.

Unlike `API_SHARED_SECRET`, this is a real credential against a metered
account and is never compiled into the bundle, so it belongs in Secret Manager
alongside the Gemini key:

```bash
printf '%s' 'PASTE_YOUR_HF_TOKEN_HERE' | gcloud secrets create hf-token --data-file=-
```

```bash
gcloud secrets add-iam-policy-binding hf-token --member="serviceAccount:$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

Deploying without it is supported and fails honestly: synthetic probability
reports `NOT_ASSESSED`, the manipulation confidence is still measured by
Detector B, and the startup log says which detector is missing.

## 7. Build the image

Replace `YOUR-SHARED-SECRET` with the string you chose. It is compiled into the
browser bundle here, which is why it has to be a build argument rather than
only a runtime variable.

```bash
gcloud builds submit --config cloudbuild.yaml --substitutions=_API_SHARED_SECRET="YOUR-SHARED-SECRET",_REGION="asia-southeast1"
```

## 8. Deploy

The same secret string as step 7. If they differ, the server will demand a
header the browser never sends and every analysis returns 401.

```bash
gcloud run deploy anamnesis-media-forensics-engine --region asia-southeast1 --image "asia-southeast1-docker.pkg.dev/$PROJECT_ID/anamnesis/anamnesis-media-forensics-engine:latest" --allow-unauthenticated --max-instances 1 --timeout 120 --set-env-vars "NODE_ENV=production,GEMINI_MODEL=gemini-3.6-flash,HF_DETECTOR_MODEL=Organika/sdxl-detector,API_SHARED_SECRET=YOUR-SHARED-SECRET" --set-secrets GEMINI_API_KEY=gemini-api-key:latest,HF_TOKEN=hf-token:latest
```

## 9. Verify

```bash
curl -s "$(gcloud run services describe anamnesis-media-forensics-engine --region asia-southeast1 --format='value(status.url)')/api/health"
```

A correct deployment returns all four of these:

```json
{
  "status": "ok",
  "model": "gemini-3.6-flash",
  "timeoutMs": 30000,
  "authRequired": true,
  "rateLimit": { "max": 12, "windowMs": 60000 }
}
```

If `model`, `timeoutMs` or `authRequired` is missing, an older revision is
still serving and something above did not take effect.

## 10. Open it

```bash
gcloud run services describe anamnesis-media-forensics-engine --region asia-southeast1 --format='value(status.url)'
```

Put that URL in the README, replacing the old one.

---

## Why the flags are what they are

| Flag | Reason |
| --- | --- |
| `--max-instances 1` | The rate limiter is a fixed window held in one process's memory. Scale beyond one instance and each gets its own counter, so the limit stops meaning anything. |
| `--timeout 120` | Comfortably longer than the app's own 30s model deadline, so the application's honest 504 reaches the user rather than Cloud Run severing the connection first. |
| `--allow-unauthenticated` | Judges open a link; they do not hold Google credentials. The shared secret and rate limit are what protect the endpoint. |
| `--set-secrets` for the key | A paid API key on a public URL does not belong in an environment variable that anyone with console read access can see. |

## Rotating the shared secret

It is compiled into the client bundle, so changing it means repeating steps 7
and 8 — not just editing a Cloud Run variable.

## If something fails

**Build fails on permissions.** Newer projects restrict the Cloud Build service
account. Grant it what it needs:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role="roles/logging.logWriter"
```

**Every analysis returns 401.** The secret in step 7 and step 8 do not match.
Repeat both with identical values.

**Analyses time out.** Raise the deadline and redeploy:
`--set-env-vars GEMINI_TIMEOUT_MS=45000` alongside the others. Values below
10000 are rejected by the model API and are clamped up automatically.

**The model is unavailable.** Capacity moves between models. Check which ones
answer, then set `GEMINI_MODEL` to one that does and redeploy — no rebuild
needed, it is a runtime variable:

```bash
for M in gemini-3.7-flash gemini-3.6-flash gemini-3.5-flash gemini-2.5-flash; do echo -n "$M "; curl -s -o /dev/null -w "%{http_code}\n" "https://generativelanguage.googleapis.com/v1beta/models/$M:generateContent?key=$GEMINI_API_KEY" -H 'Content-Type: application/json' -d '{"contents":[{"parts":[{"text":"hi"}]}]}'; done
```

## Running it locally instead

The presentation should not depend on conference wifi reaching Cloud Run. The
same container runs on a laptop:

```bash
docker build --build-arg API_SHARED_SECRET=local-secret -t anamnesis . && docker run --rm -p 3000:3000 --env-file .env anamnesis
```

Demo Mode is the other safety net: reference cases render with no network calls
at all, badged as precomputed.
