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
    url = f"https://www.weather.gov/wrh/timeseries?site={site_id}&hours={HOURS}&units=english"

    try:
        print(f"  Loading URL: {url}")
        page.goto(url, timeout=60000)
        page.wait_for_load_state('networkidle', timeout=60000)

        # Wait for content to load
        time.sleep(5)

        # Try multiple selectors to find the data
        data_text = ""

        # Try 1: Look for pre tag
        if page.locator('pre').count() > 0:
            data_text = page.locator('pre').first.text_content()
            print(f"  Found data in <pre> tag ({len(data_text)} chars)")

        # Try 2: Look for textarea
        elif page.locator('textarea').count() > 0:
            data_text = page.locator('textarea').first.text_content()
            print(f"  Found data in <textarea> ({len(data_text)} chars)")

        # Try 3: Get body text
        else:
            body = page.locator('body').text_content()
            # Look for data patterns (dates like 2024-12-01)
            if '202' in body and 'UTC' in body:
                data_text = body
                print(f"  Using full body text ({len(data_text)} chars)")
            else:
                print(f"  WARNING: No data found for {site_id}")
                # Save page screenshot for debugging
                try:
                    screenshot_path = f"debug_{site_id}.png"
                    page.screenshot(path=screenshot_path)
                    print(f"  Saved screenshot to {screenshot_path}")
                except:
                    pass

        return {
            'station_id': site_id,
            'station_name': STATIONS.get(site_id, site_id),
            'timestamp': datetime.utcnow().isoformat(),
            'data': data_text,
            'url': url
        }
    except Exception as e:
        print(f"Error fetching {site_id}: {str(e)}")
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
