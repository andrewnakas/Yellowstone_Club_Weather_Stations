#!/usr/bin/env python3
"""
Fetch weather data from Yellowstone Club stations and save to JSON files.
"""
import json
import os
from datetime import datetime
from playwright.sync_api import sync_playwright
import time

# Station configuration
STATIONS = {
    'YCTIM': 'Timberline',
    'YCAND': 'Andesite',
    'YCAMS': 'American Spirit',
    'YCBAS': 'Base',
    'YCGBR': 'Great Bear'
}

# Data directory
DATA_DIR = 'data'
HOURS = 168  # 7 days of data


def fetch_station_data(page, site_id):
    """Fetch data for a single station."""
    url = f"https://www.weather.gov/wrh/timeseries?site={site_id}&hours={HOURS}&units=english&chart=on&headers=on&obs=tabular&hourly=false&pview=full&font=12&plot="

    try:
        print(f"  Loading URL: {url}")

        # Set user agent to mimic Chrome
        page.set_extra_http_headers({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })

        page.goto(url, timeout=60000)

        # Wait for table to load
        try:
            page.wait_for_selector('table', timeout=45000)
        except:
            print(f"  WARNING: Table selector timeout for {site_id}")

        time.sleep(2)

        # Extract table data using JavaScript
        content = page.evaluate('''() => {
            const tables = document.querySelectorAll('table');
            let result = {headers: [], rows: []};

            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                if (rows.length === 0) continue;

                // Get headers
                const headerCells = rows[0].querySelectorAll('th, td');
                if (headerCells.length > 0) {
                    const headerText = Array.from(headerCells).map(cell => cell.textContent.trim());

                    // Check if this looks like weather data (has Date or Time)
                    if (headerText.some(h => h.includes('Date') || h.includes('Time'))) {
                        result.headers = headerText;

                        // Get data rows
                        for (let i = 1; i < rows.length; i++) {
                            const cells = rows[i].querySelectorAll('td');
                            if (cells.length > 0) {
                                const rowData = Array.from(cells).map(cell => cell.textContent.trim());
                                result.rows.push(rowData);
                            }
                        }
                        break;
                    }
                }
            }
            return result;
        }''')

        print(f"  Found {len(content['rows'])} data rows")

        return {
            'station_id': site_id,
            'station_name': STATIONS.get(site_id, site_id),
            'timestamp': datetime.utcnow().isoformat(),
            'data': content,
            'url': url
        }
    except Exception as e:
        print(f"  Error fetching {site_id}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'station_id': site_id,
            'station_name': STATIONS.get(site_id, site_id),
            'timestamp': datetime.utcnow().isoformat(),
            'error': str(e),
            'url': url
        }


def main():
    """Main function to fetch all station data."""
    # Create data directory if it doesn't exist
    os.makedirs(DATA_DIR, exist_ok=True)

    all_data = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        for site_id, site_name in STATIONS.items():
            print(f"Fetching data for {site_name} ({site_id})...")
            station_data = fetch_station_data(page, site_id)
            all_data[site_id] = station_data

            # Save individual station file
            station_file = os.path.join(DATA_DIR, f'{site_id}.json')
            with open(station_file, 'w') as f:
                json.dump(station_data, f, indent=2)

            print(f"✓ Saved {site_name} data")

        browser.close()

    # Save combined data file
    combined_file = os.path.join(DATA_DIR, 'all_stations.json')
    with open(combined_file, 'w') as f:
        json.dump(all_data, f, indent=2)

    # Save metadata
    metadata = {
        'last_updated': datetime.utcnow().isoformat(),
        'stations': list(STATIONS.keys()),
        'hours_of_data': HOURS
    }
    metadata_file = os.path.join(DATA_DIR, 'metadata.json')
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\n✓ All data fetched successfully")
    print(f"Last updated: {metadata['last_updated']}")


if __name__ == '__main__':
    main()
