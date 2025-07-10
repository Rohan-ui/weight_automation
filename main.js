const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
const ZPLPrinter = require('./zpl-printer');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const exec = require('child_process').exec;

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

let mainWindow;
let serialPort;
let parser;
let isPortBusy = false;
let zplPrinter;
let lastDataTime = Date.now();
const DATA_TIMEOUT = 10000; // 10 seconds timeout
// Serial port configuration with backup ports
const SERIAL_CONFIG = {
    defaultPath: 'COM3',
    baudRate: 9600,
    alternativePorts: [] // Only try COM3
};


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
        closeSerialPort().catch(err => {
            console.error('Error closing port during window closure:', err);
        });
    });

    // List available printers
    exec('wmic printer get name,portname', (error, stdout, stderr) => {
        if (error) {
            console.error('Error getting printer list:', error);
            return;
        }
        console.log('Available printers and ports:');
        console.log(stdout);

        // Initialize ZPL printer after getting printer list
        zplPrinter = new ZPLPrinter({
            type: 'usb',
            printerName: 'ZebraPrinter', // We'll update this based on what we find
        });
        
        console.log('ZPL Printer initialized with config:', zplPrinter.config);
    });
}

async function listAvailablePorts() {
    try {
        const ports = await SerialPort.list();
        console.log('Available ports:', ports);
        return ports;
    } catch (err) {
        console.error('Error listing ports:', err);
        return [];
    }
}

// Function to fetch only shared printers
function getSharedPrinters() {
    return new Promise((resolve, reject) => {
        exec('powershell "Get-Printer | Where-Object { $_.Shared -eq $true } | Select-Object -ExpandProperty Name"', 
        (error, stdout, stderr) => {
            if (error) {
                reject(stderr || error);
                return;
            }
            const printers = stdout.split("\n").map(line => line.trim()).filter(line => line);
            resolve(printers);
        });
    });
}


ipcMain.handle("get-shared-printers", async () => {
    try {
        return await getSharedPrinters();
    } catch (error) {
        console.error("Error fetching shared printers:", error);
        return [];
    }
});

async function findAvailablePort() {
    try {
        const ports = await listAvailablePorts();
        const availablePorts = ports.map(port => port.path);
        if (availablePorts.includes(SERIAL_CONFIG.defaultPath)) {
            return SERIAL_CONFIG.defaultPath;
        }
        // Only try COM3, do not scan alternatives
        return null;
    } catch (err) {
        console.error('Error finding available port:', err);
        return null;
    }
}

async function initSerialPort() {
    if (isPortBusy) {
        console.log('Port initialization already in progress...');
        return;
    }
    
    isPortBusy = true;
    
    try {
        const availablePort = await findAvailablePort();
        if (!availablePort) {
            throw new Error('No available serial ports found');
        }

        await closeSerialPort();

        return new Promise((resolve, reject) => {
            serialPort = new SerialPort({
                path: availablePort,
                baudRate: SERIAL_CONFIG.baudRate,
                autoOpen: false // We'll open manually after setting up listeners
            });

            // Set up all event listeners BEFORE opening the port
            serialPort.on('error', (err) => {
                handleSerialError('Serial port error', err);
            });

            serialPort.on('open', () => {
                isPortBusy = false;
                console.log(`Serial port ${availablePort} successfully opened`);
                notifyRenderer('serial-status', { 
                    connected: true, 
                    port: availablePort 
                });
                setupParser();
                lastDataTime = Date.now(); // Reset the data timer
                resolve();
            });

            serialPort.on('close', async () => {
                console.log('Serial port closed');
                notifyRenderer('serial-status', { connected: false });
                if (!isPortBusy) {
                    await handlePortDisconnection();
                }
            });

            // Now open the port
            serialPort.open();
        });
    } catch (err) {
        isPortBusy = false;
        handleSerialError('Failed to create serial port', err);
        throw err;
    }
}

async function handlePortDisconnection() {
    isPortBusy = true;
    let reconnectAttempts = 0;
    const maxAttempts = 10;
    const retryDelay = 1000;
    
    const tryReconnect = async () => {
        reconnectAttempts++;
        console.log(`[Reconnect Attempt ${reconnectAttempts}] Scanning for COM3...`);
        try {
            const port = await findAvailablePort();
            if (port) {
                console.log(`[Reconnect Attempt ${reconnectAttempts}] COM3 found, trying to connect...`);
                await initSerialPort();
                console.log(`[Reconnect Attempt ${reconnectAttempts}] Reconnected to COM3 successfully.`);
                isPortBusy = false;
                // Notify renderer process to trigger any post-reconnect logic
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('serial-reconnected');
                }
            } else {
                if (reconnectAttempts < maxAttempts) {
                    console.log(`[Reconnect Attempt ${reconnectAttempts}] COM3 not found, will retry in ${retryDelay/1000} second.`);
                    setTimeout(tryReconnect, retryDelay);
                } else {
                    console.log(`Max reconnect attempts (${maxAttempts}) reached. Giving up.`);
                    isPortBusy = false;
                }
            }
        } catch (err) {
            console.error(`[Reconnect Attempt ${reconnectAttempts}] Reconnect attempt failed:`, err);
            if (reconnectAttempts < maxAttempts) {
                setTimeout(tryReconnect, retryDelay);
            } else {
                console.log(`Max reconnect attempts (${maxAttempts}) reached. Giving up.`);
                isPortBusy = false;
            }
        }
    };
    await tryReconnect();
}

function setupParser() {
    try {
        // Remove old parser and listeners if they exist
        if (parser) {
            parser.removeAllListeners();
            parser.destroy();
        }
        
        if (serialPort) {
            serialPort.removeAllListeners('data');
        }

        // Create new parser
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

        parser.on('data', (data) => {
            try {
                lastDataTime = Date.now();
                const rawData = data.toString().trim();
                console.log('Received weight data:', rawData);
                
                if (mainWindow && rawData.length > 0) {
                    notifyRenderer('update-weight', { 
                        weight: rawData, 
                        timestamp: new Date().toISOString(),
                        port: serialPort.path
                    });
                }
            } catch (err) {
                console.error('Error processing weight data:', err);
            }
        });

        // Also listen to raw data as a fallback
        serialPort.on('data', (data) => {
            lastDataTime = Date.now();
            const rawData = data.toString().trim();
            console.log('Raw port data:', rawData);
            
            if (mainWindow && rawData.length > 0) {
                notifyRenderer('update-weight', { 
                    weight: rawData, 
                    timestamp: new Date().toISOString(),
                    port: serialPort.path
                });
            }
        });

        // Handle parser errors
        parser.on('error', (err) => {
            console.error('Parser error:', err);
        });
    } catch (err) {
        console.error('Parser setup failed:', err);
    }
}

// Add function to monitor data timeout and restart connection
function monitorDataTimeout() {
    setInterval(async () => {
        if (serialPort && serialPort.isOpen && (Date.now() - lastDataTime) > DATA_TIMEOUT) {
            console.log(`No data received for ${DATA_TIMEOUT/1000} seconds. Checking connection...`);
            
            // First try sending a simple command to check if the port is responsive
            try {
                if (serialPort.isOpen) {
                    serialPort.write('GET_DATA\n', (err) => {
                        if (err) {
                            console.error('Error writing to port:', err);
                            // If write fails, try reconnecting
                            initSerialPort().catch(err => {
                                console.error('Reconnection attempt failed:', err);
                            });
                        }
                    });
                }
            } catch (err) {
                console.error('Error checking port responsiveness:', err);
                // If any error occurs, try reconnecting
                initSerialPort().catch(err => {
                    console.error('Reconnection attempt failed:', err);
                });
            }
        }
    }, 2000); // Check every 2 seconds
}
// Update app.whenReady to include data timeout monitoring


async function closeSerialPort() {
    if (serialPort && serialPort.isOpen) {
        return new Promise((resolve, reject) => {
            serialPort.close((err) => {
                if (err) {
                    console.error('Error closing port:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    return Promise.resolve();
}

function handleSerialError(context, error) {
    const errorDetails = {
        context,
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        portInfo: serialPort ? {
            path: serialPort.path,
            isOpen: serialPort.isOpen
        } : null
    };
    
    console.error('Serial Error:', errorDetails);
    notifyRenderer('serial-error', errorDetails);
}

function notifyRenderer(channel, data) {
    if (mainWindow) {
        mainWindow.webContents.send(channel, data);
    }
}

app.whenReady().then(async () => {
    try {
        createWindow();
        
        // Initial port check and connection
        await initSerialPort();
        
        // Start monitoring for data timeout
        monitorDataTimeout();
        
        // Check for updates
        autoUpdater.checkForUpdatesAndNotify();
        
        // Check for updates every 30 minutes
        setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify();
        }, 30 * 60 * 1000);
    } catch (err) {
        console.error('Error during app initialization:', err);
    }
});

app.on('window-all-closed', async () => {
    try {
        await closeSerialPort();
        if (process.platform !== 'darwin') {
            app.quit();
        }
    } catch (err) {
        console.error('Error during app cleanup:', err);
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('get-available-ports', async () => {
    try {
        return await listAvailablePorts();
    } catch (err) {
        console.error('Error handling get-available-ports:', err);
        return [];
    }
});

ipcMain.on('select-port', async (event, portPath) => {
    try {
        SERIAL_CONFIG.defaultPath = portPath;
        await initSerialPort();
    } catch (err) {
        console.error('Error handling select-port:', err);
        handleSerialError('Port selection failed', err);
    }
});

ipcMain.on('refresh-connection', async () => {
    try {
        await initSerialPort();
    } catch (err) {
        console.error('Manual refresh failed:', err);
    }
});
ipcMain.on('restart-serial', async () => {
    try {
        await initSerialPort();
    } catch (err) {
        console.error('Error handling restart-serial:', err);
        handleSerialError('Restart failed', err);
    }
});

// Add new IPC handler for printing
ipcMain.on('print-label', async (event, data) => {
    try {
        // Store original data for potential retry
        const printData = {
            originalData: data,
            timestamp: new Date().toISOString()
        };

        await zplPrinter.print(data);
        
        event.reply('print-status', { 
            success: true,
            data: printData
        });
    } catch (err) {
        const errorMessage = {
            success: false,
            error: err.message,
            details: {
                code: err.code,
                syscall: err.syscall,
                path: err.path
            },
            originalData: data  // Include original data for retry
        };
        
        event.reply('print-status', errorMessage);
    }
});

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    notifyRenderer('update-status', 'Checking for update...');
});

autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    notifyRenderer('update-status', 'Update available. Downloading...');
});

autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    notifyRenderer('update-status', 'You are running the latest version.');
});

autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    notifyRenderer('update-status', 'Error checking for updates.');
});

autoUpdater.on('download-progress', (progressObj) => {
    let message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`;
    log.info(message);
    notifyRenderer('update-status', message);
});

autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    notifyRenderer('update-status', 'Update downloaded. Will install on restart.');
});

