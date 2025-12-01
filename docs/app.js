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

function parseWeatherData(dataText) {
    // Parse the weather.gov text format
    const lines = dataText.split('\n');
    const result = {
        timestamps: [],
        temperature: [],
        windSpeed: [],
        snowDepth: [],
        precipitation: []
    };

    // Find data section (after header lines)
    let dataStarted = false;

    for (const line of lines) {
        if (!line.trim()) continue;

        // Skip header lines
        if (line.includes('UTC') || line.includes('---') || line.includes('DATE')) {
            dataStarted = true;
            continue;
        }

        if (!dataStarted) continue;

        // Parse data line
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;

        try {
            // Typical format: YYYY-MM-DD HH:MM temp wind snow precip ...
            const dateTime = `${parts[0]} ${parts[1]}`;
            const timestamp = new Date(dateTime);

            if (isNaN(timestamp.getTime())) continue;

            result.timestamps.push(timestamp);

            // Parse numeric values (they might be 'M' for missing)
            const parseValue = (val) => {
                if (!val || val === 'M' || val === 'MM') return null;
                const num = parseFloat(val);
                return isNaN(num) ? null : num;
            };

            // Adjust indices based on actual data format
            result.temperature.push(parseValue(parts[2]));
            result.windSpeed.push(parseValue(parts[3]));
            result.snowDepth.push(parseValue(parts[4]));
            result.precipitation.push(parseValue(parts[5]));

        } catch (e) {
            console.warn('Error parsing line:', line, e);
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
