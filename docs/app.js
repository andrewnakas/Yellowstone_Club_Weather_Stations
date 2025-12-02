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
let enabledCharts = new Set(['temperature', 'windSpeed', 'windDirection', 'snowDepth', 'newSnow24h', 'swe']);
let overlayMode = false;

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

    // Chart toggle checkboxes
    const chartTypes = ['temperature', 'windSpeed', 'windDirection', 'snowDepth', 'newSnow24h', 'swe'];
    chartTypes.forEach(type => {
        const checkbox = document.getElementById(`toggle-${type}`);
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    enabledCharts.add(type);
                } else {
                    enabledCharts.delete(type);
                }
                updateCharts();
            });
        }
    });

    // Overlay mode toggle
    const overlayCheckbox = document.getElementById('toggle-overlay');
    if (overlayCheckbox) {
        overlayCheckbox.addEventListener('change', (e) => {
            overlayMode = e.target.checked;
            const chartsGrid = document.getElementById('chartsGrid');
            if (overlayMode) {
                chartsGrid.classList.add('overlay-mode');
                document.body.classList.add('overlay-active');
            } else {
                chartsGrid.classList.remove('overlay-mode');
                document.body.classList.remove('overlay-active');
            }
            updateCharts();
        });
    }
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
        document.getElementById('chartControls').style.display = 'block';

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
        windDirection: [],
        snowDepth: [],
        rawSnowDepth: [], // Keep raw values for debugging
        newSnow24h: [],
        swe: [],
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
    const headers = data.headers.map(h => h.toLowerCase().replace(/\s+/g, ''));

    // Look for date/time column (could be combined or separate)
    const dateTimeIdx = headers.findIndex(h => h.includes('date') && h.includes('time'));
    const dateIdx = dateTimeIdx >= 0 ? dateTimeIdx : headers.findIndex(h => h.includes('date'));
    const timeIdx = dateTimeIdx >= 0 ? -1 : headers.findIndex(h => h.includes('time'));

    const tempIdx = headers.findIndex(h => h.includes('temp') && !h.includes('dew'));
    const windSpeedIdx = headers.findIndex(h => h.includes('wind') && h.includes('speed'));
    const windDirIdx = headers.findIndex(h => h.includes('wind') && h.includes('direction'));
    const snowDepthIdx = headers.findIndex(h => h.includes('snow') && h.includes('depth'));
    const newSnow24hIdx = headers.findIndex(h => h.includes('snowfall') && h.includes('24'));
    const sweIdx = headers.findIndex(h => h.includes('equivalent'));
    const precipIdx = headers.findIndex(h => h.includes('precip') && !h.includes('snow'));

    console.log('Column indices:', { dateIdx, timeIdx, tempIdx, windSpeedIdx, windDirIdx, snowDepthIdx, newSnow24hIdx, sweIdx, precipIdx });

    // Parse numeric value helper
    const parseValue = (val) => {
        if (!val || val === 'M' || val === 'MM' || val === '') return null;
        // Handle wind speed with gusts (e.g., "28G38" -> 28)
        const cleanVal = String(val).split('G')[0];
        const num = parseFloat(cleanVal);
        return isNaN(num) ? null : num;
    };

    // Validate snowfall values (filter out anomalies)
    const validateSnowfall = (val) => {
        if (val === null) return null;
        // 24-hour snowfall rarely exceeds 12" (1 foot) - anything higher is likely a sensor error
        // Most extreme snowfall events are 2-3" per hour = 24-36" in 24 hours max
        if (val > 12) {
            console.warn(`Anomalous 24h snowfall detected: ${val}" (filtered out)`);
            return null;
        }
        return val;
    };

    // Validate SWE values
    const validateSWE = (val) => {
        if (val === null) return null;
        // SWE should never exceed 10" in a single reading (data glitch filter)
        if (val > 10) return null;
        return val;
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

            // Parse timestamp - convert formats like "Dec 1, 6:00 pm" to proper date
            const now = new Date();
            const currentYear = now.getFullYear();

            // Add year to the timestamp if not present
            if (!timestampStr.includes(currentYear)) {
                timestampStr = timestampStr + ' ' + currentYear;
            }

            const timestamp = new Date(timestampStr);

            // If date is invalid or in future, try previous year
            if (isNaN(timestamp.getTime()) || timestamp > now) {
                timestampStr = timestampStr.replace(currentYear, currentYear - 1);
                const adjustedTimestamp = new Date(timestampStr);
                if (!isNaN(adjustedTimestamp.getTime())) {
                    result.timestamps.push(adjustedTimestamp);
                } else {
                    continue;
                }
            } else {
                result.timestamps.push(timestamp);
            }

            result.temperature.push(tempIdx >= 0 ? parseValue(row[tempIdx]) : null);
            result.windSpeed.push(windSpeedIdx >= 0 ? parseValue(row[windSpeedIdx]) : null);
            result.windDirection.push(windDirIdx >= 0 ? row[windDirIdx] : null);
            const rawSnow = snowDepthIdx >= 0 ? parseValue(row[snowDepthIdx]) : null;
            result.rawSnowDepth.push(rawSnow);
            result.snowDepth.push(rawSnow); // Will be smoothed later
            result.newSnow24h.push(newSnow24hIdx >= 0 ? validateSnowfall(parseValue(row[newSnow24hIdx])) : null);
            result.swe.push(sweIdx >= 0 ? validateSWE(parseValue(row[sweIdx])) : null);
            result.precipitation.push(precipIdx >= 0 ? parseValue(row[precipIdx]) : null);

        } catch (e) {
            console.warn('Error parsing row:', row, e);
        }
    }

    console.log('Parsed data points:', result.timestamps.length);

    // Smooth snow depth to remove unrealistic spikes (max 5" change per hour)
    for (let i = 1; i < result.snowDepth.length; i++) {
        const current = result.snowDepth[i];
        const previous = result.snowDepth[i - 1];

        if (current !== null && previous !== null) {
            const change = Math.abs(current - previous);
            // If change exceeds 5 inches per hour, it's likely a sensor error
            if (change > 5) {
                console.warn(`Snow depth spike detected at index ${i}: ${previous}" -> ${current}" (${change}" change)`);
                // Replace spike with interpolated value
                result.snowDepth[i] = previous;
            }
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
        windDirection: [],
        snowDepth: [],
        newSnow24h: [],
        swe: [],
        precipitation: []
    };

    for (let i = 0; i < data.timestamps.length; i++) {
        if (data.timestamps[i] >= cutoffTime) {
            filtered.timestamps.push(data.timestamps[i]);
            filtered.temperature.push(data.temperature[i]);
            filtered.windSpeed.push(data.windSpeed[i]);
            filtered.windDirection.push(data.windDirection[i]);
            filtered.snowDepth.push(data.snowDepth[i]);
            filtered.newSnow24h.push(data.newSnow24h[i]);
            filtered.swe.push(data.swe[i]);
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

    // Create charts based on enabled toggles
    if (enabledCharts.has('temperature')) {
        createChart('temperature', 'Temperature (°F)', 'line');
    }
    if (enabledCharts.has('windSpeed')) {
        createChart('windSpeed', 'Wind Speed (mph)', 'line');
    }
    if (enabledCharts.has('windDirection')) {
        createWindDirectionChart();
    }
    if (enabledCharts.has('snowDepth')) {
        createChart('snowDepth', 'Snow Depth (inches)', 'line');
    }
    if (enabledCharts.has('newSnow24h')) {
        createChart('newSnow24h', '24-Hour Snowfall (inches)', 'bar');
    }
    if (enabledCharts.has('swe')) {
        createChart('swe', 'Snow Water Equivalent (inches)', 'line');
    }

    // Update chart count for grid layout
    chartsGrid.setAttribute('data-chart-count', enabledCharts.size);
}

function renderStats() {
    const statsGrid = document.getElementById('statsGrid');

    // Calculate aggregate stats
    let totalStations = 0;
    let avgTemp = 0;
    let maxSnowDepth = 0;
    let maxNewSnow24h = 0;
    let avgSWE = 0;

    for (const stationId of selectedStations) {
        const data = currentData[stationId]?.parsed;
        if (!data) continue;

        totalStations++;

        // Get latest values
        const latestIdx = data.timestamps.length - 1;
        if (latestIdx >= 0) {
            const temp = data.temperature[latestIdx];
            const snow = data.snowDepth[latestIdx];
            const newSnow = data.newSnow24h[latestIdx];
            const swe = data.swe[latestIdx];

            if (temp !== null) avgTemp += temp;
            if (snow !== null && snow > maxSnowDepth) maxSnowDepth = snow;
            if (newSnow !== null && newSnow > maxNewSnow24h) maxNewSnow24h = newSnow;
            if (swe !== null) avgSWE += swe;
        }
    }

    if (totalStations > 0) {
        avgTemp /= totalStations;
        avgSWE /= totalStations;
    }

    const stats = [
        { label: 'Active Stations', value: totalStations },
        { label: 'Avg Temperature', value: `${avgTemp.toFixed(1)}°F` },
        { label: 'Max Snow Depth', value: `${maxSnowDepth.toFixed(1)}"` },
        { label: 'Max 24h Snowfall', value: `${maxNewSnow24h.toFixed(1)}"` },
        { label: 'Avg SWE', value: `${avgSWE.toFixed(2)}"` }
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

    // Create new chart with overlay-specific settings
    const isOverlay = overlayMode;

    charts[dataKey] = new Chart(canvas, {
        type: type,
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: isOverlay ? 2 : 10
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: !isOverlay,
                    position: 'top',
                    labels: {
                        font: {
                            size: isOverlay ? 8 : 12
                        },
                        padding: isOverlay ? 3 : 10,
                        boxWidth: isOverlay ? 20 : 40
                    }
                },
                tooltip: {
                    enabled: true,
                    bodyFont: {
                        size: isOverlay ? 10 : 12
                    },
                    titleFont: {
                        size: isOverlay ? 10 : 12
                    },
                    padding: isOverlay ? 6 : 10,
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
                        display: false
                    },
                    ticks: {
                        font: {
                            size: isOverlay ? 8 : 11
                        },
                        maxRotation: isOverlay ? 0 : 45,
                        autoSkip: true,
                        maxTicksLimit: isOverlay ? 6 : 10
                    },
                    grid: {
                        display: !isOverlay
                    }
                },
                y: {
                    beginAtZero: dataKey === 'precipitation',
                    title: {
                        display: false
                    },
                    ticks: {
                        font: {
                            size: isOverlay ? 8 : 11
                        },
                        maxTicksLimit: isOverlay ? 5 : 8
                    },
                    grid: {
                        color: isOverlay ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.1)'
                    }
                }
            }
        }
    });
}

function createWindDirectionChart() {
    const container = document.createElement('div');
    container.className = 'chart-container';

    const chartTitle = document.createElement('div');
    chartTitle.className = 'chart-title';
    chartTitle.textContent = 'Wind Direction';

    const canvas = document.createElement('canvas');
    canvas.id = 'chart-windDirection';

    container.appendChild(chartTitle);
    container.appendChild(canvas);
    document.getElementById('chartsGrid').appendChild(container);

    // Convert wind directions to degrees for visualization
    const windDirToDegrees = (dir) => {
        const directions = {
            'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
            'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
            'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
            'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
        };
        return directions[dir] !== undefined ? directions[dir] : null;
    };

    // Prepare datasets - aggregate by day and show dominant direction
    const dailyWindData = {};

    for (const stationId of selectedStations) {
        const stationData = currentData[stationId];
        if (!stationData?.parsed) continue;

        const filtered = filterDataByTimeRange(stationData.parsed);

        // Group by day
        for (let i = 0; i < filtered.timestamps.length; i++) {
            const timestamp = filtered.timestamps[i];
            const dayKey = timestamp.toLocaleDateString();

            if (!dailyWindData[dayKey]) {
                dailyWindData[dayKey] = { directions: {}, timestamp };
            }

            const dir = filtered.windDirection[i];
            if (dir) {
                dailyWindData[dayKey].directions[dir] = (dailyWindData[dayKey].directions[dir] || 0) + 1;
            }
        }
    }

    // Find dominant direction for each day
    const chartData = Object.entries(dailyWindData).map(([day, data]) => {
        const dominantDir = Object.entries(data.directions).sort((a, b) => b[1] - a[1])[0]?.[0];
        return {
            x: data.timestamp,
            y: windDirToDegrees(dominantDir),
            direction: dominantDir
        };
    }).filter(d => d.y !== null);

    // Destroy existing chart
    if (charts['windDirection']) {
        charts['windDirection'].destroy();
    }

    // Create chart with overlay-specific settings
    const isOverlay = overlayMode;

    charts['windDirection'] = new Chart(canvas, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Dominant Wind Direction',
                data: chartData,
                backgroundColor: '#667eea',
                pointRadius: isOverlay ? 4 : 8,
                pointHoverRadius: isOverlay ? 6 : 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: isOverlay ? 2 : 10
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    bodyFont: {
                        size: isOverlay ? 10 : 12
                    },
                    titleFont: {
                        size: isOverlay ? 10 : 12
                    },
                    padding: isOverlay ? 6 : 10,
                    callbacks: {
                        title: (items) => new Date(items[0].raw.x).toLocaleDateString(),
                        label: (item) => `Direction: ${item.raw.direction}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: { day: 'MMM dd' }
                    },
                    title: { display: false },
                    ticks: {
                        font: {
                            size: isOverlay ? 8 : 11
                        },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: isOverlay ? 6 : 10
                    },
                    grid: {
                        display: !isOverlay
                    }
                },
                y: {
                    min: 0,
                    max: 360,
                    ticks: {
                        stepSize: 45,
                        font: {
                            size: isOverlay ? 8 : 11
                        },
                        callback: (value) => {
                            const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
                            return dirs[Math.round(value / 45)];
                        }
                    },
                    title: { display: false },
                    grid: {
                        color: isOverlay ? 'rgba(0, 0, 0, 0.05)' : 'rgba(0, 0, 0, 0.1)'
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
