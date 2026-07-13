# Central Image Downloader — Web deployment

Deployment copy of the existing Central Image Downloader UI. It keeps the
current workflow and supports Central image lookup, gallery selection, ZIP,
Dicut, Dicut AI, and the existing local Photoshop-helper flow.

## Run locally

```powershell
python -m pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## Hosting notes

- Run one Gunicorn worker because job sessions and image edits are in memory.
- `REMBG_MODEL=u2netp` is the low-memory default for hosted Dicut AI.
- Set `ACCESS_PASSWORD` to protect a private deployment; leave it unset for the
  same link-only public access model as the Strip Banner app.
- Dicut PS still runs Photoshop on the user's computer through the local helper.
