// Configuration
const DATA_PATH = 'data/';
const REFRESH_INTERVAL = 60000; // Check for updates every minute
const STATION_COLORS = {
    'YCTIM': '#667eea',
    'YCAND': '#f59e0b',
    'YCAMS': '#10b981',
    'YCBAS': '#ef4444',
    'YCGBR': '#8b5cf6'
};

// Global state
let currentData = {};
let charts = {};
let lastUpdateTimestamp = null;
let selectedStations = new Set(['YCTIM', 'YCAND', 'YCAMS', 'YCBAS', 'YCGBR']);
let timeRangeHours = 168;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await loadData();
    startAutoRefresh();
});

function setupEventListeners() {
    // Time range selector
    document.getElementById('timeRange').addEventListener('change', (e) => {
        timeRangeHours = parseInt(e.target.value);
        updateCharts();
    });

    // Station checkboxes
    document.querySelectorAll('.station-checkbox input').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedStations.add(e.target.value);
            } else {
                selectedStations.delete(e.target.value);
            }
            updateCharts();
        });
    });
}

async function loadData() {
    try {
        const response = await fetch(`${DATA_PATH}all_stations.json?_=${Date.now()}`);
        if (!response.ok) throw new Error('Failed to fetch data');

        const data = await response.json();

        // Check if data is empty
        if (Object.keys(data).length === 0) {
            document.getElementById('loading').innerHTML =
                'Waiting for initial data fetch...<br><small>Please run the "Fetch Weather Data" GitHub Action to populate data.</small>';
            return;
        }

        // Check if data has changed
        const metadataResponse = await fetch(`${DATA_PATH}metadata.json?_=${Date.now()}`);
        const metadata = await metadataResponse.json();

        const newTimestamp = metadata.last_updated;
        const hasNewData = newTimestamp !== lastUpdateTimestamp;

        if (hasNewData) {
            currentData = data;
            lastUpdateTimestamp = newTimestamp;
            document.getElementById('lastUpdate').textContent =
                `Last updated: ${new Date(newTimestamp).toLocaleString()}`;

            processData();
            renderCharts();
        }

        document.getElementById('loading').style.display = 'none';

    } catch (error) {
        console.error('Error loading data:', error);
        showError(`Failed to load data: ${error.message}`);
    }
}

function processData() {
    // Parse weather data from each station
    for (const [stationId, stationData] of Object.entries(currentData)) {
        if (stationData.error || !stationData.data) continue;

        const parsed = parseWeatherData(stationData.data);
        currentData[stationId].parsed = parsed;
    }
}

function parseWeatherData(data) {
    // Data is now structured JSON with headers and rows
    const result = {
        timestamps: [],
        temperature: [],
        windSpeed: [],
        snowDepth: [],
        precipitation: []
    };

    // Check if data is empty or has old text format
    if (!data || typeof data === 'string') {
        return result;
    }

    if (!data.headers || !data.rows || data.rows.length === 0) {
        return result;
    }

    // Find column indices from headers
    const headers = data.headers.map(h => h.toLowerCase());
    const dateIdx = headers.findIndex(h => h.includes('date'));
    const timeIdx = headers.findIndex(h => h.includes('time'));
    const tempIdx = headers.findIndex(h => h.includes('temp') && !h.includes('dew'));
    const windIdx = headers.findIndex(h => h.includes('wind') && h.includes('speed'));
    const snowIdx = headers.findIndex(h => h.includes('snow') && h.includes('depth'));
    const precipIdx = headers.findIndex(h => h.includes('precip'));

    // Parse numeric value helper
    const parseValue = (val) => {
        if (!val || val === 'M' || val === 'MM' || val === '') return null;
        const num = parseFloat(val);
        return isNaN(num) ? null : num;
    };

    // Process each row
    for (const row of data.rows) {
        try {
            // Build timestamp from date/time columns
            let timestampStr = '';
            if (dateIdx >= 0 && row[dateIdx]) {
                timestampStr = row[dateIdx];
                if (timeIdx >= 0 && row[timeIdx]) {
                    timestampStr += ' ' + row[timeIdx];
                }
            }

            if (!timestampStr) continue;

            // Parse timestamp (remove timezone abbreviations if present)
            timestampStr = timestampStr.replace(/\s+(UTC|MST|MDT|PST|PDT)$/, '');
            const timestamp = new Date(timestampStr);

            if (isNaN(timestamp.getTime())) continue;

            result.timestamps.push(timestamp);
            result.temperature.push(tempIdx >= 0 ? parseValue(row[tempIdx]) : null);
            result.windSpeed.push(windIdx >= 0 ? parseValue(row[windIdx]) : null);
            result.snowDepth.push(snowIdx >= 0 ? parseValue(row[snowIdx]) : null);
            result.precipitation.push(precipIdx >= 0 ? parseValue(row[precipIdx]) : null);

        } catch (e) {
            console.warn('Error parsing row:', row, e);
        }
    }

    return result;
}

function filterDataByTimeRange(data) {
    const cutoffTime = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
    const filtered = {
        timestamps: [],
        temperature: [],
        windSpeed: [],
        snowDepth: [],
        precipitation: []
    };

    for (let i = 0; i < data.timestamps.length; i++) {
        if (data.timestamps[i] >= cutoffTime) {
            filtered.timestamps.push(data.timestamps[i]);
            filtered.temperature.push(data.temperature[i]);
            filtered.windSpeed.push(data.windSpeed[i]);
            filtered.snowDepth.push(data.snowDepth[i]);
            filtered.precipitation.push(data.precipitation[i]);
        }
    }

    return filtered;
}

function renderCharts() {
    const chartsGrid = document.getElementById('chartsGrid');
    const statsGrid = document.getElementById('statsGrid');

    chartsGrid.innerHTML = '';
    statsGrid.innerHTML = '';
    statsGrid.style.display = 'grid';

    // Render statistics
    renderStats();

    // Create charts
    createChart('temperature', 'Temperature (°F)', 'line');
    createChart('windSpeed', 'Wind Speed (mph)', 'line');
    createChart('snowDepth', 'Snow Depth (inches)', 'line');
    createChart('precipitation', 'Precipitation (inches)', 'bar');
}

function renderStats() {
    const statsGrid = document.getElementById('statsGrid');

    // Calculate aggregate stats
    let totalStations = 0;
    let avgTemp = 0;
    let maxSnowDepth = 0;
    let totalPrecip = 0;

    for (const stationId of selectedStations) {
        const data = currentData[stationId]?.parsed;
        if (!data) continue;

        totalStations++;

        // Get latest values
        const latestIdx = data.timestamps.length - 1;
        if (latestIdx >= 0) {
            const temp = data.temperature[latestIdx];
            const snow = data.snowDepth[latestIdx];
            const precip = data.precipitation[latestIdx];

            if (temp !== null) avgTemp += temp;
            if (snow !== null && snow > maxSnowDepth) maxSnowDepth = snow;
            if (precip !== null) totalPrecip += precip;
        }
    }

    if (totalStations > 0) {
        avgTemp /= totalStations;
    }

    const stats = [
        { label: 'Active Stations', value: totalStations },
        { label: 'Avg Temperature', value: `${avgTemp.toFixed(1)}°F` },
        { label: 'Max Snow Depth', value: `${maxSnowDepth.toFixed(1)}"` },
        { label: 'Total Precip', value: `${totalPrecip.toFixed(2)}"` }
    ];

    stats.forEach(stat => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `
            <div class="stat-label">${stat.label}</div>
            <div class="stat-value">${stat.value}</div>
        `;
        statsGrid.appendChild(card);
    });
}

function createChart(dataKey, title, type = 'line') {
    const container = document.createElement('div');
    container.className = 'chart-container';

    const chartTitle = document.createElement('div');
    chartTitle.className = 'chart-title';
    chartTitle.textContent = title;

    const canvas = document.createElement('canvas');
    canvas.id = `chart-${dataKey}`;

    container.appendChild(chartTitle);
    container.appendChild(canvas);
    document.getElementById('chartsGrid').appendChild(container);

    // Prepare datasets
    const datasets = [];

    for (const stationId of selectedStations) {
        const stationData = currentData[stationId];
        if (!stationData?.parsed) continue;

        const filtered = filterDataByTimeRange(stationData.parsed);

        datasets.push({
            label: stationData.station_name,
            data: filtered.timestamps.map((timestamp, i) => ({
                x: timestamp,
                y: filtered[dataKey][i]
            })),
            borderColor: STATION_COLORS[stationId],
            backgroundColor: type === 'bar' ? STATION_COLORS[stationId] + '80' : STATION_COLORS[stationId] + '20',
            borderWidth: 2,
            fill: type === 'line',
            tension: 0.4,
            pointRadius: type === 'line' ? 0 : 3,
            pointHoverRadius: 5
        });
    }

    // Destroy existing chart
    if (charts[dataKey]) {
        charts[dataKey].destroy();
    }

    // Create new chart
    charts[dataKey] = new Chart(canvas, {
        type: type,
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            return new Date(items[0].parsed.x).toLocaleString();
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        tooltipFormat: 'MMM dd, HH:mm',
                        displayFormats: {
                            hour: 'MMM dd HH:mm',
                            day: 'MMM dd'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Time'
                    }
                },
                y: {
                    beginAtZero: dataKey === 'precipitation',
                    title: {
                        display: true,
                        text: title
                    }
                }
            }
        }
    });
}

function updateCharts() {
    renderCharts();
}

function startAutoRefresh() {
    setInterval(async () => {
        await loadData();
    }, REFRESH_INTERVAL);
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('loading').style.display = 'none';
}
