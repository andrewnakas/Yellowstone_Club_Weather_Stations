# Yellowstone Club Weather Stations

Automated weather data collection and visualization for Yellowstone Club snow stations.

## Features

- **Automated Data Collection**: Fetches weather data every hour from 5 Yellowstone Club stations
- **Real-time Visualization**: Interactive charts with live updates (no page reload required)
- **Multiple Time Scales**: View data for 24h, 48h, 3 days, or 7 days
- **Station Selection**: Toggle individual stations on/off
- **GitHub Pages Hosted**: Fully automated deployment

## Stations

- **YCTIM** - Timberline
- **YCAND** - Andesite
- **YCAMS** - American Spirit
- **YCBAS** - Base
- **YCGBR** - Great Bear

## How It Works

1. **Data Fetching**: GitHub Actions runs `fetch_data.py` every hour to scrape weather data from weather.gov
2. **Storage**: Data is saved as JSON files in the `data/` directory and copied to `docs/data/`
3. **Deployment**: Changes trigger GitHub Pages deployment
4. **Live Updates**: The web page checks for new data every minute and regenerates charts automatically

## Project Structure

```
.
├── .github/
│   └── workflows/
│       ├── fetch-data.yml      # Hourly data collection
│       └── deploy-pages.yml    # GitHub Pages deployment
├── data/                        # Raw data storage
│   ├── all_stations.json       # Combined station data
│   ├── metadata.json           # Update timestamps
│   └── {STATION_ID}.json       # Individual station files
├── docs/                        # GitHub Pages site
│   ├── index.html              # Main visualization page
│   ├── app.js                  # Chart rendering & auto-update
│   └── data/                   # Data copy for web serving
├── fetch_data.py               # Data collection script
└── requirements.txt            # Python dependencies
```

## Setup Instructions

### 1. Enable GitHub Actions

In your repository settings:
- Go to **Settings** → **Actions** → **General**
- Enable "Allow all actions and reusable workflows"

### 2. Configure GitHub Pages

- Go to **Settings** → **Pages**
- Source: "GitHub Actions"
- The site will be deployed automatically

### 3. Initial Data Fetch

Trigger the first data collection:
- Go to **Actions** tab
- Select "Fetch Weather Data" workflow
- Click "Run workflow" → "Run workflow"

### 4. View Your Site

After the first successful run, your site will be available at:
```
https://{your-username}.github.io/{repository-name}/
```

## Local Development

### Run Data Fetch Locally

```bash
# Install dependencies
pip install -r requirements.txt
playwright install chromium

# Fetch data
python fetch_data.py
```

### Test Visualization Locally

```bash
# Serve the docs folder
cd docs
python -m http.server 8000

# Open browser to http://localhost:8000
```

## Customization

### Change Data Collection Frequency

Edit `.github/workflows/fetch-data.yml`:
```yaml
schedule:
  - cron: '0 * * * *'  # Every hour
  # - cron: '*/30 * * * *'  # Every 30 minutes
  # - cron: '0 */2 * * *'  # Every 2 hours
```

### Adjust Data History Length

Edit `fetch_data.py`:
```python
HOURS = 168  # 7 days
# HOURS = 336  # 14 days
```

### Change Auto-refresh Interval

Edit `docs/app.js`:
```javascript
const REFRESH_INTERVAL = 60000;  // 1 minute
// const REFRESH_INTERVAL = 30000;  // 30 seconds
```

### Add/Remove Stations

Edit `fetch_data.py`:
```python
STATIONS = {
    'YCTIM': 'Timberline',
    'YCAND': 'Andesite',
    # Add more stations here
}
```

## Data Format

### all_stations.json
```json
{
  "YCTIM": {
    "station_id": "YCTIM",
    "station_name": "Timberline",
    "timestamp": "2024-01-01T12:00:00",
    "data": "raw weather.gov data...",
    "url": "https://www.weather.gov/wrh/timeseries?site=YCTIM..."
  }
}
```

### metadata.json
```json
{
  "last_updated": "2024-01-01T12:00:00",
  "stations": ["YCTIM", "YCAND", "YCAMS", "YCBAS", "YCGBR"],
  "hours_of_data": 168
}
```

## Troubleshooting

### Data Not Updating

1. Check GitHub Actions logs in the "Actions" tab
2. Verify the workflow has proper permissions (Settings → Actions → General → Workflow permissions → "Read and write permissions")
3. Check if weather.gov is accessible

### Charts Not Showing

1. Open browser console (F12) for JavaScript errors
2. Verify data files exist in `docs/data/`
3. Check network tab for failed file loads

### GitHub Pages Not Deploying

1. Verify Pages is enabled (Settings → Pages)
2. Check deployment logs in Actions tab
3. Ensure `docs/` folder exists with `index.html`

## License

This project uses data from weather.gov (NOAA) which is public domain.

## Credits

Based on the [TimberLine Snow History](https://huggingface.co/spaces/nakas/TimberLine_Snow_History) Hugging Face Space.
